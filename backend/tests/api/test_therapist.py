import csv
import io
import json

import pytest
from sqlmodel import select

from app.contracts.therapist import CoachDecision, FeelingEntry, SessionDetail
from app.db import models as m


@pytest.fixture
def therapy_session(client, session_body):
    return client.post("/api/sessions", json=session_body).json()["id"]


@pytest.fixture
def decision(therapy_session):
    return {
        "id": "decision-1",
        "t": "2026-11-07T12:00:01.000Z",
        "session_id": therapy_session,
        "tool": "adjust_help",
        "requested": {"finger": "index", "direction": "more", "reason": "Your hand is tiring"},
        "applied": {"assist_speed": {"index": 0.3}},
        "result": "clamped",
        "reason": "Help is already at the safe cap",
        "source": "coach",
    }


@pytest.fixture
def feeling(therapy_session):
    return {
        "t": "2026-11-07T12:00:02.000Z",
        "session_id": therapy_session,
        "attempt_index": 0,
        "pain": 5,
        "fatigue": 6,
        "note": "My index hurts",
        "source": "voice",
    }


def normalized_decision(data):
    return CoachDecision.model_validate(data).model_dump()


def normalized_feeling(data):
    return FeelingEntry.model_validate(data).model_dump()


def test_upload_roundtrip_order_retry_and_cascade(client, db, therapy_session, decision, feeling):
    path = f"/api/sessions/{therapy_session}"
    unknown = {
        **decision,
        "id": "unknown",
        "t": "2026-11-07T12:00:00Z",
        "tool": "set_current_limit",
        "requested": {"ma": 99999, "nested": [True, None, {"finger": "unknown"}]},
        "applied": None,
        "result": "rejected",
        "source": "patient_ui",
    }
    brake = {
        **decision,
        "id": "brake",
        "t": "2026-11-07T12:00:02Z",
        "tool": "brake",
        "requested": {"reason": "Reported pain 5/10"},
        "applied": {"phase": "PAUSED"},
        "result": "applied",
        "reason": "Reported pain 5/10",
        "source": "local_rule",
    }
    undone = {**decision, "id": "undo", "t": "2026-11-07T12:00:03Z", "result": "undone"}
    decisions = [undone, brake, decision, unknown]
    for _ in range(2):
        response = client.post(path + "/coach_decisions", json={"decisions": decisions})
        assert response.status_code == 204 and not response.content
        response = client.post(path + "/feelings", json={"feelings": [feeling]})
        assert response.status_code == 204 and not response.content
    detail = SessionDetail.model_validate(client.get(path).json())
    assert [d.model_dump() for d in detail.coach_decisions] == [
        normalized_decision(d) for d in reversed(decisions)
    ]
    assert [f.model_dump() for f in detail.feelings] == [normalized_feeling(feeling)]
    assert len(db.exec(select(m.CoachDecision)).all()) == 4
    assert len(db.exec(select(m.FeelingEntry)).all()) == 1
    assert client.delete(path).status_code == 204
    assert not db.exec(select(m.CoachDecision)).all()
    assert not db.exec(select(m.FeelingEntry)).all()


def test_null_decision_session_is_bound_to_url_and_retries_are_semantic(
    client, therapy_session, decision
):
    path = f"/api/sessions/{therapy_session}"
    decision["session_id"] = None
    assert client.post(path + "/coach_decisions", json={"decisions": [decision]}).status_code == 204
    # The same instant and reordered JSON object keys are still the same record.
    retry = {
        **decision,
        "session_id": therapy_session,
        "t": "2026-11-07T07:00:01-05:00",
        "requested": dict(reversed(list(decision["requested"].items()))),
    }
    assert client.post(path + "/coach_decisions", json={"decisions": [retry]}).status_code == 204
    saved = client.get(path).json()["coach_decisions"]
    assert len(saved) == 1 and saved[0]["session_id"] == therapy_session


@pytest.mark.parametrize("collection", ["coach_decisions", "feelings"])
def test_batch_conflict_preserves_original_and_rolls_back_new_rows(
    client, therapy_session, decision, feeling, collection
):
    path = f"/api/sessions/{therapy_session}"
    original = decision if collection == "coach_decisions" else feeling
    key = "decisions" if collection == "coach_decisions" else "feelings"
    assert client.post(path + "/" + collection, json={key: [original]}).status_code == 204
    new = {**original, "t": "2026-11-07T12:00:04Z"}
    if collection == "coach_decisions":
        new["id"] = "new-decision"
        conflict = {**original, "reason": "Altered audit record"}
    else:
        conflict = {**original, "pain": 0}
    response = client.post(path + "/" + collection, json={key: [new, conflict]})
    assert response.status_code == 409 and response.json()["error"]["code"] == "audit_conflict"
    normalize = normalized_decision if collection == "coach_decisions" else normalized_feeling
    assert client.get(path).json()[collection] == [normalize(original)]


