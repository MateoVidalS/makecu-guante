from sqlalchemy import text
from sqlmodel import Session, SQLModel

from app.db.models import Profile
from app.db.seed import seed
from app.db.session import make_engine


def test_schema_wal_foreign_keys_and_empty_profile(tmp_path):
    engine = make_engine(str(tmp_path / "rehab.db"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed(session)
        seed(session)
        profile = session.get(Profile, 1)
        assert profile is not None and profile.pseudonym == ""
        assert session.exec(text("PRAGMA journal_mode")).scalar() == "wal"
        assert session.exec(text("PRAGMA foreign_keys")).scalar() == 1
        tables = {
            r[0] for r in session.exec(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
        assert {
            "profile",
            "calibration",
            "session",
            "attempt",
            "attempt_finger",
            "attempt_trace",
            "evaluation",
            "evaluation_finger",
            "transcript_line",
            "summary",
        } <= tables
    engine.dispose()


def test_child_rows_cascade_from_session_and_evaluation(tmp_path):
    from app.db import models as m

    engine = make_engine(str(tmp_path / "cascade.db"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            m.Calibration(
                id=1,
                created_at="2026-11-05T09:00:00Z",
                servo_json="[]",
                camera_json="{}",
                friction_json="{}",
                current_limit_ma=900,
            )
        )
        db.commit()
        db.add(
            m.Session(
                id=1,
                mode="exercise",
                started_at="2026-11-05T09:00:00Z",
                calibration_id=1,
                plan_json="[]",
                settings_json="{}",
            )
        )
        db.add(
            m.Evaluation(
                id=1,
                started_at="2026-11-05T09:00:00Z",
                ended_at="2026-11-05T09:01:00Z",
                calibration_id=1,
                settings_json="{}",
                sweeps_blob=b"",
                friction_used=False,
            )
        )
        db.commit()
        db.add(
            m.Attempt(
                id=1,
                session_id=1,
                idx=0,
                pose="full_fist",
                rep=1,
                started_at="2026-11-05T09:00:00Z",
                ended_at="2026-11-05T09:00:09Z",
                reached_active=False,
                reached_final=True,
                assisted=True,
                active_ratio=0.6,
                interrupted=False,
                safety_json="[]",
            )
        )
        db.add(
            m.TranscriptLine(
                session_id=1, t="2026-11-05T09:00:00Z", role="coach", text="Give it a try"
            )
        )
        db.add(
            m.Summary(
                kind="session",
                created_at="2026-11-05T09:01:00Z",
                session_id=1,
                model="fixture",
                text="Steady effort",
            )
        )
        db.add(m.EvaluationFinger(evaluation_id=1, finger="index", aborted=False))
        db.commit()
        db.add(m.AttemptFinger(attempt_id=1, finger="index", scored=True, active_max=0.6))
        db.add(m.AttemptTrace(attempt_id=1, blob=b""))
        db.commit()
        db.exec(text("DELETE FROM session WHERE id=1"))
        db.exec(text("DELETE FROM evaluation WHERE id=1"))
        db.commit()
        for table in [
            "attempt",
            "attempt_finger",
            "attempt_trace",
            "transcript_line",
            "summary",
            "evaluation_finger",
        ]:
            assert db.exec(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0
    engine.dispose()
