import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel

from app.contracts import types as c
from app.db import repo
from app.db.session import make_engine

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"


@pytest.fixture
def data(tmp_path):
    engine = make_engine(str(tmp_path / "repo.db"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        calibration = json.loads((FIXTURES / "calibration.json").read_text())
        cal = repo.create_demo_calibration(
            db,
            c.CalibrationIn.model_validate(
                {k: v for k, v in calibration.items() if k not in ("id", "created_at")}
            ),
        )
        session = json.loads((FIXTURES / "sessions.json").read_text())[0]
        body = c.SessionIn.model_validate(
            {**{k: session[k] for k in c.SessionIn.model_fields}, "calibration_id": cal.id}
        )
        summary = c.SessionSummary.model_validate(session["summary"])
        yield db, body, summary
    engine.dispose()


def timestamp(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")


def test_previous_prefers_real_and_never_uses_self_or_future(data):
    db, body, summary = data
    first = repo.create_demo_session(db, body, started_at=timestamp(6))
    assert first.is_demo
    ended = repo.end_session(db, first.id, summary)
    assert ended.summary.previous is None
    second = repo.create_demo_session(db, body, started_at=timestamp(5))
    assert (
        repo.end_session(db, second.id, summary).summary.previous.active_ratio_mean
        == summary.active_ratio_mean
    )
    real = repo.create_session(
        db, body.model_copy(update={"is_demo": False}), started_at=timestamp(4)
    )
    changed = summary.model_copy(update={"active_ratio_mean": 0.45})
    repo.end_session(db, real.id, changed)
    demo = repo.create_demo_session(db, body, started_at=timestamp(3))
    assert repo.end_session(db, demo.id, summary).summary.previous.active_ratio_mean == 0.45
    future = repo.create_session(
        db, body.model_copy(update={"is_demo": False}), started_at=timestamp(-1)
    )
    repo.end_session(db, future.id, summary.model_copy(update={"active_ratio_mean": 0.99}))
    current = repo.create_session(db, body, started_at=timestamp(1))
    ended = repo.end_session(db, current.id, summary)
    assert ended.summary.previous.active_ratio_mean == 0.45
    assert (
        ended.summary.previous.per_finger[0].active_max_mean
        == changed.per_finger[0].active_max_mean
    )
    assert repo.end_session(db, current.id, summary).ended_at == ended.ended_at
    assert repo.end_session(db, current.id, summary).summary.previous == ended.summary.previous


def test_previous_orders_by_timestamp_then_id_and_skips_unfinished(data):
    db, body, summary = data
    same = timestamp(1)
    first = repo.create_session(db, body, started_at=same)
    second = repo.create_session(db, body, started_at=same)
    repo.end_session(db, first.id, summary)
    unfinished = repo.create_session(db, body, started_at=timestamp(0.5))
    assert repo.end_session(db, second.id, summary).summary.previous is not None
    assert repo.session_summary_with_previous(db, first.id, summary).previous is None
    assert repo.session_summary_with_previous(db, unfinished.id, summary).previous is not None


def test_digest_excludes_demo_and_outside_window_and_has_adherence_and_safety(data):
    db, body, summary = data
    demo = repo.create_demo_session(db, body, started_at=timestamp(2))
    repo.end_session(db, demo.id, summary)
    assert repo.therapist_digest(db, 7)["only_demo"] is True
    real = repo.create_session(
        db, body.model_copy(update={"is_demo": False}), started_at=timestamp(1)
    )
    repo.create_session(db, body, started_at=timestamp(20))
    attempt = json.loads((FIXTURES / "session_detail.json").read_text())["attempts"][0]
    trace = json.loads((FIXTURES / "attempt_trace.json").read_text())
    attempt = c.AttemptResult.model_validate(
        {**{k: v for k, v in attempt.items() if k not in ("id", "session_id")}, "trace": trace}
    )
    repo.create_attempt(db, real.id, attempt)
    evaluation = json.loads((FIXTURES / "evaluations.json").read_text())[0]
    evaluation = c.EvaluationIn.model_validate(
        {
            **{k: v for k, v in evaluation.items() if k != "id"},
            "started_at": timestamp(1),
            "calibration_id": body.calibration_id,
            "is_demo": False,
        }
    )
    repo.create_evaluation(db, evaluation)
    repo.create_demo_evaluation(db, evaluation)
    digest = repo.therapist_digest(db, 7)
    assert digest["only_demo"] is False
    assert digest["adherence"] == {
        "sessions": 1,
        "attempts": 1,
        "days_practiced": 1,
        "evaluations": 1,
    }
    assert all(p["session_id"] == real.id for p in digest["active_range"] + digest["assistance"])
    assert len(digest["resistance"]) == 3
    assert digest["safety_events"][0]["source"] == "resistance"
    assert digest["safety_events"][0]["session_id"] == real.id
    repo.delete_session(db, real.id)
    # A real evaluation alone is sufficient to exclude demo sessions.
    assert repo.therapist_digest(db, 7)["adherence"]["sessions"] == 0
