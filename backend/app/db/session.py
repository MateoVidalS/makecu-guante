from pathlib import Path

from sqlalchemy import event, inspect
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings
from app.db import models  # noqa: F401


def make_engine(path: str):
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")

    return engine


engine = make_engine(settings.rehab_db_path)


def upgrade_schema(target_engine):
    """Add nullable columns without rewriting legacy calibrations or their ranges."""
    SQLModel.metadata.create_all(target_engine)
    with target_engine.begin() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("calibration")}
        if "assist_direction" not in columns:
            connection.exec_driver_sql("ALTER TABLE calibration ADD COLUMN assist_direction TEXT")


def init_db():
    upgrade_schema(engine)
    from app.db.seed import seed

    with Session(engine) as session:
        seed(session)


def get_session():
    with Session(engine) as session:
        yield session
