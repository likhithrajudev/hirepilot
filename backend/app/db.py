import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

url = settings.effective_database_url
connect_args = {}
if url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    path = url.replace("sqlite:///", "", 1)
    if path and path != ":memory:":
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_COLUMNS = [
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS score_detail JSON",
    "ALTER TABLE resumes ADD COLUMN IF NOT EXISTS user_id INTEGER",
    "ALTER TABLE resumes ADD COLUMN IF NOT EXISTS tenant_id INTEGER",
    "ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS user_id INTEGER",
    "ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS tenant_id INTEGER",
    "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS persona_name VARCHAR(40)",
    "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS persona_voice VARCHAR(20)",
    "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS proctored BOOLEAN DEFAULT FALSE",
    "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS events JSON",
    "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 20",
    "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS team_candidate_id INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_resumes_user_id ON resumes (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_ai_tasks_user_id ON ai_tasks (user_id)",
]

_INDEXES = [
    # Serve "best match" and "most recent" lists as index scans instead of sorting every row.
    "CREATE INDEX IF NOT EXISTS ix_jobs_rank ON jobs (score DESC NULLS LAST, posted_at DESC NULLS LAST) WHERE status <> 'ignored'",
    "CREATE INDEX IF NOT EXISTS ix_jobs_recent ON jobs (posted_at DESC NULLS LAST, id DESC) WHERE status <> 'ignored'",
    # ILIKE '%city%' filters cannot use a btree; a trigram GIN index can.
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "CREATE INDEX IF NOT EXISTS ix_jobs_location_trgm ON jobs USING gin (location gin_trgm_ops)",
]


def ensure_indexes() -> None:
    """Postgres only. Each statement is independent so a missing privilege (e.g. CREATE EXTENSION) never blocks startup."""
    if engine.dialect.name == "sqlite":  # tests/dev only: add missing columns by hand
        from sqlalchemy import inspect

        insp = inspect(engine)
        for table, col, ddl in (("jobs", "score_detail", "JSON"), ("resumes", "user_id", "INTEGER"), ("resumes", "tenant_id", "INTEGER"),
                                ("ai_tasks", "user_id", "INTEGER"), ("ai_tasks", "tenant_id", "INTEGER"),
                                ("interview_sessions", "persona_name", "VARCHAR(40)"), ("interview_sessions", "persona_voice", "VARCHAR(20)"),
                                ("interview_sessions", "proctored", "BOOLEAN DEFAULT 0"), ("interview_sessions", "events", "JSON"), ("interview_sessions", "duration_min", "INTEGER DEFAULT 20"), ("interview_sessions", "team_candidate_id", "INTEGER")):
            if table not in insp.get_table_names():
                continue
            if col not in {c["name"] for c in insp.get_columns(table)}:
                with engine.begin() as conn:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
        return
    if engine.dialect.name != "postgresql":
        return
    for stmt in _COLUMNS + _INDEXES:
        try:
            with engine.begin() as conn:
                conn.exec_driver_sql(stmt)
        except Exception:  # pragma: no cover - environment dependent
            pass
