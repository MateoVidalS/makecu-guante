"""Single-use Live credentials locked to the clinician prompt and the read-only tools.

Uses the same Live model as the patient coach, including its translation of retired models:
gemini-3.8-live-extended-thinking never delivers tool calls (checked Nov 8 2026).
"""

from datetime import datetime, timedelta, timezone

from google import genai

from app.chat import prompt, tools
from app.chat.record import build_patient_record
from app.config import settings
from app.contracts.chat import ChatVoiceToken
from app.voice.gemini_live import CURRENT_MODEL, RETIRED_MODELS

RECORD_IN_TOKEN_MAX_CHARS = 60_000


class ChatUnavailable(Exception):
    pass


def live_setup(db) -> tuple[str, dict, str | None]:
    """Model, locked Live config and optional first-turn context, shared by the token and
    tools/chat_check.py so the live check exercises exactly what the browser gets."""
    record = build_patient_record(db)
    instruction = prompt.render(record, voice=True)
    context = None
    if len(instruction) > RECORD_IN_TOKEN_MAX_CHARS:
        instruction = prompt.rules(voice=True)
        context = prompt.record_text(record)
    model = settings.gemini_live_model
    if model in RETIRED_MODELS:
        model = CURRENT_MODEL
    config = {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "language_code": "en-US",
            "voice_config": {"prebuilt_voice_config": {"voice_name": settings.gemini_live_voice}},
        },
        "system_instruction": instruction,
        "tools": tools.TOOLS,
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        # A clinician asks, then listens. Sound picked up while Gemini answers (its own voice
        # through speakers, people in the room) must not cut the answer short, and quiet
        # background talk should not count as a question.
        "realtime_input_config": {
            "automatic_activity_detection": {
                "disabled": False,
                "start_of_speech_sensitivity": "START_SENSITIVITY_LOW",
                "end_of_speech_sensitivity": "END_SENSITIVITY_LOW",
                "silence_duration_ms": 800,
            },
            "activity_handling": "NO_INTERRUPTION",
        },
        "context_window_compression": {"sliding_window": {}},
    }
    if settings.gemini_live_thinking_level and "thinking" in model:
        config["thinking_config"] = {"thinking_level": settings.gemini_live_thinking_level}
    return model, config, context


def create_token(db) -> ChatVoiceToken:
    if not settings.gemini_api_key:
        raise ChatUnavailable()
    try:
        model, config, context = live_setup(db)
        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=30)
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
            raise ChatUnavailable()
        return ChatVoiceToken(
            token=token.name,
            expires_at=expires.isoformat(),
            model=model,
            voice=settings.gemini_live_voice,
            context=context,
        )
    except Exception:
        raise ChatUnavailable() from None
