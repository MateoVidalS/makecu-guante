from fastapi import APIRouter

from app.config import settings
from app.contracts.types import Health

router = APIRouter()


@router.get("/health", response_model=Health)
def health() -> Health:
    return Health(ok=True, version="0.1.0", gemini=bool(settings.gemini_api_key))
