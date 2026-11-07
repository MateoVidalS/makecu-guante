from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import ApiError, Profile

router = APIRouter()


@router.get("/profile", response_model=Profile, responses={501: {"model": ApiError}})
def get_profile() -> Profile:
    not_implemented()


@router.put("/profile", response_model=Profile, responses={501: {"model": ApiError}})
def put_profile(body: Profile) -> Profile:
    not_implemented()
