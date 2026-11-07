# U1 — Helper flows: calibration truth, Setup layout, consistent safety strips

Read `handoffs/ux/COMMON.md` first. Findings 1, 5, 6 in `docs/plan/14-ux-fixes.md`.

**You own:** `frontend/src/pages/{Home,Setup,Calibrate,Evaluate}/**`, `frontend/src/runtime/calibrationValidation.ts` (+ its test), and the
new directory `frontend/src/components/calibration/**`.
**Do not edit:** `pages/Exercise/**`, `pages/Doctor/**`, the rest of `components/**`, the rest of `runtime/**`, `voice/**`, `App.tsx`
(the A-wave is working there). U4 will use your banner on the Exercise plan page later.

## 1. One source of truth for "is the calibration usable?" (P0)
Today an out-of-range calibration ("Camera range would report over 100% for your index") blocks Start practice, while Home says
"Calibration: Saved" and Evaluate says "Calibration: Ready".
- Expose one selector/hook from `calibrationValidation.ts`, e.g. `useCalibrationStatus(): { state: 'missing' | 'invalid' | 'ok';
  issues: { finger, step: 'glove' | 'camera', message }[] }`. Every page reads it; nothing re-derives "calibrated" on its own.
- Home readiness row: `invalid` shows a caution dot + "Calibration: Needs a quick redo" + a "Fix" link. "Start today's practice" with an
  invalid calibration routes to the right Calibrate step with a one-line explanation (same pattern as the missing-calibration route).
- Evaluate "Before you start": the same status row and link.
- Build `components/calibration/CalibrationIssueBanner.tsx`: `Banner tone="caution"`, icon, one plain sentence ("Your index range needs
  a quick redo."), and one action button "Redo camera range" (or "Redo glove range") that deep-links to that Calibrate step
  (e.g. `/calibrate?step=camera&finger=index`). Use it on Home and Calibrate. Export it for U4.
- Calibrate honours the deep link (opens that step and finger) and, on Review, flags the bad values with the same wording.
- Calibrate must not open on "Thumb · Not set" when a valid saved calibration exists: start on Review with "Redo" links instead.

## 2. Setup layout (P1)
- Glove and camera are no longer two unequal columns. Recommended: one column, max ~760 px, in this order: Glove card (status headline,
  Connect/Reconnect, Release glove) → Camera card (status, device, live overlay with per-finger %) → glove-detection check →
  camera placement diagram collapsed under "How to place the camera" once the camera sees the hand → Advanced (collapsed).
- "Continue to calibration" is visible without scrolling at 1280×720 once both are ready (sticky footer bar or placed under the status
  summary at the top). One primary per view.
- Keep the overlay large enough to judge the hand (≥ 480 px wide at 1280).

## 3. Consistent states and copy (P1)
- The relaxed-hand/STOP strip is the same component everywhere: `Banner tone="warning"` with "Release glove now" as its action, in Calibrate
  and Evaluate.
- Evaluate's strip reads once: title "Keep your hand relaxed." + "Press STOP anytime. Stop if it hurts." (no repeated sentence).
- Calibrate shows **one** simulator shortcut (only in sim mode). Remove the second path ("Calibrate simulator" vs "Use simulated
  glove ranges"); keep whichever one also fills the camera step correctly and say which in the PR.
- The disabled "Next finger" explains why (e.g. "Set open and closed first").

## Acceptance criteria
- [ ] With an invalid calibration: Home, Evaluate and Calibrate all show the same caution status, and one click reaches the right step. Unit test on the selector + a component test per page.
- [ ] With a valid calibration: Calibrate opens on Review; nothing says "Not set".
- [ ] Setup at 1280×720: both statuses and "Continue to calibration" are visible above the fold once ready (browser test asserting the button is in the viewport).
- [ ] Calibrate and Evaluate strips render the same component and tone; Evaluate copy has no duplicate sentence.
- [ ] Before/after screenshots in `docs/design/screenshots/ux-u1/`. `make test` + `make e2e` green.
