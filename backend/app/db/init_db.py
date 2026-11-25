from app.core.logging import configure_logging, get_logger
from app.db.base import Base, SessionLocal, engine
from app.db.seed import seed_database

configure_logging()
logger = get_logger("kestrel.init_db")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
        logger.info("database_initialized_and_seeded")
    finally:
        db.close()


if __name__ == "__main__":
    init_db()
