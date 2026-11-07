from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import (
    ApiError,
    AssistPoint,
    GloveFinger,
    HistoryOverview,
    PoseId,
    ResistancePoint,
    RomPoint,
)

router = APIRouter()


@router.get(
    "/history/overview", response_model=HistoryOverview, responses={501: {"model": ApiError}}
)
def get_history_overview() -> HistoryOverview:
    not_implemented()


@router.get("/history/rom", response_model=list[RomPoint], responses={501: {"model": ApiError}})
def get_history_rom(
    finger: GloveFinger | None = None, pose: PoseId | None = None
) -> list[RomPoint]:
    not_implemented()


@router.get(
    "/history/assist", response_model=list[AssistPoint], responses={501: {"model": ApiError}}
)
def get_history_assist() -> list[AssistPoint]:
    not_implemented()


@router.get(
    "/history/resistance",
    response_model=list[ResistancePoint],
    responses={501: {"model": ApiError}},
)
def get_history_resistance() -> list[ResistancePoint]:
    not_implemented()
