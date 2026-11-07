from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session as DbSession

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
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.post(
    "/sessions",
    response_model=Session,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_sessions(db: Db, body: SessionIn) -> Session:
    return repo.create_session(db, body)


@router.get(
    "/sessions",
    response_model=list[Session],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_sessions(
    db: Db,
    mode: Literal["exercise"] | None = None,
    limit: Annotated[int, Query(ge=1)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Session]:
    return repo.list_sessions(db, mode, limit, offset)


@router.post(
    "/sessions/{id}/attempts",
    response_model=Attempt,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_sessions_id_attempts(db: Db, id: int, body: AttemptResult) -> Attempt:
    return repo.create_attempt(db, id, body)


@router.post(
    "/sessions/{id}/end",
    response_model=Session,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_sessions_id_end(db: Db, id: int, body: SessionEndIn) -> Session:
    return repo.end_session(db, id, body.summary)


@router.get(
    "/sessions/{id}",
    response_model=SessionDetail,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_sessions_id(db: Db, id: int) -> SessionDetail:
    return repo.get_session(db, id)


@router.delete(
    "/sessions/{id}",
    response_model=None,
    status_code=204,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def delete_sessions_id(db: Db, id: int) -> None:
    return repo.delete_session(db, id)


@router.get(
    "/attempts/{id}/trace",
    response_model=AttemptTrace,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_attempts_id_trace(db: Db, id: int) -> AttemptTrace:
    return repo.get_trace(db, id)


@router.post(
    "/sessions/{id}/transcript",
    response_model=None,
    status_code=204,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_sessions_id_transcript(db: Db, id: int, body: TranscriptIn) -> None:
    return repo.add_transcript(db, id, body.lines)
