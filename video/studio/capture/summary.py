"""Generate once against the isolated demo DB; reuse the stored result thereafter."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from dotenv import dotenv_values

# The key exists only in this child process, never in browser requests or capture files.
source = dotenv_values(
    "/Users/mateovidal/orca/workspaces/makecu-guante/rehab-hub/backend/.env"
)
os.environ["GEMINI_API_KEY"] = source.get("GEMINI_API_KEY", "")
os.environ["GEMINI_TEXT_MODEL"] = source.get("GEMINI_TEXT_MODEL", "gemini-4-argon")
os.environ["GEMINI_TEXT_FALLBACK_MODELS"] = source.get("GEMINI_TEXT_FALLBACK_MODELS", "")
from sqlmodel import Session, select
from app.db.session import engine
from app.db import models, repo
from app.contracts.types import TherapistSummaryIn
from google.genai.models import Models

cache = Path(__file__).resolve().parents[1] / "public/recordings/therapist-summary.json"
with Session(engine) as db:
    existing = db.exec(select(models.Summary).where(models.Summary.kind == "therapist")).first()
    if existing:
        print("Using stored therapist summary; no model request.")
        sys.exit(0)
    if cache.exists():
        value = json.loads(cache.read_text())
        value.pop("id", None)
        db.add(models.Summary(**value))
        db.commit()
        print("Restored the captured Gemini summary; no model request.")
        sys.exit(0)

    original = Models.generate_content
    count = 0
    # Persist the budget outside the DB so resets and failed reruns cannot spend more.
    budget = Path(os.environ.get("REHAB_CAPTURE_BUDGET", "/tmp/memo-video-summary-budget.json"))
    count = json.loads(budget.read_text())["requests"] if budget.exists() else 0

    def limited(self, *args, **kwargs):
        global count
        if count >= 2:
            raise RuntimeError("Capture summary request budget exhausted")
        count += 1
        budget.write_text(json.dumps({"requests": count}))
        return original(self, *args, **kwargs)

    Models.generate_content = limited
    try:
        summary = repo.create_summary(db, TherapistSummaryIn(kind="therapist", days=7))
    except Exception:
        print(f"Therapist summary unavailable; request budget used: {count}/2.")
        sys.exit(1)
    cache.write_text(summary.model_dump_json(indent=2) + "\n")
    print(f"Stored real Gemini therapist summary; request budget used: {count}/2.")
