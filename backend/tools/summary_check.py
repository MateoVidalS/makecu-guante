"""Live check of the Gemini summaries against the demo story (needs GEMINI_API_KEY).

Run from backend: uv run python -m tools.summary_check [--db PATH]
Seeds the demo story into a temporary database (or uses --db), generates patient summaries for
the sessions that stress the prompt (latest, first opening, rigid-index stop, pain brake, tired
week, legacy closing glove) and therapist summaries for 7 and 30 days, then checks each text
against the rules the prompts promise. Prints every summary and exits 1 on any failure.
"""

import argparse
import re
import sys
import tempfile
import time
from pathlib import Path

from sqlmodel import Session

from app.config import settings
from app.contracts import types as c
from app.db import repo
from app.db.session import make_engine
from tools.seed_demo import seed_demo

INTERNAL = re.compile(
    r"active_ratio|assist_needed|active_max|per_finger|highlight_finger|adjust_help|"
    r"add_rest|set_attempt_time|note_for_therapist|undo_last|readable|assist_direction|"
    r"session_id|\bsession \d+\b|\bevaluation \d+\b|\bid\b",
    re.I,
)
FRACTION = re.compile(r"(?<![\d.])0\.\d{2,}")
MARKDOWN = re.compile(r"\*\*|^#|^\s*[*\-•] ", re.M)
HEADINGS = [
    "Practice:",
    "Active range:",
    "Assistance:",
    "Resistance:",
    "Safety:",
    "Notes for therapist:",
]


def problems(kind: str, text: str, *, legacy: bool = False) -> list[str]:
    found = []
    words = len(text.split())
    limit = 80 if kind == "session" else 250
    if words > limit:
        found.append(f"{words} words > {limit}")
    if MARKDOWN.search(text):
        found.append("markdown")
    if INTERNAL.search(text):
        found.append(f"internal name: {INTERNAL.search(text).group(0)!r}")
    if FRACTION.search(text):
        found.append(f"raw fraction: {FRACTION.search(text).group(0)}")
    if "demo" not in text.lower():
        found.append("does not say demo data")
    if re.search(r"\d{4}-\d{2}-\d{2}", text):
        found.append("ISO date")
    if kind == "session" and re.search(r"\bmA\b", text):
        found.append("shows mA to the patient")
    if kind == "therapist":
        missing = [h for h in HEADINGS if h not in text]
        if missing:
            found.append(f"missing headings {missing}")
    if re.search(r"assisted closing|helps? (you )?close", text, re.I) and not legacy:
        found.append("describes closing assistance")
    return found


def pick_sessions(db) -> dict[str, int]:
    sessions = repo.list_sessions(db)  # newest first
    by_id = {s.id: repo.get_session(db, s.id) for s in sessions}
    opening = [s for s in reversed(sessions) if s.assist_direction == "open"]
    legacy = [s for s in sessions if s.assist_direction == "close"]
    pick = {"latest": sessions[0].id, "first opening": opening[0].id}
    for s in opening:
        events = [e.source for a in by_id[s.id].attempts for e in a.safety_events]
        if "resistance" in events:
            pick["rigid index stop"] = s.id
        if "coach_brake" in events:
            pick["pain brake"] = s.id
        if any("Ring finger tired" in d.reason for d in by_id[s.id].coach_decisions or []):
            pick.setdefault("tired week", s.id)
    if legacy:
        pick["legacy closing glove"] = legacy[0].id
    return pick


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", help="Existing database with demo history (default: temporary)")
    parser.add_argument("--pause", type=float, default=8, help="Seconds between requests")
    args = parser.parse_args()
    if not settings.gemini_api_key:
        sys.exit("GEMINI_API_KEY is not set (backend/.env).")
    path = args.db or str(Path(tempfile.mkdtemp()) / "summary-check.db")
    engine = make_engine(path)
    if not args.db:
        seed_demo(engine)
    failures = 0
    with Session(engine) as db:
        jobs = [
            (label, c.SessionSummaryIn(kind="session", session_id=id))
            for label, id in pick_sessions(db).items()
        ] + [
            ("therapist 7 days", c.TherapistSummaryIn(kind="therapist", days=7)),
            ("therapist 30 days", c.TherapistSummaryIn(kind="therapist", days=30)),
        ]
        for n, (label, body) in enumerate(jobs):
            if n:
                time.sleep(args.pause)  # stay under free-tier requests-per-minute limits
            start = time.monotonic()
            try:
                summary = repo.create_summary(db, body)
            except Exception as error:  # noqa: BLE001 - report and continue
                failures += 1
                print(f"\n=== {label}: FAILED ({type(error).__name__})")
                continue
            elapsed = time.monotonic() - start
            legacy = label.startswith("legacy")
            found = problems(body.kind, summary.text, legacy=legacy)
            failures += bool(found)
            status = "ok" if not found else "; ".join(found)
            words = len(summary.text.split())
            print(f"\n=== {label} · {summary.model} · {elapsed:.1f}s · {words} words · {status}")
            print(summary.text)
    engine.dispose()
    print(f"\n{len(jobs) - failures}/{len(jobs)} summaries passed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
