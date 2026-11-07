import json
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.config import settings
from app.contracts import types as c
from app.contracts.therapist import CoachDecision, FeelingEntry
from app.db import models as m
from app.db import repo
from app.llm import summaries


def fake_model(monkeypatch, text="Steady effort today."):
    factory = MagicMock()
    model = factory.return_value.__enter__.return_value.models.generate_content
    model.return_value = SimpleNamespace(text=text)
    monkeypatch.setattr(summaries.genai, "Client", factory)
    monkeypatch.setattr(settings, "gemini_api_key", "test-secret-key")
    return model


def test_session_summary_persists_and_supplies_previous_and_evaluation_trend(
    client, db, session_body, payload, calibration, monkeypatch
):
    model = fake_model(monkeypatch)
    previous = client.post("/api/sessions", json=session_body).json()
    summary = payload("sessions")[0]["summary"]
    client.post(f"/api/sessions/{previous['id']}/end", json={"summary": summary})
    current = client.post("/api/sessions", json=session_body).json()
    client.post(f"/api/sessions/{current['id']}/end", json={"summary": summary})
    evaluation = {k: v for k, v in payload("evaluations")[0].items() if k != "id"}
    evaluation.update(calibration_id=calibration.id, is_demo=session_body["is_demo"])
    client.post("/api/evaluations", json=evaluation)
    response = client.post("/api/summaries", json={"kind": "session", "session_id": current["id"]})
    assert response.status_code == 200, response.text
    saved = c.Summary.model_validate(response.json())
    assert saved.id > 0 and saved.session_id == current["id"] and saved.days is None
    assert saved.model == settings.gemini_text_model and saved.text == "Steady effort today."
    context = json.loads(model.call_args.kwargs["contents"])
    assert context["summary"]["previous"]["active_ratio_mean"] == summary["active_ratio_mean"]
    assert len(context["evaluation_trend"]) == 5
    assert client.get("/api/summaries?kind=session&limit=1").json() == [saved.model_dump()]


def test_summary_context_marks_legacy_fingers_unmeasured(
    client, db, session_body, payload, monkeypatch
):
    model = fake_model(monkeypatch)
    session = repo.create_session(db, c.SessionIn.model_validate(session_body))
    summary = payload("sessions")[0]["summary"]
    summary["per_finger"] = summary["per_finger"][:3]
    row = db.get(m.Session, session.id)
    row.summary_json = json.dumps(summary)
    db.add(row)
    db.commit()
    response = client.post("/api/summaries", json={"kind": "session", "session_id": session.id})
    assert response.status_code == 200, response.text
    context = json.loads(model.call_args.kwargs["contents"])
    fingers = context["summary"]["per_finger"]
    assert [f["finger"] for f in fingers] == list(repo.FINGERS)
    assert all(f["active_max_mean"] is f["assist_needed_mean"] is None for f in fingers[3:])


def test_therapist_summary_digest_excludes_demo_and_summaries_filter(
    client, db, session_body, monkeypatch
):
    model = fake_model(monkeypatch)
    body = c.SessionIn.model_validate(session_body)
    repo.create_demo_session(db, body)
    first = client.post("/api/summaries", json={"kind": "therapist", "days": 7})
    assert first.status_code == 200
    assert json.loads(model.call_args.kwargs["contents"])["only_demo"] is True
    repo.create_session(db, body.model_copy(update={"is_demo": False}))
    second = client.post("/api/summaries", json={"kind": "therapist", "days": 7})
    saved = c.Summary.model_validate(second.json())
    assert saved.days == 7 and saved.session_id is None
    context = json.loads(model.call_args.kwargs["contents"])
    assert context["only_demo"] is False and context["adherence"]["sessions"] == 1
    assert client.get("/api/summaries?kind=session").json() == []
    assert len(client.get("/api/summaries").json()) == 2
    assert client.get("/api/summaries?limit=1").json()[0]["id"] == saved.id


