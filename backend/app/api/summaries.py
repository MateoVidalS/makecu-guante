from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session as DbSession

from app.contracts.types import ApiError, SessionSummaryIn, Summary, TherapistSummaryIn
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.post(
    "/summaries",
    response_model=Summary,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}, 503: {"model": ApiError}},
)
def post_summaries(db: Db, body: SessionSummaryIn | TherapistSummaryIn) -> Summary:
    return repo.create_summary(db, body)


@router.get(
    "/summaries",
    response_model=list[Summary],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_summaries(
    db: Db,
    kind: Literal["session", "therapist"] | None = None,
    limit: Annotated[int, Query(ge=1)] = 20,
) -> list[Summary]:
    return repo.list_summaries(db, kind, limit)
