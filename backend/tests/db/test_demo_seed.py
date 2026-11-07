"""The demo must exercise real engines, retain traces and preserve real records."""

from datetime import datetime, timezone

import pytest
from sqlmodel import Session, select

from app.contracts import types as c
from app.db import models as m
from app.db import repo
from app.db.session import make_engine
from tools import seed_demo as seeder

END = datetime(2026, 11, 6, 10, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def generated():
    return seeder.generate(END)


def test_real_engine_seed_reset_and_provenance(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    assert seeder.seed_demo(engine, end=END) == (11, 4)
    with Session(engine) as db:
        sessions = repo.list_sessions(db)
        assert len(sessions) == 11
        assert all(s.is_demo and s.n_attempts == 15 and s.summary for s in sessions)
        assert sessions[-1].started_at.startswith("2026-10-17")
        assert sessions[0].started_at.startswith("2026-11-06")
        assert sessions[0].summary.active_ratio_mean > sessions[-1].summary.active_ratio_mean
        detail = repo.get_session(db, sessions[0].id)
        trace = repo.get_trace(db, detail.attempts[-1].id)
        assert trace.hz == 20 and len(trace.t) > 100
        assert "ASSIST" in trace.phase
        assert len(repo.list_evaluations(db)) == 4
        assert all(e.is_demo and len(e.sweeps) == 6 for e in repo.list_evaluations(db))
        trend = repo.history_resistance(db)
        index = [p for p in trend if p.finger == "index"]
        assert index[-1].slow < index[0].slow
        calibration_id = sessions[0].calibration_id
        real = repo.create_session(
            db,
            c.SessionIn(
                mode="exercise",
                calibration_id=calibration_id,
                plan=sessions[0].plan,
                settings=sessions[0].settings,
                is_demo=False,
            ),
        )
        real_id = real.id
    assert seeder.seed_demo(engine, end=END) == (0, 0)
    assert seeder.seed_demo(engine, reset=True, end=END) == (11, 4)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == 12
        assert repo.get_session(db, real_id).is_demo is False
        assert len(db.exec(select(m.Calibration)).all()) == 1
        assert len(db.exec(select(m.AttemptTrace)).all()) == 165
    engine.dispose()


def test_invalid_generation_does_not_remove_demo_history(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    seeder.seed_demo(engine, end=END)
    monkeypatch.setattr(seeder, "generate", lambda _: {**generated, "evaluations": [{}]})
    with pytest.raises(ValueError):
        seeder.seed_demo(engine, reset=True, end=END)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == 11
        assert len(repo.list_evaluations(db)) == 4
    engine.dispose()
