"""Manual, bounded read-only tool loop with shared model fallback and redacted failures."""

import re
import time
from collections.abc import Iterator

from google import genai
from google.genai import types
from pydantic import ValidationError

from app.chat import prompt, tools
from app.chat.record import build_patient_record
from app.config import settings
from app.contracts.chat import ChatDelta, ChatDone, ChatErrorEvent, ChatStreamEvent, ChatToolEvent
from app.llm import gemini

MAX_TOOL_ROUNDS = 3
# Smaller fallback models sometimes write the chart call as text instead of calling the tool.
_WRITTEN_CHART = re.compile(r"`?\bshow_chart\(\s*(?:section\s*=\s*)?[\"']?(\w+)[\"']?\s*\)`?")


def _written_charts(answer: str) -> tuple[str, list[str]]:
    sections = [s for s in _WRITTEN_CHART.findall(answer) if s in tools.CHART_SECTIONS]
    cleaned = re.sub(r"\n{3,}", "\n\n", _WRITTEN_CHART.sub("", answer)).strip()
    return cleaned, sections


UNAVAILABLE_MESSAGE = "Doctor chat is unavailable. Please try again later."


def _error():
    return ChatErrorEvent(type="error", code="chat_unavailable", message=UNAVAILABLE_MESSAGE)


def run_chat(db, messages) -> Iterator[ChatStreamEvent]:
    if not settings.gemini_api_key:
        yield _error()
        return
    deadline = time.monotonic() + gemini.TOTAL_BUDGET_S
    try:
        record = build_patient_record(db)
        instruction = prompt.render(record)
        history = [
            types.Content(role=m.role, parts=[types.Part.from_text(text=m.text)]) for m in messages
        ]
        rounds = 0
        with genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(
                timeout=int(gemini.TOTAL_BUDGET_S * 1000),
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        ) as client:
            models = gemini._models()
            for position, model in enumerate(models):
                remaining = deadline - time.monotonic()
                if remaining < 1:
                    break
                budget = (
                    remaining
                    if position == len(models) - 1
                    else min(max(5.0, settings.gemini_text_attempt_timeout_s), remaining)
                )
                model_deadline = min(deadline, time.monotonic() + budget)
                try:
                    while (remaining := min(deadline, model_deadline) - time.monotonic()) >= 1:
                        response = client.models.generate_content(
                            model=model,
                            contents=history,
                            config=types.GenerateContentConfig(
                                system_instruction=instruction,
                                tools=tools.TOOLS,
                                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                                    disable=True
                                ),
                                tool_config=types.ToolConfig(
                                    function_calling_config=types.FunctionCallingConfig(
                                        mode="AUTO" if rounds < MAX_TOOL_ROUNDS else "NONE"
                                    )
                                ),
                                temperature=0.2,
                                thinking_config=types.ThinkingConfig(thinking_level="low"),
                                http_options=types.HttpOptions(timeout=int(remaining * 1000)),
                            ),
                        )
                        content = response.candidates[0].content if response.candidates else None
                        calls = (
                            [p.function_call for p in (content.parts or []) if p.function_call]
                            if content
                            else []
                        )
                        if not calls:
                            # Read text parts directly: SDK response.text warns on function calls.
                            answer = gemini._plain(
                                "".join(
                                    p.text
                                    for p in (content.parts or [])
                                    if p.text and not p.thought
                                )
                                if content
                                else ""
                            )
                            if not answer:
                                break  # blocked/empty response: try the next model
                            if settings.gemini_api_key in answer:
                                yield _error()
                                return
                            if record["only_demo"] and "demo" not in answer.lower():
                                answer = f"This is demo data. {answer}"
                            answer, charts = _written_charts(answer)
                            gemini._cooling.pop(model, None)
                            for section in charts[:1]:
                                yield ChatToolEvent(type="tool", name="show_chart", label=section)
                            yield ChatDelta(type="delta", text=answer)
                            yield ChatDone(type="done", model=model)
                            return
                        if rounds >= MAX_TOOL_ROUNDS or len(calls) > 16:
                            yield _error()
                            return
                        rounds += 1
                        # Preserve original model parts, including thought signatures, for the SDK.
                        history.append(content)
                        replies = []
                        for call in calls:
                            name, args = call.name, call.args or {}
                            try:
                                if name == "show_chart":
                                    label = tools.label(name, args)  # validates section first
                                    result = {"shown": True}
                                else:
                                    result = tools.execute(db, name, args)
                                    label = tools.label(name, args)
                                yield ChatToolEvent(type="tool", name=name, label=label)
                            except (tools.UnknownTool, tools.BrowserOnlyTool, ValidationError):
                                result = {"error": "Unknown tool or invalid arguments"}
                            replies.append(
                                types.Part(
                                    function_response=types.FunctionResponse(
                                        name=name, id=call.id, response=result
                                    )
                                )
                            )
                        history.append(types.Content(role="tool", parts=replies))
                except Exception as error:
                    gemini._cool(model, error)
                    if not gemini._transient(error):
                        raise
                    continue
    except Exception:
        # Never log, interpolate or chain provider exception text into API output.
        pass
    yield _error()
