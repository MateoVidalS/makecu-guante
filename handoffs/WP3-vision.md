# WP3 — Vision: MediaPipe → per-finger closure

**Goal:** a `VisionSource` that turns the webcam into smoothed, calibrated per-finger closure, joint angles, pinch ratio and confidence, fast enough that
the virtual hand lags < 150 ms behind the real hand.

**Read:** `AGENTS.md`, **`docs/plan/03-contracts.md §3` (vision, calibration)**, **`docs/plan/05-vision-and-glove-link.md` Part B**,
`docs/plan/08-frontend.md §4` (Calibrate step 2), `docs/plan/11-ux-design.md §5.3` (camera overlay design).

**You own:** `frontend/src/vision/**`, `frontend/public/models/**`, new fixture files `contracts/fixtures/landmarks_*.json`, and their tests.

## Deliverables
- [ ] Download `hand_landmarker.task` into `public/models/` (document the source URL and version in `public/models/README.md`).
- [ ] `cameraVision.ts` (`CameraVision implements VisionSource`): device picker support, `requestVideoFrameCallback` loop, GPU → CPU fallback,
      handedness selection + mirror toggle, frame skipping, latency stats (p50/p95, exposed as `stats()`).
- [ ] `flex.ts` (joint angles, flex sums, normalization, pinch), `oneEuro.ts`, `calibration.ts` (`captureStats`), `confidence.ts`.
- [ ] `CameraOverlay.tsx` (video + landmarks canvas + per-finger readout + confidence badge) styled per `11-ux-design.md §5.3`.
- [ ] `VisionProvider` / `useVision()` (replacing the WP0 stub): switching between camera and sim (it obtains the SimVision from `src/glove/sim` through the
      exported factory; until WP2 merges, keep the WP0 stub).
- [ ] Landmark fixtures recorded from a real webcam if available (open, full fist, hook, tabletop, pinch; 30 frames each). If you can't record, generate
      them synthetically from a hand model and **say so in the PR**.
- [ ] Tests per `05-vision-and-glove-link.md §B6`.

## Acceptance criteria
- [ ] On the fixtures, closure ordering is correct: open < tabletop < hook < straight fist < full fist for the index finger, and the pinch ratio is lowest on the pinch fixture.
- [ ] One Euro: a step response settles within 200 ms with no overshoot > 5%.
- [ ] Inference p95 ≤ 25 ms on the dev laptop (logged); missing GPU falls back to CPU without crashing.
- [ ] Low confidence and no hand → `detected=false`, `closure=null`, confidence decays to 0 within 200 ms.
