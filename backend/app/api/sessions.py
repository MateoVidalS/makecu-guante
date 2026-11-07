from typing import Literal

from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import (
    ApiError,
    Attempt,
    AttemptResult,
    AttemptTrace,
    Session,
    SessionDetail,
    SessionEndIn,
    SessionIn,
    TranscriptIn,
)

router = APIRouter()


@router.post("/sessions", response_model=Session, responses={501: {"model": ApiError}})
def post_sessions(body: SessionIn) -> Session:
    not_implemented()


@router.get("/sessions", response_model=list[Session], responses={501: {"model": ApiError}})
def get_sessions(
    mode: Literal["exercise"] | None = None, limit: int = 50, offset: int = 0
) -> list[Session]:
    not_implemented()


@router.post(
    "/sessions/{id}/attempts", response_model=Attempt, responses={501: {"model": ApiError}}
)
def post_sessions_id_attempts(id: int, body: AttemptResult) -> Attempt:
    not_implemented()


@router.post("/sessions/{id}/end", response_model=Session, responses={501: {"model": ApiError}})
def post_sessions_id_end(id: int, body: SessionEndIn) -> Session:
    not_implemented()


@router.get("/sessions/{id}", response_model=SessionDetail, responses={501: {"model": ApiError}})
def get_sessions_id(id: int) -> SessionDetail:
    not_implemented()


@router.delete(
    "/sessions/{id}", response_model=None, status_code=204, responses={501: {"model": ApiError}}
)
def delete_sessions_id(id: int) -> None:
    not_implemented()


@router.get(
    "/attempts/{id}/trace", response_model=AttemptTrace, responses={501: {"model": ApiError}}
)
def get_attempts_id_trace(id: int) -> AttemptTrace:
    not_implemented()


@router.post(
    "/sessions/{id}/transcript",
    response_model=None,
    status_code=204,
    responses={501: {"model": ApiError}},
)
def post_sessions_id_transcript(id: int, body: TranscriptIn) -> None:
    not_implemented()
