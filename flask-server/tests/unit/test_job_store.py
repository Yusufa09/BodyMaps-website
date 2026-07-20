"""Unit tests for the SQLite-backed inference job store: create/upsert/get, the
worker leasing/claim path, cancellation, and the boot-time reap. Each test gets
its own temp-file database (not :memory:, so real WAL/locking behaviour applies).
"""

import importlib
import os

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """Point the engine at a fresh temp DB and hand back the job_store module.

    constants.Constants.DATABASE_URL is read at import time, so we set the env
    var and reload the modules that captured it, then reset the cached engine.
    """
    db_path = tmp_path / "jobs.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.job  # noqa: F401
    import services.job_store as job_store
    importlib.reload(job_store)

    engine.reset_engine_for_tests()
    engine.create_all()
    yield job_store
    engine.reset_engine_for_tests()


def test_create_and_get(store):
    job = store.create_job("s1", "ePAI", "/in/ct.nii.gz", "/sess/s1", "/sess/s1/out.zip")
    assert job["status"] == "queued"
    assert job["model"] == "ePAI"
    got = store.get_job("s1")
    assert got["ct_path"] == "/in/ct.nii.gz"
    assert store.get_job("missing") is None


def test_upsert_creates_then_patches(store):
    # First upsert must carry the NOT NULL columns (mirrors the real first call).
    store.upsert_job("s1", status="queued", model="ePAI")
    store.upsert_job("s1", status="running")
    store.upsert_job("s1", status="completed", zip_path="/z.zip")
    job = store.get_job("s1")
    assert job["status"] == "completed"
    assert job["zip_path"] == "/z.zip"
    assert job["model"] == "ePAI"  # preserved across patches


def test_update_unknown_field_raises(store):
    store.create_job("s1", "ePAI", None, None, None)
    with pytest.raises(AttributeError):
        store.update_job("s1", not_a_column=1)


def test_update_missing_job_returns_none(store):
    assert store.update_job("ghost", status="failed") is None


def test_claim_is_exclusive_and_oldest_first(store):
    store.create_job("old", "ePAI", None, None, None)
    store.create_job("new", "ePAI", None, None, None)
    # Force a deterministic ordering rather than relying on wall-clock ties.
    store.update_job("old", created_at=_dt("2026-01-01T00:00:00"))
    store.update_job("new", created_at=_dt("2026-01-02T00:00:00"))

    first = store.claim_next_job("w1")
    assert store.get_job("old")["status"] == "running"
    assert store.get_job("new")["status"] == "queued"  # not double-claimed

    store.claim_next_job("w2")
    assert store.get_job("new")["status"] == "running"

    assert store.claim_next_job("w3") is None  # nothing left


def test_heartbeat_owner_semantics(store):
    store.create_job("s1", "ePAI", None, None, None)
    store.claim_next_job("w1")
    assert store.heartbeat("s1", "w1") is True
    assert store.heartbeat("s1", "w2") is False   # wrong owner
    store.update_job("s1", status="completed")
    assert store.heartbeat("s1", "w1") is False   # terminal


def test_expired_lease_is_reclaimable(store):
    from datetime import timedelta
    from models.job import utcnow

    store.create_job("s1", "ePAI", None, None, None)
    store.claim_next_job("dead")
    store.update_job("s1", lease_expires_at=utcnow() - timedelta(seconds=1))

    reclaimed = store.claim_next_job("live")
    assert reclaimed is not None
    job = store.get_job("s1")
    assert job["status"] == "running"
    # attempts is worker-internal (not in the client-facing to_dict), so read
    # the column straight from the row: it increments on every claim.
    from models.engine import session_scope
    from models.job import Job
    with session_scope() as s:
        assert s.get(Job, "s1").attempts == 2
        assert s.get(Job, "s1").lease_owner == "live"


