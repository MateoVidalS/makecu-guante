from typing import Literal

from fastapi import APIRouter, Response

from app.api.stub import not_implemented
from app.contracts.types import ApiError

router = APIRouter()


@router.get("/export", response_model=None, responses={501: {"model": ApiError}})
def get_export(format: Literal["json", "csv"] = "json") -> Response:
    not_implemented()
