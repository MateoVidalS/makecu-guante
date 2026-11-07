import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.db import repo
from app.db.seed import seed
from app.db.session import get_session, make_engine
from app.main import app

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"


@pytest.fixture
def payload():
    return lambda name: json.loads((FIXTURES / f"{name}.json").read_text())


@pytest.fixture
def db(tmp_path):
    engine = make_engine(str(tmp_path / "test.db"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed(session)
        yield session
    engine.dispose()


@pytest.fixture
def client(db):
    def override():
        yield db

    app.dependency_overrides[get_session] = override
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.pop(get_session)


@pytest.fixture
def calibration(db, payload):
    from app.contracts.types import CalibrationIn

    data = payload("calibration")
    return repo.create_calibration(
        db,
        CalibrationIn.model_validate(
            {k: v for k, v in data.items() if k not in ("id", "created_at")}
        ),
    )


@pytest.fixture
def session_body(payload, calibration):
    return {
        **{k: payload("sessions")[0][k] for k in ("mode", "plan", "settings", "is_demo")},
        "calibration_id": calibration.id,
    }


@pytest.fixture
def attempt_body(payload):
    return {
        **{
            k: v
            for k, v in payload("session_detail")["attempts"][0].items()
            if k not in ("id", "session_id")
        },
        "trace": payload("attempt_trace"),
    }
