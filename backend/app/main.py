# app/main.py
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import Base, engine

# Routers (these should exist in your repo)
from app.routers.sync import router as sync_router

# These *very likely* exist based on your endpoints.
# If your filenames differ, adjust these two imports to match your repo.
from app.routers.calendar import router as calendar_router
from app.routers.job_registry import router as job_registry_router


app = FastAPI(title="Mountaineer Crew App Backend")

# -----------------------------
# CORS (fixes ERR_FAILED 200 OK)
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # Local dev (Vite)
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # Vercel prod (NO trailing slash)
        "https://mountaineer-crew-app.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# DB init
# -----------------------------
@app.on_event("startup")
def on_startup() -> None:
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)


# -----------------------------
# Routes
# -----------------------------
@app.get("/")
def root():
    # Render was hitting "/" and getting 404 — this makes it obvious the service is up.
    return {"ok": True, "service": "mountaineer-crew-app-backend"}


# API routers
app.include_router(sync_router)
app.include_router(calendar_router)
app.include_router(job_registry_router)
