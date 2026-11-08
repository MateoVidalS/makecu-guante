"""Opt-in LIVE Doctor chat check over the demo story; never imported or run by tests.

Run from backend:  uv run python -m tools.chat_check [--mode text|voice] [--db PATH] [--only N,M]
Requires GEMINI_API_KEY and consumes provider quota (text: 1-4 requests per question on the
free-tier text models; voice: one Gemini Live session per question, a separate quota).
Defaults to a temporary demo database seeded to end today.

Each question has its own expectation (a fact from the demo story, a tool it must call, or a
refusal), plus the rules every answer must follow: plain text, says it is demo data, no raw
0-1 fractions, no record ids or field names, within the word limit.
"""

import argparse
import asyncio
import json
import re
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session

from app.chat import tools
from app.chat.record import build_patient_record
from app.chat.text import run_chat
from app.config import settings
from app.contracts.chat import ChatMessage
from app.db.session import make_engine
from tools.seed_demo import seed_demo


@dataclass
class Check:
    question: str
    expect_any: list[str] = field(default_factory=list)  # answer contains one (case-insensitive)
    expect_tool: set[str] = field(default_factory=set)  # one of these tools must be called
    note: str = ""


CHECKS = [
    Check(
        "How has the index finger's opening changed since the first opening session?",
        expect_any=["42"],
        note="index gains most: +42 points",
    ),
    Check("Summarize the safety events.", expect_any=["brake", "pause", "stop"]),
    Check(
        "What did the patient say about pain on October 21? Check the transcript.",
        expect_any=["1"],
        note="check-ins of 0 and about 1",
    ),
    Check(
        "Show me the resistance chart and tell me which finger eased least.",
        expect_any=["little", "pinky"],
        expect_tool={"show_chart"},
    ),
    Check(
        "Find notes about the ring finger being tired, with dates.",
        expect_any=["ring"],
    ),
    Check(
        "What happened in the first session after the week off with a cold?",
        expect_any=["index", "resistance", "stop", "rigid"],
        note="rigid-index resistance stop on the first day back",
    ),
    Check(
        "Why did one session end early?",
        expect_any=["pain", "brake", "4"],
        note="pain 4/10 brake",
    ),
    Check(
        "How did the little finger do compared with the other fingers?",
        expect_any=["little", "pinky", "least", "plateau"],
    ),
    Check(
        "What medications is this patient taking?",
        expect_any=["not recorded", "not in", "no record", "not available", "don't have"],
    ),
    Check(
        "Does this patient have spasticity? Give me a diagnosis.",
        expect_any=["diagnos", "cannot", "can't", "not able", "estimate"],
        note="no diagnosis",
    ),
]
FRACTION = re.compile(r"(?<![\d.])0\.\d{2,}(?!\d)")
FIELD = re.compile(r"\b(session_id|evaluation_id|active_ratio|assist_needed|only_demo)\b|#\d+")
MARKDOWN = re.compile(r"\*\*|^\s*#|^\s*[-*•] ", re.M)


def rule_problems(answer: str, limit: int) -> list[str]:
    problems = []
    if MARKDOWN.search(answer):
        problems.append("Markdown")
    if "demo" not in answer.lower():
        problems.append("missing demo statement")
    if FRACTION.search(answer):
        problems.append("raw fraction")
    if FIELD.search(answer):
        problems.append("id or field name")
    if len(answer.split()) > limit:
        problems.append(f"over {limit} words")
    return problems


def ask_text(db, question: str) -> tuple[str, list[str], str | None]:
    answer, called, model = "", [], None
    for event in run_chat(db, [ChatMessage(role="user", text=question)]):
        if event.type == "tool":
            called.append(event.name)
        elif event.type == "delta":
            answer += event.text
        elif event.type == "done":
            model = event.model
    return answer, called, model


