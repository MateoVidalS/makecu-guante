"""All chat tests use synthetic records and a mocked SDK; never a live Gemini client."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from google import genai
from google.genai import types
from sqlmodel import Session

from app.config import settings
from app.db.session import get_session, make_engine
from app.llm import gemini
from app.main import app
from tools.seed_demo import seed_demo

END = datetime(2026, 11, 6, 10, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def no_live_gemini(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(genai, "Client", MagicMock(side_effect=AssertionError("SDK must be faked")))
    gemini._cooling.clear()
    yield
    gemini._cooling.clear()


@pytest.fixture(scope="module")
def demo_engine(tmp_path_factory):
    engine = make_engine(str(tmp_path_factory.mktemp("chat") / "demo.db"))
    seed_demo(engine, end=END)
    yield engine
    engine.dispose()


@pytest.fixture
def db(demo_engine):
    # Repository commits release savepoints, leaving each test's outer transaction isolated.
    with demo_engine.connect() as connection:
        connection.exec_driver_sql("BEGIN")
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            yield db
        connection.rollback()


@pytest.fixture
def client(db):
    def override():
        yield db

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def sdk(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
    factory = MagicMock()
    fake = factory.return_value.__enter__.return_value
    fake.auth_tokens.create.return_value = SimpleNamespace(name="auth_tokens/chat-test")
    monkeypatch.setattr(genai, "Client", factory)
    fake.factory = factory

    # Streaming replays whatever a test set on generate_content, as one chunk or several
    # (a list of responses), so call-argument assertions keep working for both.
    def stream(**kwargs):
        result = fake.models.generate_content(**kwargs)
        return iter(result if isinstance(result, list) else [result])

    fake.models.generate_content_stream.side_effect = stream
    return fake


def response(text=None, calls=()):
    parts = [types.Part(text=text)] if text is not None else []
    parts.extend(
        types.Part(function_call=types.FunctionCall(name=name, args=args, id=f"call-{i}"))
        for i, (name, args) in enumerate(calls)
    )
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts))]
    )
