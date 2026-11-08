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
UNAVAILABLE_MESSAGE = "Doctor chat is unavailable. Please try again later."
# Smaller fallback models sometimes write the chart call as text instead of calling the tool.
_WRITTEN_CHART = re.compile(r"`?\bshow_chart\(\s*(?:section\s*=\s*)?[\"']?(\w+)[\"']?\s*\)`?")


class _Leak(Exception):
    pass


class _Writer:
    """Streams an answer as it arrives, a sentence or line at a time.

    Whole sentences and lines are cleaned before they are sent: stray Markdown is stripped,
    a chart call written as text becomes a show_chart event, and demo answers open with the
    demo statement when the first sentence does not make it.
    """

    _BOUNDARY = re.compile(r"\n|[.!?][\"')\]]?[ \t]")

    def __init__(self, only_demo: bool):
        self.only_demo = only_demo
        self.buffer = ""
        self.started = False
        self.charted = False
        self.sent = ""
        self.spacing = ""  # trailing whitespace, sent only once more text follows

    def feed(self, text: str) -> Iterator[ChatStreamEvent]:
        self.buffer += text
        cut = max((m.end() for m in self._BOUNDARY.finditer(self.buffer)), default=0)
        if cut:
            segment, self.buffer = self.buffer[:cut], self.buffer[cut:]
            yield from self._emit(segment)

    def finish(self) -> Iterator[ChatStreamEvent]:
        segment, self.buffer = self.buffer, ""
        yield from self._emit(segment, last=True)

    def _emit(self, segment: str, last: bool = False) -> Iterator[ChatStreamEvent]:
        sections = [s for s in _WRITTEN_CHART.findall(segment) if s in tools.CHART_SECTIONS]
        segment = _WRITTEN_CHART.sub("", segment)
        for pattern, replacement in gemini._MARKDOWN:
            segment = pattern.sub(replacement, segment)
        segment = re.sub(r"[ \t]+\n", "\n", segment)
        if not self.started:
            segment = segment.lstrip()
        if sections and not self.charted:
            self.charted = True
            yield ChatToolEvent(type="tool", name="show_chart", label=sections[0])
        body = segment.rstrip()
        if not body.strip():
            if self.started and not last:
                self.spacing += segment
            return
        segment, self.spacing = self.spacing + body, segment[len(body) :]
        if settings.gemini_api_key and settings.gemini_api_key in self.sent + segment:
            raise _Leak()
        if not self.started:
            self.started = True
            if self.only_demo and "demo" not in segment.lower():
                segment = f"This is demo data. {segment}"
        self.sent += segment
        yield ChatDelta(type="delta", text=segment)


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
        writer = _Writer(record["only_demo"])
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
                        stream = client.models.generate_content_stream(
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
                        parts, calls = [], []
                        for chunk in stream:
                            content = chunk.candidates[0].content if chunk.candidates else None
                            for part in (content.parts or []) if content else []:
                                parts.append(part)
                                if part.function_call:
                                    calls.append(part.function_call)
                                elif part.text and not part.thought and not calls:
                                    # Read text parts directly: SDK .text warns on function calls.
                                    yield from writer.feed(part.text)
                        if not calls:
                            yield from writer.finish()
                            if not writer.started:
                                break  # blocked/empty response: try the next model
                            gemini._cooling.pop(model, None)
                            yield ChatDone(type="done", model=model)
                            return
                        content = types.Content(role="model", parts=parts)
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
                        history.append(
                            types.Content(role="user", parts=replies)
                        )  # Gemini takes function responses as user turns; "tool" is a 400
                except Exception as error:
                    gemini._cool(model, error)
                    # Text already reached the browser: another model would repeat or contradict
                    # it, so a mid-answer failure ends the turn with an error instead.
                    if writer.started or not gemini._transient(error):
                        raise
                    continue
    except Exception:
        # Never log, interpolate or chain provider exception text into API output.
        pass
    yield _error()
