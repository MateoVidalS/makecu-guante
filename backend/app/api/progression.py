from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session as DbSession

from app.contracts.progression import ProgressionSettings, ProgressionSettingsIn
from app.contracts.types import ApiError
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.get(
    "/progression/settings",
    response_model=ProgressionSettings,
    responses={422: {"model": ApiError}},
)
def get_progression_settings(db: Db) -> ProgressionSettings:
    return repo.get_progression_settings(db)


@router.put(
    "/progression/settings",
    response_model=ProgressionSettings,
    responses={422: {"model": ApiError}},
)
def put_progression_settings(db: Db, body: ProgressionSettingsIn) -> ProgressionSettings:
    return repo.put_progression_settings(db, body)
