import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .services.security import AuthError

from . import models  # noqa: F401  (register tables)
from .config import settings
from .db import Base, engine, ensure_indexes
from .deps import current_user
from .services import tasks as task_service
from .services import templates as template_service
from .routers import admin, assessments, contests, invites, practice, teams, recruiting, recordings, coding, auth, billing, interviews, jobs, preferences, profile, resumes, tasks, templates
from .routers import settings as settings_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)  # swap for Alembic migrations once the schema stabilises
    ensure_indexes()
    task_service.recover_after_restart()
    warm = asyncio.create_task(template_service.warm())  # compile template previews in the background
    yield


app = FastAPI(title="HirePilot API", version="1.0.0", lifespan=lifespan)
@app.exception_handler(AuthError)
async def auth_error_handler(_request, exc: AuthError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


@api.get("/health")
def health():
    return {"status": "ok"}


protected = APIRouter(dependencies=[Depends(current_user)])
protected.include_router(resumes.router)
protected.include_router(jobs.router)
protected.include_router(profile.router)
protected.include_router(tasks.router)
protected.include_router(preferences.router)
protected.include_router(billing.router)
protected.include_router(interviews.router)
protected.include_router(recordings.router)
protected.include_router(coding.router)
protected.include_router(practice.router)
protected.include_router(contests.router)
protected.include_router(teams.router)
protected.include_router(assessments.router)
protected.include_router(invites.router)
protected.include_router(admin.router)
protected.include_router(recruiting.router)
protected.include_router(recruiting.admin)
protected.include_router(templates.router)
protected.include_router(settings_router.router)
api.include_router(auth.router)
api.include_router(recruiting.public)
api.include_router(invites.public)
api.include_router(billing.public)
api.include_router(templates.public)
api.include_router(protected)
app.include_router(api)
