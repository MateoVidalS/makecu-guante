from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session as DbSession

from app.contracts.types import ApiError, Evaluation, EvaluationIn
from app.db import repo
from app.db.session import get_session

Db = Annotated[DbSession, Depends(get_session)]

router = APIRouter()


@router.post(
    "/evaluations",
    response_model=Evaluation,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def post_evaluations(db: Db, body: EvaluationIn) -> Evaluation:
    return repo.create_evaluation(db, body)


@router.get(
    "/evaluations",
    response_model=list[Evaluation],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_evaluations(db: Db) -> list[Evaluation]:
    return repo.list_evaluations(db)


@router.get(
    "/evaluations/{id}",
    response_model=Evaluation,
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def get_evaluations_id(db: Db, id: int) -> Evaluation:
    return repo.get_evaluation(db, id)
