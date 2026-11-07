"""The demo must exercise real engines, retain traces and preserve real records."""

from copy import deepcopy
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


def test_generated_measurements_cover_all_five_fingers(generated):
    calibration = generated["calibration"]
    assert [f["finger"] for f in calibration["servo"]] == list(repo.FINGERS)
    assert set(calibration["camera"]["closed_flex"]) == set(repo.FINGERS)
    for session in generated["sessions"]:
        assert [f["finger"] for f in session["summary"]["per_finger"]] == list(repo.FINGERS)
        for attempt in session["attempts"]:
            assert [f["finger"] for f in attempt["fingers"]] == list(repo.FINGERS)
            assert all(f["scored"] for f in attempt["fingers"][3:])
            assert all(f["active_max"] is not None for f in attempt["fingers"] if f["scored"])
            assert set(attempt["trace"]["closure"]) == set(repo.FINGERS)
            assert set(attempt["trace"]["servo"]) == set(repo.FINGERS)
    for evaluation in generated["evaluations"]:
        assert evaluation["settings"]["fingers"] == list(repo.FINGERS)
        assert [f["finger"] for f in evaluation["fingers"]] == list(repo.FINGERS)
        for speed in ("slow", "fast"):
            assert [s["finger"] for s in evaluation["sweeps"] if s["speed"] == speed] == list(
                repo.FINGERS
            )


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
        assert all(e.is_demo and len(e.sweeps) == 10 for e in repo.list_evaluations(db))
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


@pytest.mark.parametrize(
    "part", ["servo", "camera", "summary", "attempt", "trace", "evaluation", "sweep"]
)
def test_incomplete_five_finger_demo_does_not_remove_history(
    tmp_path, generated, monkeypatch, part
):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    seeder.seed_demo(engine, end=END)
    broken = deepcopy(generated)
    if part == "servo":
        broken["calibration"]["servo"].pop()
    elif part == "camera":
        broken["calibration"]["camera"]["closed_flex"].pop("pinky")
    elif part == "summary":
        broken["sessions"][0]["summary"]["per_finger"].pop()
    elif part == "attempt":
        broken["sessions"][0]["attempts"][0]["fingers"].pop()
    elif part == "trace":
        broken["sessions"][0]["attempts"][0]["trace"]["servo"].pop("pinky")
    elif part == "evaluation":
        broken["evaluations"][0]["fingers"].pop()
    else:
        broken["evaluations"][0]["sweeps"].pop()
    monkeypatch.setattr(seeder, "generate", lambda _: broken)
    with pytest.raises(ValueError, match="all five fingers"):
        seeder.seed_demo(engine, reset=True, end=END)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == 11
        assert len(repo.list_evaluations(db)) == 4
    engine.dispose()


def test_write_failure_rolls_back_the_entire_reset(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    seeder.seed_demo(engine, end=END)
    with Session(engine) as db:
        before_ids = [s.id for s in repo.list_sessions(db)]

    def unavailable(*args):
        raise RuntimeError("simulated storage failure")

    monkeypatch.setattr(repo, "create_evaluation", unavailable)
    with pytest.raises(RuntimeError, match="storage failure"):
        seeder.seed_demo(engine, reset=True, end=END)
    with Session(engine) as db:
        assert [s.id for s in repo.list_sessions(db)] == before_ids
        assert len(repo.list_evaluations(db)) == 4
        assert len(db.exec(select(m.AttemptTrace)).all()) == 165
    engine.dispose()
