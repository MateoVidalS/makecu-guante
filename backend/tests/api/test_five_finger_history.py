"""Mixed stored history must distinguish missing fingers from measured zeroes."""

import csv
import gzip
import io
import json

import pytest

from app.contracts import types as c
from app.db import models as m
from app.db import repo

LEGACY_FINGERS = repo.FINGERS[:3]


def add_history(db, session_body, attempt_body, payload, *, legacy):
    fingers = LEGACY_FINGERS if legacy else repo.FINGERS
    session = repo.create_session(
        db,
        c.SessionIn.model_validate(session_body),
        started_at="2026-11-01T10:00:00Z" if legacy else "2026-11-02T10:00:00Z",
    )
    data = {**attempt_body, "fingers": []}
    for index, finger in enumerate(fingers):
        active = 0.2 + index * 0.1
        data["fingers"].append(
            dict(
                finger=finger,
                scored=True,
                target=0.95,
                active_max=active,
                assist_needed=0 if finger == "pinky" else 0.95 - active,
                final=0.95,
            )
        )
    data["trace"] = {
        **attempt_body["trace"],
        **{
            key: {f: samples for f, samples in attempt_body["trace"][key].items() if f in fingers}
            for key in ("closure", "servo")
        },
    }
    attempt = repo.create_attempt(db, session.id, c.AttemptResult.model_validate(data))
    summary = payload("sessions")[0]["summary"]
    summary["per_finger"] = [f for f in summary["per_finger"] if f["finger"] in fingers]
    if legacy:
        # Persist the old shape directly, bypassing today's write path.
        summary["previous"] = {
            "active_ratio_mean": 0.3,
            "per_finger": [{"finger": f, "active_max_mean": 0.3} for f in fingers],
        }
        row = db.get(m.Session, session.id)
        row.summary_json = json.dumps(summary)
        db.add(row)
        db.commit()
    else:
        repo.end_session(db, session.id, c.SessionSummary.model_validate(summary))
    return session.id, attempt.id


def assert_unmeasured(rows, *fields):
    assert [row["finger"] for row in rows] == list(repo.FINGERS)
    for row in rows[3:]:
        assert all(row[field] is None for field in fields)


def test_legacy_session_and_mixed_aggregates(client, db, session_body, attempt_body, payload):
    old, attempt_id = add_history(db, session_body, attempt_body, payload, legacy=True)
    original_summary = db.get(m.Session, old).summary_json
    detail = client.get(f"/api/sessions/{old}").json()
    assert_unmeasured(
        detail["attempts"][0]["fingers"], "target", "active_max", "assist_needed", "final"
    )
    assert all(not f["scored"] for f in detail["attempts"][0]["fingers"][3:])
    assert_unmeasured(detail["summary"]["per_finger"], "active_max_mean", "assist_needed_mean")
    assert_unmeasured(detail["summary"]["previous"]["per_finger"], "active_max_mean")
    listed = client.get("/api/sessions").json()[0]
    assert listed["summary"] == detail["summary"]
    assert_unmeasured(
        client.get("/api/history/overview").json()["per_finger"],
        "active_max_first",
        "active_max_last",
        "assist_needed_last",
    )
    assert client.get("/api/history/rom?finger=ring").json() == []
    assert {p["finger"] for p in client.get("/api/history/assist").json()} == set(LEGACY_FINGERS)
    # Missing servo positions stay absent: the frozen trace contract cannot express null servo data.
    trace = client.get(f"/api/attempts/{attempt_id}/trace").json()
    assert set(trace["servo"]) == set(trace["closure"]) == set(LEGACY_FINGERS)
    assert json.loads(gzip.decompress(db.get(m.AttemptTrace, attempt_id).blob)) == trace
    assert db.get(m.Session, old).summary_json == original_summary

    current, _ = add_history(db, session_body, attempt_body, payload, legacy=False)
    current_detail = client.get(f"/api/sessions/{current}").json()
    assert_unmeasured(current_detail["summary"]["previous"]["per_finger"], "active_max_mean")
    rom = client.get("/api/history/rom").json()
    assert len(rom) == 8
    for finger, expected in (("ring", 0.5), ("pinky", 0.6)):
        filtered = client.get(
            f"/api/history/rom?finger={finger}&pose={attempt_body['pose']}"
        ).json()
        assert len(filtered) == 1
        assert filtered[0]["session_id"] == current
        assert filtered[0]["active_max_mean"] == pytest.approx(expected)
    assist = client.get("/api/history/assist").json()
    assert len(assist) == 8
    pinky = next(p for p in assist if p["finger"] == "pinky")
    assert pinky["assist_needed_mean"] == pinky["assisted_rate"] == 0
    overview = client.get("/api/history/overview").json()["per_finger"]
    assert overview[3]["active_max_first"] == overview[3]["active_max_last"] == 0.5
    assert overview[4]["assist_needed_last"] == 0


def test_mixed_exports_have_five_rows_per_attempt_with_blank_missing_values(
    client, db, session_body, attempt_body, payload
):
    old, _ = add_history(db, session_body, attempt_body, payload, legacy=True)
    current, _ = add_history(db, session_body, attempt_body, payload, legacy=False)
    rows = list(csv.DictReader(io.StringIO(client.get("/api/export?format=csv").text)))
    assert len(rows) == 10
    for id in (old, current):
        assert [r["finger"] for r in rows if int(r["session_id"]) == id] == list(repo.FINGERS)
    for row in rows[:5][3:]:
        assert row["scored"] == "False"
        assert all(row[field] == "" for field in ("target", "active_max", "assist_needed", "final"))
    assert float(rows[-1]["active_max"]) == pytest.approx(0.6)
    assert rows[-1]["assist_needed"] == "0.0"
    sessions = client.get("/api/export?format=json").json()["sessions"]
    assert_unmeasured(sessions[0]["attempts"][0]["fingers"], "active_max", "assist_needed")
    assert_unmeasured(sessions[0]["summary"]["per_finger"], "active_max_mean")
    assert set(sessions[0]["attempts"][0]["trace"]["servo"]) == set(LEGACY_FINGERS)
    assert len(sessions[1]["attempts"][0]["fingers"]) == 5


def test_legacy_and_subset_evaluation_trends_preserve_missing_values(
    client, db, calibration, payload
):
    original = payload("evaluations")[0]
    ids = []
    for fingers in (LEGACY_FINGERS, repo.FINGERS, ("pinky",)):
        body = {
            **{k: v for k, v in original.items() if k != "id"},
            "calibration_id": calibration.id,
            "settings": {**original["settings"], "fingers": list(fingers)},
            "fingers": [f for f in original["fingers"] if f["finger"] in fingers],
            "sweeps": [s for s in original["sweeps"] if s["finger"] in fingers],
        }
        saved = client.post("/api/evaluations", json=body)
        assert saved.status_code == 200, saved.text
        ids.append(saved.json()["id"])
        assert len(saved.json()["fingers"]) == len(fingers)
    points = client.get("/api/history/resistance").json()
    assert len(points) == 15
    legacy = [p for p in points if p["evaluation_id"] == ids[0]]
    assert_unmeasured(legacy, "slow", "fast", "dependence")
    subset = [p for p in points if p["evaluation_id"] == ids[2]]
    assert all(p["slow"] is None for p in subset[:4])
    assert subset[-1]["slow"] == original["fingers"][-1]["resistance_slow_ma"]
    # Evaluation detail/export retain the selected subset and never fabricate sweeps.
    assert client.get(f"/api/evaluations/{ids[2]}").json()["settings"]["fingers"] == ["pinky"]
