from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session as DbSession

from app.contracts.types import (
    ApiError,
    AssistPoint,
    GloveFinger,
    HistoryOverview,
    PoseId,
    ResistancePoint,
    RomPoint,
)
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.get(
    "/history/overview",
    response_model=HistoryOverview,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_history_overview(db: Db) -> HistoryOverview:
    return repo.history_overview(db)


@router.get(
    "/history/rom",
    response_model=list[RomPoint],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_history_rom(
    db: Db, finger: GloveFinger | None = None, pose: PoseId | None = None
) -> list[RomPoint]:
    return repo.history_rom(db, finger, pose)


@router.get(
    "/history/assist",
    response_model=list[AssistPoint],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_history_assist(db: Db) -> list[AssistPoint]:
    return repo.history_assist(db)


@router.get(
    "/history/resistance",
    response_model=list[ResistancePoint],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_history_resistance(db: Db) -> list[ResistancePoint]:
    return repo.history_resistance(db)
