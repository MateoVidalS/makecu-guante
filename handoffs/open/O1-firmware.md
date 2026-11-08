# O1 — Firmware for the opening glove (owns `firmware/**`)

Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` §1–§3 and §7. Safety-critical: the coordinator reads every line.

## Build
1. **Asymmetric ramps** (`lib/core/safety.cpp`, `tick()`): in `State::Run` (both `Mode::Follow` and `Mode::Target`), per finger, compute the
   current pull `pos = calib::toClosure(angle(i), c)` (keep the existing helper; it maps angle → normalized 0–1, which is now pull) and
   `rate = goals_[i] < pos ? config::V_RELEASE : speed_`. Unwinding is always safe; winding stays capped (`V_FOLLOW` in follow,
   `min(v, V_MAX)` in target). Jog and release are unchanged. No catch-up jumps (keep the one-period cap).
2. **`config.h`:** `FOLLOW_SLACK = 0.08F`. Comment the constants in pull terms (`V_FOLLOW`/`V_MAX` are winding caps, `V_RELEASE` also
   governs every unwinding in run).
3. **Naming, no behavior change:** where code or comments say "open" for pull 0, say "slack": `release()` comments, the `opened` flag in
   `tick()` → `slack`, the first-attach comment in `handle()` ("A detached actuator has no feedback; the first commanded position is
   slack"), `calib.h/.cpp` doc comments (`toClosure` returns normalized pull; consider adding `toPull`/`fromPull` aliases and using them,
   keeping the old names for the tests or migrating the tests). `lib/core/protocol.h` is frozen except for its comments (already updated).
4. **Native tests** (`test/test_native/test_main.cpp`), injected time as today:
   - follow: unwinding from pull 0.9 to 0.2 runs at 3.0/s; winding from 0.2 to 0.9 runs at 1.5/s; goal = `max(0, f − 0.08)`.
   - target with `v = 0.2`: unwinding still runs at 3.0/s; winding at 0.2/s; `v = 5` winds at `V_MAX`.
   - a fast "fist" (follow goal dropping every 20 ms) is tracked within one tick of `V_RELEASE` and never ends above the goal.
   - follow → target → follow and target → release transitions never jump.
   - all existing safety tests still pass (overcurrent 99/101 ms, watchdog, STOP latch, mirrored calib, jog limits, `ina_missing`).
5. **`firmware/README.md`:** a "Direction" section: pull semantics, 0 = slack is the safe state, never swap `min`/`max` to change direction
   (explain why: release/fault/first-attach go to 0), and the calibration procedure (slack = thread just taut with a relaxed full fist;
   open = finger straight, never bent back; ≥ 20° apart).
6. **`firmware/BENCH.md`:** keep the existing sections, update wording to pull, and add an **"Opening glove gate"** section, in order,
   each with a results table: (1) dorsal routing: winding opens each finger on an empty glove; (2) calibration per finger;
   (3) **extension strength gate**: a helper resists opening one finger with moderate effort, the servo must open it and hold 2 s under
   the limit; record peak and sustained mA; failing = stronger servo or bigger spool/lever before any patient use; (4) all five held open
   on a relaxed hand for 2 s, total current under the limit (record); (5) STOP while held open → slack within 0.5 s; (6) a fast fist during
   `follow` does not trip overcurrent; (7) watchdog (pull USB) while held open → slack within 1 s.
7. The NeoPixel ring logic does not change (it already draws `a`); update its comment/README line: the bar is how much the glove is opening.

## Acceptance
- `pio test -e native` and `pio run -e esp32dev` pass (`make fw-build`), `make test` green.
- Diff only under `firmware/**`.
- The PR lists every changed safety behavior (only the asymmetric unwinding and the slack value) and how each is tested.
