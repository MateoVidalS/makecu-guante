import csv
import gzip
import io
import json
import re

import pytest
from sqlmodel import select

from app.contracts import types as c
from app.contracts.therapist import SessionDetail
from app.db import models as m


def test_profile_and_calibration_roundtrip(client, payload):
    assert c.Profile.model_validate(client.get("/api/profile").json()).pseudonym == ""
    body = payload("profile")
    assert client.put("/api/profile", json=body).json() == body
    assert client.get("/api/profile").json() == body
    assert client.get("/api/calibrations/latest").json() is None
    assert client.get("/api/calibrations").json() == []
    body = {k: v for k, v in payload("calibration").items() if k not in ("id", "created_at")}
    first = client.post("/api/calibrations", json=body).json()
    second = client.post("/api/calibrations", json=body).json()
    assert (
        c.Calibration.model_validate(first).model_dump(
            exclude={"id", "created_at"}, exclude_none=True
        )
        == body
    )
    assert client.get("/api/calibrations/latest").json() == second
    assert client.get("/api/calibrations").json() == [second, first]


@pytest.mark.parametrize("flex_model", [None, 1, 2, 3])
def test_calibration_flex_model_roundtrip(client, db, payload, flex_model):
    body = {k: v for k, v in payload("calibration").items() if k not in ("id", "created_at")}
    body["camera"]["camera_view"] = "front_upright"
    body["camera"]["flex_model"] = flex_model
    response = client.post("/api/calibrations", json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["camera"]["flex_model"] == flex_model
    row = db.get(m.Calibration, saved["id"])
    assert json.loads(row.camera_json)["flex_model"] == flex_model
    assert client.get("/api/calibrations/latest").json() == saved
    assert client.get("/api/calibrations").json() == [saved]


def test_session_attempt_trace_transcript_and_cascade(
    client, db, payload, session_body, attempt_body
):
    session = c.Session.model_validate(client.post("/api/sessions", json=session_body).json())
    id = session.id
    assert session.summary is None and session.n_attempts == 0
    attempt = c.Attempt.model_validate(
        client.post(f"/api/sessions/{id}/attempts", json=attempt_body).json()
    )
    assert attempt.model_dump(exclude={"id", "session_id"}) == {
        k: v for k, v in attempt_body.items() if k != "trace"
    }
    blob = db.get(m.AttemptTrace, attempt.id).blob
    assert blob.startswith(b"\x1f\x8b")
    assert json.loads(gzip.decompress(blob)) == payload("attempt_trace")
    assert client.get(f"/api/attempts/{attempt.id}/trace").json() == payload("attempt_trace")
    transcript = payload("session_detail")["transcript"]
    response = client.post(f"/api/sessions/{id}/transcript", json={"lines": transcript})
    assert response.status_code == 204 and not response.content
    detail = SessionDetail.model_validate(client.get(f"/api/sessions/{id}").json())
    assert detail.n_attempts == 1 and detail.attempts == [attempt]
    assert [t.model_dump() for t in detail.transcript] == transcript
    summary = payload("sessions")[0]["summary"]
    summary["previous"] = {"active_ratio_mean": 99, "per_finger": []}
    ended = c.Session.model_validate(
        client.post(f"/api/sessions/{id}/end", json={"summary": summary}).json()
    )
    assert ended.ended_at and ended.summary.previous is None
    assert client.get("/api/sessions?mode=exercise&limit=1&offset=0").json() == [ended.model_dump()]
    assert client.get("/api/sessions?offset=1").json() == []
    db.add(
        m.Summary(
            kind="session", session_id=id, created_at=ended.ended_at, model="mock", text="Effort"
        )
    )
    db.commit()
    response = client.delete(f"/api/sessions/{id}")
    assert response.status_code == 204 and not response.content
    for model in (
        m.Session,
        m.Attempt,
        m.AttemptFinger,
        m.AttemptTrace,
        m.TranscriptLine,
        m.Summary,
    ):
        assert not db.exec(select(model)).all()
    assert client.get(f"/api/attempts/{attempt.id}/trace").status_code == 404


def test_fixture_sessions_roundtrip(client, payload, calibration):
    for item in payload("sessions"):
        body = {k: item[k] for k in c.SessionIn.model_fields}
        body["calibration_id"] = calibration.id
        created = client.post("/api/sessions", json=body).json()
        ended = client.post(
            f"/api/sessions/{created['id']}/end", json={"summary": item["summary"]}
        ).json()
        expected = {**item, **{k: ended[k] for k in ("id", "started_at", "ended_at", "n_attempts")}}
        expected["summary"]["previous"] = ended["summary"]["previous"]
        assert ended == {**expected, "assist_direction": calibration.assist_direction}
        detail = client.get(f"/api/sessions/{created['id']}").json()
        SessionDetail.model_validate(detail)
        assert detail["coach_decisions"] == detail["feelings"] == []
        assert {
            k: v
            for k, v in detail.items()
            if k not in ("attempts", "transcript", "coach_decisions", "feelings")
        } == ended


def test_evaluations_roundtrip_and_compression(client, db, payload, calibration):
    expected = []
    for item in payload("evaluations"):
        body = {k: v for k, v in item.items() if k != "id"}
        body["calibration_id"] = calibration.id
        response = client.post("/api/evaluations", json=body)
        assert response.status_code == 200, response.text
        evaluation = c.Evaluation.model_validate(response.json())
        assert evaluation.model_dump(exclude={"id", "assist_direction"}) == body
        assert client.get(f"/api/evaluations/{evaluation.id}").json() == evaluation.model_dump()
        blob = db.get(m.Evaluation, evaluation.id).sweeps_blob
        assert blob.startswith(b"\x1f\x8b") and json.loads(gzip.decompress(blob)) == body["sweeps"]
        expected.append(evaluation.model_dump())
    expected.sort(key=lambda x: (x["started_at"], x["id"]), reverse=True)
    assert client.get("/api/evaluations").json() == expected
    # The schema exposes evaluation deletion through cascades, with no REST DELETE contract.
    db.delete(db.get(m.Evaluation, expected[0]["id"]))
    db.commit()
    assert not db.exec(
        select(m.EvaluationFinger).where(m.EvaluationFinger.evaluation_id == expected[0]["id"])
    ).all()


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("get", "/sessions/999", None),
        ("delete", "/sessions/999", None),
        ("get", "/evaluations/999", None),
        ("get", "/attempts/999/trace", None),
        ("post", "/sessions/999/transcript", {"lines": []}),
    ],
)
def test_missing_record_errors(client, method, path, body):
    response = client.request(method, "/api" + path, json=body)
    assert response.status_code == 404
    assert c.ApiError.model_validate(response.json()).error.code == "not_found"


