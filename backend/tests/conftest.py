import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def no_real_gemini_key(monkeypatch):
    """backend/.env may hold a real key: tests never call Gemini unless they set a fake one."""
    monkeypatch.setattr(settings, "gemini_api_key", "")
