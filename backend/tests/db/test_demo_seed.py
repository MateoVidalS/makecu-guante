"""Synthetic demo history must tell an opening story, retain traces and preserve real records."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, select

from app.contracts import types as c
from app.db import models as m
from app.db import repo
from app.db.session import make_engine
from tools import seed_demo as seeder

END = datetime(2026, 11, 6, 10, tzinfo=timezone.utc)
SESSIONS, EVALUATIONS = 25, 5  # 3 legacy closing-glove sessions, 22 with the opening glove


@pytest.fixture(scope="module")
def generated():
    return seeder.generate(END)


def traces(generated):
    return sum(len(s["attempts"]) for s in generated["sessions"])


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
        if f["finger"] == finger and f["scored"] and a["pose"] == "open"
    ]
    return sum(values) / len(values)


def test_story_is_deterministic(generated):
    again = seeder.generate(END)
    assert again == generated


def test_story_reads_like_a_real_patient(generated):
    sessions = generated["sessions"]
    assert [s["assist_direction"] for s in sessions] == ["close"] * 3 + ["open"] * 22
    assert generated["calibration"]["assist_direction"] == "open"
    assert generated["legacy_calibration"].get("assist_direction") is None
    assert generated["legacy_calibration"]["created_at"] < sessions[0]["started_at"]
    assert sessions[2]["ended_at"] < generated["calibration"]["created_at"]
    sessions = sessions[3:]
    first, last = sessions[0], sessions[-1]
    # Irregular home practice: mixed lengths, a week off with a cold, never in the future.
    assert {len(s["attempts"]) for s in sessions} == {4, 6, 8, 10}
    days = sorted({s["started_at"][:10] for s in sessions})
    gaps = [
        (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days
        for a, b in zip(days, days[1:], strict=False)
    ]
    assert max(gaps) >= 5 and len(set(gaps)) >= 3
    assert all(s["ended_at"] < END.isoformat() for s in sessions)
    # Fingers improve at different rates: index most, thumb slowly, little finger plateaus.
    gain = {f: _active(first, f) - _active(last, f) for f in repo.FINGERS}
    assert len({round(g, 2) for g in gain.values()}) == len(repo.FINGERS)
    assert max(gain, key=gain.get) == "index"
    assert gain["thumb"] < gain["middle"] and gain["pinky"] < gain["ring"]
    late_pinky = [_active(s, "pinky") for s in sessions[-8:]]
    assert max(late_pinky) - min(late_pinky) < 0.06
    # Within a session, attempts vary (no copy-pasted repetitions).
    opens = [a for a in last["attempts"] if a["pose"] == "open"]
    assert len({a["fingers"][1]["active_max"] for a in opens}) == len(opens)
    # The ring finger dips in the tired week, then recovers.
    tired = [s for s in sessions if any("tired" in d["reason"] for d in s["decisions"])]
    before = sessions[sessions.index(tired[0]) - 1]
    assert min(_active(s, "ring") for s in tired) > _active(before, "ring") > _active(last, "ring")
    # Safety events are rare: one rigid-index resistance stop and one pain brake.
    safety = [
        (e["source"], e["finger"])
        for s in sessions
        for a in s["attempts"]
        for e in a["safety_events"]
    ]
    assert safety == [("resistance", "index"), ("coach_brake", None)]
    braked = next(s for s in sessions if any(a["interrupted"] for a in s["attempts"]))
    assert braked["attempts"][-1]["interrupted"] and len(braked["attempts"]) == 8
    brake = next(d for d in braked["decisions"] if d["tool"] == "brake")
    assert brake["source"] == "local_rule" and brake["result"] == "applied"
    assert max(f["pain"] for f in braked["feelings"]) == 4
    # Resistance to opening eases at a different rate per finger; the little finger least.
    evaluations = generated["evaluations"]
    drops = {f["finger"]: f["resistance_slow_ma"] for f in evaluations[0]["fingers"]}
    for f in evaluations[-1]["fingers"]:
        drops[f["finger"]] -= f["resistance_slow_ma"]
    assert all(d > 0 for d in drops.values())
    assert len({round(d) for d in drops.values()}) >= 4
    assert min(drops, key=drops.get) == "pinky"
    # The voice coach arrived in the last weeks; its records are varied and consistent.
    coached = [s for s in sessions if s["transcript"]]
    cutoff = (END - timedelta(days=18)).date().isoformat()
    assert coached and all(s["started_at"][:10] >= cutoff for s in coached)
    assert all(s["decisions"] for s in coached)
    tools = {d["tool"] for s in coached for d in s["decisions"]}
    assert {"highlight_finger", "add_rest", "adjust_target", "adjust_help", "brake"} <= tools
    assert {"intensify", "undo_last_adjustment", "note_for_therapist"} <= tools
    assert {d["result"] for s in coached for d in s["decisions"]} >= {"applied", "rejected"}
    assert len({f["note"] for s in sessions for f in s["feelings"]}) >= 8
    for s in coached:
        times = [line["t"] for line in s["transcript"]]
        assert times == sorted(times)
        assert s["started_at"] <= times[0] and times[-1] <= s["ended_at"]
        assert {line["role"] for line in s["transcript"]} == {"coach", "patient"}
    # Holding the hand open costs sustained current that falls as flexor tone eases.
    peak = [max(a["current_peak_ma"] or 0 for a in s["attempts"]) for s in sessions]
    assert peak[0] > peak[-1]
    assert max(peak) < 0.8 * generated["calibration"]["current_limit_ma"]
    assert generated["profile"]["affected_hand"] == "right"


def test_seed_reset_and_provenance(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    assert seeder.seed_demo(engine, end=END) == (SESSIONS, EVALUATIONS)
    with Session(engine) as db:
        sessions = repo.list_sessions(db)
        assert len(sessions) == SESSIONS
        assert all(s.is_demo and s.n_attempts in (4, 6, 8, 10) and s.summary for s in sessions)
        assert sessions[-1].started_at.startswith("2026-09-26")
        assert sessions[0].started_at.startswith("2026-11-05")
        assert repo.get_profile(db).pseudonym == "M.R. (demo patient)"
        latest = repo.get_session(db, sessions[0].id)
        assert latest.coach_decisions and latest.feelings and latest.transcript
        assert all(f.session_id == latest.id for f in latest.feelings)
        opening = [s for s in sessions if s.assist_direction == "open"]
        legacy = [s for s in sessions if s.assist_direction == "close"]
        assert len(opening) == 22 and len(legacy) == 3
        assert opening[0].summary.active_ratio_mean > opening[-1].summary.active_ratio_mean
        assert opening[-1].summary.previous is None  # Never compare with legacy closing.
        assert legacy[0].summary.previous is not None
        detail = repo.get_session(db, sessions[0].id)
        trace = repo.get_trace(db, detail.attempts[-1].id)
        assert trace.hz == 20 and len(trace.t) > 100
        assert "ASSIST" in trace.phase
        assert len(repo.list_evaluations(db)) == EVALUATIONS
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
    assert seeder.seed_demo(engine, reset=True, end=END) == (SESSIONS, EVALUATIONS)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == SESSIONS + 1
        assert repo.get_session(db, real_id).is_demo is False
        assert len(db.exec(select(m.Calibration)).all()) == 2
        assert len(db.exec(select(m.AttemptTrace)).all()) == traces(generated)
    engine.dispose()


def test_invalid_generation_does_not_remove_demo_history(tmp_path, generated, monkeypatch):
    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    seeder.seed_demo(engine, end=END)
    monkeypatch.setattr(seeder, "generate", lambda _: {**generated, "evaluations": [{}]})
    with pytest.raises(ValueError):
        seeder.seed_demo(engine, reset=True, end=END)
    with Session(engine) as db:
        assert len(repo.list_sessions(db)) == SESSIONS
        assert len(repo.list_evaluations(db)) == EVALUATIONS
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
        assert len(repo.list_sessions(db)) == SESSIONS
        assert len(repo.list_evaluations(db)) == EVALUATIONS
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
        assert len(repo.list_evaluations(db)) == EVALUATIONS
        assert len(db.exec(select(m.AttemptTrace)).all()) == traces(generated)
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


def test_opening_attempts_help_open_and_fists_are_independent(generated):
    for session in generated["sessions"][3:]:
        for attempt in session["attempts"]:
            trace = attempt["trace"]
            assert trace["hz"] == 20
            assert all(abs(b - a - 0.05) < 1e-8 for a, b in zip(trace["t"], trace["t"][1:]))
            assert all(values[-1] == 0 for values in trace["servo"].values())
            assert max(trace["ma"]) < 1500
            if attempt["pose"] == "full_fist":
                assert not attempt["assisted"] and attempt["reached_active"]
                assert not any(p.startswith("ASSIST") for p in trace["phase"])
                assert all(f["assist_needed"] == 0 for f in attempt["fingers"])
            else:
                assert attempt["pose"] == "open" and attempt["assisted"]
                # Targets are fully open, except a ring target the coach eased (0.1).
                assert all(f["target"] in (0, 0.1) for f in attempt["fingers"])
                assert all(f["assist_needed"] > 0 for f in attempt["fingers"])
                if not attempt["interrupted"]:
                    assert "ASSIST" in trace["phase"] and "ASSIST_HOLD" in trace["phase"]
                    start = trace["phase"].index("ASSIST")
                    held = trace["phase"].index("ASSIST_HOLD")
                    for finger in repo.FINGERS:
                        assert trace["closure"][finger][held] < trace["closure"][finger][start]
                        assert trace["servo"][finger][held] > trace["servo"][finger][start]
                        assert max(trace["servo"][finger]) <= 0.95
    for evaluation in generated["evaluations"]:
        assert evaluation["friction_used"]
        for result in evaluation["fingers"]:
            assert result["resistance_fast_ma"] > result["resistance_slow_ma"] > 0
            assert result["velocity_dependence_ma"] > 0
        for sweep in evaluation["sweeps"]:
            assert sweep["points"][0]["pos"] == 0
            assert sweep["points"][-1]["pos"] == 0.95
            assert sweep["points"][-1]["ma"] > sweep["points"][0]["ma"]


def test_demo_gives_the_summaries_readable_numbers(tmp_path, generated, monkeypatch):
    """The LLM context carries percentages, point changes and plain actions, not raw fields."""
    from app.llm import summaries

    monkeypatch.setattr(seeder, "generate", lambda _: generated)
    engine = make_engine(str(tmp_path / "demo.db"))
    seeder.seed_demo(engine, end=END)
    captured = {}

    def fake(kind, context):
        captured[kind] = context
        return c.Summary(
            id=0, kind=kind, created_at=repo.now(), session_id=None, days=None, model="f", text="."
        )

    monkeypatch.setattr(summaries, "generate_summary", fake)
    monkeypatch.setattr(repo, "now", lambda: END.isoformat().replace("+00:00", "Z"))
    with Session(engine) as db:
        latest = repo.list_sessions(db)[0]
        repo.create_summary(db, c.SessionSummaryIn(kind="session", session_id=latest.id))
        repo.create_summary(db, c.TherapistSummaryIn(kind="therapist", days=7))
    engine.dispose()
    session = captured["session"]["readable"]
    assert set(session["opening_on_your_own_percent"]) == set(repo.FINGERS)
    assert all(0 < v < 100 for v in session["opening_on_your_own_percent"].values())
    help_ = session["glove_completed_percent"]
    assert help_["pinky"] > help_["index"]
    assert session["finger_needing_most_help"] == "little finger"
    assert session["previous_session"]["date"].startswith(("Oct", "Nov"))
    since = session["since_first_opening_session"]
    assert since["most_improved_finger"] == "index finger" and since["change_points"]["index"] > 30
    assert session["resistance_to_opening"]["trend"] == "eased"
    assert "patient_goals" in session
    actions = [a["action"] for a in session["coach_actions"]]
    assert actions and not any("_" in a for a in actions)
    digest = captured["therapist"]["readable"]
    assert digest["demo_data"] is True and digest["adherence"]["sessions"] >= 3
    assert digest["since_first_opening_session"]["most_improved_finger"] == "index finger"
    assert digest["resistance_since_first_evaluation"]["evaluations"] == EVALUATIONS
    assert digest["feelings"]["pain_range_0_10"][1] <= 2
