from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import ApiError, VoiceToken, VoiceTokenIn

router = APIRouter()


@router.post("/voice/token", response_model=VoiceToken, responses={501: {"model": ApiError}})
def post_voice_token(body: VoiceTokenIn) -> VoiceToken:
    not_implemented()
