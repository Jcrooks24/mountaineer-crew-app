# backend/app/main.py
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import Base, engine
import app.db.models.system_config  # noqa: F401 — ensure table is registered

# Routers that exist
from app.routers.sync import router as sync_router
from app.routers.jobs import router as jobs_router
from app.routers.calendar import router as calendar_router
from app.routers.auth import router as auth_router
from app.routers.admin import router as admin_router


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
    # Creates tables if they don't exist.
    # NOTE: Fine for SQLite early on; later you'll likely switch to migrations (Alembic).
    Base.metadata.create_all(bind=engine)


@app.get("/")
def root():
    return {"ok": True, "service": "mountaineer-crew-app-backend"}


# Routers
app.include_router(sync_router)        # /api/sync
app.include_router(calendar_router)    # /api/calendar/day
app.include_router(jobs_router)        # /jobs (JWT protected)
app.include_router(auth_router)        # /api/auth/*
app.include_router(admin_router)       # /api/admin/*