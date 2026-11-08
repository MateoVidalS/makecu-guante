"""Adaptive progression settings (docs/plan/17-progression.md)."""

from sqlmodel import select

from app.db import models as m


def test_progression_is_off_until_a_therapist_turns_it_on(client):
    # Off by default: practice, the demo and old databases behave exactly as before.
    assert client.get("/api/progression/settings").json() == {
        "enabled": False,
        "challenge": "standard",
        "updated_at": None,
    }


def test_progression_settings_roundtrip(client, db):
    saved = client.put(
        "/api/progression/settings", json={"enabled": True, "challenge": "gentle"}
    ).json()
    assert saved["enabled"] is True
    assert saved["challenge"] == "gentle"
    assert saved["updated_at"].endswith("Z")
    assert client.get("/api/progression/settings").json() == saved
    client.put("/api/progression/settings", json={"enabled": False, "challenge": "standard"})
    assert len(db.exec(select(m.ProgressionSettings)).all()) == 1
    assert client.get("/api/progression/settings").json()["enabled"] is False


def test_progression_settings_reject_unknown_values(client):
    bad = [
        {"enabled": True, "challenge": "hard"},
        {"enabled": True},
        {"enabled": True, "challenge": "standard", "target_scale": 1.2},
    ]
    for body in bad:
        response = client.put("/api/progression/settings", json=body)
        assert response.status_code == 422, body
        assert response.json()["error"]["code"] == "validation_error"
    assert client.get("/api/progression/settings").json()["enabled"] is False


def test_progression_fixture_matches_the_contract(payload):
    from app.contracts.progression import ProgressionSettings

    assert ProgressionSettings.model_validate(payload("progression_settings")).enabled is True