@pytest.mark.parametrize("collection", ["coach_decisions", "feelings"])
def test_missing_parent_and_mismatched_session_reject_entire_batch(
    client, therapy_session, decision, feeling, collection
):
    data = decision if collection == "coach_decisions" else feeling
    key = "decisions" if collection == "coach_decisions" else "feelings"
    assert client.post(f"/api/sessions/999/{collection}", json={key: []}).status_code == 404
    mismatch = {**data, "session_id": 999}
    response = client.post(
        f"/api/sessions/{therapy_session}/{collection}", json={key: [data, mismatch]}
    )
    assert response.status_code == 422
    assert client.get(f"/api/sessions/{therapy_session}").json()[collection] == []


@pytest.mark.parametrize(
    "patch",
    [
        {"pain": -1},
        {"pain": 10.1},
        {"fatigue": -0.1},
        {"fatigue": 11},
        {"attempt_index": -1},
        {"source": "coach"},
        {"t": "yesterday"},
        {"t": "2026-11-07T12:00:00"},
        {"unexpected": True},
    ],
)
def test_feeling_validation_is_atomic(client, therapy_session, feeling, patch):
    path = f"/api/sessions/{therapy_session}"
    response = client.post(path + "/feelings", json={"feelings": [feeling, {**feeling, **patch}]})
    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    assert client.get(path).json()["feelings"] == []


@pytest.mark.parametrize("pain,fatigue,source", [(0, 0, "ui"), (10, 10, "voice"), (3.5, 6.5, "ui")])
def test_rating_boundaries_and_reports_without_attempt(
    client, therapy_session, feeling, pain, fatigue, source
):
    data = {**feeling, "pain": pain, "fatigue": fatigue, "source": source, "attempt_index": None}
    path = f"/api/sessions/{therapy_session}"
    assert client.post(path + "/feelings", json={"feelings": [data]}).status_code == 204
    assert client.get(path).json()["feelings"] == [normalized_feeling(data)]


def test_uploads_do_not_execute_commands_or_change_settings(
    client, db, therapy_session, decision, feeling, session_body
):
    path = f"/api/sessions/{therapy_session}"
    calibration = db.get(m.Calibration, session_body["calibration_id"])
    before = calibration.model_dump()
    # The backend records what the runtime did. It must never reinterpret audit data as a tool.
    decision.update(tool="brake", result="applied", requested={"reason": "Pain"}, applied={})
    assert client.post(path + "/coach_decisions", json={"decisions": [decision]}).status_code == 204
    assert client.post(path + "/feelings", json={"feelings": [feeling]}).status_code == 204
    saved = client.get(path).json()
    assert saved["settings"] == session_body["settings"] and saved["ended_at"] is None
    db.refresh(calibration)
    assert calibration.model_dump() == before


def test_json_and_csv_exports_include_audit_records(
    client, therapy_session, decision, feeling, attempt_body
):
    path = f"/api/sessions/{therapy_session}"
    decision["reason"] = 'Rest, then "try"\nagain'
    feeling["note"] = 'Tired, but "okay"\nnow'
    client.post(path + "/coach_decisions", json={"decisions": [decision]})
    client.post(path + "/feelings", json={"feelings": [feeling]})
    client.post(path + "/attempts", json=attempt_body)
    exported = client.get("/api/export?format=json").json()["sessions"][0]
    assert exported["coach_decisions"] == [normalized_decision(decision)]
    assert exported["feelings"] == [normalized_feeling(feeling)]
    rows = list(csv.DictReader(io.StringIO(client.get("/api/export?format=csv").text)))
    assert len(rows) == 5
    for row in rows:
        assert json.loads(row["coach_decisions"]) == exported["coach_decisions"]
        assert json.loads(row["feelings"]) == exported["feelings"]


def test_late_uploads_are_allowed_after_session_end(
    client, therapy_session, decision, feeling, payload
):
    path = f"/api/sessions/{therapy_session}"
    assert (
        client.post(path + "/end", json={"summary": payload("sessions")[0]["summary"]}).status_code
        == 200
    )
    assert client.post(path + "/coach_decisions", json={"decisions": [decision]}).status_code == 204
    assert client.post(path + "/feelings", json={"feelings": [feeling]}).status_code == 204
