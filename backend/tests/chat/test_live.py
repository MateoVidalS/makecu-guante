import json

import pytest
from google.genai import types

from app.chat import live, prompt, tools
from app.config import settings


@pytest.mark.parametrize("large", [False, True])
def test_locked_single_use_voice_token_inline_or_context(client, sdk, monkeypatch, large):
    record = {
        "only_demo": True,
        "readable": {"note": "record-marker" + "x" * (65000 if large else 10)},
    }
    monkeypatch.setattr(live, "build_patient_record", lambda db: record)
    result = client.post("/api/chat/voice-token")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["token"] == "auth_tokens/chat-test"
    expected = settings.gemini_live_model
    assert body["model"] == (live.CURRENT_MODEL if expected in live.RETIRED_MODELS else expected)
    assert body["voice"] == settings.gemini_live_voice
    assert "fake-key" not in result.text
    assert set(body) == {"token", "expires_at", "model", "voice", "context"}
    cfg = sdk.auth_tokens.create.call_args.kwargs["config"]
    assert cfg["uses"] == 1
    assert (cfg["expire_time"] - cfg["new_session_expire_time"]).total_seconds() == 1740
    assert cfg["expire_time"].isoformat() == body["expires_at"]
    locked = cfg["live_connect_constraints"]
    assert locked["model"] == body["model"]
    connect = locked["config"]
    assert connect["response_modalities"] == ["AUDIO"]
    assert (
        connect["speech_config"]["voice_config"]["prebuilt_voice_config"]["voice_name"]
        == body["voice"]
    )
    assert connect["input_audio_transcription"] == connect["output_audio_transcription"] == {}
    assert connect["tools"] == tools.TOOLS
    realtime = connect["realtime_input_config"]
    assert realtime["activity_handling"] == "NO_INTERRUPTION"
    assert realtime["automatic_activity_detection"]["start_of_speech_sensitivity"] == (
        "START_SENSITIVITY_LOW"
    )
    assert "never say you will" in connect["system_instruction"]
    assert "60 words" in connect["system_instruction"]
    # Validate against the installed SDK locally; this does not make a request.
    assert types.CreateAuthTokenConfig.model_validate(cfg).uses == 1
    if large:
        assert connect["system_instruction"] == prompt.rules(voice=True)
        assert "record-marker" not in connect["system_instruction"]
        assert body["context"] == prompt.record_text(record)
    else:
        assert body["context"] is None
        assert connect["system_instruction"] == prompt.render(record, voice=True)
    sdk.factory.return_value.__exit__.assert_called_once()


def test_token_threshold_uses_entire_prompt_length(client, sdk, monkeypatch):
    record = {"readable": {}, "only_demo": False}
    monkeypatch.setattr(live, "build_patient_record", lambda db: record)
    monkeypatch.setattr(live, "RECORD_IN_TOKEN_MAX_CHARS", len(prompt.render(record, voice=True)))
    assert client.post("/api/chat/voice-token").json()["context"] is None
    monkeypatch.setattr(
        live, "RECORD_IN_TOKEN_MAX_CHARS", len(prompt.render(record, voice=True)) - 1
    )
    assert client.post("/api/chat/voice-token").json()["context"] == prompt.record_text(record)


def test_voice_missing_key_never_constructs_provider(client):
    from google import genai

    result = client.post("/api/chat/voice-token")
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "chat_unavailable"
    genai.Client.assert_not_called()


def test_voice_error_is_redacted(client, sdk, caplog, capsys):
    sdk.auth_tokens.create.side_effect = RuntimeError("fake-key in provider URL")
    result = client.post("/api/chat/voice-token")
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "chat_unavailable"
    assert "fake-key" not in result.text + caplog.text + capsys.readouterr().out


@pytest.mark.parametrize("name", [None, "", "fake-key"])
def test_invalid_provider_token_is_unavailable(client, sdk, name):
    sdk.auth_tokens.create.return_value.name = name
    assert client.post("/api/chat/voice-token").status_code == 503


def test_tools_endpoint_statuses_and_read_only(client, db):
    from sqlmodel import select

    from app.db import models as m

    before = {
        table: len(db.exec(select(table)).all())
        for table in (m.Session, m.Attempt, m.Evaluation, m.Summary, m.TranscriptLine)
    }
    result = client.post("/api/chat/tools/get_session", json={"args": {"date": "Nov 5"}})
    assert result.status_code == 200
    assert result.json()["name"] == "get_session"
    assert result.json()["result"]["readable"]["sessions"]
    assert (
        client.post("/api/chat/tools/delete_session", json={"args": {"id": 1}}).status_code == 404
    )
    assert (
        client.post("/api/chat/tools/show_chart", json={"args": {"section": "range"}}).status_code
        == 422
    )
    assert (
        "error"
        in client.post("/api/chat/tools/get_session", json={"args": {"date": "bad"}}).json()[
            "result"
        ]
    )
    assert (
        "not_found"
        in client.post("/api/chat/tools/get_session", json={"args": {"date": "2000-01-01"}}).json()[
            "result"
        ]
    )
    after = {table: len(db.exec(select(table)).all()) for table in before}
    assert before == after
    assert "fake-key" not in json.dumps(result.json())


def test_voice_uses_the_coach_live_model_mapping(db, monkeypatch):
    from app.voice.gemini_live import CURRENT_MODEL

    monkeypatch.setattr(settings, "gemini_live_model", "gemini-3.8-live-extended-thinking")
    assert live.CURRENT_MODEL == CURRENT_MODEL
    assert "gemini-3.8-live-extended-thinking" in live.RETIRED_MODELS
