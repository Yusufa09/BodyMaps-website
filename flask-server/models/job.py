"""Inference job state.

Replaces the in-memory ``inference_jobs`` dict and its ``sessions/<id>/job.json``
mirror, which were lost on restart. Rows carry an explicit lease, so liveness is
a fact rather than an inference.

Timestamps are naive UTC (SQLite has no tz type). Always write via ``utcnow()``.
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from models.base import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# A job in one of these will never change again.
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})

# Wire values the frontend switches on; changing them is a breaking API change.
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"


class Job(db.Model):
    __tablename__ = "job"

    # The session id the frontend already generates and polls with, reused as PK
    # so existing URLs (/inference-status/<id>, /get_result/<id>) keep working.
    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)

    model: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=STATUS_QUEUED)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    ct_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    zip_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_mask_dir: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lease + cancellation. Inert until the out-of-process worker lands; included
    # now so that step is a code-only deploy with no second migration. An expired
    # lease means the worker died and the job can be reclaimed / reaped.
    lease_owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    __table_args__ = (
        Index("ix_job_status_created_at", "status", "created_at"),
    )

    def to_dict(self) -> dict:
        """Client-facing shape, matching the old inference_jobs dict key-for-key.
        Excludes lease internals (lease_owner/lease_expires_at/attempts)."""
        return {
            "status": self.status,
            "model": self.model,
            "error": self.error,
            "ct_path": self.ct_path,
            "session_path": self.session_path,
            "zip_path": self.zip_path,
            "output_mask_dir": self.output_mask_dir,
            "cancel_requested": self.cancel_requested,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self) -> str:
        return f"<Job {self.session_id} {self.status} model={self.model}>"
