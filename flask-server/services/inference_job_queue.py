import os
import json
import uuid
import time
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from contextlib import contextmanager
import fcntl


class InferenceJobQueue:
    def __init__(self, root_dir: str):
        self.root_dir = os.path.abspath(root_dir)
        self.jobs_dir = os.path.join(self.root_dir, "jobs")
        self.inputs_dir = os.path.join(self.root_dir, "inputs")
        self.results_dir = os.path.join(self.root_dir, "results")
        self.lock_path = os.path.join(self.root_dir, ".lock")
        os.makedirs(self.jobs_dir, exist_ok=True)
        os.makedirs(self.inputs_dir, exist_ok=True)
        os.makedirs(self.results_dir, exist_ok=True)
        open(self.lock_path, "a").close()

    @contextmanager
    def _locked(self):
        with open(self.lock_path, "r+") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _job_path(self, job_id: str) -> str:
        return os.path.join(self.jobs_dir, f"{job_id}.json")

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _read_job(self, job_id: str):
        path = self._job_path(job_id)
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_job(self, job: dict):
        path = self._job_path(job["job_id"])
        tmp_fd, tmp_path = tempfile.mkstemp(prefix="job_", suffix=".json", dir=self.jobs_dir)
        os.close(tmp_fd)
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False)
        os.replace(tmp_path, path)

    def create_job(self, input_file_path: str, session_id: str | None = None, model: str = "ePAI", max_attempts: int = 3):
        if not os.path.exists(input_file_path):
            raise FileNotFoundError(f"Input file not found: {input_file_path}")

        job_id = str(uuid.uuid4())
        session_id = session_id or job_id

        ext = ".nii.gz" if input_file_path.lower().endswith(".nii.gz") else os.path.splitext(input_file_path)[1]
        if not ext:
            ext = ".nii.gz"

        input_copy_path = os.path.join(self.inputs_dir, f"{job_id}{ext}")
        shutil.copy2(input_file_path, input_copy_path)

        now = self._now()
        job = {
            "job_id": job_id,
            "session_id": session_id,
            "model": model,
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "attempts": 0,
            "max_attempts": int(max_attempts),
            "lease_owner": None,
            "lease_until": None,
            "error": None,
            "input_file_path": input_copy_path,
            "result_mask_path": None,
            "result_csv_path": None,
            "result_zip_path": None,
        }

        with self._locked():
            self._write_job(job)

        return job

    def get_job(self, job_id: str):
        with self._locked():
            return self._read_job(job_id)

    def lease_next_job(self, worker_id: str, lease_seconds: int = 900):
        lease_seconds = max(30, int(lease_seconds))
        now_epoch = int(time.time())

        with self._locked():
            candidates = []
            for name in os.listdir(self.jobs_dir):
                if not name.endswith(".json"):
                    continue
                path = os.path.join(self.jobs_dir, name)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        job = json.load(f)
                except Exception:
                    continue

                status = job.get("status")
                lease_until = job.get("lease_until")
                lease_expired = True
                if lease_until:
                    try:
                        lease_expired = int(lease_until) <= now_epoch
                    except Exception:
                        lease_expired = True

                if status == "queued":
                    candidates.append(job)
                elif status in {"leased", "running"} and lease_expired:
                    if int(job.get("attempts", 0)) < int(job.get("max_attempts", 3)):
                        candidates.append(job)
                    else:
                        job["status"] = "failed"
                        job["error"] = "Job exceeded max attempts after lease timeouts"
                        job["updated_at"] = self._now()
                        self._write_job(job)

            if not candidates:
                return None

            candidates.sort(key=lambda x: x.get("created_at", ""))
            job = candidates[0]
            job["status"] = "leased"
            job["attempts"] = int(job.get("attempts", 0)) + 1
            job["lease_owner"] = worker_id
            job["lease_until"] = str(now_epoch + lease_seconds)
            job["updated_at"] = self._now()
            self._write_job(job)
            return job

    def heartbeat(self, job_id: str, worker_id: str, lease_seconds: int = 900):
        lease_seconds = max(30, int(lease_seconds))
        now_epoch = int(time.time())

        with self._locked():
            job = self._read_job(job_id)
            if not job:
                return None
            if job.get("lease_owner") != worker_id:
                raise PermissionError("Lease owner mismatch")
            if job.get("status") not in {"leased", "running"}:
                raise ValueError("Job is not active")

            job["status"] = "running"
            job["lease_until"] = str(now_epoch + lease_seconds)
            job["updated_at"] = self._now()
            self._write_job(job)
            return job

    def fail_job(self, job_id: str, worker_id: str, error: str):
        with self._locked():
            job = self._read_job(job_id)
            if not job:
                return None
            if job.get("lease_owner") != worker_id:
                raise PermissionError("Lease owner mismatch")

            job["status"] = "failed"
            job["error"] = (error or "Unknown error")[:4000]
            job["lease_until"] = None
            job["updated_at"] = self._now()
            self._write_job(job)
            return job

    def complete_job(self, job_id: str, worker_id: str, result_mask_path: str, result_csv_path: str | None = None):
        if not os.path.exists(result_mask_path):
            raise FileNotFoundError(f"Result mask not found: {result_mask_path}")
        if result_csv_path and not os.path.exists(result_csv_path):
            raise FileNotFoundError(f"Result CSV not found: {result_csv_path}")

        with self._locked():
            job = self._read_job(job_id)
            if not job:
                return None
            if job.get("lease_owner") != worker_id:
                raise PermissionError("Lease owner mismatch")

            result_dir = os.path.join(self.results_dir, job_id)
            os.makedirs(result_dir, exist_ok=True)

            mask_dest = os.path.join(result_dir, "combined_labels.nii.gz")
            shutil.copy2(result_mask_path, mask_dest)

            csv_dest = None
            if result_csv_path:
                csv_dest = os.path.join(result_dir, "output.csv")
                shutil.copy2(result_csv_path, csv_dest)

            zip_dest = os.path.join(result_dir, "auto_masks.zip")
            with zipfile.ZipFile(zip_dest, "w", zipfile.ZIP_DEFLATED) as zipf:
                zipf.write(mask_dest, arcname="combined_labels.nii.gz")
                if csv_dest and os.path.exists(csv_dest):
                    zipf.write(csv_dest, arcname="output.csv")

            job["status"] = "succeeded"
            job["error"] = None
            job["lease_until"] = None
            job["updated_at"] = self._now()
            job["result_mask_path"] = mask_dest
            job["result_csv_path"] = csv_dest
            job["result_zip_path"] = zip_dest
            self._write_job(job)
            return job
