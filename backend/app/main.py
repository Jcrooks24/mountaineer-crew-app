# backend/app/main.py
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import Base, engine

# Routers that exist
from app.routers.sync import router as sync_router
from app.routers.jobs import router as jobs_router
from app.routers.calendar import router as calendar_router
from app.routers.auth import router as auth_router


app = FastAPI(title="Mountaineer Crew App Backend")

# CORS: allow your Vercel frontend to call Render backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://mountaineer-crew-app.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/")
def root():
    return {"ok": True, "service": "mountaineer-crew-app-backend"}


# Routers
app.include_router(sync_router)        # /api/sync
app.include_router(calendar_router)    # /api/calendar/day
app.include_router(jobs_router)        # /jobs (JWT protected)
app.include_router(auth_router)        # /api/auth/*