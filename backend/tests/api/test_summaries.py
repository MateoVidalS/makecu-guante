import json
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.config import settings
from app.contracts import types as c
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
