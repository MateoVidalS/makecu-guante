# F2 — Glove link + simulator for 5 fingers
Owns: `frontend/src/glove/**`.
- Codec/clients reject `info.fingers ≠ 5` with a clear error surfaced through the connection state.
- `simFirmware`: 5 servos, the new limits, per-servo profiles (same table as F1, mirrored in TS) and a **power model**: total current = sum of per-servo currents; the supply saturates at 2.5 A (servos stall/brown out) — model it so tests can verify the engine never gets there.
- Patient model: 5 fingers; presets mild/moderate/severe with ring/pinky typically weaker; "rigid" can target any finger.
- SimVision: 5 fingers from the world (ring/pinky no longer copy the middle finger).
- Conformance tests for 5 fingers; a test that 5 simultaneous stalls exceed 2.2 A (so the engine stagger in F3 is meaningful).
