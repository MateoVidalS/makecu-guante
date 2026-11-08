import json
from copy import deepcopy

import pytest
from google.genai import types

from app.chat import text
from app.config import settings
from app.contracts.chat import ChatMessage
from app.llm import gemini, summaries
from tests.chat.conftest import response

BODY = {"messages": [{"role": "user", "text": "How is the index doing?"}]}


def events(client):
    result = client.post("/api/chat", json=BODY)
    assert result.status_code == 200, result.text
    assert result.headers["content-type"].startswith("text/event-stream")
    assert result.text.endswith("\n\n")
    assert all(frame.startswith("data: ") for frame in result.text.strip().split("\n\n"))
    return [json.loads(frame[6:]) for frame in result.text.strip().split("\n\n")]


def answer_of(stream):
    return "".join(e["text"] for e in stream if e["type"] == "delta")


def test_text_stream_plain_final_and_done(client, sdk):
    sdk.models.generate_content.return_value = response(
        "## Progress\n**Index** opened 73% on Nov 5."
    )
    stream = events(client)
    assert [e["type"] for e in stream] == ["delta", "delta", "done"]  # streamed per line
    assert answer_of(stream) == "This is demo data. Progress\nIndex opened 73% on Nov 5."
    assert stream[-1]["model"] == settings.gemini_text_model
    call = sdk.models.generate_content.call_args.kwargs
    assert call["config"].automatic_function_calling.disable is True
    assert call["config"].tool_config.function_calling_config.mode == "AUTO"
    assert call["contents"][0].role == "user"
    assert call["config"].http_options.timeout <= 20_000
    assert sdk.factory.call_args.kwargs["http_options"].retry_options.attempts == 1
    sdk.factory.return_value.__exit__.assert_called_once()


def test_manual_tool_round_preserves_signatures_and_show_chart(client, sdk):
    first = response(
        calls=[("get_session", {"date": "Nov 5"}), ("show_chart", {"section": "range"})]
    )
    first.candidates[0].content.parts[0].thought_signature = b"signature"
    histories = []
    replies = iter([first, response("Demo data: on Nov 5 the index opened further.")])

    def generate(**kwargs):
        histories.append(deepcopy(kwargs["contents"]))
        return next(replies)

    sdk.models.generate_content.side_effect = generate
    stream = events(client)
    assert [e["type"] for e in stream] == ["tool", "tool", "delta", "done"]
    assert stream[0] == {
        "type": "tool",
        "name": "get_session",
        "label": "Looking up the Nov 5 session",
    }
    assert stream[1] == {"type": "tool", "name": "show_chart", "label": "range"}
    assert histories[1][1].parts[0].thought_signature == b"signature"
    assert histories[1][2].role == "user"  # Gemini rejects role "tool" with a 400
    responses = histories[1][2].parts
    assert responses[0].function_response.response["readable"]["sessions"][0]["attempts"]
    assert responses[1].function_response.response == {"shown": True}
    assert responses[1].function_response.id == "call-1"


def test_three_tool_rounds_then_final_request_disables_calls(client, sdk):
    sdk.models.generate_content.side_effect = [
        response(calls=[("find", {"query": "finger"})]) for _ in range(3)
    ] + [response("Demo data: further detail is not recorded.")]
    stream = events(client)
    assert [e["type"] for e in stream] == ["tool"] * 3 + ["delta", "done"]
    calls = sdk.models.generate_content.call_args_list
    assert len(calls) == 4
    assert calls[-1].kwargs["config"].tool_config.function_calling_config.mode == "NONE"


def test_model_ignoring_round_cap_ends_once_without_fourth_execution(client, sdk):
    sdk.models.generate_content.return_value = response(calls=[("find", {"query": "finger"})])
    stream = events(client)
    assert [e["type"] for e in stream] == ["tool"] * 3 + ["error"]
    assert sdk.models.generate_content.call_count == 4


def test_invalid_show_chart_and_unknown_tool_are_returned_to_model(client, sdk):
    histories = []
    replies = iter(
        [
            response(calls=[("show_chart", {"section": "fake-key"}), ("invented", {"id": 42})]),
            response("Demo data: that detail is not recorded."),
        ]
    )

    def generate(**kwargs):
        histories.append(deepcopy(kwargs["contents"]))
        return next(replies)

    sdk.models.generate_content.side_effect = generate
    stream = events(client)
    assert [e["type"] for e in stream] == ["delta", "done"]
    assert "fake-key" not in json.dumps(stream)
    assert all("error" in p.function_response.response for p in histories[1][-1].parts)


@pytest.mark.parametrize("error", [RuntimeError("fake-key provider URL"), TimeoutError("fake-key")])
def test_provider_errors_redacted(client, sdk, error, caplog, capsys):
    sdk.models.generate_content.side_effect = error
    stream = events(client)
    assert len(stream) == 1 and stream[0]["type"] == "error"
    assert stream[0]["code"] == "chat_unavailable"
    assert "fake-key" not in json.dumps(stream) + caplog.text + capsys.readouterr().out
    sdk.factory.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("answer", ["", "  ", "fake-key leaked"])
def test_empty_or_credential_echo_answer_is_unavailable(client, sdk, answer):
    sdk.models.generate_content.return_value = response(answer)
    assert events(client)[-1]["type"] == "error"


