from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.voice import gemini_live
from app.voice.prompt import render_prompt


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    return TestClient(app)


def test_missing_key(client):
    response = client.post("/api/voice/token", json={"session_id": None})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "voice_unavailable"


def test_locked_token_and_no_key_in_browser(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "server-secret")
    sdk = MagicMock()
    sdk.__enter__.return_value = sdk
    sdk.auth_tokens.create.return_value = SimpleNamespace(name="auth_tokens/ephemeral")
    monkeypatch.setattr(gemini_live.genai, "Client", MagicMock(return_value=sdk))
    response = client.post("/api/voice/token", json={"session_id": None})
    assert response.status_code == 200, response.text
    assert "server-secret" not in response.text
    assert response.json()["model"] == gemini_live.CURRENT_MODEL
    config = sdk.auth_tokens.create.call_args.kwargs["config"]
    assert config["uses"] == 1
    assert (config["expire_time"] - config["new_session_expire_time"]).total_seconds() == 1740
    locked = config["live_connect_constraints"]
    assert locked["model"] == response.json()["model"]
    assert locked["config"]["system_instruction"] == response.json()["system_instruction"]
    assert locked["config"]["tools"] == response.json()["tools"]
    assert locked["config"]["response_modalities"] == ["AUDIO"]


def test_provider_failure_does_not_leak_key(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "server-secret")
    monkeypatch.setattr(
        gemini_live.genai, "Client", MagicMock(side_effect=ValueError("server-secret"))
    )
    response = client.post("/api/voice/token", json={"session_id": None})
    assert response.status_code == 503
    assert "server-secret" not in response.text


def test_context_uses_wp5_boundary(monkeypatch):
    profile = SimpleNamespace(pseudonym="Sam", goals="Practice a pinch")
    previous = SimpleNamespace(id=1, is_demo=False, summary=SimpleNamespace())
    current = SimpleNamespace(is_demo=False)
    monkeypatch.setattr(gemini_live.repo, "get_profile", lambda db: profile)
    monkeypatch.setattr(gemini_live.repo, "get_session", lambda db, id: current)
    monkeypatch.setattr(gemini_live.repo, "list_sessions", lambda db, limit: [previous])
    assert gemini_live.read_context(None, 2) == (profile, previous)


def test_prompt():
    prompt = render_prompt(SimpleNamespace(pseudonym="Sam", goals="Practice"), None)
    assert '"pseudonym": "Sam"' in prompt
    assert "Never resume automatically" in prompt
    assert "untrusted data" in prompt
    assert "No medical advice" in prompt
