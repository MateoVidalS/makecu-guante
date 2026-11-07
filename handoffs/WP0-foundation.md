# WP0 — Foundation: scaffold, contracts, stubs, mocks, stub runtime

**Goal:** create the whole repo skeleton so nine Codex workers can then build in parallel without touching each other's files. Every path in
`docs/plan/02-architecture.md §4` must exist with its final exports, and the app must run end to end on **stubs**.

**Read:** `AGENTS.md`, `docs/plan/02-architecture.md`, **`docs/plan/03-contracts.md` (all)**, `docs/plan/06-session.md §2` (pose table),
`docs/plan/08-frontend.md §1–2`, **`docs/plan/11-ux-design.md` §3–4 (design tokens, app shell, components)**, `docs/plan/09-testing.md`.

**You own:** everything except `docs/plan/**`, `handoffs/**` and `AGENTS.md`.

## Deliverables
**Repo:** `Makefile` (targets in `02-architecture.md §5`; the `pio` steps are skipped with a notice if PlatformIO is missing), `.gitignore` (Python, Node,
PlatformIO `.pio/`, `.env`, `backend/data/`, `backend/static/`, Playwright output, `.playwright-mcp/`), `.env.example` files, `docs/DEV.md`.

**Contracts:**
- [ ] `frontend/src/contracts/{glove,vision,calibration,poses,engine,evaluation,runtime,api}.ts`, with every type and constant in contracts §3–4.
      `poses.ts` contains `POSES: Record<PoseId, PoseDef>` with the exact values from `06-session.md §2`, `DEFAULT_PLAN` and `PINCH_PLAN`,
      and `DEFAULT_EXERCISE_SETTINGS` / `DEFAULT_EVAL_SETTINGS`.
- [ ] `backend/app/contracts/*.py`: Pydantic mirrors of the REST shapes.
- [ ] `firmware/include/config.h` (constants + pins) and `firmware/lib/core/protocol.h` (message structs/enums, function declarations only).
- [ ] `contracts/fixtures/`: `serial_lines.txt` (one valid line per message type in both directions + 10 malformed lines, each annotated in
      a sibling `serial_lines.expected.json`), `calibration.json`, `sessions.json` (8 sessions over 3 weeks, improving active range,
      2 flagged `is_demo`), `session_detail.json`, `attempt_trace.json` (an assisted attempt with a resistance event), `evaluations.json` (3, with
      the resistance trend), `history_*.json`, `summaries.json`, `profile.json`. The backend tests validate them; `src/contracts/fixtures.check.ts` type-checks them.

**Backend:** a uv project (deps: fastapi, uvicorn[standard], pydantic>=2, pydantic-settings, sqlmodel, google-genai, httpx; dev: pytest,
pytest-asyncio, respx, ruff), with all deps installed now. `config.py`, the DB models exactly per contracts §5, `session.py`, the seed (empty
profile), `repo.py` signatures stubbed, **every router and endpoint** registered with its response models, returning 501 except `/api/health`.
Static serving with an SPA fallback. Tests: health, fixtures valid, every stub returns 501 in the error shape.

**Frontend:** Vite + React 18 + TS strict + ESLint + Prettier + vitest + Playwright config; all the deps in the `AGENTS.md` cheat-sheet installed now.
- [ ] `vite.config.ts` proxy `/api` → `:8000`. `public/models/` placeholder README.
- [ ] `src/api/client.ts`: typed functions + TanStack Query hooks for **every** endpoint.
- [ ] `src/mocks/`: MSW handlers backed by the fixtures (in-memory writes), enabled with `VITE_MOCK_API=1`.
- [ ] `src/styles/`: **the full token set and base styles from `11-ux-design.md §3`** (colors light/dark, type scale, spacing, radii, elevation,
      motion, focus ring), as CSS custom properties + `tokens.ts` exporting the same values for three.js/canvas.
- [ ] `src/App.tsx`: the providers in the order from `02-architecture.md §2`, the **app shell from `11-ux-design.md §4`** (Setup/Data, Focus and Doctor shells) (top bar, status chips
      placeholders, nav, Doctor view button, safety banner slot, toast region, aria-live region), and all routes from `08-frontend.md §2`, each pointing at
      placeholder pages in the owning folder (`src/pages/<Name>/index.tsx` showing the title + "Coming in WPn").
- [ ] Stubs with the final exports: `src/glove/` (`GloveProvider`, `useGlove`, a `StubGlove` emitting fake telemetry), `src/vision/`
      (`VisionProvider`, `useVision`, a `StubVision` with a sine closure), `src/engine/` (factories returning engines that throw "WP4"),
      `src/hand3d/VirtualHand.tsx` (renders a grey box placeholder), `src/voice/` (`VoiceProvider`, `useVoice` → status `off`, `CoachPanel` placeholder).
- [ ] `src/runtime/`: `RuntimeProvider`, `useRuntime`, `useExerciseView`, `useEvaluationView` implementing the contracts §3 `Runtime` with a
      **scripted stub** that plays a believable exercise (phases cycling, active max rising, an assist, one resistance event, attempt results,
      a summary) and evaluation (sweeps with fake curves). WP7, WP8 and WP9 develop against it.

## Acceptance criteria
- [ ] `make setup && make test` pass on a clean clone (with or without PlatformIO).
- [ ] `make dev-mock` serves an app where every route renders in the app shell, `/exercise` plays the scripted runtime (shown as raw JSON is fine),
      and REST calls hit MSW.
- [ ] `tsc --noEmit` passes, including `fixtures.check.ts`; the backend fixture tests pass.
- [ ] Every path in `02-architecture.md §4` exists. The PR lists each stub and the WP that replaces it.
