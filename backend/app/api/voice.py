from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.contracts.types import ApiError, VoiceToken, VoiceTokenIn
from app.db.session import get_session
from app.voice.gemini_live import VoiceUnavailable, create_token

router = APIRouter()


@router.post("/voice/token", response_model=VoiceToken, responses={503: {"model": ApiError}})
def post_voice_token(body: VoiceTokenIn, db: Session = Depends(get_session)) -> VoiceToken:
    try:
        return create_token(body.session_id, db)
    except VoiceUnavailable:
        raise HTTPException(
            503,
            {"code": "voice_unavailable", "message": "Live coach unavailable; use Simple voice."},
        ) from None
