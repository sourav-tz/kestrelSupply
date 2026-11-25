from contextlib import asynccontextmanager
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, audit, escalations, health, orders, policies, refunds, tickets, users
from app.core.config import get_settings
from app.core.exceptions import (
    AppError,
    app_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.core.logging import configure_logging, get_logger
from app.db.base import Base, SessionLocal, engine
from app.db.seed import seed_database

configure_logging()
logger = get_logger("kestrel.main")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    logger.info("application_startup_complete")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        description=(
            "Full-stack e-commerce customer support, AI policy agent, "
            "automated/escalated refund engine, and operations console API."
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    api_router = APIRouter(prefix="/api")
    api_router.include_router(health.router)
    api_router.include_router(auth.router)
    api_router.include_router(users.router)
    api_router.include_router(orders.router)
    api_router.include_router(tickets.router)
    api_router.include_router(refunds.router)
    api_router.include_router(escalations.router)
    api_router.include_router(audit.router)
    api_router.include_router(policies.router)
    app.include_router(api_router)

    return app


app = create_app()
