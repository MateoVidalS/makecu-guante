# 04 — Firmware (ESP32-WROOM-32)

> **Superseded in part by `15-open-assist.md` (Nov 7): the glove helps the hand open.** Positions on the wire are tendon pull
> (0 = slack, the safe state; 1 = fingers straight). In `run`, unwinding always moves at `V_RELEASE`; winding at `V_FOLLOW` (follow) or
> `min(v, V_MAX)` (target). `FOLLOW_SLACK = 0.08`. Servo calibration: `min` = slack with a relaxed fist, `max` = straight, never bent back.
> Bench: the opening gate in `firmware/BENCH.md` (watchdog fault ≤ 1005 ms, slack ≤ 1.5 s).

Code: `firmware/` (WP1). PlatformIO, Arduino framework. Protocol and constants: `03-contracts.md §2`. Hardware: `README.md §3`.

## 1. Layout

```
firmware/
  platformio.ini            envs: esp32dev (target), native (host unit tests)
  include/config.h          constants (contracts §2.4) + pin map
  lib/core/                 PURE C++17, no Arduino headers → testable on the host
    protocol.h/.cpp         parse a line → Command; format Telemetry/Event/Info/Err → line
    safety.h/.cpp           SafetyController: states, ramps, limits, overcurrent, watchdog, STOP latch
    calib.h/.cpp            closure ⇄ angle mapping, validation
    ramp.h/.cpp             rate-limited position per servo
  src/main.cpp              Arduino glue: setup, 200 Hz control loop, serial line reader, HAL calls
  src/hal_*.cpp/.h          ServoOut (ESP32Servo), CurrentSensor (Adafruit_INA219), StopButton (ISR), Ring (Adafruit_NeoPixel)
  test/test_native/         Unity tests for lib/core
```
Libraries: `madhephaestus/ESP32Servo`, `adafruit/Adafruit INA219`, `bblanchon/ArduinoJson@^7`, `adafruit/Adafruit NeoPixel`.

## 2. Pins (from README)

Servos: thumb GPIO25, index GPIO26, middle GPIO27, ring GPIO13, pinky GPIO4 (LEDC 50 Hz, 500–2500 µs). NeoPixel data GPIO33 (through the level
shifter + 330 Ω). INA219: SDA 21, SCL 22 (addr 0x40). STOP: GPIO32 `INPUT_PULLUP`, button to GND. Avoid 0, 2, 5, 12, 14, 15.

## 3. Control loop (200 Hz, `main.cpp`)

Each tick, in order:
1. **STOP:** the ISR (falling edge, 20 ms debounce in the loop) sets a volatile flag. Flag set → `safety.stopPressed()` →
   release + `fault` + `evt stop_button`. While the button is held, `release` can't clear the fault (`err fault`); when it's
   released → `evt stop_released`.
2. **Serial:** read the available bytes into a 256-byte line buffer. On `\n` → `protocol::parse` → `safety.handle(cmd, now)`.
   A line longer than 200 bytes is dropped with `err bad_json`. Every valid message feeds the watchdog.
3. **Current:** read the INA219 (`getCurrent_mA`) every tick through a 2-sample median + EMA (α 0.5, ~10 ms) →
   `safety.current(ma, now)`. Above the limit continuously for `OVERCURRENT_MS` → release + `fault` + `evt overcurrent` (with the peak ma).
   INA219 not found at boot → `evt ina_missing`. Without it, `target`/`follow` are refused (`err state`) and only `jog`/`release` work.
4. **Watchdog:** `now − last_msg > WATCHDOG_MS` while in `run`/`calib` → release + `fault` + `evt watchdog`. In `idle` the servos
   are already released; just stay idle (no event spam).
5. **Ramps:** each servo position moves toward its goal at the allowed speed (`V_MAX`, `V_FOLLOW`, `V_RELEASE`, jog) →
   `calib::toAngle` → `ServoOut.write(i, deg)`. Positions are clamped to `[0,1]` and angles to `[HARD_MIN, HARD_MAX]`; this happens **in core, not in the HAL**.
6. **Release detach:** 500 ms after a release completes → `ServoOut.detach(i)` (the servo goes limp). Any new move re-attaches.
7. **Telemetry:** every 20 ms → `tel` line. Events are sent immediately.
8. **Ring:** update at ≤ 30 Hz (see §5).

Serial output never blocks: if `Serial.availableForWrite()` is short, skip that `tel` (never skip events).

## 4. Safety rules (enforced in `SafetyController`, tested natively)

- Never command a position outside `[0,1]` mapped through a valid calib, nor an angle outside `[HARD_MIN, HARD_MAX]`.
- `target` speed = `min(v, V_MAX)`; `v ≤ 0` → `err bad_args`.
- `follow` replaces any active `target`: the goal becomes `max(0, f − FOLLOW_SLACK)`, so in follow mode the servo only takes up slack
  behind the finger and never pulls it.
- Overcurrent, STOP and watchdog all release and latch `fault`; only `release` clears it (and only when STOP isn't held).
- `calib` only in `idle`; `jog` only in `idle`/`calib`.
- A `calib` for a finger invalidates that finger until all three are valid again → `evt calib_ok` once all three are set.
- Boot: servos detached (no twitch), state `idle`, `evt boot` + `info`.
- NVS: **do not persist calib** (the laptop re-sends it on every connect), so a different patient can never inherit a stale range.

## 5. NeoPixel ring (24 px)

Five 4-pixel segments with a 1-pixel gap between them (thumb, index, middle, ring, pinky = 20 px + 4 gaps), each a bar of the
commanded position `a` (0 = 0 px, 1 = 4 px).
Color by state (matches the app's semantics, `11-ux-design.md §3.1`): `idle` dim white · `run`+`follow` blue (`#2F6FEB`) ·
`run`+`target` orange (`#E8890C`, the glove helping) · `calib` amber · `fault` all red, blinking at 2 Hz.
Brightness 20% (the 5 V supply is shared with the servos).

## 6. Native tests (`pio test -e native`)

- Protocol: parse every command type; reject malformed JSON, unknown `t`, bad args (finger index, ranges, `|max−min|<20`);
  format `tel` within 200 bytes; round-trip numbers to 2 decimals.
- Safety: ramp speed respected (target capped at V_MAX even if v=5); clamps; `no_calib` before calib; overcurrent at
  99 ms → no fault, at 101 ms → fault; a spike under 100 ms → no fault; watchdog at 1000 ms in `run`; STOP latch while held;
  `release` clears the fault; follow slack; mirrored calib (min > max); jog limits; `ina_missing` refuses target.
- Timing is injected (`now` passed in), with no real clocks.

## 7. Bench checklist (`firmware/BENCH.md`, for the team with hardware)
1. 5 V verified with the DMM before connecting the servos; supply current limit 1.5 A; common GND.
2. Flash, open a serial monitor at 115200: see `evt boot` + `info`.
3. `{"t":"jog","i":1,"deg":90}` moves the index servo; `release` detaches.
4. Send the 3 `calib`s → `evt calib_ok`; `target` 0.5 → `tel` ramps.
5. Hold the spool by hand → `overcurrent` within ~100 ms.
6. Press STOP while moving → release + `fault`.
7. Pull the USB cable while in `run` → servos release within 1 s.
8. Record the results in `BENCH.md`.

## 8. Web flashing (optional, nice-to-have)
Build artifacts for ESP Web Tools (`esp-web-tools` manifest) so the app's Connect page can offer "Flash firmware" from Chrome.
