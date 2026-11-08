"""Read-only Doctor chat: SSE text, Live token and date-based record lookups."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.chat import live, text, tools
from app.config import settings
from app.contracts.chat import ChatIn, ChatToolIn, ChatToolResult, ChatVoiceToken
from app.contracts.types import ApiError
from app.db.session import get_session

router = APIRouter()


def _unavailable():
    raise HTTPException(503, {"code": "chat_unavailable", "message": text.UNAVAILABLE_MESSAGE})


@router.post(
    "/chat",
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "ChatStreamEvent SSE stream"},
        422: {"model": ApiError},
        503: {"model": ApiError},
    },
)
def post_chat(body: ChatIn, db: Session = Depends(get_session)):
    if body.messages[-1].role != "user":
        raise HTTPException(
            422, {"code": "invalid_request", "message": "Last message must be from user"}
        )
    if not settings.gemini_api_key:
        _unavailable()

    def events():
        for event in text.run_chat(db, body.messages):
            yield f"data: {event.model_dump_json()}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/chat/voice-token", response_model=ChatVoiceToken, responses={503: {"model": ApiError}}
)
def post_voice_token(db: Session = Depends(get_session)):
    try:
        return live.create_token(db)
    except live.ChatUnavailable:
        _unavailable()


@router.post(
    "/chat/tools/{name}",
    response_model=ChatToolResult,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_tool(name: str, body: ChatToolIn, db: Session = Depends(get_session)):
    try:
        result = tools.execute(db, name, body.args)
    except tools.UnknownTool:
        raise HTTPException(404, {"code": "not_found", "message": "Unknown chat tool"}) from None
    except tools.BrowserOnlyTool:
        raise HTTPException(
            422, {"code": "invalid_request", "message": "Chart navigation is browser-only"}
        ) from None
    return ChatToolResult(name=name, result=result)
