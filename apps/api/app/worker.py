from __future__ import annotations

import logging
import signal
import threading
import time
import traceback
from datetime import datetime
from typing import Optional

from .db import SessionLocal
from .migrations import ensure_schema
from .db import engine
from .models import Run
from .services.job_queue import RunQueue, TERMINAL_STATUSES, new_worker_id
from .services.runtime import AgentRuntime


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("agentforge.worker")


class RuntimeWorker:
    def __init__(
        self,
        worker_id: Optional[str] = None,
        lease_seconds: int = 12,
        poll_interval: float = 0.4,
    ) -> None:
        self.worker_id = worker_id or new_worker_id()
        self.lease_seconds = lease_seconds
        self.poll_interval = poll_interval
        self.runtime = AgentRuntime()
        self.queue = RunQueue(lease_seconds=lease_seconds)
        self._stopping = threading.Event()

    def run_once(self) -> bool:
        db = SessionLocal()
        try:
            run = self.queue.claim_next(db, self.worker_id)
        finally:
            db.close()
        if not run:
            return False
        self._execute_claimed(run.id)
        return True

    def process_run(self, run_id: str) -> bool:
        db = SessionLocal()
        try:
            run = self.queue.claim_run(db, run_id, self.worker_id)
        finally:
            db.close()
        if not run:
            return False
        self._execute_claimed(run.id)
        return True

    def _execute_claimed(self, run_id: str) -> None:
        stop_heartbeat = threading.Event()
        heartbeat = threading.Thread(
            target=self._heartbeat_loop,
            args=(run_id, stop_heartbeat),
            daemon=True,
            name=f"heartbeat-{run_id[:8]}",
        )
        heartbeat.start()
        db = SessionLocal()
        try:
            run = db.query(Run).filter(Run.id == run_id).first()
            if not run:
                return
            if run.attempt_count > 1:
                recovering_approval = run.resume_action == "issue_refund"
                self.runtime.add_event(
                    db,
                    run,
                    "job.recovered",
                    (
                        "Worker 重新领取审批任务"
                        if recovering_approval
                        else "Worker 恢复运行"
                    ),
                    {
                        "worker_id": self.worker_id,
                        "attempt": run.attempt_count,
                        "previous_error": run.last_error or None,
                    },
                    latency_ms=0,
                )
                db.commit()
            logger.info(
                "executing run=%s worker=%s attempt=%s resume=%s",
                run.id,
                self.worker_id,
                run.attempt_count,
                run.resume_action or None,
            )
            if run.resume_action:
                self.runtime.resume_after_approval(db, run)
            else:
                self.runtime.execute(db, run)
            db.refresh(run)
            run.last_error = ""
            db.commit()
        except Exception:
            db.rollback()
            run = db.query(Run).filter(Run.id == run_id).first()
            if run:
                error = traceback.format_exc()
                run.last_error = error[-2000:]
                self.runtime.add_event(
                    db,
                    run,
                    "job.failed",
                    "Worker 执行异常",
                    {
                        "worker_id": self.worker_id,
                        "attempt": run.attempt_count,
                        "error_type": error.splitlines()[-1]
                        if error.splitlines()
                        else "UnknownError",
                    },
                    latency_ms=0,
                )
                if run.attempt_count < 3:
                    run.status = "queued"
                    run.finished_at = None
                else:
                    run.status = "failed"
                    run.output = "Worker 多次执行失败，已停止自动重试。"
                    run.finished_at = datetime.utcnow()
                db.commit()
            logger.exception("run failed: %s", run_id)
        finally:
            stop_heartbeat.set()
            heartbeat.join(timeout=1)
            run = db.query(Run).filter(Run.id == run_id).first()
            if run and run.status in TERMINAL_STATUSES:
                self.queue.release(db, run_id, self.worker_id)
            db.close()

    def _heartbeat_loop(
        self, run_id: str, stop: threading.Event
    ) -> None:
        interval = max(1.0, self.lease_seconds / 3)
        while not stop.wait(interval):
            db = SessionLocal()
            try:
                if not self.queue.heartbeat(db, run_id, self.worker_id):
                    return
            except Exception:
                logger.exception("heartbeat failed: %s", run_id)
            finally:
                db.close()

    def run_forever(self) -> None:
        ensure_schema(engine)
        logger.info("runtime worker started: %s", self.worker_id)

        def stop(*_args) -> None:
            self._stopping.set()

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        while not self._stopping.is_set():
            try:
                processed = self.run_once()
            except Exception:
                logger.exception("worker loop error")
                processed = False
            if not processed:
                self._stopping.wait(self.poll_interval)
        logger.info("runtime worker stopped: %s", self.worker_id)


if __name__ == "__main__":
    RuntimeWorker().run_forever()
