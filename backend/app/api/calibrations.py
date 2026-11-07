from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import ApiError, Calibration, CalibrationIn

router = APIRouter()


@router.get(
    "/calibrations/latest", response_model=Calibration | None, responses={501: {"model": ApiError}}
)
def get_calibrations_latest() -> Calibration | None:
    not_implemented()


@router.get("/calibrations", response_model=list[Calibration], responses={501: {"model": ApiError}})
def get_calibrations() -> list[Calibration]:
    not_implemented()


@router.post("/calibrations", response_model=Calibration, responses={501: {"model": ApiError}})
def post_calibrations(body: CalibrationIn) -> Calibration:
    not_implemented()
