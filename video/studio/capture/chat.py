"""Cache the production Doctor chat stream once, with a persistent four-call cap."""

import hashlib
import fcntl
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from dotenv import dotenv_values

QUESTION = "Compare index opening on Oct 24 and Nov 7, and show me the chart."
cache = (
    Path(__file__).resolve().parents[1] / "public/recordings/doctor-chat.response.json"
)
# Serialize helpers so concurrent reruns cannot overspend the persistent counter.
lock = open("/tmp/memo-video-doctor-chat.lock", "a")
fcntl.flock(lock, fcntl.LOCK_EX)
fixture = Path(__file__).parent / "fixtures/demo-with-summary.sql.gz"
fingerprint = hashlib.sha256(fixture.read_bytes()).hexdigest()
if cache.exists():
    saved = json.loads(cache.read_text())
    if saved["question"] != QUESTION or saved["fixtureSha256"] != fingerprint:
        raise SystemExit("Chat cache does not match this question/demo snapshot")
    print("Using cached real Gemini chat stream; no model requests.")
    sys.exit(0)

if os.environ.get("REHAB_DB_PATH") != "/tmp/memo-video.db":
    raise SystemExit("Chat capture can only read /tmp/memo-video.db")

# Credentials remain only in this process. Never log provider exception strings.
source = dotenv_values(
    "/Users/mateovidal/orca/workspaces/makecu-guante/rehab-hub/backend/.env"
)
os.environ["GEMINI_API_KEY"] = source.get("GEMINI_API_KEY", "")
for name in ("GEMINI_TEXT_MODEL", "GEMINI_TEXT_FALLBACK_MODELS"):
    if source.get(name):
        os.environ[name] = source[name]
# Optional explicit model for the remaining budget after a chain failure.
model = next(
    (arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--model=")), None
)
if model:
    os.environ["GEMINI_TEXT_MODEL"] = model
    os.environ["GEMINI_TEXT_FALLBACK_MODELS"] = ""

from google.genai.models import Models
from sqlmodel import Session
from app.chat.text import run_chat
from app.chat.record import cohort
from app.contracts.chat import ChatMessage
from app.db.session import engine

budget = Path("/tmp/memo-video-doctor-chat-budget.json")
failure = Path(__file__).parent / "doctor-chat.failure.json"
attempts = json.loads(budget.read_text()) if budget.exists() else []
recorded = json.loads(failure.read_text())["requests"] if failure.exists() else []
if len(recorded) > len(attempts):
    attempts = recorded
if len(attempts) > 2:
    raise SystemExit(
        "Insufficient capture budget for a tool-and-answer round; no model request made."
    )
original = Models.generate_content_stream


def limited(self, *args, **kwargs):
    if len(attempts) >= 4:
        raise RuntimeError("Doctor chat capture request budget exhausted")
    attempt = {"model": kwargs.get("model"), "status": "started"}
    attempts.append(attempt)
    budget.write_text(json.dumps(attempts, indent=2) + "\n")
    try:
        yield from original(self, *args, **kwargs)
        attempt["status"] = "complete"
    except Exception as error:
        attempt["status"] = (
            getattr(error, "code", None)
            or getattr(error, "status_code", None)
            or "failed"
        )
        raise
    finally:
        budget.write_text(json.dumps(attempts, indent=2) + "\n")
        print(
            f"Model request {len(attempts)}/4: {attempt['model']}, status {attempt['status']}"
        )


Models.generate_content_stream = limited
with Session(engine) as db:
    sessions, evaluations, only_demo = cohort(db)
    if not only_demo or len(sessions) != 25 or len(evaluations) != 5:
        raise SystemExit("Restore the packaged demo cohort before generating chat")
    events = [
        event.model_dump()
        for event in run_chat(db, [ChatMessage(role="user", text=QUESTION)])
    ]
if (
    not events
    or events[-1]["type"] != "done"
    or any(e["type"] == "error" for e in events)
):
    (Path(__file__).parent / "doctor-chat.failure.json").write_text(
        json.dumps(
            {
                "capturedAt": datetime.now(timezone.utc).isoformat(),
                "question": QUESTION,
                "fixtureSha256": fingerprint,
                "requestLimit": 4,
                "requests": attempts,
                "status": "blocked: no successful production chat response",
                "recordingCreated": False,
            },
            indent=2,
        )
        + "\n"
    )
    raise SystemExit(
        "Real Doctor chat unavailable; no response fabricated or cached. See redacted request statuses above."
    )
if not any(e["type"] == "tool" and e["name"] == "compare" for e in events):
    raise SystemExit("Real response did not call compare; no capture created.")
if not any(e["type"] == "tool" and e["name"] == "show_chart" for e in events):
    raise SystemExit("Real response did not call show_chart; no capture created.")
cache.write_text(
    json.dumps(
        {
            "question": QUESTION,
            "fixtureSha256": fingerprint,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "requests": attempts,
            "events": events,
        },
        indent=2,
    )
    + "\n"
)
print("Cached the successful production chat stream, including real tool events.")
