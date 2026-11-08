"""Keep the therapist summary current: regenerate it in the background after each session.

Runs after the session-end response is sent, so the patient never waits for Gemini. Sessions
that end while a refresh is running schedule exactly one more run, so the stored summary always
covers the newest session without stacking requests on a small quota.
"""

import logging
import threading

from sqlmodel import Session

from app.config import settings
from app.contracts.types import TherapistSummaryIn

log = logging.getLogger(__name__)
DAYS = 7  # the Doctor view's "last 7 days" window
_lock = threading.Lock()
_running = False
_again = False


def refresh_therapist_summary(bind) -> None:
    """Generate and store a 7-day therapist summary; failures only log (no provider details)."""
    global _running, _again
    if not settings.gemini_api_key:
        return
    with _lock:
        if _running:
            _again = True
            return
        _running = True
    try:
        while True:
            with _lock:
                _again = False
            try:
                from app.db import repo

                with Session(bind) as db:
                    repo.create_summary(db, TherapistSummaryIn(kind="therapist", days=DAYS))
            except Exception:  # noqa: BLE001 - background work must never surface errors
                log.warning("Background therapist summary unavailable")
            with _lock:
                # Decide and release under one lock, so a session ending now is never lost.
                if not _again:
                    _running = False
                    return
    except BaseException:
        with _lock:
            _running = False
        raise
