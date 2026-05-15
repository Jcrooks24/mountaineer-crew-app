# backend/app/main.py
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.limits import BodySizeLimitMiddleware, MAX_REQUEST_BODY_BYTES
from app.db.session import Base, engine  # noqa: F401
import app.db.models.system_config  # noqa: F401 — ensure table is registered
import app.db.models.materials  # noqa: F401 — ensures table is registered with Base
import app.db.models.calendar_job  # noqa: F401 — ensures table is registered with Base
import app.db.models.photo         # noqa: F401 — ensures table is registered with Base
import app.db.models.dvir  # noqa: F401 — ensure dvirs table is registered
import app.db.models.job_report  # noqa: F401 — ensure job_reports table is registered
import app.db.models.job_bill  # noqa: F401 — ensure job_bills table is registered
import app.db.models.long_distance  # noqa: F401 — register prior_on_duty_statements table
import app.db.models.document  # noqa: F401 — register documents table
import app.db.models.estimate  # noqa: F401 — register estimates + estimate_items + furniture_catalog tables
import app.db.models.patch_note  # noqa: F401 — register patch_notes table
import app.db.models.admin_note  # noqa: F401 — register admin_notes table
import app.db.models.office_hours  # noqa: F401 — register office_hours_entries table
import app.db.models.reimbursement  # noqa: F401 — register reimbursements table

# Routers that exist
from app.routers.sync import router as sync_router
from app.routers.jobs import router as jobs_router
from app.routers.calendar import router as calendar_router
from app.routers.auth import router as auth_router
from app.routers.admin import router as admin_router
from app.routers.materials import router as materials_router
from app.routers.photos import router as photos_router
from app.routers.dvir import router as dvir_router
from app.routers.job_report import router as job_report_router
from app.routers.config import router as config_router
from app.routers.bill import router as bill_router
from app.routers.users import router as users_router
from app.routers.long_distance import router as long_distance_router
from app.routers.documents import router as documents_router
from app.routers.estimates import router as estimates_router
from app.routers.patch_notes import router as patch_notes_router
from app.routers.admin_notes import router as admin_notes_router
from app.routers.office_hours import router as office_hours_router
from app.routers.reimbursement import router as reimbursement_router


app = FastAPI(title="Mountaineer Crew App Backend")

# Hard ceiling on request body size — rejects oversized uploads with 413
# before the body reaches a router. Defense in depth: even if a future
# endpoint accidentally buffers the whole body (`await request.body()`,
# `await file.read()`), the worker can't OOM from a single request.
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_REQUEST_BODY_BYTES)

# CORS: allow browser/PWA frontends to call this API
# Why:
# - Your frontend is on Vercel, backend is on Render => cross-origin => browser preflight (OPTIONS)
# - Without CORSMiddleware, OPTIONS hits the route and returns Method Not Allowed
#
# What we allow:
# - Local dev Vite servers
# - Your known production Vercel domain
# - Any Vercel preview deployment domain (*.vercel.app) via regex (prevents "sometimes works" issues)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://mountaineer-crew-app.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    import os
    import traceback
    from app.db.session import SessionLocal
    from app.db.models.user import User

    # NOTE: Alembic migrations are NOT run here anymore. The alembic + 24-
    # migration-module import surface, alongside the live FastAPI app, was
    # putting the web worker over Render's 512 MB cap during boot. Migrations
    # now run in their own short-lived process via the start command:
    #
    #     python backend/scripts/run_migrations.py && uvicorn app.main:app ...
    #
    # If schema is stale at boot, the first DB query that needs the missing
    # column will surface a clear ProgrammingError — far easier to diagnose
    # than an OOM kill.

    # Ensure sheet export dedup tables exist (idempotent, handles deployments
    # where the initial migration ran before these tables were added).
    try:
        from app.db.sheet_exports import ensure_sheet_exports_tables
        from app.db.session import engine
        ensure_sheet_exports_tables(engine)
        print("[startup] Sheet export tables ensured.")
    except Exception:
        print("[startup] WARNING — could not ensure sheet export tables:")
        traceback.print_exc()

    # Auto-promote ADMIN_EMAIL to admin role on every startup.
    # Set this env var on Render to grant admin access without a shell.
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    if admin_email:
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == admin_email).first()
            if user and user.role != "admin":
                user.role = "admin"
                db.commit()
                print(f"[startup] Promoted {admin_email} to admin.")
        finally:
            db.close()


@app.get("/")
def root():
    return {"ok": True, "service": "mountaineer-crew-app-backend"}


# Routers
app.include_router(sync_router)        # /api/sync, /api/events
app.include_router(calendar_router)    # /api/calendar/day
app.include_router(jobs_router)        # /api/jobs (JWT protected)
app.include_router(auth_router)        # /api/auth/*
app.include_router(admin_router)       # /api/admin/*
app.include_router(materials_router)   # /api/materials
app.include_router(photos_router)      # /api/photos/upload
app.include_router(dvir_router)        # /api/dvir
app.include_router(job_report_router)  # /api/job-report
app.include_router(config_router)      # /api/config (public)
app.include_router(bill_router)        # /api/bill
app.include_router(users_router)       # /api/users/directory
app.include_router(long_distance_router)  # /api/long-distance/*
app.include_router(documents_router)      # /api/documents
app.include_router(estimates_router)      # /api/estimates
app.include_router(patch_notes_router)    # /api/patch-notes
app.include_router(admin_notes_router)    # /api/admin-notes
app.include_router(office_hours_router)   # /api/office-hours (admin-only)
app.include_router(reimbursement_router)  # /api/reimbursements
