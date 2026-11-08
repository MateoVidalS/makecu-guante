import gzip
from datetime import datetime, timedelta, timezone
from time import perf_counter

import pytest
from sqlalchemy import event, insert

from app.contracts import types as c
from app.db import models as m
from app.db import repo


def stamp(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")


def add_session(db, body, attempt, days, values, *, demo=False, pose="full_fist"):
    session = repo.create_session(
        db, c.SessionIn.model_validate({**body, "is_demo": demo}), started_at=stamp(days)
    )
    for i, (active, need) in enumerate(values):
        data = {**attempt, "index": i, "pose": pose, "assisted": any(x > 0 for x in need)}
        data["fingers"] = [
            {
                "finger": finger,
                "scored": True,
                "target": 1,
                "active_max": value,
                "assist_needed": required,
                "final": 1,
            }
            for finger, value, required in zip(
                repo.FINGERS, active + [active[-1]] * 2, need + [need[-1]] * 2
            )
        ]
        repo.create_attempt(db, session.id, c.AttemptResult.model_validate(data))
    return session.id


def test_hand_computed_history(client, db, session_body, attempt_body, payload, calibration):
    first = add_session(
        db,
        session_body,
        attempt_body,
        10,
        [([0.2, 0.4, 0.6], [0.8, 0.6, 0.4]), ([0.4, 0.6, 0.8], [0.6, 0.4, 0.2])],
    )
    second = add_session(
        db,
        session_body,
        attempt_body,
        2,
        [([0.6, 0.8, 1.0], [0.4, 0.2, 0.0]), ([1.0, 1.0, 1.0], [0.0, 0.0, 0.0])],
        pose="hook",
    )
    third = add_session(
        db, session_body, attempt_body, 1, [([0.9, 0.9, 0.9], [0.1, 0.1, 0.1])], demo=True
    )
    # An unscored measurement must not pollute either average. Nulls do not become zeros.
    extra = {
        **attempt_body,
        "index": 2,
        "fingers": [
            {
                "finger": "index",
                "scored": False,
                "target": None,
                "active_max": 0.01,
                "assist_needed": 0.99,
                "final": None,
            },
            {
                "finger": "thumb",
                "scored": True,
                "target": 1,
                "active_max": None,
                "assist_needed": None,
                "final": None,
            },
        ],
    }
    repo.create_attempt(db, second, c.AttemptResult.model_validate(extra))
    overview = c.HistoryOverview.model_validate(client.get("/api/history/overview").json())
    assert (overview.sessions, overview.attempts, overview.days_practiced_last_7) == (3, 6, 2)
    assert [f.active_max_first for f in overview.per_finger] == pytest.approx(
        [0.3, 0.5, 0.7, 0.7, 0.7]
    )
    assert [f.active_max_last for f in overview.per_finger] == pytest.approx([0.9] * 5)
    assert [f.assist_needed_last for f in overview.per_finger] == pytest.approx([0.1] * 5)
    rom = [c.RomPoint.model_validate(p) for p in client.get("/api/history/rom").json()]
    assert (
        len(rom) == 15 and [p.session_id for p in rom] == [first] * 5 + [second] * 5 + [third] * 5
    )
    assert [p.is_demo for p in rom] == [False] * 10 + [True] * 5
    index = client.get("/api/history/rom?finger=index&pose=hook").json()
    assert len(index) == 1 and index[0]["active_max_mean"] == pytest.approx(0.9)
    assert index[0]["pose"] == "hook"
    assist = [c.AssistPoint.model_validate(p) for p in client.get("/api/history/assist").json()]
    middle = next(p for p in assist if p.session_id == second and p.finger == "middle")
    assert middle.assisted_rate == middle.assist_needed_mean == 0
    thumb = next(p for p in assist if p.session_id == second and p.finger == "thumb")
    assert thumb.assist_needed_mean == pytest.approx(0.2) and thumb.assisted_rate == 0.5
    for item in payload("evaluations"):
        body = c.EvaluationIn.model_validate({k: v for k, v in item.items() if k != "id"})
        repo.create_evaluation(db, body.model_copy(update={"calibration_id": calibration.id}))
    resistance = [
        c.ResistancePoint.model_validate(p) for p in client.get("/api/history/resistance").json()
    ]
    assert len(resistance) == 15
    expected = []
    for id, evaluation in enumerate(payload("evaluations"), 1):
        for finger in evaluation["fingers"]:
            expected.append(
                c.ResistancePoint(
                    evaluation_id=id,
                    assist_direction=calibration.assist_direction,
                    started_at=evaluation["started_at"],
                    is_demo=evaluation["is_demo"],
                    finger=finger["finger"],
                    slow=finger["resistance_slow_ma"],
                    fast=finger["resistance_fast_ma"],
                    dependence=finger["velocity_dependence_ma"],
                )
            )
    expected.sort(key=lambda p: (p.started_at, p.evaluation_id, repo.FINGERS.index(p.finger)))
    assert resistance == expected


def test_empty_history(client):
    overview = client.get("/api/history/overview").json()
    assert overview["sessions"] == overview["attempts"] == overview["evaluations"] == 0
    assert overview["last_session_at"] is None
    assert all(p["active_max_first"] is None for p in overview["per_finger"])
    for path in ("rom", "assist", "resistance"):
        assert client.get(f"/api/history/{path}").json() == []


def test_history_endpoints_under_100ms_for_200_sessions(
    client, db, calibration, session_body, attempt_body, payload
):
    sessions = [
        {
            "id": i,
            "calibration_id": calibration.id,
            "mode": "exercise",
            "started_at": stamp(i / 10),
            "plan_json": "[]",
            "settings_json": "{}",
            "is_demo": i % 2 == 0,
        }
        for i in range(1, 201)
    ]
    db.execute(insert(m.Session), sessions)
    attempts = []
    fingers = []
    for i in range(1, 3001):
        attempts.append(
            {
                "id": i,
                "session_id": (i - 1) // 15 + 1,
                "idx": (i - 1) % 15,
                "pose": "full_fist",
                "rep": 1,
                "started_at": stamp(1),
                "ended_at": stamp(1),
                "reached_active": False,
                "reached_final": True,
                "assisted": True,
                "active_ratio": 0.6,
                "interrupted": False,
                "safety_json": "[]",
            }
        )
        fingers.extend(
            {
                "attempt_id": i,
                "finger": f,
                "scored": True,
                "target": 1,
                "active_max": 0.6,
                "assist_needed": 0.4,
                "final": 1,
            }
            for f in repo.FINGERS
        )
    db.execute(insert(m.Attempt), attempts)
    db.execute(insert(m.AttemptFinger), fingers)
    # Large traces are present but must never enter history queries.
    blob = gzip.compress(
        c.AttemptTrace.model_validate(payload("attempt_trace")).model_dump_json().encode()
    )
    db.execute(insert(m.AttemptTrace), [{"attempt_id": i, "blob": blob} for i in range(1, 3001)])
    evaluation = payload("evaluations")[0]
    for i in range(200):
        repo.create_evaluation(
            db,
            c.EvaluationIn.model_validate(
                {
                    **{k: v for k, v in evaluation.items() if k != "id"},
                    "calibration_id": calibration.id,
                }
            ),
        )
    db.commit()
    statements = []

    def record(_connection, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    event.listen(db.bind, "before_cursor_execute", record)
    try:
        for path in ("overview", "rom", "assist", "resistance"):
            # Median of 5 runs: a single timing flakes when the machine is busy
            # (parallel test suites), while a real regression moves the median.
            timings = []
            for _ in range(5):
                start = perf_counter()
                response = client.get(f"/api/history/{path}")
                timings.append((perf_counter() - start) * 1000)
                assert response.status_code == 200, response.text
            elapsed = sorted(timings)[len(timings) // 2]
            print(f"history/{path}: median {elapsed:.1f} ms")
            assert elapsed < 100, f"{path} median took {elapsed:.1f} ms"
        assert not any("attempt_trace" in sql or "sweeps_blob" in sql for sql in statements)
    finally:
        event.remove(db.bind, "before_cursor_execute", record)
