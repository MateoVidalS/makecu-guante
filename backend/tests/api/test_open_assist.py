"""Direction is calibration identity, including for legacy data and comparisons."""

import csv
import io

import pytest

from app.contracts import types as c
from app.db import repo
from app.voice import gemini_live


@pytest.mark.parametrize("direction", [None, "close", "open"])
def test_direction_roundtrip_and_derived_responses(
    client, payload, session_body, attempt_body, direction
):
    calibration = payload("calibration")
    body = {
        k: v for k, v in calibration.items() if k not in ("id", "created_at", "assist_direction")
    }
    if direction is not None:
        body["assist_direction"] = direction
    saved = client.post("/api/calibrations", json=body).json()
    assert saved["assist_direction"] == direction
    assert client.get("/api/calibrations/latest").json() == saved
    derived = direction or "close"
    session = client.post(
        "/api/sessions", json={**session_body, "calibration_id": saved["id"]}
    ).json()
    assert session["assist_direction"] == derived
    id = session["id"]
    assert client.post(f"/api/sessions/{id}/attempts", json=attempt_body).status_code == 200
    assert client.get(f"/api/sessions/{id}").json()["assist_direction"] == derived
    assert client.get("/api/sessions").json()[0]["assist_direction"] == derived
    for path in ("rom", "assist"):
        assert {p["assist_direction"] for p in client.get(f"/api/history/{path}").json()} == {
            derived
        }
    evaluation = {k: v for k, v in payload("evaluations")[0].items() if k != "id"}
    evaluation["calibration_id"] = saved["id"]
    evaluated = client.post("/api/evaluations", json=evaluation).json()
    assert evaluated["assist_direction"] == derived
    assert client.get(f"/api/evaluations/{evaluated['id']}").json()["assist_direction"] == derived
    assert {p["assist_direction"] for p in client.get("/api/history/resistance").json()} == {
        derived
    }
    exported = client.get("/api/export").json()
    assert exported["sessions"][0]["assist_direction"] == derived
    assert exported["evaluations"][0]["assist_direction"] == derived
    rows = list(csv.DictReader(io.StringIO(client.get("/api/export?format=csv").text)))
    assert len(rows) == len(attempt_body["fingers"])
    assert {row["assist_direction"] for row in rows} == {derived}


def test_direction_is_derived_not_accepted_from_client(client, session_body, payload):
    assert (
        client.post("/api/sessions", json={**session_body, "assist_direction": "close"}).status_code
        == 422
    )
    body = {k: v for k, v in payload("evaluations")[0].items() if k != "id"}
    assert (
        client.post("/api/evaluations", json={**body, "assist_direction": "close"}).status_code
        == 422
    )


def test_no_cross_direction_comparisons(db, calibration, session_body, attempt_body, payload):
    legacy = repo.create_calibration(
        db,
        c.CalibrationIn.model_validate(
            {
                **calibration.model_dump(exclude={"id", "created_at"}),
                "assist_direction": None,
            }
        ),
    )
    summary = c.SessionSummary.model_validate(payload("sessions")[0]["summary"])

    def visit(cal, stamp, active):
        session = repo.create_session(
            db,
            c.SessionIn.model_validate(
                {
                    **session_body,
                    "calibration_id": cal.id,
                }
            ),
            started_at=stamp,
        )
        attempt = c.AttemptResult.model_validate(attempt_body)
        # Deliberately disjoint cohorts, including a later legacy session.
        attempt.fingers = [
            f.model_copy(update={"active_max": active, "assist_needed": active})
            for f in attempt.fingers
        ]
        repo.create_attempt(db, session.id, attempt)
        return repo.end_session(db, session.id, summary)

    old = visit(legacy, "2026-01-01", 0.9)
    first = visit(calibration, "2026-01-02", 0.5)
    assert first.summary.previous is None
    second = visit(calibration, "2026-01-03", 0.2)
    later_legacy = visit(legacy, "2026-01-04", 0.99)
    assert later_legacy.summary.previous == c.PreviousSummary(
        active_ratio_mean=old.summary.active_ratio_mean,
        per_finger=[
            c.PreviousFinger(finger=f.finger, active_max_mean=f.active_max_mean)
            for f in old.summary.per_finger
        ],
    )
    assert second.summary.previous is not None
    overview = repo.history_overview(db)
    assert overview.sessions == 4 and overview.attempts == 4
    assert all(f.active_max_first == 0.5 and f.active_max_last == 0.2 for f in overview.per_finger)
    assert all(f.assist_needed_last == 0.2 for f in overview.per_finger)
    for points in (repo.history_rom(db), repo.history_assist(db)):
        assert {p.assist_direction for p in points} == {"open", "close"}
        assert len(points) == 20
    # Both Live and session summaries select comparable previous data.
    assert gemini_live.read_context(db, second.id)[1].id == first.id
    assert gemini_live.read_context(db, first.id)[1] is None