def test_missing_references_and_query_validation(client, session_body, attempt_body, payload):
    session_body["calibration_id"] = 999
    assert client.post("/api/sessions", json=session_body).status_code == 404
    assert client.post("/api/sessions/999/attempts", json=attempt_body).status_code == 404
    assert (
        client.post(
            "/api/sessions/999/end", json={"summary": payload("sessions")[0]["summary"]}
        ).status_code
        == 404
    )
    evaluation = {k: v for k, v in payload("evaluations")[0].items() if k != "id"}
    evaluation["calibration_id"] = 999
    assert client.post("/api/evaluations", json=evaluation).status_code == 404
    for path in (
        "/sessions?limit=0",
        "/sessions?offset=-1",
        "/sessions?mode=bad",
        "/history/rom?finger=invalid",
        "/history/rom?pose=bad",
        "/export?format=xml",
        "/summaries?kind=bad",
        "/summaries?limit=-1",
    ):
        response = client.get("/api" + path)
        assert response.status_code == 422, path
        assert c.ApiError.model_validate(response.json()).error.code == "validation_error"
    attempt_body["trace"]["ma"].pop()
    assert client.post("/api/sessions/1/attempts", json=attempt_body).status_code == 422


def test_exports(client, db, session_body, attempt_body, payload, calibration):
    assert client.get("/api/export?format=csv").text.startswith("session_id,")
    id = client.post("/api/sessions", json=session_body).json()["id"]
    client.post(f"/api/sessions/{id}/attempts", json=attempt_body)
    transcript = payload("session_detail")["transcript"]
    client.post(f"/api/sessions/{id}/transcript", json={"lines": transcript})
    evaluation = {k: v for k, v in payload("evaluations")[0].items() if k != "id"}
    evaluation["calibration_id"] = calibration.id
    client.post("/api/evaluations", json=evaluation)
    # Export must not silently truncate summaries to the usual list limit of 20.
    db.add_all(
        [
            m.Summary(
                kind="therapist",
                created_at="2026-11-07T12:00:00Z",
                days=7,
                model="test",
                text=f"Note {i}",
            )
            for i in range(25)
        ]
    )
    db.commit()
    response = client.get("/api/export?format=json")
    assert re.fullmatch(
        r'attachment; filename="rehab-hub-export-\d{8}.json"',
        response.headers["content-disposition"],
    )
    data = response.json()
    assert len(data["summaries"]) == 25
    assert data["sessions"][0]["attempts"][0]["trace"] == attempt_body["trace"]
    assert data["sessions"][0]["transcript"] == transcript
    c.Evaluation.model_validate(data["evaluations"][0])
    response = client.get("/api/export?format=csv")
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"].endswith('.csv"')
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == len(attempt_body["fingers"])
    assert {r["finger"] for r in rows} == {f["finger"] for f in attempt_body["fingers"]}
    assert all(
        int(r["session_id"]) == id and int(r["calibration_id"]) == calibration.id for r in rows
    )
    assert json.loads(rows[0]["plan"]) == session_body["plan"]
    assert float(rows[0]["active_max"]) == attempt_body["fingers"][0]["active_max"]
