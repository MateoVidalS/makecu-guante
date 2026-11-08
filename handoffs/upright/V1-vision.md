# V1 — Vision for the upright hand (owns `frontend/src/vision/**`)
- Default view `front_upright` (selfie, no rotation). Keep the configured affected hand authoritative, but use MediaPipe's selfie
  handedness as a cross-check (report a mismatch in the robustness stats instead of silently flipping).
- MCP flexion measured against the **palm plane** (landmarks 5, 9, 13, 17 + palm normal), robust to wrist tilt; PIP/DIP unchanged.
  Fingers curl toward the lens, so use world landmarks only.
- Robustness stats: add a **backlight / low-light** metric (from the video frame luminance of the hand region vs background, or mean
  frame luminance) with a guidance string for Setup.
- Synthetic `front_upright_*` fixtures (open, hook, tabletop, straight fist, full fist, pinch) from the existing generator, closure
  ordering tests, and keep the palm-down fixtures for the legacy view.
- `VisionSource.start({ view })` honored by CameraVision and SimVision.
