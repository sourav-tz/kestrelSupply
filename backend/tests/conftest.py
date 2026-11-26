import os
from pathlib import Path
import sys

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()
_base_settings = get_settings()


def _resolve_test_postgres_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    url = make_url(_base_settings.DATABASE_URL)
    if not url.drivername.startswith("postgresql"):
        raise RuntimeError(
            "PostgreSQL DATABASE_URL or TEST_DATABASE_URL is required to run the PostgreSQL test suite."
        )
    test_db_name = f"{url.database}_test"
    return url.set(database=test_db_name).render_as_string(hide_password=False)


TEST_DATABASE_URL = _resolve_test_postgres_url()

# Point app config to the isolated PostgreSQL test database and offline deterministic LLM
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["LLM_PROVIDER"] = "local_deterministic"
get_settings.cache_clear()

from app.db.base import Base, get_db  # noqa: E402
from app.db.seed import seed_database  # noqa: E402
import app.main as main_module  # noqa: E402
from app.main import app  # noqa: E402


def _ensure_test_database_exists(db_url: str) -> None:
    url = make_url(db_url)
    target_db = url.database
    admin_url = url.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False)
    with psycopg.connect(admin_url, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (target_db,),
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{target_db}"')


@pytest.fixture(scope="session")
def pg_test_engine():
    _ensure_test_database_exists(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def test_db_session(pg_test_engine, monkeypatch):
    TestingSessionLocal = sessionmaker(
        bind=pg_test_engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )

    with pg_test_engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE audit_logs, internal_notes, escalations, refunds, "
                "messages, tickets, orders, users RESTART IDENTITY CASCADE"
            )
        )

    seed_db = TestingSessionLocal()
    try:
        seed_database(seed_db)
    finally:
        seed_db.close()

    monkeypatch.setattr(main_module, "engine", pg_test_engine)
    monkeypatch.setattr(main_module, "SessionLocal", TestingSessionLocal)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestingSessionLocal
    app.dependency_overrides.clear()


@pytest.fixture()
def client(test_db_session):
    with TestClient(app) as c:
        yield c


def login_token(client: TestClient, email: str, password: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]
