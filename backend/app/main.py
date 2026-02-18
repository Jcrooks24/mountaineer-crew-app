from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import Base, engine
from app.db.models.user import User  # noqa: F401
from app.db.models.job import Job  # noqa: F401
from app.db.models.event import Event  # noqa: F401

from app.routers.users import router as users_router
from app.routers.auth import router as auth_router
from app.routers.jobs import router as jobs_router
from app.routers.dev import router as dev_router
from app.routers.sync import router as sync_router
from app.routers.calendar import router as calendar_router
from app.db.sheet_exports import ensure_sheet_exports_tables]
from fastapi.middleware.cors import CORSMiddleware



from app.jobs_api import router as job_registry_router

app = FastAPI(title="Crew Lead API")
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://mountaineer-crew-app.vercel.app",
        # If you have a different Vercel production domain, add it here too.
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(users_router)
app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(dev_router)
app.include_router(sync_router)
app.include_router(calendar_router)

# NEW: job registry router
app.include_router(job_registry_router)

# Create tables (dev only)
Base.metadata.create_all(bind=engine)
ensure_sheet_exports_tables(engine)



@app.get("/health")
def health():
    return {"ok": True}
