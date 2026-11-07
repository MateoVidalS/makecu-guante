from fastapi import APIRouter

from app.api.stub import not_implemented
from app.contracts.types import ApiError, Evaluation, EvaluationIn

router = APIRouter()


@router.post("/evaluations", response_model=Evaluation, responses={501: {"model": ApiError}})
def post_evaluations(body: EvaluationIn) -> Evaluation:
    not_implemented()


@router.get("/evaluations", response_model=list[Evaluation], responses={501: {"model": ApiError}})
def get_evaluations() -> list[Evaluation]:
    not_implemented()


@router.get("/evaluations/{id}", response_model=Evaluation, responses={501: {"model": ApiError}})
def get_evaluations_id(id: int) -> Evaluation:
    not_implemented()
