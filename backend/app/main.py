# backend/app/main.py
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import Base, engine  # noqa: F401
import app.db.models.system_config  # noqa: F401 — ensure table is registered
import app.db.models.materials  # noqa: F401 — ensures table is registered with Base
import app.db.models.calendar_job  # noqa: F401 — ensures table is registered with Base
import app.db.models.photo         # noqa: F401 — ensures table is registered with Base

# Routers that exist
from app.routers.sync import router as sync_router
from app.routers.jobs import router as jobs_router
from app.routers.calendar import router as calendar_router
from app.routers.auth import router as auth_router
from app.routers.admin import router as admin_router
from app.routers.materials import router as materials_router
from app.routers.photos import router as photos_router


app = FastAPI(title="Mountaineer Crew App Backend")

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
    from pathlib import Path
    from alembic.config import Config
    from alembic import command
    from app.db.session import SessionLocal
    from app.db.models.user import User

    # Run all pending Alembic migrations on startup.
    # This replaces create_all and keeps the schema versioned and up to date.
    try:
        alembic_cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        command.upgrade(alembic_cfg, "head")
        print("[startup] Alembic migrations applied.")
    except Exception:
        print("[startup] ERROR — Alembic migration failed:")
        traceback.print_exc()
        raise

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