def test_overview_does_not_fill_missing_open_fingers_from_legacy(
    db, calibration, session_body, attempt_body
):
    legacy = repo.create_calibration(
        db,
        c.CalibrationIn.model_validate(
            {
                **calibration.model_dump(exclude={"id", "created_at"}),
                "assist_direction": "close",
            }
        ),
    )
    for cal, fingers in [(legacy, attempt_body["fingers"]), (calibration, [])]:
        session = repo.create_session(
            db, c.SessionIn.model_validate({**session_body, "calibration_id": cal.id})
        )
        repo.create_attempt(
            db, session.id, c.AttemptResult.model_validate({**attempt_body, "fingers": fingers})
        )
    assert all(f.active_max_first is None for f in repo.history_overview(db).per_finger)


def test_summary_contexts_keep_direction_and_pose_identity(
    db, calibration, session_body, attempt_body, payload, monkeypatch
):
    from app.llm import summaries

    legacy = repo.create_calibration(
        db,
        c.CalibrationIn.model_validate(
            {
                **calibration.model_dump(exclude={"id", "created_at"}),
                "assist_direction": None,
            }
        ),
    )
    sessions = []
    for cal in (legacy, calibration):
        saved = repo.create_session(
            db, c.SessionIn.model_validate({**session_body, "calibration_id": cal.id})
        )
        repo.create_attempt(
            db, saved.id, c.AttemptResult.model_validate({**attempt_body, "pose": "open"})
        )
        repo.end_session(
            db, saved.id, c.SessionSummary.model_validate(payload("sessions")[0]["summary"])
        )
        sessions.append(saved)
        body = {k: v for k, v in payload("evaluations")[0].items() if k != "id"}
        repo.create_evaluation(
            db, c.EvaluationIn.model_validate({**body, "calibration_id": cal.id})
        )
    captured = []

    def generate(kind, context):
        captured.append(context)
        return c.Summary(
            id=0,
            kind=kind,
            created_at=repo.now(),
            session_id=None,
            days=None,
            model="fake",
            text="Demo",
        )

    monkeypatch.setattr(summaries, "generate_summary", generate)
    for saved, direction in zip(sessions, ("close", "open"), strict=True):
        repo.create_summary(db, c.SessionSummaryIn(kind="session", session_id=saved.id))
        context = captured[-1]
        assert context["assist_direction"] == direction
        assert {p["assist_direction"] for p in context["evaluation_trend"]} == {direction}
        assert bool(context["opening_attempts"]) == (direction == "open")
        assert context["summary"]["previous"] is None
    digest = repo.therapist_digest(db, 7)
    assert {s["assist_direction"] for s in digest["sessions"]} == {"open", "close"}
    assert {p["assist_direction"] for p in digest["active_opening"]} == {"open"}
    assert {p["session_id"] for p in digest["active_opening"]} == {sessions[-1].id}
