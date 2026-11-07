# F7 — Live UI for 5 fingers + palm-down view
Owns: pages Home/Setup/Calibrate/Exercise/Evaluate, `components/common/**`, `components/metrics/**`, `hand3d/**`, and in `frontend/src/styles/tokens*` only the new `--finger-ring` / `--finger-pinky` tokens (light + dark, contrast-checked).
- Setup: telemetry ×5, a **camera placement guide** (small diagram: front, thumb side, diagonal, 30–40 cm, above the hand), the **glove-detection check** using F4's stats API, the error for `info.fingers ≠ 5`.
- Calibrate: 5 servos (ring/pinky steps), power warning copy, camera calibration with the glove closing all 5.
- Exercise: meters and attempt feedback for 5 fingers; must still fit 1280×720 with no scroll.
- Evaluate: finger subset selector, 10-sweep progress.
- `hand3d`: **palm-down view** from the camera's diagonal angle, mirrored for the left hand; all 5 fingers tinted by state.
- Screenshots 1280×720 + 1440×900 in `docs/design/screenshots/five-fingers-live/`.