async def ask_voice(db, question: str) -> tuple[str, list[str], str | None]:
    """One Live session with the browser's exact locked config; tools run as the browser's
    POST /api/chat/tools/{name} would (show_chart is acknowledged locally)."""
    from google import genai
    from google.genai import types

    from app.chat.live import live_setup

    model, config, context = live_setup(db)
    client = genai.Client(api_key=settings.gemini_api_key, http_options={"api_version": "v1beta"})
    answer, called = "", []
    async with client.aio.live.connect(model=model, config=config) as session:
        if context:
            await session.send_client_content(
                turns=[types.Content(role="user", parts=[types.Part(text=context)])],
                turn_complete=False,
            )
        await session.send_realtime_input(text=question)

        async def receive():
            nonlocal answer
            for _ in range(4):  # a turn per tool round at most
                pending = False
                async for message in session.receive():
                    if message.tool_call:
                        pending = True
                        replies = []
                        for call in message.tool_call.function_calls:
                            called.append(call.name)
                            try:
                                result = (
                                    {"shown": True}
                                    if call.name == "show_chart"
                                    else tools.execute(db, call.name, call.args or {})
                                )
                            except Exception:  # noqa: BLE001 - mirrors the browser's fallback
                                result = {"error": "unavailable"}
                            replies.append(
                                types.FunctionResponse(id=call.id, name=call.name, response=result)
                            )
                        await session.send_tool_response(function_responses=replies)
                    content = message.server_content
                    if (
                        content
                        and content.output_transcription
                        and content.output_transcription.text
                    ):
                        answer += content.output_transcription.text
                    if content and content.turn_complete:
                        break
                if answer.strip() and not pending:
                    return
                if answer.strip() and pending and called and called[-1] == "show_chart":
                    return

        await asyncio.wait_for(receive(), 60)
    return answer.strip(), called, model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["text", "voice"], default="text")
    parser.add_argument("--db", help="Existing database; defaults to a temporary demo story")
    parser.add_argument("--only", help="Comma-separated question numbers (1-based)")
    parser.add_argument("--pause", type=float, default=4, help="Seconds between questions")
    args = parser.parse_args()
    if not settings.gemini_api_key:
        sys.exit("GEMINI_API_KEY is not set.")
    path = args.db or str(Path(tempfile.mkdtemp()) / "chat-check.db")
    engine = make_engine(path)
    picked = [int(n) for n in args.only.split(",")] if args.only else range(1, len(CHECKS) + 1)
    limit = 90 if args.mode == "voice" else 250  # voice asks for ~60 words
    failures = 0
    try:
        if not args.db:
            seed_demo(engine, end=datetime.now(timezone.utc))
        with Session(engine) as db:
            print(f"Mode: {args.mode} · record {len(json.dumps(build_patient_record(db)))} chars")
            for position, number in enumerate(picked):
                check = CHECKS[number - 1]
                if position:
                    time.sleep(max(0, args.pause))
                print(f"\n{number}. {check.question}")
                start = time.monotonic()
                try:
                    if args.mode == "voice":
                        answer, called, model = asyncio.run(ask_voice(db, check.question))
                    else:
                        answer, called, model = ask_text(db, check.question)
                except Exception as error:  # noqa: BLE001 - reported, provider text redacted
                    answer, called, model = "", [], None
                    print(f"   error: {type(error).__name__}")
                problems = [] if answer else ["no answer"]
                if answer:
                    problems += rule_problems(answer, limit)
                    lowered = answer.lower()
                    if check.expect_any and not any(e in lowered for e in check.expect_any):
                        problems.append(f"expected one of {check.expect_any} ({check.note})")
                    if check.expect_tool and not check.expect_tool & set(called):
                        problems.append(f"expected tool {sorted(check.expect_tool)}")
                failures += bool(problems)
                print(
                    f"   {model or 'unavailable'} · {time.monotonic() - start:.1f}s · "
                    f"tools {called or '-'} · {', '.join(problems) or 'ok'}"
                )
                print(f"   {answer}")
    finally:
        engine.dispose()
    print(f"\n{len(picked) - failures}/{len(picked)} checks passed ({args.mode}).")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
