# F4 — Vision for the real posture and glove
Owns: `frontend/src/vision/**`.
- Palm-down hand, camera in front on the thumb side, diagonal, 30–40 cm, above the hand (`12 §1 H8–H9`). Use the configured affected hand; ignore MediaPipe handedness when one hand is visible.
- Robustness stats API for Setup: detection rate over the last 5 s, mean confidence, per-finger visibility; thresholds + guidance strings.
- Calibration capture for 5 fingers (the glove closes all 5).
- Fixtures: synthetic palm-down diagonal-view landmarks for each pose (clearly marked synthetic) + a recorder helper so the team can record real ones with `make dev-camera`.
- Keep the joint smoothing from the jitter fix; tests for closure ordering in the new view.
