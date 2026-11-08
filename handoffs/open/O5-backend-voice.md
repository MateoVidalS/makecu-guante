# O5 — Backend + voice for the opening glove (owns `backend/**`, `frontend/src/voice/**`, plus the listed contract edits)

Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` §2.8, §4.5 and `docs/plan/07-voice-and-ai.md`, `13-ai-therapist.md`.

## Contract edits you own (the backend half of O0)
- `backend/app/contracts/types.py`: `AssistDirection = Literal["close", "open"]`, `CURRENT_ASSIST_DIRECTION = "open"`;
  `CalibrationIn.assist_direction: AssistDirection | None = None`; the same optional field (derived, `None` = legacy close) on
  `Session`, `Evaluation`, `RomPoint`, `AssistPoint`, `ResistancePoint`. Comments on `ServoCalibration` (min = slack with a relaxed fist,
  max = straight) and `CameraCalibration` (open = glove-opened relaxed hand, closed = the patient's own fist). Mirrors
  `frontend/src/contracts/{calibration,api}.ts`.
- `contracts/fixtures/calibration.json`: add `"assist_direction": "open"`. Keep the other fixtures valid (the field is optional).

## Backend
1. DB: nullable `calibration.assist_direction` (migration for existing DBs, like earlier additive columns); stored on POST, returned on GET.
2. Sessions, evaluations and history points carry `assist_direction` derived from their calibration (null → `"close"` in responses, so
   the UI never guesses). History aggregations (`overview`, `rom`, `assist`, `resistance`) never average across directions: the overview's
   first/last comparisons use only `"open"` data when any exists.
3. Export: an `assist_direction` column in CSV (one per attempt-finger row) and the field in JSON.
4. Demo seeder: regenerate the story with `"open"` calibrations (assisted openings, opening deficits that shrink, flexor resistance in
   evaluations) plus two early legacy `"close"` sessions to exercise the marking. Keep `make demo-seed` deterministic.
5. Summaries (`llm/` prompts): the glove assists **opening**; talk about active opening, the opening the glove completed, and resistance to
   opening (flexor tone); legacy sessions are described as the earlier closing-assist glove and never compared directly.
6. Voice (`backend/app/voice/prompt.py`, `tools.py`, the prompt snapshot): the coach explains the glove helps open the hand; tool
   descriptions: `intensify(further)` = open further, `target_scale` = how far to open; safety phrases for resistance while opening.

## Frontend voice (`frontend/src/voice/**`)
Cues, `safetyNet.ts`, `fallbackCoach.ts`, `patientSafety.ts`, `fingerNames.ts` phrases, `context.ts`: "I'll help you open", "Open your
hand as wide as you can", "I feel resistance opening your index, let's stop here", fist attempts are encouragement only ("Make a fist on
your own; the glove just follows"). Keep every safety-net behavior.

## Tests
Backend: migration on an old DB, roundtrip with and without the field, derived direction on sessions/points, no cross-direction
aggregation, CSV column, seeder story, prompt snapshots. Frontend voice: cue and safety-net tests updated. `make test` green.

## Acceptance
Diff only in the owned paths plus the two contract files above (list them under `## Out-of-scope edits` as "O5 contract edits per brief").
