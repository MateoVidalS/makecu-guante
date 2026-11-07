from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session as DbSession

from app.contracts.types import ApiError, Profile
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.get(
    "/profile",
    response_model=Profile,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_profile(db: Db) -> Profile:
    return repo.get_profile(db)


@router.put(
    "/profile",
    response_model=Profile,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def put_profile(db: Db, body: Profile) -> Profile:
    return repo.put_profile(db, body)
