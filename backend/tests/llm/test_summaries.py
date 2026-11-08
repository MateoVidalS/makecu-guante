import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.llm import summaries


@pytest.fixture(autouse=True)
def fresh_cooldowns():
    summaries._cooling.clear()
    yield
    summaries._cooling.clear()


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
    # only_demo context: the demo statement is guaranteed even when the model omits it.
    assert result.text == "This is demo data. Your effort was steady today."
    options = factory.call_args.kwargs["http_options"]
    assert options.timeout == 55_000 and options.retry_options.attempts == 1
    factory.return_value.__exit__.assert_called_once()
    call = client.models.generate_content.call_args.kwargs
    assert json.loads(call["contents"]) == context
    instruction = call["config"].system_instruction
    assert all(part in instruction for part in required)
    assert "estimate inspired by clinical practice" in instruction
    assert "Never give medical advice or a diagnosis" in instruction
    assert "explicitly say this is demo data" in instruction
    assert "thumb, index, middle, ring and pinky (little finger)" in instruction
    assert '"not measured", never zero' in instruction
    assert "without measurements for both sessions" in instruction
    assert "Include supplied feelings" in instruction
    assert "rejected calls were not applied and undone changes were reverted" in instruction
    assert "release-and-pause threshold" in instruction
    assert "Do not recommend" in instruction and "assist speed above 0.30/s" in instruction
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


class _Busy(Exception):
    code = 503


def test_busy_model_falls_back_to_next_model(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_model", "main-model")
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "backup-model")
    client.models.generate_content.side_effect = [
        _Busy("fake-secret-for-tests busy"),
        SimpleNamespace(text="Backup summary."),
    ]
    result = summaries.generate_summary("session", {"days": 7})
    assert result.text == "Backup summary." and result.model == "backup-model"
    models = [c.kwargs["model"] for c in client.models.generate_content.call_args_list]
    assert models == ["main-model", "backup-model"]


def test_all_models_busy_is_unavailable(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "backup-model")
    client.models.generate_content.side_effect = _Busy("busy")
    with pytest.raises(HTTPException) as caught:
        summaries.generate_summary("session", {"days": 7})
    assert caught.value.status_code == 503


class _Quota(Exception):
    code = 429


def test_each_model_gets_a_share_of_the_wait(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_model", "slow-model")
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "fast-model")
    monkeypatch.setattr(summaries.settings, "gemini_text_attempt_timeout_s", 20)
    client.models.generate_content.side_effect = [
        TimeoutError("slow"),
        SimpleNamespace(text="Fast summary."),
    ]
    result = summaries.generate_summary("session", {})
    assert result.model == "fast-model"
    timeouts = [
        c.kwargs["config"].http_options.timeout
        for c in client.models.generate_content.call_args_list
    ]
    assert timeouts[0] == 20_000  # a non-final model never holds the whole budget
    assert 20_000 < timeouts[1] <= 55_000  # the last one gets what is left


def test_exhausted_or_slow_models_are_tried_last_for_a_while(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_model", "main-model")
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "backup-model")
    client.models.generate_content.side_effect = [
        _Quota("Quota exceeded per day. 'retryDelay': '7187s'"),
        SimpleNamespace(text="First."),
        SimpleNamespace(text="Second."),
    ]
    assert summaries.generate_summary("session", {}).model == "backup-model"
    # The next summary skips straight to the model that works.
    assert summaries.generate_summary("session", {}).model == "backup-model"
    models = [c.kwargs["model"] for c in client.models.generate_content.call_args_list]
    assert models == ["main-model", "backup-model", "backup-model"]
    assert summaries._models() == ["backup-model", "main-model"]


def test_per_minute_limit_waits_once_and_retries(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_model", "main-model")
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "backup-model")
    slept = []
    monkeypatch.setattr(summaries.time, "sleep", slept.append)
    client.models.generate_content.side_effect = [
        _Busy("busy"),
        _Quota("Quota exceeded per minute. Please retry in 4.2s."),
        SimpleNamespace(text="After waiting."),
    ]
    result = summaries.generate_summary("session", {})
    assert result.text == "After waiting." and result.model == "backup-model"
    assert slept == [pytest.approx(4.7)]


def test_long_retry_delays_are_not_waited_for(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "")
    monkeypatch.setattr(summaries.time, "sleep", lambda s: pytest.fail("must not wait"))
    client.models.generate_content.side_effect = _Quota("Please retry in 1h59m47.6s.")
    with pytest.raises(HTTPException):
        summaries.generate_summary("session", {})


@pytest.mark.parametrize(
    "raw,plain",
    [
        ("**Practice:**\nSix sessions.", "Practice:\nSix sessions."),
        ("## Safety\n* No stops.\n- Pain 0/10.", "Safety\nNo stops.\nPain 0/10."),
        ("Your *index* opened `72%`.", "Your index opened 72%."),
        ("Pain 2*3 stays as is.", "Pain 2*3 stays as is."),
    ],
)
def test_markdown_is_stripped_for_the_plain_text_ui(monkeypatch, raw, plain):
    model_mock(monkeypatch, text=raw)
    assert summaries.generate_summary("therapist", {}).text == plain


def test_prompts_ask_for_readable_numbers_and_plain_text():
    for prompt in (summaries.SESSION_PROMPT, summaries.THERAPIST_PROMPT):
        assert '"readable" block' in prompt
        assert "Never quote raw 0–1 fractions" in prompt
        assert "no Markdown" in prompt
        assert "about the same" in prompt
    assert "since the first opening session" in summaries.THERAPIST_PROMPT
    assert '"Practice:"' in summaries.THERAPIST_PROMPT


def test_an_overlong_summary_is_shortened_once_by_the_same_model(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "")
    long = "Practice:\n" + "word " * 300
    client.models.generate_content.side_effect = [
        SimpleNamespace(text=long),
        SimpleNamespace(text="Practice:\nShort."),
    ]
    result = summaries.generate_summary("therapist", {})
    assert result.text == "Practice:\nShort."
    calls = client.models.generate_content.call_args_list
    assert len(calls) == 2 and calls[1].kwargs["contents"] == long.strip()
    assert "never more than 250" in calls[1].kwargs["config"].system_instruction


def test_a_failed_shortening_keeps_the_valid_summary(monkeypatch):
    factory, client = model_mock(monkeypatch)
    monkeypatch.setattr(summaries.settings, "gemini_text_fallback_models", "")
    long = "word " * 100
    client.models.generate_content.side_effect = [SimpleNamespace(text=long), _Busy("busy")]
    assert summaries.generate_summary("session", {}).text == long.strip()


@pytest.mark.parametrize("flag", ["is_demo", "only_demo"])
def test_demo_summaries_always_say_so(monkeypatch, flag):
    model_mock(monkeypatch, text="Great effort today.")
    assert summaries.generate_summary("session", {flag: True}).text == (
        "This is demo data. Great effort today."
    )
    assert summaries.generate_summary("session", {flag: False}).text == "Great effort today."


def test_fit_trims_whole_sentences_and_keeps_every_heading():
    text = "\n\n".join(
        f"{h}:\n" + " ".join(f"Sentence {i} of {h} has six words." for i in range(6))
        for h in ("Practice", "Active range", "Safety")
    )
    fitted = summaries._fit(text, 60)
    assert len(fitted.split()) <= 60
    for heading in ("Practice:", "Active range:", "Safety:"):
        assert heading in fitted and f"Sentence 0 of {heading[:-1]}" in fitted
    assert all(line.endswith((":", ".")) for line in fitted.splitlines() if line)
    assert summaries._fit("Short enough.", 80) == "Short enough."
