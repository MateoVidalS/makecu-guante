# WP4 — Session engine: exercise, assist-as-needed, evaluation, metrics

**Goal:** pure, deterministic TypeScript engines that decide **when the glove helps and when it stops**, and compute the clinical-style metrics.

**Read:** `AGENTS.md`, **`docs/plan/06-session.md` (all)**, `docs/plan/03-contracts.md §2–3`, `docs/plan/04-firmware.md §4` (what the firmware already
guarantees), `docs/plan/07-voice-and-ai.md §4` (which events the voice consumes).

**You own:** `frontend/src/engine/**` and its tests.

## Deliverables
- [ ] `exercise.ts` (`ExerciseEngine`): the state machine, phase table, vision gating, safety mapping + finger attribution, resistance pre-emption,
      pause/resume (resume sends `release` first), skip/stop, `progress` throttling.
- [ ] `metrics.ts`: per-finger and per-attempt metrics, the 20 Hz trace builder, `SessionSummary`.
- [ ] `evaluation.ts` (`EvaluationEngine`): limit handling, slow/fast sweeps, abort + fault clearing, friction subtraction, results; plus
      `frictionRun` used by the calibration wizard.
- [ ] Factories in `src/engine/index.ts` (replacing the WP0 stubs; same exports).
- [ ] `test/fakeWorld.ts`: a tiny deterministic input generator (closure curves, telemetry echo of commands with a ramp, scripted events). **Don't import WP2.**
- [ ] Every scenario in `06-session.md §6`, asserting the command sequences, events and metrics.

## Acceptance criteria
- [ ] No imports from React, DOM, `src/glove`, `src/vision` or `src/runtime`; no `Date.now()`/`setTimeout`. Time comes only from `now`.
- [ ] The engine never emits `target` or `follow` while PAUSED, while in a firmware `fault`, or with vision confidence < 0.6 (a property-based test with random inputs).
- [ ] The full default plan (5 × 3) runs through the fake world in < 200 ms of CPU.
- [ ] Each state-transition function has a doc comment citing the spec row it implements.
