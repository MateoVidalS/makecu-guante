# Rehab Hub development

WP0 is a runnable foundation for the parallel work packages. All live signals are
synthetic. The runtime does not connect to hardware, move servos, capture a camera,
or make Gemini calls. The app identifies the simulated sources in its header.

## First run

Install Node 20 or newer, pnpm, Python 3.11 or newer, and uv. From the repository root:

```sh
make setup
make dev-mock
```

Open <http://127.0.0.1:5173>. No environment file or API key is needed. MSW starts
before React and handles every `/api` endpoint using the shared fixtures. Writes
are kept in memory until the page reloads. The mock voice endpoint returns the
contract's `503 voice_unavailable` response.

Home makes a health request and displays “API connected”. Visit `/exercise`, click
**Play scripted exercise**, and expand **Scripted runtime data** to inspect the
view. The fifteen-attempt script cycles through phases, tracks active range,
assists, emits one resistance event, and produces a summary. Pause, Resume, Skip
pose, and End session work. `/evaluate` plays six synthetic slow/fast sweeps.
These scripts are UI development tools; they are not rehabilitation logic.

All routes are registered, including `/calibrate`, `/history/sessions/8`,
`/history/evaluations/3`, `/doctor`, `/profile`, and `/_dev/hand`. Page folders show
which work package implements their final content. Focus mode hides navigation
while an exercise or evaluation runs. Doctor view has its own read-only banner.

```sh
make dev       # API :8000 and Vite :5173; Ctrl-C stops both
make dev-sim   # same, with VITE_SIM=1
make test      # pytest, vitest, TypeScript, Ruff, ESLint, optional native tests
make build     # frontend build into backend/static/
make demo      # build and serve at http://127.0.0.1:8000
```

Every backend endpoint except `/api/health` deliberately returns HTTP 501 in the
shared error envelope for a valid request. Request validation returns HTTP 422 in
the same envelope. `/docs` and `/openapi.json` expose typed bodies and responses.
The API creates a SQLite database with WAL, foreign keys, cascading child deletes,
and an empty singleton profile. It never seeds demo records implicitly. WP5 will
implement storage operations and WP11 will implement explicit demo seeding.

PlatformIO is optional for WP0. Firmware steps print a notice if `pio` is absent,
or if WP1 has not created `firmware/platformio.ini`. Once that file exists,
`make setup`, `make test`, and `make fw-build` invoke PlatformIO normally. The
`fw-flash` target is provided for the team's later bench workflow; WP0 never runs it.

## Configuration

Copy `backend/.env.example` to `backend/.env` and/or `frontend/.env.example` to
`frontend/.env` only when needed. These files are ignored. Backend keys never
belong in frontend variables. `REHAB_DB_PATH` defaults to `backend/data/rehab.db`
when launched through Make; `REHAB_PORT` defaults to 8000. The Vite proxy targets
port 8000; keep the default port for local integration.

`VITE_MOCK_API=1` enables MSW. `VITE_SIM=1` is reserved for source selection by the
real WP2/WP3 providers; WP0 only has simulated sources in every mode. Source
switches to camera/serial reject explicitly until their implementations arrive.

The Gemini settings retain the published contract defaults. Google's current
[model catalog](https://ai.google.dev/gemini-api/docs/models) and
[Live model availability](https://firebase.google.com/docs/ai-logic/models)
indicate the old `gemini-3.8-live` identifier is retired. WP8 must
select an available Gemini Developer API Live model when implementing token
creation, and request the corresponding contract update. Puck remains a named
voice option in the [Live API guide](https://firebase.google.com/docs/ai-logic/live-api/configuration).
WP0 makes no model requests. Model availability and account access need verifying
again when WP5/WP8 add the integrations.

## Verification

```sh
cd frontend
pnpm exec playwright install chromium
cd ..
make e2e                     # real health endpoint, all other API routes stubbed
REHAB_E2E_MOCK=1 make e2e     # browser MSW integration
```

The Playwright server defaults to `make dev-sim`; the mock option launches
`make dev-mock`. Use free ports 5173 and 8000 for these checks. Tests cover every
route, focus mode, exercise controls, browser console errors, and the shared
accessibility slots. Vitest covers contract fixture drift, the full scripted
plan, evaluation sweeps, mock API reads/writes, exports, source cleanup, and
contrast for text, buttons and focus indicators. Pytest validates every shared
REST fixture, every stub endpoint, static serving, and SQLite initialization.

`src/contracts/fixtures.check.ts` contains literal copies of the JSON fixtures
with `satisfies` checks, because TypeScript widens enum strings imported from
JSON. A Vitest comparison makes fixture drift fail. Future workers must add new
fixture files instead of editing these frozen examples.

The exact light/dark design colors are retained. Body/secondary text on all
surfaces pass 4.5:1; accent focus indicators pass 3:1; primary button text passes
4.5:1. Some semantic colors in the design spec (notably light assist/reached/demo
and finger-index) do not independently meet 3:1 against every surface. They must
remain supplementary to labels and outlines. WP11 should resolve their use in
essential charts/graphics with the design owner; WP0 does not alter spec colors.
Dark finger series variants, elevation values, and layout measurements omitted
from the spec have explicit values in `tokens.ts` and matching CSS properties.

## Replacement map

| Stub boundary | Incoming owner |
| --- | --- |
| Entire `firmware/` tree (excluded from WP0 by coordinator update) | WP1 |
| `src/glove/codec.ts`, `webSerialGlove.ts`, `StubGlove.ts`, `sim/*`, `GloveProvider.tsx` | WP2 |
| `src/vision/*`, model placeholder README | WP3 |
| `src/engine/{types,exercise,evaluation,metrics,index}.ts` | WP4 |
| `app/db/repo.py`, `app/api/*` except voice, `app/llm/*` | WP5 |
| `src/hand3d/*`, `src/pages/DevHand` | WP6 |
| Home, Setup, Calibrate, Exercise, Evaluation pages; common components | WP7 |
| `src/voice/*`, `app/voice/*`, `app/api/voice.py` | WP8 |
| History, SessionReplay, EvaluationDetail, Doctor, Profile; chart components | WP9 |
| `src/runtime/*`, browser integration tests | WP10 |
| `backend/tools/seed_demo.py`, final visual/accessibility polish | WP11 |

The engine factories return their final typed interfaces; operations throw
`WP4`. Serial/camera leaf stubs reject use. The compatibility `SimWorld` factory
currently exposes independent scripted sources, not a patient/safety model.
`useGloveTelemetry`, `useVisionFrame`, `useExerciseView`, and `useEvaluationView`
provide selector subscriptions; imperative getters expose the latest source
values. Voice remains off. `VirtualHand` is a grey placeholder. Only the runtime
script is orchestrated; WP10 will wire the real sources, engines, voice, API retry
queue, and calibration commands. Do not use WP0 as a hardware simulator.
