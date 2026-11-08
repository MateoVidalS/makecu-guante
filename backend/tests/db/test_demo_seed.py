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
TRACES = 9 * 15 + 5 * 5  # nine tendon-glide sessions and five short sessions


@pytest.fixture(scope="module")
def generated():
    return seeder.generate(END)


def test_generated_measurements_cover_all_five_fingers(generated):
    calibration = generated["calibration"]
    assert [f["finger"] for f in calibration["servo"]] == list(repo.FINGERS)
    assert set(calibration["camera"]["closed_flex"]) == set(repo.FINGERS)
    assert calibration["camera"]["camera_view"] == "front_upright"
    assert calibration["camera"]["flex_model"] == 2
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


def _active(session, finger):
    values = [
        f["active_max"]
        for a in session["attempts"]
        for f in a["fingers"]
        if f["finger"] == finger and f["scored"]
    ]
    return sum(values) / len(values)


def test_story_is_deterministic(generated):
    again = seeder.generate(END)
    assert again["sessions"][5]["summary"] == generated["sessions"][5]["summary"]
    assert again["evaluations"][-1]["fingers"] == generated["evaluations"][-1]["fingers"]


def test_story_reads_like_a_real_patient(generated):
    sessions = generated["sessions"]
    first, last = sessions[0], sessions[-1]
    # Irregular home practice with mixed plan lengths, never in the future.
    lengths = {len(s["attempts"]) for s in sessions}
    assert lengths == {5, 15}
    days = sorted({s["started_at"][:10] for s in sessions})
    gaps = {
        (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days
        for a, b in zip(days, days[1:], strict=False)
    }
    assert len(gaps) >= 2
    assert all(s["ended_at"] < END.isoformat() for s in sessions)
    # Fingers improve at different rates: index most, thumb slowly, little finger least.
    gain = {f: _active(last, f) - _active(first, f) for f in repo.FINGERS}
    assert len({round(g, 2) for g in gain.values()}) == len(repo.FINGERS)
    assert max(gain, key=gain.get) == "index"
    assert gain["thumb"] < gain["middle"] and gain["pinky"] < gain["ring"]
    # The ring finger dips in the tired week, then recovers.
    ring = [_active(s, "ring") for s in sessions if len(s["attempts"]) == 15]
    assert min(ring[4:]) < max(ring[:4]) < ring[-1]
    # Safety events are rare: one rigid-index stop in the whole history.
    safety = [e for s in sessions for a in s["attempts"] for e in a["safety_events"]]
    assert [e["finger"] for e in safety] == ["index"]
    # Resistance eases at a different rate per finger.
    evaluations = generated["evaluations"]
    drops = {f["finger"]: f["resistance_slow_ma"] for f in evaluations[0]["fingers"]}
    for f in evaluations[-1]["fingers"]:
        drops[f["finger"]] -= f["resistance_slow_ma"]
    assert all(d > 0 for d in drops.values())
    assert len({round(d) for d in drops.values()}) >= 4
    # The AI coach was only used in the last week; its records are plausible.
    coached = [s for s in sessions if s["decisions"]]
    assert coached and all(s["started_at"] > sessions[-5]["started_at"] for s in coached)
    feelings = [f for s in coached for f in s["feelings"]]
    assert all(0 <= f["pain"] <= 3 for f in feelings)
    assert generated["profile"]["affected_hand"] == "right"


def test_real_engine_seed_reset_and_provenance(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    assert seeder.seed_demo(engine, end=END) == (14, 4)
    with Session(engine) as db:
        sessions = repo.list_sessions(db)
        assert len(sessions) == 14
        assert all(s.is_demo and s.n_attempts in (5, 15) and s.summary for s in sessions)
        assert sessions[-1].started_at.startswith("2026-10-10")
        assert sessions[0].started_at.startswith("2026-11-05")
        assert repo.get_profile(db).pseudonym == "M.R. (demo patient)"
        latest = repo.get_session(db, sessions[0].id)
        assert latest.coach_decisions and latest.feelings
        assert all(f.session_id == latest.id for f in latest.feelings)
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
        camera = repo.latest_calibration(db).camera
        assert camera.camera_view == "front_upright"
        assert camera.flex_model == 2
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
    assert seeder.seed_demo(engine, reset=True, end=END) == (14, 4)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == 15
        assert repo.get_session(db, real_id).is_demo is False
        assert len(db.exec(select(m.Calibration)).all()) == 1
        assert len(db.exec(select(m.AttemptTrace)).all()) == TRACES
    engine.dispose()


def test_invalid_generation_does_not_remove_demo_history(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    seeder.seed_demo(engine, end=END)
    monkeypatch.setattr(seeder, "generate", lambda _: {**generated, "evaluations": [{}]})
    with pytest.raises(ValueError):
        seeder.seed_demo(engine, reset=True, end=END)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == 14
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
        assert len(repo.list_sessions(db)) == 14
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
        assert len(db.exec(select(m.AttemptTrace)).all()) == TRACES
    engine.dispose()


def test_a_real_profile_is_never_replaced(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    from sqlmodel import SQLModel

    SQLModel.metadata.create_all(engine)
    real = c.Profile(
        pseudonym="J.D.",
        affected_hand="left",
        condition="Real patient",
        goals="Real goals",
        therapist_name="",
        therapist_email="",
    )
    with Session(engine) as db:
        repo.put_profile(db, real)
    seeder.seed_demo(engine, end=END)
    seeder.seed_demo(engine, reset=True, end=END)
    with Session(engine) as db:
        assert repo.get_profile(db) == real
    engine.dispose()
