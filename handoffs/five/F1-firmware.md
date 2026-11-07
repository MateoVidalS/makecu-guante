# F1 — Firmware for 5 servos
Owns: `firmware/**`.
- Per-servo profiles in `config.h` (thumb: unknown, placeholder; index SG92R; middle MG90S; ring/pinky Smraza S51): nominal idle/moving/stall mA and max speed, documented as "to be measured".
- Overcurrent: total limit default 1500 mA, max 2200 mA; keep the 100 ms rule. Optional per-finger soft limit if a single servo's estimated share is far above its stall profile (document; the total INA219 is the hard rule).
- Pins 25/26/27/13/4; check GPIO 4 and 13 have no boot glitch (detached at boot, keep it); document in `firmware/README.md`.
- NeoPixel ring: 5 segments of 4 px with 1 px gaps (`docs/plan/12 §3.8`).
- `tel` with 5 values ≤ 200 bytes (test). `info.fingers = 5`.
- Native tests for all safety rules with 5 servos; `BENCH.md` rewritten for 5 servos, 2.5 A supply, pins, and a table to record each servo's idle/moving/stall current and the thumb servo's size/torque.
- Brown-out resilience: document the 470–1000 µF capacitor in `firmware/README.md` and `BENCH.md` (with a step that starts all 5 servos together and checks the ESP32 does not reset); on boot after a brown-out reset, the firmware reports `evt boot` with the reset reason (`esp_reset_reason()`), so the app can tell a brown-out from a normal start.
Acceptance: `pio test -e native` and `pio run -e esp32dev` pass; BENCH covers 5 servos.
