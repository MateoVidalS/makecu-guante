"""Startup adds therapy tables without rewriting existing sessions/calibrations."""

from sqlalchemy import inspect, text
from sqlmodel import Session

from app.contracts.therapist import CoachDecision, FeelingEntry
from app.db import models as m
from app.db import repo
from app.db import session as db_session

from . import test_repo

data = test_repo.data


def test_existing_database_upgrade_and_persistent_roundtrip(data, monkeypatch):
    db, body, _ = data
    engine = db.get_bind()
    existing = repo.create_session(db, body)
    before = repo.get_session(db, existing.id).model_dump()
    # Reproduce a pre-therapy database, then run the real startup migration twice.
    for model in (m.CoachDecision, m.FeelingEntry):
        model.__table__.drop(engine)
    assert "coach_decision" not in inspect(engine).get_table_names()
    monkeypatch.setattr(db_session, "engine", engine)
    db_session.init_db()
    db_session.init_db()
    assert {"coach_decision", "feeling_entry"} <= set(inspect(engine).get_table_names())
    assert repo.get_session(db, existing.id).model_dump() == before
    decision = CoachDecision(
        id="release",
        t="2026-11-07T12:00:00Z",
        session_id=existing.id,
        tool="brake",
        requested={"reason": "Stop"},
        applied={"phase": "PAUSED"},
        result="applied",
        reason="Stop",
        source="local_rule",
    )
    feeling = FeelingEntry(
        t="2026-11-07T12:00:00Z",
        session_id=existing.id,
        attempt_index=None,
        pain=4,
        fatigue=6,
        note="Sore hand",
        source="voice",
    )
    repo.add_coach_decisions(db, existing.id, [decision])
    repo.add_feelings(db, existing.id, [feeling])
    with Session(engine) as reopened:
        saved = repo.get_session(reopened, existing.id)
        assert saved.coach_decisions == [decision] and saved.feelings == [feeling]
        # SQLite, rather than a Python delete hook, owns the cascade.
        reopened.exec(text("DELETE FROM session WHERE id=:id").bindparams(id=existing.id))
        reopened.commit()
        assert reopened.exec(text("SELECT count(*) FROM coach_decision")).scalar() == 0
        assert reopened.exec(text("SELECT count(*) FROM feeling_entry")).scalar() == 0


def test_decision_ids_are_scoped_to_a_session(data):
    db, body, _ = data
    first = repo.create_session(db, body)
    second = repo.create_session(db, body)
    for session in (first, second):
        repo.add_coach_decisions(
            db,
            session.id,
            [
                CoachDecision(
                    id="same-id",
                    t=repo.now(),
                    session_id=session.id,
                    tool="get_live_state",
                    requested={},
                    applied={},
                    result="applied",
                    reason="Checked state",
                    source="coach",
                )
            ],
        )
    assert len(repo.list_coach_decisions(db, {first.id, second.id})) == 2
    repo.delete_session(db, first.id)
    assert len(repo.get_session(db, second.id).coach_decisions) == 1
