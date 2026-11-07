# WP10 — Runtime integration + end-to-end

**Goal:** replace the stub runtime with the real one: vision + telemetry → engine → glove commands, events → voice and UI, results → backend. Prove the
README acceptance criteria end to end with the simulator.

**Prerequisites:** WP2, WP3, WP4 and WP5 merged. Before opening the PR, `git pull origin MateoVidalS/rehab-hub` again so WP6–9 are included, and make
the e2e pass on that.

**Read:** `AGENTS.md`, **`docs/plan/02-architecture.md §2`**, **`docs/plan/03-contracts.md §3` (Runtime)**, `docs/plan/06-session.md`,
`docs/plan/07-voice-and-ai.md §1`, **`docs/plan/09-testing.md §2`**.

**You own:** `frontend/src/runtime/**`, `frontend/e2e/**`, `frontend/src/App.tsx` (provider wiring only). Small fixes in other WPs' code are allowed if
each one is listed in the PR with its reason.

## Deliverables
- [ ] `runtime.ts`: subscribes to vision + telemetry + glove events + connection, calls `engine.tick`, executes commands (respecting the client's throttling),
      exposes the views via small stores, feeds `SimWorld.setIntent` when the sim is active, sends calibration + limit on every (re)connect, and persists
      the session/attempts/evaluation with a **retry queue** (the backend being down never blocks a session; a "Saving…/Saved/Offline" indicator).
- [ ] Source switching (serial ↔ sim, camera ↔ sim) at runtime, only when no session is running.
- [ ] Integration tests (vitest, node): SimWorld moderate preset → the full default plan → expected attempt counts/assist flags → payloads posted (to a mocked API).
- [ ] Playwright e2e on `make dev-sim` (3× sim speed, voice off): calibrate (sim) → exercise the default plan → a rigid-index safety pause appears and resume works
      → summary → history shows the session → replay renders → evaluation runs → doctor view loads → export downloads.
- [ ] Latency instrumentation: vision → command and command → telemetry echo, shown on the Setup page diagnostics.

## Acceptance criteria
- [ ] `make test` and `make e2e` green on the updated integration branch.
- [ ] README §4.10 rows 3 and 6 are demonstrated in e2e with the sim; rows 1–2 instrumented.
- [ ] A 20-minute sim soak (2 sessions + 1 evaluation) without errors or memory growth > 50 MB.
