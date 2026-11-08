"""Check the actual SDK token payload without sending credentials to Google."""

import json

import httpx
import pytest

from app.config import settings
from app.voice import gemini_live


@pytest.mark.parametrize("model", ["gemini-3.8-live-extended-thinking", "gemini-3.8-live"])
def test_english_language_is_serialized_in_locked_live_config(monkeypatch, model):
    monkeypatch.setattr(settings, "gemini_api_key", "fake-server-key")
    monkeypatch.setattr(settings, "gemini_live_model", model)
    monkeypatch.setattr(settings, "gemini_live_voice", "Puck")
    monkeypatch.setattr(settings, "gemini_live_thinking_level", "MEDIUM")
    monkeypatch.setattr(gemini_live, "read_context", lambda db, session_id: (None, None))
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"name": "auth_tokens/english-only"})

    real_client = gemini_live.genai.Client

    def make_client(**kwargs):
        kwargs["http_options"]["httpx_client"] = httpx.Client(transport=httpx.MockTransport(handle))
        return real_client(**kwargs)

    monkeypatch.setattr(gemini_live.genai, "Client", make_client)
    token = gemini_live.create_token(None, None)
    assert len(requests) == 1
    payload = json.loads(requests[0].content)
    setup = payload["bidiGenerateContentSetup"]
    speech = setup["generationConfig"]["speechConfig"]
    # The SDK preserves snake_case inside Live speechConfig, as with thinkingConfig.
    assert speech == {
        "language_code": "en-US",
        "voice_config": {"prebuilt_voice_config": {"voice_name": "Puck"}},
    }
    assert setup["model"] == f"models/{model}"
    assert ("thinkingConfig" in setup["generationConfig"]) == ("thinking" in model)
    assert "Always speak English, even if the patient speaks another language." in (
        token.system_instruction
    )
    assert "fake-server-key" not in token.model_dump_json()
    assert "intensify" in {tool["name"] for tool in setup["tools"][0]["functionDeclarations"]}
