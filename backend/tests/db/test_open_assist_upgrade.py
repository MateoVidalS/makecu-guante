"""The startup and opt-in seeder share an idempotent additive migration."""

from sqlmodel import Session

from app.db import models as m
from app.db import repo
from app.db import session as db_session

from . import test_repo

data = test_repo.data


def test_old_database_migrates_without_rewriting_ranges_or_sessions(data, monkeypatch):
    db, body, _ = data
    engine = db.get_bind()
    saved = repo.create_session(db, body)
    row = db.get(m.Calibration, body.calibration_id)
    original = (row.servo_json, row.camera_json, row.friction_json)
    db.close()
    # Recreate the schema state before this change, preserving the existing rows/FKs.
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE calibration DROP COLUMN assist_direction")
    monkeypatch.setattr(db_session, "engine", engine)
    db_session.init_db()
    db_session.init_db()
    with Session(engine) as reopened:
        legacy = repo.latest_calibration(reopened)
        assert legacy.assist_direction is None
        assert repo.get_session(reopened, saved.id).assist_direction == "close"
        migrated = reopened.get(m.Calibration, legacy.id)
        assert (migrated.servo_json, migrated.camera_json, migrated.friction_json) == original
        current = repo.create_calibration(
            reopened, legacy.model_copy(update={"assist_direction": "open"})
        )
        assert current.assist_direction == "open"