class Busy(Exception):
    code = 503


class Quota(Exception):
    code = 429


def test_shared_fallback_and_cooldown(client, sdk, monkeypatch):
    monkeypatch.setattr(settings, "gemini_text_model", "primary")
    monkeypatch.setattr(settings, "gemini_text_fallback_models", "backup")
    sdk.models.generate_content.side_effect = [
        Quota("fake-key exhausted"),
        response("Demo data."),
        response("Demo again."),
    ]
    assert events(client)[-1]["model"] == "backup"
    assert summaries._cooling is gemini._cooling
    assert summaries._models() == ["backup", "primary"]
    assert events(client)[-1]["model"] == "backup"
    assert [c.kwargs["model"] for c in sdk.models.generate_content.call_args_list] == [
        "primary",
        "backup",
        "backup",
    ]


def test_fallback_keeps_tool_responses_and_global_round_budget(client, sdk, monkeypatch):
    monkeypatch.setattr(settings, "gemini_text_model", "primary")
    monkeypatch.setattr(settings, "gemini_text_fallback_models", "backup")
    sdk.models.generate_content.side_effect = [
        response(calls=[("show_chart", {"section": "therapy"})]),
        Busy("fake-key busy"),
        response("Demo data."),
    ]
    stream = events(client)
    assert [e["type"] for e in stream] == ["tool", "delta", "done"]
    assert stream[-1]["model"] == "backup"
    assert sdk.models.generate_content.call_args.kwargs["contents"][-1].parts[
        0
    ].function_response.response == {"shown": True}


def test_total_budget_stops_further_requests(db, sdk, monkeypatch):
    tick = iter([0, 56, 57, 58, 59])
    monkeypatch.setattr(text.time, "monotonic", lambda: next(tick, 100))
    stream = list(text.run_chat(db, [ChatMessage(role="user", text="Hi")]))
    assert [e.type for e in stream] == ["error"]
    sdk.models.generate_content.assert_not_called()


def test_missing_key_is_503_before_stream_and_sdk_is_not_constructed(client):
    from google import genai

    result = client.post("/api/chat", json=BODY)
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "chat_unavailable"
    genai.Client.assert_not_called()


def test_last_message_must_be_user(client, sdk):
    result = client.post("/api/chat", json={"messages": [{"role": "model", "text": "Hi"}]})
    assert result.status_code == 422
    sdk.factory.assert_not_called()


@pytest.mark.parametrize(
    "body",
    [
        {"messages": []},
        {"messages": [{"role": "system", "text": "Hi"}]},
        {"messages": [{"role": "user", "text": ""}]},
        {"messages": [{"role": "user", "text": "x" * 4001}]},
        {"messages": [{"role": "user", "text": "Hi"}] * 41},
    ],
)
def test_frozen_request_validation(client, body):
    assert client.post("/api/chat", json=body).status_code == 422


def test_no_automatic_callables_are_registered(client, sdk):
    sdk.models.generate_content.return_value = response("Demo data.")
    events(client)
    config = sdk.models.generate_content.call_args.kwargs["config"]
    assert all(isinstance(t, types.Tool) for t in config.tools)


def test_chart_call_written_as_text_becomes_a_show_chart_event(client, sdk):
    sdk.models.generate_content.return_value = response(
        'Index opened 42 points further, demo data.\n\nshow_chart(section="range")'
    )
    stream = events(client)
    assert {"type": "tool", "name": "show_chart", "label": "range"} in stream
    assert answer_of(stream) == "Index opened 42 points further, demo data."
    assert "show_chart" not in answer_of(stream)


def test_written_chart_with_unknown_section_is_only_removed(client, sdk):
    sdk.models.generate_content.return_value = response("Demo data. show_chart(section='bogus')")
    stream = events(client)
    assert [e["type"] for e in stream if e["type"] != "delta"] == ["done"]
    assert answer_of(stream) == "Demo data."


def test_answer_streams_sentence_by_sentence_as_chunks_arrive(client, sdk):
    sdk.models.generate_content.return_value = [
        response("This is demo data. The index finger opened"),
        response(" 42 points further. The **little"),
        response(" finger** gained least.\n\n"),
        response("Practice:\nFive days."),
    ]
    stream = events(client)
    deltas = [e["text"] for e in stream if e["type"] == "delta"]
    assert deltas[0] == "This is demo data."  # sent before the rest of the reply arrived
    assert len(deltas) >= 4
    assert answer_of(stream) == (
        "This is demo data. The index finger opened 42 points further. "
        "The little finger gained least.\n\nPractice:\nFive days."
    )
    assert stream[-1]["type"] == "done"


def test_failure_after_streaming_started_never_switches_model(client, sdk, monkeypatch):
    calls = []

    def flaky(**kwargs):
        calls.append(kwargs["model"])

        def chunks():
            yield response("This is demo data. Partial answer. ")
            raise Busy("503 busy")

        return chunks()

    sdk.models.generate_content_stream.side_effect = flaky
    stream = events(client)
    assert answer_of(stream) == "This is demo data. Partial answer."
    assert stream[-1]["type"] == "error"
    assert len(calls) == 1  # no second model repeating or contradicting the streamed text