def test_summary_503s_without_key_and_no_secret_in_health_or_errors(
    client, session_body, payload, monkeypatch, caplog
):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    session = client.post("/api/sessions", json=session_body).json()
    client.post(
        f"/api/sessions/{session['id']}/end", json={"summary": payload("sessions")[0]["summary"]}
    )
    for body in (
        {"kind": "session", "session_id": session["id"]},
        {"kind": "therapist", "days": 7},
    ):
        response = client.post("/api/summaries", json=body)
        assert response.status_code == 503
        assert c.ApiError.model_validate(response.json()).error.code == "llm_unavailable"
    assert client.get("/api/health").json()["gemini"] is False
    model = fake_model(monkeypatch)
    model.side_effect = TimeoutError("test-secret-key")
    response = client.post("/api/summaries", json={"kind": "therapist", "days": 7})
    assert response.status_code == 503
    assert "test-secret-key" not in response.text + caplog.text
    assert client.get("/api/health").json() == {"ok": True, "version": "0.1.0", "gemini": True}
    assert client.get("/api/summaries").json() == []


def test_invalid_summary_requests(client, session_body, monkeypatch):
    model = fake_model(monkeypatch)
    session = client.post("/api/sessions", json=session_body).json()
    assert (
        client.post("/api/summaries", json={"kind": "session", "session_id": 999}).status_code
        == 404
    )
    assert (
        client.post(
            "/api/summaries", json={"kind": "session", "session_id": session["id"]}
        ).status_code
        == 422
    )
    for days in (0, -1):
        assert (
            client.post("/api/summaries", json={"kind": "therapist", "days": days}).status_code
            == 422
        )
    model.assert_not_called()


def test_summary_inputs_include_feelings_and_full_decision_audit(
    client, db, session_body, payload, monkeypatch
):
    model = fake_model(monkeypatch)
    id = client.post("/api/sessions", json=session_body).json()["id"]
    path = f"/api/sessions/{id}"
    feelings = [
        FeelingEntry(
            t="2026-11-07T12:00:00Z",
            session_id=id,
            attempt_index=0,
            pain=5,
            fatigue=7,
            note="My index hurts",
            source="ui",
        ).model_dump()
    ]
    decisions = [
        CoachDecision(
            id=f"decision-{result}",
            t=f"2026-11-07T12:00:0{i}Z",
            session_id=id,
            tool="brake" if result == "applied" else "adjust_help",
            requested={"reason": "Reported pain"} if result == "applied" else {"finger": "index"},
            applied=None if result == "rejected" else {"phase": "PAUSED"},
            result=result,
            reason="Reported pain" if result == "applied" else "Safe help limit",
            source="local_rule" if result == "applied" else "coach",
        ).model_dump()
        for i, result in enumerate(("applied", "clamped", "rejected", "undone"))
    ]
    assert client.post(path + "/feelings", json={"feelings": feelings}).status_code == 204
    assert client.post(path + "/coach_decisions", json={"decisions": decisions}).status_code == 204
    client.post(path + "/end", json={"summary": payload("sessions")[0]["summary"]})
    for request in ({"kind": "session", "session_id": id}, {"kind": "therapist", "days": 7}):
        response = client.post("/api/summaries", json=request)
        assert response.status_code == 200, response.text
        context = json.loads(model.call_args.kwargs["contents"])
        assert context["feelings"] == feelings
        assert context["coach_decisions"] == decisions


def test_digest_filters_therapy_records_by_session_demo_status_and_window(db, session_body):
    from datetime import datetime, timedelta, timezone

    body = c.SessionIn.model_validate(session_body)
    demo = repo.create_demo_session(db, body)
    old = repo.create_session(
        db,
        body,
        started_at=(datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),
    )
    for session in (demo, old):
        repo.add_feelings(
            db,
            session.id,
            [
                FeelingEntry(
                    t=repo.now(),
                    session_id=session.id,
                    attempt_index=None,
                    pain=0,
                    fatigue=2,
                    note="Fine",
                    source="voice",
                )
            ],
        )
        repo.add_coach_decisions(
            db,
            session.id,
            [
                CoachDecision(
                    id="rest",
                    t=repo.now(),
                    session_id=session.id,
                    tool="add_rest",
                    requested={"seconds": 10},
                    applied={"seconds": 10},
                    result="applied",
                    reason="Tired",
                    source="coach",
                )
            ],
        )
    digest = repo.therapist_digest(db, 7)
    assert digest["only_demo"] is True
    assert {f["session_id"] for f in digest["feelings"]} == {demo.id}
    assert {d["session_id"] for d in digest["coach_decisions"]} == {demo.id}
    repo.create_session(db, body.model_copy(update={"is_demo": False}))
    digest = repo.therapist_digest(db, 7)
    assert digest["only_demo"] is False
    assert digest["coach_decisions"] == digest["feelings"] == []
