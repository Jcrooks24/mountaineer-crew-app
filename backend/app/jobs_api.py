from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.db.session import engine

router = APIRouter(prefix="/api/job-registry", tags=["job-registry"])


# -----------------------
# Models
# -----------------------
class JobUpsertIn(BaseModel):
    job_uuid: str = Field(..., min_length=1)
    job_name: str = ""
    job_date: str = Field(..., min_length=10)  # YYYY-MM-DD
    status: str = Field("active")  # active|closed
    calendar_event_id: Optional[str] = None


# -----------------------
# Schema helpers
# -----------------------
TABLE = "jobs_registry"
REQUIRED_COLS = {
    "job_uuid": "TEXT PRIMARY KEY",
    "job_name": "TEXT NOT NULL DEFAULT ''",
    "job_date": "TEXT NOT NULL",
    "status": "TEXT NOT NULL DEFAULT 'active'",
    "calendar_event_id": "TEXT",
    "updated_at": "TEXT NOT NULL",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_registry_table():
    """
    Ensure jobs_registry exists and has required columns.
    If table exists but schema is wrong, we drop/recreate (dev-friendly; user said no data to preserve).
    """
    with engine.begin() as conn:
        # Create table if missing
        conn.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {TABLE} (
                    job_uuid TEXT PRIMARY KEY,
                    job_name TEXT NOT NULL DEFAULT '',
                    job_date TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    calendar_event_id TEXT,
                    updated_at TEXT NOT NULL
                );
                """
            )
        )

        # Check columns
        cols = conn.execute(text(f"PRAGMA table_info({TABLE});")).fetchall()
        existing = {row[1] for row in cols}  # row[1] = name

        if not set(REQUIRED_COLS.keys()).issubset(existing):
            # Drop & recreate to fix old schema
            conn.execute(text(f"DROP TABLE IF EXISTS {TABLE};"))
            conn.execute(
                text(
                    f"""
                    CREATE TABLE {TABLE} (
                        job_uuid TEXT PRIMARY KEY,
                        job_name TEXT NOT NULL DEFAULT '',
                        job_date TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'active',
                        calendar_event_id TEXT,
                        updated_at TEXT NOT NULL
                    );
                    """
                )
            )

        # Indexes (safe)
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_job_date ON {TABLE}(job_date);"))
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_cal ON {TABLE}(job_date, calendar_event_id);"))


# -----------------------
# Routes
# -----------------------
@router.post("/upsert")
def upsert_job(payload: JobUpsertIn):
    ensure_registry_table()

    status = payload.status.strip().lower()
    if status not in ("active", "closed"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'closed'")

    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO {TABLE} (job_uuid, job_name, job_date, status, calendar_event_id, updated_at)
                VALUES (:job_uuid, :job_name, :job_date, :status, :calendar_event_id, :updated_at)
                ON CONFLICT(job_uuid) DO UPDATE SET
                    job_name = excluded.job_name,
                    job_date = excluded.job_date,
                    status = excluded.status,
                    calendar_event_id = excluded.calendar_event_id,
                    updated_at = excluded.updated_at
                ;
                """
            ),
            {
                "job_uuid": payload.job_uuid.strip(),
                "job_name": payload.job_name.strip(),
                "job_date": payload.job_date.strip(),
                "status": status,
                "calendar_event_id": (payload.calendar_event_id.strip() if payload.calendar_event_id else None),
                "updated_at": _utc_now_iso(),
            },
        )

    return {"ok": True, "job_uuid": payload.job_uuid.strip()}


@router.get("/by-calendar")
def get_by_calendar(
    date: str = Query(..., min_length=10),
    calendar_event_id: str = Query(..., min_length=1),
):
    """
    Return job_uuid bound to (date + calendar_event_id) if exists.
    """
    ensure_registry_table()

    with engine.begin() as conn:
        row = conn.execute(
            text(
                f"""
                SELECT job_uuid
                FROM {TABLE}
                WHERE job_date = :job_date
                  AND calendar_event_id = :calendar_event_id
                LIMIT 1
                """
            ),
            {"job_date": date.strip(), "calendar_event_id": calendar_event_id.strip()},
        ).mappings().first()

    return {"ok": True, "job_uuid": (row["job_uuid"] if row else None)}

@router.get("/{job_uuid}")
def get_job(job_uuid: str):
    ensure_registry_table()

    with engine.begin() as conn:
        row = conn.execute(
            text(
                f"""
                SELECT job_uuid, job_name, job_date, status, calendar_event_id, updated_at
                FROM {TABLE}
                WHERE job_uuid = :job_uuid
                """
            ),
            {"job_uuid": job_uuid.strip()},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    return {"ok": True, "job": dict(row)}