def test_cancel_queued_moves_to_cancelled(store):
    store.create_job("s1", "ePAI", None, None, None)
    store.request_cancel("s1")
    assert store.get_job("s1")["status"] == "cancelled"
    # A cancelled/flagged job is never handed to a worker.
    assert store.claim_next_job("w1") is None


def test_cancel_running_sets_flag_only(store):
    store.create_job("s1", "ePAI", None, None, None)
    store.claim_next_job("w1")
    store.request_cancel("s1")
    job = store.get_job("s1")
    assert job["status"] == "running"          # left for the worker to tear down
    assert job["cancel_requested"] is True
    assert store.is_cancel_requested("s1") is True


def test_reap_fails_orphaned_jobs(store):
    store.create_job("queued", "ePAI", None, None, None)
    store.create_job("running", "ePAI", None, None, None)
    store.claim_next_job("w1")  # claims "queued" (oldest) -> running

    # Both are in-flight with no live lease window that outlasts a restart:
    # simulate the runner having died by expiring/clearing leases.
    from datetime import timedelta
    from models.job import utcnow
    store.update_job("queued", lease_expires_at=utcnow() - timedelta(seconds=1))

    n = store.reap_orphaned_jobs()
    assert n >= 1
    assert store.get_job("queued")["status"] == "failed"
    assert "restart" in (store.get_job("queued")["error"] or "").lower()


def test_reap_leaves_live_lease_alone(store):
    from datetime import timedelta
    from models.job import utcnow

    store.create_job("s1", "ePAI", None, None, None)
    store.claim_next_job("w1")
    # Fresh, future lease => a live worker holds it; reap must not touch it.
    store.update_job("s1", lease_expires_at=utcnow() + timedelta(minutes=30))
    store.reap_orphaned_jobs()
    assert store.get_job("s1")["status"] == "running"


def test_fail_all_active(store):
    store.create_job("a", "ePAI", None, None, None)
    store.create_job("b", "ePAI", None, None, None)
    store.update_job("b", status="completed")
    n = store.fail_all_active()
    assert n == 1
    assert store.get_job("a")["status"] == "failed"
    assert store.get_job("b")["status"] == "completed"  # terminal untouched


def test_import_legacy_job_json(store, tmp_path):
    import json

    sessions = tmp_path / "sessions"
    # A completed legacy job with result paths, and a stuck "running" one.
    for sid, payload in [
        ("legacy-done", {"status": "completed", "model": "ePAI",
                          "ct_path": "/s/legacy-done/ct.nii.gz",
                          "output_mask_dir": "/s/legacy-done/out"}),
        ("legacy-stuck", {"status": "running", "model": "ePAI"}),
        # No status/model: exercises the STATUS_FAILED / "unknown" fallbacks.
        ("legacy-bare", {}),
    ]:
        d = sessions / sid
        d.mkdir(parents=True)
        (d / "job.json").write_text(json.dumps(payload))
    # A session dir with no job.json must be ignored, not crash.
    (sessions / "no-meta").mkdir()

    n = store.import_legacy_job_json(str(sessions))
    assert n == 3
    bare = store.get_job("legacy-bare")
    assert bare["status"] == "failed"   # STATUS_FAILED fallback
    assert bare["model"] == "unknown"
    done = store.get_job("legacy-done")
    assert done["status"] == "completed"
    assert done["output_mask_dir"] == "/s/legacy-done/out"

    # Re-import is an idempotent no-op (row already exists).
    assert store.import_legacy_job_json(str(sessions)) == 0

    # The subsequent reap fails the imported-but-stuck one.
    store.reap_orphaned_jobs()
    assert store.get_job("legacy-stuck")["status"] == "failed"
    assert store.get_job("legacy-done")["status"] == "completed"  # terminal kept


def test_import_legacy_missing_dir_is_noop(store):
    assert store.import_legacy_job_json("/no/such/dir") == 0
    assert store.import_legacy_job_json("") == 0


def _dt(iso: str):
    from datetime import datetime
    return datetime.fromisoformat(iso)
