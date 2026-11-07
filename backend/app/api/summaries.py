from typing import Literal

from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import ApiError, SessionSummaryIn, Summary, TherapistSummaryIn

router = APIRouter()


@router.post("/summaries", response_model=Summary, responses={501: {"model": ApiError}})
def post_summaries(body: SessionSummaryIn | TherapistSummaryIn) -> Summary:
    not_implemented()


@router.get("/summaries", response_model=list[Summary], responses={501: {"model": ApiError}})
def get_summaries(
    kind: Literal["session", "therapist"] | None = None, limit: int = 20
) -> list[Summary]:
    not_implemented()
