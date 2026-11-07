# WP1 — ESP32 firmware + native safety tests + bench guide

**Goal:** firmware for the ESP32-WROOM-32 that drives 3 servos through tendons, reads the INA219, honors STOP, and speaks the JSON-lines
protocol, with **every safety rule enforced on the board** and proven by host-side unit tests.

**Read:** `AGENTS.md`, `README.md §3` (hardware, pins, power, safety; it's in Spanish), **`docs/plan/03-contracts.md §2` (protocol)**, **`docs/plan/04-firmware.md` (all)**, `docs/plan/09-testing.md`.

**You own:** `firmware/**` (except `lib/core/protocol.h`, which is frozen: implement it in `protocol.cpp`, and request changes in the PR).

## Deliverables
- [ ] `platformio.ini` with the `esp32dev` and `native` envs and the lib deps from `04-firmware.md §1`. Install PlatformIO (`pipx install platformio` or `uv tool install platformio`) for your runs.
- [ ] `lib/core`: `protocol.cpp`, `safety.{h,cpp}`, `ramp.{h,cpp}`, `calib.{h,cpp}`: pure C++17, no Arduino includes, time injected.
- [ ] `src/main.cpp` + HAL files: the 200 Hz loop exactly as in `04-firmware.md §3`, STOP ISR + debounce, INA219 filtering, the `ina_missing` path,
      release-then-detach, non-blocking telemetry, the NeoPixel ring per §5.
- [ ] `test/test_native`: every case listed in `04-firmware.md §6`, **plus** a test that parses every line of `contracts/fixtures/serial_lines.txt`
      and matches `serial_lines.expected.json`.
- [ ] `firmware/README.md` (build, flash, serial monitor, pin table, power warnings) and `firmware/BENCH.md` (the §7 checklist with a results table).
- [ ] Optional: an ESP Web Tools manifest (`04-firmware.md §8`).

## Acceptance criteria
- [ ] `pio run -e esp32dev` builds with no warnings in `lib/core`; `pio test -e native` passes.
- [ ] The tests prove: speed cap, clamps, no_calib, overcurrent at 100 ms ± 1 tick, spike rejection, watchdog 1 s, STOP latch, release clears the fault,
      fault rejects moves, jog only in idle/calib, follow slack, mirrored calib, ina_missing refusal.
- [ ] A worst-case loop iteration (parse + safety + telemetry) is estimated at < 2 ms (the reasoning goes in the PR).
- [ ] No dynamic allocation in the control loop (ArduinoJson with a static document).
- [ ] **You do not flash a board or run hardware.** The team runs `BENCH.md`.
