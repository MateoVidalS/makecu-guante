import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.llm import summaries


def model_mock(monkeypatch, *, text="Your effort was steady today.", error=None):
    factory = MagicMock()
    client = factory.return_value.__enter__.return_value
    client.models.generate_content.return_value = SimpleNamespace(text=text)
    if error:
        client.models.generate_content.side_effect = error
    monkeypatch.setattr(summaries.genai, "Client", factory)
    monkeypatch.setattr(summaries.settings, "gemini_api_key", "fake-secret-for-tests")
    return factory, client


@pytest.mark.parametrize(
    "kind,required",
    [
        ("session", ["80 words", "second person", "previous", "Do not show mA"]),
        (
            "therapist",
            [
                "250 words",
                "Practice",
                "Active range",
                "Assistance",
                "Resistance",
                "Safety",
                "Notes for therapist",
                "adherence",
                "velocity",
            ],
        ),
    ],
)
def test_sdk_call_prompt_timeout_and_resource_cleanup(monkeypatch, kind, required):
    factory, client = model_mock(monkeypatch)
    context = {"only_demo": True, "days": 7, "active_range": [{"finger": "index", "value": 0.5}]}
    result = summaries.generate_summary(kind, context)
    assert result.kind == kind and result.model == summaries.settings.gemini_text_model
    assert result.text == "Your effort was steady today."
    options = factory.call_args.kwargs["http_options"]
    assert options.timeout == 30_000 and options.retry_options.attempts == 1
    factory.return_value.__exit__.assert_called_once()
    call = client.models.generate_content.call_args.kwargs
    assert json.loads(call["contents"]) == context
    instruction = call["config"].system_instruction
    assert all(part in instruction for part in required)
    assert "estimate inspired by clinical practice" in instruction
    assert "Never give medical advice or a diagnosis" in instruction
    assert "explicitly say this is demo data" in instruction
    assert "fake-secret-for-tests" not in call["contents"] + instruction


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError("fake-secret-for-tests in request URL"),
        RuntimeError("fake-secret-for-tests provider failed"),
    ],
)
def test_provider_errors_are_redacted_and_clients_close(monkeypatch, error, caplog, capsys):
    factory, _ = model_mock(monkeypatch, error=error)
    with pytest.raises(HTTPException) as exc:
        summaries.generate_summary("therapist", {})
    assert exc.value.status_code == 503
    assert exc.value.detail == {"code": "llm_unavailable", "message": "Summary unavailable"}
    assert "fake-secret-for-tests" not in caplog.text + capsys.readouterr().out
    factory.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("text", [None, "", "   ", "Response fake-secret-for-tests"])
def test_empty_blocked_or_credential_echo_response_is_unavailable(monkeypatch, text):
    model_mock(monkeypatch, text=text)
    with pytest.raises(HTTPException) as exc:
        summaries.generate_summary("session", {})
    assert exc.value.status_code == 503


def test_missing_key_never_constructs_sdk_client(monkeypatch):
    factory, _ = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_api_key", "")
    with pytest.raises(HTTPException) as exc:
        summaries.generate_summary("session", {})
    assert exc.value.status_code == 503
    factory.assert_not_called()
