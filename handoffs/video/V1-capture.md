# V1: app recordings (capture)

Read `handoffs/video/README.md` first. You own `video/studio/capture/**` and `video/studio/public/recordings/**`.
**No edits to `frontend/` or `backend/`.** If an app bug blocks a shot, work around it in the capture script or report it.

## Goal
Scripted, repeatable, crisp recordings of the real app running on the simulator, plus a manifest of what happens when and
where (the editor zooms and draws callouts from it). Contract: `RecordingManifest` in `video/studio/src/contracts.ts`.

## Setup
- Seed a **separate** DB: `REHAB_DB_PATH=/tmp/memo-video.db make demo-seed` (repo root), then run the stack with simulated
  glove and camera on **non-default ports** so you don't collide with other sessions: backend on 8100
  (`REHAB_PORT=8100`, see `frontend/vite.config.ts` proxy and `scripts/dev.py`), Vite on 5273, `VITE_SIM=1 VITE_VISION=sim`.
- Gemini: the backend reads `GEMINI_API_KEY`. For the one therapist-summary shot, export it at runtime from
  `/Users/mateovidal/orca/workspaces/makecu-guante/rehab-hub/backend/.env` (never copy the file, never print the key, never let it
  appear on screen). Free tier: ~20 requests/day/model. **At most 2 summary requests total.** Check first whether the seed already
  stores a therapist summary you can show.
- Learn how to drive the simulator from `frontend/e2e/helpers.ts`, `frontend/e2e/open-assist.spec.ts`, `frontend/e2e/f9-rigid-harness.ts`,
  `frontend/e2e/ai-therapist-harness.ts`, `frontend/src/runtime/SimulatorControls.tsx`, `frontend/src/runtime/testMode.ts`.

## How to record
- Chromium via Playwright (Node script in `capture/`, run with the frontend's Playwright or add it to `video/studio` devDeps),
  viewport **1920×1080 CSS px, deviceScaleFactor 2** so 2× zooms stay sharp. Use CDP `Page.startScreencast` (jpeg q≥90) or
  per-frame screenshots, then assemble a constant **30 fps** H.264 mp4 (`ffmpeg -crf 14 -pix_fmt yuv420p`) at 3840×2160.
  `recordVideo` webm is too soft; don't use it.
- Light theme. Hide the mouse unless a click is the point; when clicking, move the cursor with eased paths (the editor can add a
  cursor overlay from your click events instead, so a hidden cursor plus accurate `click` events is fine).
- You may inject CSS from the script to hide **developer-only** panels (simulator controls, demo tools) after using them. Never hide
  the app's own Simulated/Demo labels or safety banners.
- Every clip: a `phase`/`click`/`focus`/`mark` event list with element boxes (`getBoundingClientRect` × 2 for device pixels) and
  `point`s for callout anchors (e.g. the virtual hand's fingertips: get them from the hand3d canvas region; approximate points are
  fine if marked in the label).

## Shot list (ids are fixed; the editor depends on them)
| id | ~len | What must be on screen |
|---|---|---|
| `session-main` | 45 s | Exercise, opening plan: PRESENT (ghost shows "open your hand") → ATTEMPT where the simulated patient opens partway (blue) → ASSIST on the fingers that fall short (orange) → reached (green). Events: phase changes, hand box, fingertip points per finger, the finger meters box |
| `session-resist` | 20 s | Same screen; rigid index via the simulator → resistance → glove releases → the app's safety banner/coach caption ("I feel resistance opening your index, let's stop here."). Events: the resist moment, release, banner box |
| `coach-panel` | 20 s | The coach panel/decision timeline with at least one adjustment and its **Undo**, the highlighted finger on the hand. Use the ai-therapist harness or the seeded replay/TherapyReview; must be real app UI |
| `doctor-history` | 15 s | History: per-finger then vs. now, trend charts, Demo data label visible. Slow scroll |
| `doctor-replay` | 12 s | Session replay of one attempt: vision vs. servo vs. current, phase bands |
| `doctor-summary` | 15 s | Doctor view → click Therapist summary → text appears (real Gemini output, or the stored one) |
| `doctor-export` | 6 s | Export JSON/CSV/print buttons, one click |
| `calibrate` | 8 s (optional) | The calibration wizard in one smooth pass |

## Deliverables
- `capture/*.ts|mjs` + `capture/README.md` (one command re-records everything: `pnpm capture` or similar).
- `public/recordings/<id>.mp4` and `public/recordings/manifest.json` (`simulated: true`, `demoData` set honestly).
  If total size > 150 MB, also commit `<id>.proxy.mp4` at 1920×1080 and tell the coordinator; we may move the 4K ones to LFS.
- `evidence/V1/`: one PNG contact sheet per clip (ffmpeg tile).

## Acceptance
- [ ] All required ids exist, 30 fps, sharp text at 2× zoom, no key or dev panels visible.
- [ ] Manifest validates against the TS type (add a tiny check script) and events line up with what's on screen (spot-check 3).
- [ ] Re-running the capture command reproduces the clips.
