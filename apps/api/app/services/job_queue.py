from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from ..models import Run


TERMINAL_STATUSES = {
    "completed",
    "failed",
    "rejected",
    "needs_input",
    "waiting_approval",
}
ACTIVE_STATUSES = {"queued", "running"}


class RunQueue:
    def __init__(self, lease_seconds: int = 12) -> None:
        self.lease_seconds = lease_seconds

    def recover_expired(self, db: Session, limit: int = 20) -> int:
        now = datetime.utcnow()
        expired = (
            db.query(Run)
            .filter(
                Run.status == "running",
                Run.lease_expires_at.isnot(None),
                Run.lease_expires_at < now,
            )
            .limit(limit)
            .all()
        )
        recovered = 0
        for run in expired:
            previous_worker = run.worker_id
            updated = (
                db.query(Run)
                .filter(
                    Run.id == run.id,
                    Run.status == "running",
                    Run.lease_expires_at < now,
                )
                .update(
                    {
                        Run.status: "queued",
                        Run.worker_id: None,
                        Run.lease_expires_at: None,
                        Run.heartbeat_at: None,
                        Run.last_error: (
                            f"Worker lease expired"
                            + (f" ({previous_worker})" if previous_worker else "")
                        ),
                    },
                    synchronize_session=False,
                )
            )
            recovered += updated
        if recovered:
            db.commit()
        return recovered

    def claim_next(self, db: Session, worker_id: str) -> Optional[Run]:
        self.recover_expired(db)
        now = datetime.utcnow()
        lease_until = now + timedelta(seconds=self.lease_seconds)
        dialect = db.bind.dialect.name if db.bind is not None else ""

        if dialect == "postgresql":
            run = (
                db.query(Run)
                .filter(Run.status == "queued")
                .order_by(Run.started_at)
                .with_for_update(skip_locked=True)
                .first()
            )
            if not run:
                db.rollback()
                return None
            run.status = "running"
            run.worker_id = worker_id
            run.lease_expires_at = lease_until
            run.heartbeat_at = now
            run.attempt_count += 1
            db.commit()
            db.refresh(run)
            return run

        candidates = (
            db.query(Run.id)
            .filter(Run.status == "queued")
            .order_by(Run.started_at)
            .limit(10)
            .all()
        )
        for (run_id,) in candidates:
            updated = (
                db.query(Run)
                .filter(Run.id == run_id, Run.status == "queued")
                .update(
                    {
                        Run.status: "running",
                        Run.worker_id: worker_id,
                        Run.lease_expires_at: lease_until,
                        Run.heartbeat_at: now,
                        Run.attempt_count: Run.attempt_count + 1,
                    },
                    synchronize_session=False,
                )
            )
            if updated:
                db.commit()
                return db.query(Run).filter(Run.id == run_id).first()
        db.rollback()
        return None

    def claim_run(
        self, db: Session, run_id: str, worker_id: str
    ) -> Optional[Run]:
        now = datetime.utcnow()
        lease_until = now + timedelta(seconds=self.lease_seconds)
        updated = (
            db.query(Run)
            .filter(Run.id == run_id, Run.status == "queued")
            .update(
                {
                    Run.status: "running",
                    Run.worker_id: worker_id,
                    Run.lease_expires_at: lease_until,
                    Run.heartbeat_at: now,
                    Run.attempt_count: Run.attempt_count + 1,
                },
                synchronize_session=False,
            )
        )
        if not updated:
            db.rollback()
            return None
        db.commit()
        return db.query(Run).filter(Run.id == run_id).first()

    def heartbeat(self, db: Session, run_id: str, worker_id: str) -> bool:
        now = datetime.utcnow()
        updated = (
            db.query(Run)
            .filter(
                Run.id == run_id,
                Run.status == "running",
                Run.worker_id == worker_id,
            )
            .update(
                {
                    Run.heartbeat_at: now,
                    Run.lease_expires_at: now
                    + timedelta(seconds=self.lease_seconds),
                },
                synchronize_session=False,
            )
        )
        db.commit()
        return bool(updated)

    def release(self, db: Session, run_id: str, worker_id: str) -> None:
        db.execute(
            update(Run)
            .where(Run.id == run_id, Run.worker_id == worker_id)
            .values(
                lease_expires_at=None,
                heartbeat_at=None,
            )
        )
        db.commit()


def new_worker_id() -> str:
    return f"worker-{uuid.uuid4().hex[:8]}"

