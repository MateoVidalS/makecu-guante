from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session as DbSession

from app.contracts.types import ApiError, Calibration, CalibrationIn
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.get(
    "/calibrations/latest",
    response_model=Calibration | None,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_calibrations_latest(db: Db) -> Calibration | None:
    return repo.latest_calibration(db)


@router.get(
    "/calibrations",
    response_model=list[Calibration],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_calibrations(db: Db) -> list[Calibration]:
    return repo.list_calibrations(db)


@router.post(
    "/calibrations",
    response_model=Calibration,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_calibrations(db: Db, body: CalibrationIn) -> Calibration:
    return repo.create_calibration(db, body)
