# AGENTS.md — rules for every coding agent in this repo

You are a worker on **Rehab Hub**: a web app + ESP32 firmware for a robotic tendon glove for hand rehabilitation
(concept in `README.md`, written in Spanish). The plan is in `docs/plan/`. Your task is one brief in `handoffs/`.

## Read before coding
1. `docs/plan/README.md` (the index) and `docs/plan/01-product.md` (decisions).
2. `docs/plan/03-contracts.md`: **the source of truth** for the serial protocol, types, runtime API, REST, DB and config.
3. Your brief `handoffs/WPn-*.md`, plus the plan docs it points to.

## Hard rules
- **Only edit the paths your brief says you own.** New files inside owned directories are fine. Any other edit must be minimal and listed under
  `## Out-of-scope edits` in the PR.
- **Do not change the contracts** (`docs/plan/03-contracts.md`, `frontend/src/contracts/**`, `backend/app/contracts/**`,
  `firmware/lib/core/protocol.h`, existing `contracts/fixtures/*`). Work around a problem and write a `## Contract change request` in the PR.
- **Don't edit** `docs/plan/**`, `handoffs/**` or `AGENTS.md`.
- **Safety first.** Never weaken a firmware safety rule (`docs/plan/04-firmware.md §4`), and never make the browser the only safety layer.
  Never flash firmware to a board or move servos attached to a person as part of your task; hardware runs are done by the team.
- Never commit secrets. `.env` is git-ignored; keep `.env.example` updated.
- Add dependencies only when needed (`uv add`, `pnpm add`, `platformio.ini lib_deps`) and mention them in the PR.
- English for code, comments, UI copy and docs. If you ever write Spanish, never use the opening `¿` or `¡`.

## Workflow
1. `git pull origin MateoVidalS/rehab-hub` (once WP0 exists), then `make setup`.
2. Small commits (`wp4: assist phase`), ending with the trailer `Co-Authored-By: Codex <noreply@openai.com>`.
3. Write tests as you go. Before finishing: `make test` is green, plus lint and typecheck.
4. `git push -u origin HEAD`, then `gh pr create --base MateoVidalS/rehab-hub --title "WPn: <name>" --body-file <file>`.
5. **Do not merge.** Stop after the PR is open and print its URL.

## PR description template
```
## Summary
## How to see it
## Tests
## Acceptance criteria   (copy from the brief, check each)
## Deviations from spec
## Contract change request
## Out-of-scope edits
## Known gaps / follow-ups
```

## Stack cheat-sheet
- UI work follows `docs/plan/11-ux-design.md` (tokens, layouts, copy, accessibility). Use the tokens; never hard-code colors or sizes.
- Frontend: Node ≥ 20, pnpm, Vite, React 18, TS strict, react-router, TanStack Query, zustand, @react-three/fiber + drei, Recharts, @fontsource/atkinson-hyperlegible,
  @mediapipe/tasks-vision, @google/genai, MSW, vitest, Playwright. Chrome/Edge only (Web Serial).
- Backend: Python ≥ 3.11, uv, FastAPI, Pydantic v2, SQLModel (SQLite), google-genai, pytest (+ respx), ruff.
- Firmware: PlatformIO, Arduino-ESP32, ESP32Servo, Adafruit INA219, ArduinoJson 7, Adafruit NeoPixel; Unity native tests.
- `make setup | dev | dev-sim | dev-mock | test | e2e | fw-build | build | demo`.
