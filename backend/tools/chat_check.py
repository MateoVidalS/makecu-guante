"""Opt-in LIVE Doctor chat check; never imported or run by tests.

Run manually from backend: uv run python -m tools.chat_check [--db PATH].
Requires GEMINI_API_KEY and consumes provider quota. Defaults to a temporary demo database.
"""

import argparse
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session

from app.chat.record import build_patient_record
from app.chat.text import run_chat
from app.config import settings
from app.contracts.chat import ChatMessage
from app.db.session import make_engine
from tools.seed_demo import seed_demo

QUESTIONS = [
    "How has the index finger's opening changed since the first opening-glove session?",
    "What do the records say about pain, fatigue and safety stops?",
    "What does the latest evaluation say about slow and fast resistance? Show the chart.",
    "Find notes about the ring finger being tired, with dates.",
    "What medications is this patient taking?",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", help="Existing database; defaults to a temporary demo story")
    parser.add_argument("--pause", type=float, default=8, help="Seconds between questions")
    args = parser.parse_args()
    if not settings.gemini_api_key:
        sys.exit("GEMINI_API_KEY is not set.")
    path = args.db or str(Path(tempfile.mkdtemp()) / "chat-check.db")
    engine = make_engine(path)
    failures = 0
    try:
        if not args.db:
            seed_demo(engine, end=datetime.now(timezone.utc))
        with Session(engine) as db:
            import json

            print(f"Patient record: {len(json.dumps(build_patient_record(db)))} chars")
            for n, question in enumerate(QUESTIONS):
                if n:
                    time.sleep(max(0, args.pause))
                print(f"\nQuestion: {question}")
                answer, model, terminal = "", None, None
                start = time.monotonic()
                for event in run_chat(db, [ChatMessage(role="user", text=question)]):
                    if event.type == "tool":
                        print(f"Tool: {event.name}: {event.label}")
                    elif event.type == "delta":
                        answer += event.text
                    else:
                        terminal = event.type
                        if event.type == "done":
                            model = event.model
                problems = []
                if terminal != "done":
                    problems.append("chat unavailable")
                if re.search(r"\*\*|^\s*#|^\s*[-*•] ", answer, re.M):
                    problems.append("Markdown")
                if not args.db and answer and "demo" not in answer.lower():
                    problems.append("missing demo statement")
                failures += bool(problems)
                print(
                    f"{model or 'unavailable'} · {time.monotonic() - start:.1f}s · "
                    f"{', '.join(problems) or 'ok'}"
                )
                print(answer)
    finally:
        engine.dispose()
    print(f"\n{len(QUESTIONS) - failures}/{len(QUESTIONS)} checks passed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
