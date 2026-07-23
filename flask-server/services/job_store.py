"""Job state access, backed by the ``job`` table.

The single seam the app goes through for inference-job state, replacing the old
in-memory ``inference_jobs`` dict + job.json mirror. Each function owns its DB
session via ``session_scope`` so it works from both a Flask request thread and
(later) the standalone worker, neither needing an app context.

Leasing/claim logic is inert until the worker lands; keeping it here now makes
that step additive.
"""

import json
import os
from datetime import timedelta

from sqlalchemy import select

from models.engine import session_scope
from models.job import (
    Job, utcnow, TERMINAL_STATUSES,
    STATUS_QUEUED, STATUS_RUNNING, STATUS_FAILED, STATUS_CANCELLED,
)


def create_job(session_id: str, model: str, ct_path: str | None,
               session_path: str | None, zip_path: str | None) -> dict:
    """Insert (or reset) a queued job. Re-submitting a session id overwrites the
    prior row (frontend reuses the id on retry; last-write-wins)."""
    with session_scope() as s:
        job = s.get(Job, session_id)
        if job is None:
            job = Job(session_id=session_id)
            s.add(job)
        job.model = model
        job.status = STATUS_QUEUED
        job.error = None
        job.ct_path = ct_path
        job.session_path = session_path
        job.zip_path = zip_path
        job.output_mask_dir = None
        job.lease_owner = None
        job.lease_expires_at = None
        job.attempts = 0
        job.cancel_requested = False
        s.flush()
        return job.to_dict()


def upsert_job(session_id: str, **fields) -> dict:
    """Create the row if absent, then set the given columns. Drop-in for the old
    ``_set_inference_job(**kwargs)``; the first call carries status + model."""
    with session_scope() as s:
        job = s.get(Job, session_id)
        if job is None:
            job = Job(session_id=session_id)
            s.add(job)
        for key, value in fields.items():
            if not hasattr(job, key):
                raise AttributeError(f"Job has no field {key!r}")
            setattr(job, key, value)
        s.flush()
        return job.to_dict()


def get_job(session_id: str) -> dict | None:
    """Return the job as a dict, or None if unknown. Never raises for a miss."""
    with session_scope() as s:
        job = s.get(Job, session_id)
        return job.to_dict() if job else None


def update_job(session_id: str, **fields) -> dict | None:
    """Patch columns on an existing job (unknown id -> None). Unknown field names
    raise, so a typo fails loudly rather than being silently dropped."""
    if not fields:
        return get_job(session_id)
    with session_scope() as s:
        job = s.get(Job, session_id)
        if job is None:
            return None
        for key, value in fields.items():
            if not hasattr(job, key):
                raise AttributeError(f"Job has no field {key!r}")
            setattr(job, key, value)
        s.flush()
        return job.to_dict()


def request_cancel(session_id: str) -> dict | None:
    """Flag a job for cancellation. A queued job goes straight to cancelled; a
    running one keeps the flag for its worker to tear down."""
    with session_scope() as s:
        job = s.get(Job, session_id)
        if job is None:
            return None
        job.cancel_requested = True
        if job.status == STATUS_QUEUED:
            job.status = STATUS_CANCELLED
            job.error = "Cancelled by user"
        s.flush()
        return job.to_dict()


def is_cancel_requested(session_id: str) -> bool:
    with session_scope() as s:
        job = s.get(Job, session_id)
        return bool(job and job.cancel_requested)


# ---- worker-facing leasing (inert until the worker process exists) --------

def claim_next_job(worker_id: str, lease_seconds: int = 1800) -> dict | None:
    """Atomically claim the oldest queued (or lease-expired) job, or None. The
    read + status flip share one transaction, so two workers can't both win it."""
    now = utcnow()
    with session_scope() as s:
        stmt = (
            select(Job)
            .where(
                (Job.status == STATUS_QUEUED)
                | ((Job.status == STATUS_RUNNING) & (Job.lease_expires_at < now))
            )
            .where(Job.cancel_requested.is_(False))
            .order_by(Job.created_at.asc())
            .limit(1)
        )
        job = s.execute(stmt).scalar_one_or_none()
        if job is None:
            return None
        job.status = STATUS_RUNNING
        job.lease_owner = worker_id
        job.lease_expires_at = now + timedelta(seconds=lease_seconds)
        job.attempts = (job.attempts or 0) + 1
        s.flush()
        return job.to_dict()


def fail_all_active(error: str = "Cancelled by user") -> int:
    """Mark every queued/running job failed (backs the admin 'stop everything').
    Returns the number affected."""
    with session_scope() as s:
        stmt = select(Job).where(Job.status.in_((STATUS_QUEUED, STATUS_RUNNING)))
        active = s.execute(stmt).scalars().all()
        for job in active:
            job.status = STATUS_FAILED
            job.error = error
            job.lease_owner = None
            job.lease_expires_at = None
        return len(active)


def import_legacy_job_json(sessions_dir: str) -> int:
    """One-time import of pre-DB ``sessions/<id>/job.json`` files. Returns count.

    Keeps results that completed before this deploy viewable: /session-ct and
    /session-segmentation read ct_path / output_mask_dir off the job record,
    which the empty post-deploy DB wouldn't have. Idempotent (skips ids already
    in the DB); best-effort per file so one bad json can't block boot.
    """
    if not sessions_dir or not os.path.isdir(sessions_dir):
        return 0

    imported = 0
    for name in os.listdir(sessions_dir):
        meta_path = os.path.join(sessions_dir, name, "job.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path) as f:
                data = json.load(f)
            if not isinstance(data, dict):
                continue
            with session_scope() as s:
                if s.get(Job, name) is not None:
                    continue
                job = Job(session_id=name)
                job.model = data.get("model") or "unknown"
                job.status = data.get("status") or STATUS_FAILED
                for key in ("error", "ct_path", "session_path", "zip_path", "output_mask_dir"):
                    if key in data:
                        setattr(job, key, data.get(key))
                s.add(job)
            imported += 1
        except Exception as e:
            print(f"[job import] {name}: {e}")
    return imported


def reap_orphaned_jobs() -> int:
    """Fail any job mid-flight when its runner died; returns the count. Run once
    at boot. Lease-aware: a job with an unexpired lease is held by a live worker
    and left alone. This phase sets no lease, so all in-flight jobs are reaped —
    correct while inference runs inside the web process itself."""
    now = utcnow()
    with session_scope() as s:
        stmt = select(Job).where(
            Job.status.in_((STATUS_QUEUED, STATUS_RUNNING)),
            (Job.lease_expires_at.is_(None)) | (Job.lease_expires_at < now),
        )
        orphans = s.execute(stmt).scalars().all()
        for job in orphans:
            job.status = STATUS_FAILED
            job.error = job.error or "Interrupted by server restart"
            job.lease_owner = None
            job.lease_expires_at = None
        return len(orphans)


def heartbeat(session_id: str, worker_id: str, lease_seconds: int = 1800) -> bool:
    """Extend a lease the worker still owns; False if the job was reassigned or
    finished under it (the worker should then stop)."""
    now = utcnow()
    with session_scope() as s:
        job = s.get(Job, session_id)
        if job is None or job.lease_owner != worker_id:
            return False
        if job.status in TERMINAL_STATUSES:
            return False
        job.lease_expires_at = now + timedelta(seconds=lease_seconds)
        s.flush()
        return True
