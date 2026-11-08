"""Issue single-use, configuration-constrained browser credentials."""

from datetime import datetime, timedelta, timezone

from google import genai
from sqlmodel import Session as DbSession

from app.config import settings
from app.contracts.types import Profile, Session, VoiceToken
from app.db import repo
from app.voice.prompt import render_prompt
from app.voice.tools import TOOLS

# The scaffold's retired default is translated locally; contracts/config stay frozen.
CURRENT_MODEL = "gemini-3.8-live-extended-thinking"


class VoiceUnavailable(Exception):
    pass


def read_context(db: DbSession, session_id: int | None) -> tuple[Profile | None, Session | None]:
    """Use WP5's boundary, tolerating only its explicit pre-merge stubs."""
    try:
        profile = repo.get_profile(db)
        current = repo.get_session(db, session_id) if session_id is not None else None
        sessions = repo.list_sessions(db, limit=50)
        previous = next(
            (
                s
                for s in sessions
                if s.id != session_id
                and s.summary is not None
                and (current is None or s.is_demo == current.is_demo)
            ),
            None,
        )
        return profile, previous
    except NotImplementedError:
        return None, None


def create_token(session_id: int | None, db: DbSession) -> VoiceToken:
    if not settings.gemini_api_key:
        raise VoiceUnavailable()
    profile, previous = read_context(db, session_id)
    prompt = render_prompt(profile, previous)
    model = settings.gemini_live_model
    if model == "gemini-live-2.5-flash-preview":
        model = CURRENT_MODEL
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=30)
    config = {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "language_code": "en-US",
            "voice_config": {"prebuilt_voice_config": {"voice_name": settings.gemini_live_voice}},
        },
        "system_instruction": prompt,
        "tools": TOOLS,
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        "realtime_input_config": {"automatic_activity_detection": {"disabled": False}},
        "context_window_compression": {"sliding_window": {}},
    }
    # Extended-thinking Live models require an explicit level; the plain Live model rejects one.
    if settings.gemini_live_thinking_level and "thinking" in model:
        config["thinking_config"] = {"thinking_level": settings.gemini_live_thinking_level}
    try:
        with genai.Client(
            api_key=settings.gemini_api_key,
            http_options={"api_version": "v1beta", "timeout": 30000},
        ) as client:
            token = client.auth_tokens.create(
                config={
                    "uses": 1,
                    "expire_time": expires,
                    "new_session_expire_time": now + timedelta(minutes=1),
                    "live_connect_constraints": {"model": model, "config": config},
                }
            )
        if not token.name or not token.name.startswith("auth_tokens/"):
            raise VoiceUnavailable()
    except Exception as exc:
        # Provider errors can include credentials; never expose their text.
        raise VoiceUnavailable() from exc
    return VoiceToken(
        token=token.name,
        expires_at=expires.isoformat(),
        model=model,
        voice=settings.gemini_live_voice,
        system_instruction=prompt,
        tools=TOOLS,
    )
