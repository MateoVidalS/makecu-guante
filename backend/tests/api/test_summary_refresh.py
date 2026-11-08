"""The therapist summary is regenerated in the background after every session."""

import threading

from sqlmodel import select

from app.config import settings
from app.contracts import types as c
from app.db import models as m
from app.llm import refresh


def test_ending_a_session_refreshes_the_therapist_summary(
    client, db, session_body, payload, monkeypatch
):
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
    calls = []

    def fake(kind, context):
        calls.append((kind, context["days"], context["adherence"]["sessions"]))
        return c.Summary(
            id=0, kind=kind, created_at="", session_id=None, days=None, model="m", text="Fresh."
        )

    monkeypatch.setattr("app.llm.summaries.generate_summary", fake)
    session = client.post("/api/sessions", json=session_body).json()
    summary = payload("sessions")[0]["summary"]
    response = client.post(f"/api/sessions/{session['id']}/end", json={"summary": summary})
    assert response.status_code == 200
    assert calls == [("therapist", 7, 1)]
    stored = client.get("/api/summaries?kind=therapist&limit=1").json()
    assert stored[0]["text"] == "Fresh." and stored[0]["days"] == 7


def test_no_key_means_no_background_work(client, db, session_body, payload, monkeypatch):
    monkeypatch.setattr(
        "app.llm.summaries.generate_summary", lambda *a: (_ for _ in ()).throw(AssertionError)
    )
    session = client.post("/api/sessions", json=session_body).json()
    summary = payload("sessions")[0]["summary"]
    response = client.post(f"/api/sessions/{session['id']}/end", json={"summary": summary})
    assert response.status_code == 200
    assert db.exec(select(m.Summary)).all() == []


def test_a_failed_refresh_never_affects_the_session(client, db, session_body, payload, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")

    def unavailable(*args):
        raise RuntimeError("provider down fake-key")

    monkeypatch.setattr("app.llm.summaries.generate_summary", unavailable)
    session = client.post("/api/sessions", json=session_body).json()
    summary = payload("sessions")[0]["summary"]
    response = client.post(f"/api/sessions/{session['id']}/end", json={"summary": summary})
    assert response.status_code == 200 and response.json()["ended_at"]


def test_sessions_ending_during_a_refresh_coalesce_into_one_more_run(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
    started, release, runs = threading.Event(), threading.Event(), []

    def slow(db, body):
        runs.append(body.days)
        if len(runs) == 1:
            started.set()
            release.wait(5)

    monkeypatch.setattr("app.db.repo.create_summary", slow)
    monkeypatch.setattr(refresh, "Session", lambda bind: _NullSession())
    worker = threading.Thread(target=refresh.refresh_therapist_summary, args=(None,))
    worker.start()
    assert started.wait(5)
    for _ in range(3):  # three sessions end while the first refresh is running
        refresh.refresh_therapist_summary(None)
    release.set()
    worker.join(5)
    assert runs == [7, 7]  # one catch-up run covers all three
    assert refresh._running is False


class _NullSession:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False
