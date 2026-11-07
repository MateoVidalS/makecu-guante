import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


@pytest.fixture
def client():
    # No lifespan needed: stub API endpoints never read the database.
    return TestClient(app)


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert isinstance(response.json()["gemini"], bool)


CASES = [
    ("GET", "/profile", None),
    ("PUT", "/profile", fixture("profile")),
    ("GET", "/calibrations/latest", None),
    ("GET", "/calibrations", None),
    (
        "POST",
        "/calibrations",
        {k: v for k, v in fixture("calibration").items() if k not in ("id", "created_at")},
    ),
    (
        "POST",
        "/sessions",
        {
            k: fixture("sessions")[0][k]
            for k in ("mode", "plan", "settings", "calibration_id", "is_demo")
        },
    ),
    ("GET", "/sessions", None),
    ("GET", "/sessions/8", None),
    ("DELETE", "/sessions/8", None),
    ("POST", "/sessions/8/end", {"summary": fixture("sessions")[0]["summary"]}),
    (
        "POST",
        "/sessions/8/attempts",
        {
            **{
                k: v
                for k, v in fixture("session_detail")["attempts"][0].items()
                if k not in ("id", "session_id")
            },
            "trace": fixture("attempt_trace"),
        },
    ),
    ("GET", "/attempts/1/trace", None),
    ("POST", "/sessions/8/transcript", {"lines": []}),
    ("POST", "/evaluations", {k: v for k, v in fixture("evaluations")[0].items() if k != "id"}),
    ("GET", "/evaluations", None),
    ("GET", "/evaluations/3", None),
    ("GET", "/history/overview", None),
    ("GET", "/history/rom?finger=index&pose=full_fist", None),
    ("GET", "/history/assist", None),
    ("GET", "/history/resistance", None),
    ("POST", "/summaries", {"kind": "session", "session_id": 8}),
    ("POST", "/summaries", {"kind": "therapist", "days": 7}),
    ("GET", "/summaries", None),
    ("POST", "/voice/token", {"session_id": None}),
    ("GET", "/export?format=json", None),
    ("GET", "/export?format=csv", None),
]


@pytest.mark.parametrize("method,path,body", CASES)
def test_every_stub_returns_contract_error(client, method, path, body):
    response = client.request(method, f"/api{path}", json=body)
    assert response.status_code == 501, response.text
    assert response.json()["error"]["code"] == "not_implemented"
    assert isinstance(response.json()["error"]["message"], str)


def test_all_documented_operations_have_a_test_case(client):
    operations = {
        (
            method.lower(),
            path.split("?")[0]
            .replace("/8", "/{id}")
            .replace("/3", "/{id}")
            .replace("/1/", "/{id}/"),
        )
        for method, path, _ in CASES
    }
    schema = client.get("/openapi.json").json()
    for path, item in schema["paths"].items():
        for method in item:
            if path != "/api/health":
                assert (method, path.removeprefix("/api")) in operations
                assert "501" in item[method]["responses"]


def test_errors_and_spa_fallback(client, tmp_path, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)
    (tmp_path / "index.html").write_text("<html>Rehab Hub</html>")
    (tmp_path / "app.js").write_text("console.log('ready')")
    assert client.get("/history/sessions/8").text == "<html>Rehab Hub</html>"
    assert client.get("/app.js").text == "console.log('ready')"
    assert client.get("/missing.js").status_code == 404
    assert client.get("/api/missing").json()["error"]["code"] == "http_error"
    assert client.post("/api/sessions", json={}).status_code == 422
