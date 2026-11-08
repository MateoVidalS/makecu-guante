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


def create_token(db) -> ChatVoiceToken:
    if not settings.gemini_api_key:
        raise ChatUnavailable()
    try:
        record = build_patient_record(db)
        instruction = prompt.render(record, voice=True)
        context = None
        if len(instruction) > RECORD_IN_TOKEN_MAX_CHARS:
            instruction = prompt.rules(voice=True)
            context = prompt.record_text(record)
        model = settings.gemini_live_model
        if model in RETIRED_MODELS:
            model = CURRENT_MODEL
        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=30)
        config = {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "language_code": "en-US",
                "voice_config": {
                    "prebuilt_voice_config": {"voice_name": settings.gemini_live_voice}
                },
            },
            "system_instruction": instruction,
            "tools": tools.TOOLS,
            "input_audio_transcription": {},
            "output_audio_transcription": {},
            "realtime_input_config": {"automatic_activity_detection": {"disabled": False}},
            "context_window_compression": {"sliding_window": {}},
        }
        if settings.gemini_live_thinking_level and "thinking" in model:
            config["thinking_config"] = {"thinking_level": settings.gemini_live_thinking_level}
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
