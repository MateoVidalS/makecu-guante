# 02 — Architecture

## 1. Shape

```
 ┌──────────────────────────────── Chrome on the laptop (React + Vite app) ─────────────────────────────────┐
 │                                                                                                           │
 │  webcam ─▶ CameraVision (MediaPipe) ─┐           ┌─▶ VirtualHand (three.js): target ghost + actual hand   │
 │            or SimVision ─────────────┤           │                                                        │
 │                                      ▼           │                                                        │
 │                     Runtime ──tick──▶ ExerciseEngine / EvaluationEngine (pure TS)                         │
 │                       │  ▲                  │ commands                                                    │
 │                       │  └── telemetry ─────┼──────────── GloveClient: WebSerialGlove ─USB─▶ ESP32         │
 │                       │                     ▼                          or SimGlove (SimWorld)             │
 │                       ├──▶ Voice: safety net (Web Speech + earcons) + Gemini Live coach ◀─WS─▶ Google     │
 │                       └──▶ REST client ─────────────────────────────────────────┐                         │
 └─────────────────────────────────────────────────────────────────────────────────┼─────────────────────────┘
                                                                                   ▼ http://localhost:8000/api (Vite proxy)
                         FastAPI + SQLite (sessions, attempts, traces, calibrations, evaluations,
                         history aggregation, export, Gemini text summaries, Gemini Live ephemeral tokens)

 ESP32-WROOM-32 firmware: servos ×3 (LEDC), INA219, STOP button, NeoPixel ring, JSON-lines protocol, safety rules
```

- **All real-time logic runs in the browser.** Web Serial, MediaPipe and audio are all browser APIs, and keeping the loop in one place
  avoids extra hops. The backend is only storage + Gemini (keeps the key private) + aggregation.
- **Safety never depends on the browser.** The firmware enforces limits, ramps, overcurrent, STOP and the watchdog on its own
  (`04-firmware.md`). The browser adds a second layer (resistance pre-emption, camera-loss pause).
- The app is opened as `http://localhost:5173` (dev) or `http://localhost:8000` (built). Both are a secure context, so
  camera, mic and Web Serial work. **Chrome or Edge only** (Web Serial).

## 2. Frontend internals
- React 18 + TS strict + Vite, react-router, TanStack Query (REST), zustand (live view stores), three.js via
  `@react-three/fiber` + `@react-three/drei`, Recharts, `@mediapipe/tasks-vision`, `@google/genai` (Live, browser), MSW, vitest, Playwright.
- **Providers** (App.tsx, WP0): `QueryClientProvider` → `GloveProvider` (WP2) → `VisionProvider` (WP3) → `RuntimeProvider` (WP0 stub → WP10) →
  `VoiceProvider` (WP8) → router.
- **Live data never goes through React state at 30–50 Hz** for whole pages. Components subscribe with selectors, and three.js reads the
  latest values in `useFrame` (refs), not props.
- **The runtime** (`src/runtime/`, WP10) is a plain TS class + provider: it subscribes to vision frames and telemetry, calls
  `engine.tick`, executes the returned commands on the glove client, forwards events to the voice layer and the stores, persists
  attempts/sessions/evaluations through the REST client (with a retry queue; a backend outage must not stop a session), and
  sends calibration to the glove on every (re)connect.

## 3. Backend internals
FastAPI + SQLModel (sync, called from threadpool routes) + SQLite WAL. Routers: profile, calibrations, sessions/attempts,
evaluations, history, summaries, voice, export, health. It serves the built frontend from `backend/static/` with an SPA fallback.

## 4. Repo layout & ownership

WP0 creates **every file below as a stub** with the final names and exports, so later packages only edit files they own.

```
AGENTS.md, Makefile, .env.example, docs/DEV.md                 WP0 (AGENTS.md: coordinator afterwards)
contracts/fixtures/**                                          WP0 (others may ADD files, not edit existing ones)
firmware/**                                                    WP1 (WP0 creates only include/config.h + lib/core/protocol.h stubs from contracts)
frontend/
  package.json, vite.config.ts, tsconfig, eslint, index.html   WP0
  public/models/hand_landmarker.task                           WP3
  src/main.tsx, src/App.tsx (providers, layout, routes)        WP0 (frozen; WP10/WP11 may edit)
  src/contracts/**                                             WP0 (frozen)
  src/api/client.ts                                            WP0 (typed functions + query hooks for every endpoint)
  src/mocks/**                                                 WP0
  src/styles/**                                                WP0
  src/glove/**  (codec, webSerialGlove, sim/, GloveProvider)   WP2
  src/vision/** (CameraVision, flex, oneEuro, calibration, overlay, VisionProvider)   WP3
  src/engine/** (exercise, evaluation, metrics)                WP4
  src/hand3d/** (VirtualHand, rig, poses → joint transforms)    WP6
  src/pages/{Home,Setup,Calibrate,Exercise,Evaluation}/**      WP7
  src/components/common/**                                     WP7
  src/voice/**                                                 WP8
  src/pages/{History,SessionReplay,EvaluationDetail,Doctor,Profile}/**   WP9
  src/pages/DevHand/**                                         WP6
  src/components/charts/**                                     WP9
  src/runtime/**                                               WP0 stub → WP10
  e2e/**                                                       WP10
backend/
  pyproject.toml, uv.lock                                      WP0
  app/main.py, app/config.py, app/contracts/**                 WP0 (contracts frozen)
  app/db/{models,session,seed}.py                              WP0
  app/db/repo.py, app/api/{profile,calibrations,sessions,evaluations,history,export,health,summaries}.py, app/llm/**   WP5
  app/voice/**, app/api/voice.py                               WP8
  tools/seed_demo.py                                           WP11
  tests/<area>/**                                              the owner of the area
```

## 5. Commands (Makefile)

| Target | Does |
|---|---|
| `make setup` | `uv sync` (backend), `pnpm install` (frontend), `pio pkg install` (firmware, if `pio` is present) |
| `make dev` | backend `:8000` + Vite `:5173` (proxy `/api`) |
| `make dev-sim` | same, with `VITE_SIM=1` (SimGlove + SimVision by default) |
| `make dev-mock` | frontend only with `VITE_MOCK_API=1` + `VITE_SIM=1` |
| `make test` | `uv run pytest -q`, `pnpm test --run`, `pnpm typecheck`, `pnpm lint`, `pio test -e native` (if `pio` is present) |
| `make e2e` | Playwright on `make dev-sim` |
| `make fw-build` / `make fw-flash` | `pio run -e esp32dev` / `pio run -e esp32dev -t upload` |
| `make build` | `pnpm build` → `backend/static/` |
| `make demo` | build, then serve everything from FastAPI on `:8000` |
