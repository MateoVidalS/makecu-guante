# memo firmware

ESP32-WROOM-32, Arduino-ESP32, PlatformIO. The board owns every motion limit,
fault latch and watchdog. The browser is not a safety layer. No board was flashed
or exercised during development; hardware acceptance belongs to the team using
[BENCH.md](BENCH.md).

## Direction

The threads run over the back of the fingers: winding a spool opens its finger.
Every glove-side value (`target.f`, `follow.f`, `tel.a`, `tel.tg`) is normalized
**tendon pull**, not finger closure: **0 = slack = the safe state**, at calibrated
`min`; 1 = full calibrated pull, at `max`, with the finger straight. Vision and
poses use closure in the opposite direction. The host uses the contract's
`pullFromClosure` / `closureFromPull` functions for that conversion; firmware
only maps pull to servo angle. The legacy `calib::toClosure` / `clampClosure`
helper names also mean pull here.

**Never swap `min` and `max` to change the assist direction.** Release, faults,
watchdog and first attach all command pull 0. That endpoint must leave the tendon
slack, rather than yank the finger open at the release rate. `min > max` is valid
for a physically mirrored servo mount only when `min` still means slack and
`max` means full pull.

Recalibrate every finger for dorsal routing; do not reuse a closing-glove range:

1. With a helper and the low setup current limit, make a relaxed full fist. Jog
   until the thread is just taut without extending the finger; record **Slack**
   as `min` (pull 0).
2. Jog slowly until the finger is straight and neutral, **never bent back**;
   record **Open** as `max` (pull 1). Stop before hyperextension or discomfort.
3. Both angles must be within 5–175 degrees and at least **20 degrees apart**.
   Send `release` before the five `calib` commands. Recheck that release pays out
   the thread to slack on every finger.

The hardware team completes the opening glove gate in BENCH.md before patient
use; these directions do not replace that gate.

## Build and test

From this directory:

```sh
uv tool install platformio
pio pkg install -e esp32dev -e native
pio test -e native
pio test -e native-sanitized
pio run -e esp32dev
```

The native environment is pure C++17 with Unity and `-Wall -Wextra -Werror`.
Time is injected; tests never open a serial port. Shared serial fixtures are read
from `../contracts/fixtures/serial_lines.txt` and compared with the accompanying
expectations, including device messages reconstructed through the encoders. Only
that test skips if WP0 has not supplied the file; inline protocol vectors always
run. To check formatting after installing `clang-format`:

```sh
rg --files include lib/core src test -g '*.h' -g '*.cpp' | xargs clang-format --dry-run --Werror
```

Pinned dependencies: Espressif32 platform 6.12.0 (Arduino-ESP32 2.0.17),
ESP32Servo 1.2.1 (compatible with that Arduino core), ArduinoJson 7.4.2,
Adafruit INA219 1.2.3 and Adafruit NeoPixel 1.15.2. BusIO is an INA219 transitive
dependency. Updating the platform or libraries requires repeating native tests,
the ESP32 build, and the hardware checklist, particularly the allocation audit.

## Pin and power connections

| Function | ESP32 pin | Connection |
| --- | --- | --- |
| Thumb servo signal | GPIO25 | 50 Hz PWM, 500–2500 us pulse mapping |
| Index servo signal | GPIO26 | Same |
| Middle servo signal | GPIO27 | Same |
| Ring servo signal | GPIO13 | Same; remains detached at boot |
| Pinky servo signal | GPIO4 | Same; remains detached at boot |
| NeoPixel ring data | GPIO33 | 3.3 V to 5 V level shifter, then 330 ohm resistor |
| INA219 SDA | GPIO21 | I2C address 0x40, 400 kHz |
| INA219 SCL | GPIO22 | I2C |
| STOP | GPIO32 | Normally open button to GND; internal pull-up |

Avoid GPIO0, 2, 5, 12, 14 and 15 for actuator signals. Use a laboratory **5 V
supply limited to 2.5 A**. Verify the voltage with a DMM before connecting any
servo. Feed the servo positive rail through the INA219. **Never power servos from
the ESP32 or USB rail.** Share GND between the ESP32, sensor, servos, ring and
supply. Ring brightness is capped at 20% because it shares that supply. Use the
specified micro servos; substituting higher-torque servos changes the hazard.
Fit a **470–1000 µF bulk capacitor across 5 V/GND on the servo rail**, close to
the servo connectors, with correct polarity and a voltage rating above 5 V.
It reduces the startup voltage dip when several servos start together; it does
not replace the supply current limit or firmware cut-off.

`ServoOut::begin()` loads LOW before enabling each signal output and never
attaches PWM. GPIO4 and GPIO13 follow the same detached boot path as the other
three signals. This code inspection cannot certify ROM/reset-time electrical
behavior: the team must scope both pins across power-on, reset, brown-out and
STOP-held boot, with servo power present, and confirm no pulse or twitch using
BENCH.md. Do not use GPIO4 as a timing probe: it now commands the pinky.
Optional timing instrumentation is compile-time restricted to unused WROOM-32
outputs 16/17/18/19/23; GPIO18 is the documented probe pin.

## Team-only flashing and serial monitor

First complete the electrical checks in BENCH.md with the glove off any person.
These commands are for the hardware team; the coding worker does not run them:

```sh
pio run -e esp32dev -t upload --upload-port /dev/your-board
pio device monitor -b 115200 --port /dev/your-board --filter send_on_enter
```

Choose the actual port locally; reset the board after opening the monitor to see
`evt boot` and `info`. Lines are compact JSON, at most 200 bytes before the LF;
CRLF is accepted. Finger order is always `[thumb, index, middle, ring, pinky]`
(indices 0–4).
`info.fingers` is always 5, and both telemetry arrays contain exactly five values
rounded to two decimals within the 200-byte line budget. A partial or
oversized line never feeds the watchdog. Unknown fields are ignored. Malformed
JSON, non-finite numbers and invalid arguments cannot command motion.
The bounded decoder accepts up to eight nesting levels. Deeper JSON is rejected
with `bad_json`. SDK diagnostic logs are disabled to keep UART output non-blocking.

Use the app's keepalive, or send a valid `ping` every 300 ms during bench motion.
A manual monitor without keepalives is expected to trigger the watchdog after
one second. Commands to establish ranges (example values only, never a patient's
calibration):

```json
{"t":"hello"}
{"t":"jog","i":1,"deg":90}
{"t":"release"}
{"t":"calib","i":0,"min":20,"max":150}
{"t":"calib","i":1,"min":20,"max":150}
{"t":"calib","i":2,"min":150,"max":20}
{"t":"calib","i":3,"min":20,"max":150}
{"t":"calib","i":4,"min":150,"max":20}
{"t":"target","f":[0.5,0.5,0.5,0.5,0.5],"v":0.5}
{"t":"ping"}
{"t":"release"}
```

Mirrored ranges are supported. A jog must stay within 5–175 degrees, is limited
to 60 degrees/second and is allowed only in idle/calibration. Send `release`
before sending calibration ranges. Receiving the fifth valid range emits
`calib_ok`. Starting a new calibration batch invalidates the old batch, requiring
all five ranges again. Calibration is never stored in NVS.
Rejected calibration arguments invalidate that finger's existing range in idle.
After a jog outside a calibrated range, assistance waits for release to unwind
back into the range, preserving the ramp speed cap on the transition.

## How the app drives the board

The browser (`frontend/src/glove/webSerialGlove.ts`, runtime and engine) is the
only host. On every connect it sends `hello`, `release`, the five `calib`
ranges and `limit`. During an attempt it streams `follow` at up to 30 Hz using
vision converted to pull (the servos only take up slack). Opening assistance
uses slow `target` winding (0.20 range/s by default; 0.30 only with consent),
with fingers starting 150 ms apart. Held fingers' goals pay out when the patient
closes. Every run-mode decrease in pull unwinds at 3.0 ranges/s, regardless of
the requested winding speed.
The calibration wizard sets `limit 400`, jogs one finger at a time, sends
`release`, then the ranges. The client pings only after 300 ms without any
other write, so follow lines alone keep the watchdog fed. Native tests replay
these command patterns (`app_*` in `test/test_native/test_main.cpp`): every
command is accepted and no safety event fires on a healthy run, while 1005 ms
of silence still trips the watchdog.

Link budget: a typical five-finger `tel` line is about 123 bytes at 50 Hz, roughly 53%
of 115200 baud; host lines travel on the other UART direction.

## Servo profiles and power limits

`include/config.h` defines `SERVO_PROFILES` in wire order: unidentified thumb,
TowerPro SG92R index, MG90S middle, Smraza S51 ring and pinky. Every nominal
idle/moving/stall current (mA) and maximum unloaded speed (degrees/second) is a
**placeholder, to be measured** at 5 V. In particular the thumb's model, housing
size and torque are unknown. Record measurements in BENCH.md before replacing
these estimates. They are descriptive estimates, not measured force or allowed
motion speeds; normalized ramp caps below remain authoritative.

Only aggregate current is measured. No per-finger soft current trip is enabled:
there is no reliable way to infer one servo's share from a single INA219 during
simultaneous motion. The total-current cut-off remains the hard rule even if a
profile's estimated stall current would suggest otherwise. Five simultaneous
stalls can exceed the supply; normal assist is staggered by the app, and the
firmware still enforces its own total limit if all five are commanded together.
**Known limitation (team decision):** one stalled micro servo draws roughly
650–800 mA (estimated), below the 1500 mA default. A single rigid finger is
therefore stopped by the app's resistance detection (camera + current), by the
micro servo's limited torque, and by the supply's current limit, not by this
board's cut-off. Lowering the default after bench measurement narrows the gap.

The default threshold is **1500 mA**, clamped to **100–2200 mA**, below the 2.5 A
supply limit, with the existing continuous **100 ms** trip rule. Per-build flags
`-DREHAB_LIMIT_DEFAULT_MA=...` and `-DREHAB_LIMIT_MAX_MA=...` may lower these
settings; compile-time validation requires `100 <= default <= max <= 2200`.
Preserve all existing PlatformIO build flags when adding overrides.

## Reset diagnosis

Each physical boot emits an additive field on the existing boot event, using
`esp_reset_reason()` from the pinned ESP32 SDK:

```json
{"t":"evt","e":"boot","reset_reason":9}
```

`reset_reason` is the numeric `esp_reset_reason_t`: 1 = power-on, 3 = software
reset, 9 = brown-out (0 = unknown; other reasons are preserved as their numeric
codes). This allows an app to distinguish brown-out from an ordinary start.
The field is emitted through the same bounded event queue before `info`; no
calibration or motion is restored, including after brown-out. Existing clients
can ignore the additive field. The frozen `Event` struct and shared fixtures
are unchanged; the PR requests that the coordinator document/type this optional
field in the contracts so the app can expose it.

## Safety behavior

- Boot leaves PWM detached and signal pins low. No remembered calibration or
  motion is restored. The initial commanded position of a newly attached,
  calibrated servo is its calibrated slack angle. An uncalibrated jog starts from
  the last commanded angle (90 degrees on boot), without position feedback.
- Target pull is clamped to 0–1 and winding speed to at most 1 range/second.
  Follow replaces target, winds at up to 1.5 ranges/second and sets goals to
  `clamp(f - 0.08, 0, 1)`, where `f` is vision converted to pull by the host.
  Both run modes unwind at 3 ranges/second whenever a goal is below the current
  pull, even for a slow target. Each ramp update is capped to one 5 ms period;
  missed ticks and mode changes never cause a catch-up jump. The output is
  commanded position, not measured position; neither tracking error nor tendon
  force is directly measured.
- All calibrated release paths unwind to the slack angle at 3 ranges/second,
  then wait 500 ms **after reaching slack** before detaching PWM. This includes
  faults. A pre-calibration jog has no known safe unwind direction, so release
  detaches that channel immediately. A new accepted move reattaches PWM.
- Current is the total servo current. A two-sample median (the midpoint for two
  samples) followed by an alpha-0.5 EMA filters it. Continuous filtered current
  above the clamped 100–2200 mA threshold for 100 ms faults and reports its peak.
  The default limit is 1500 mA. Filtering adds roughly 10 ms to detection at the
  physical sensor; the 100 ms timer starts at the filtered threshold crossing.
- STOP is latched on the first falling edge, sampled before serial commands.
  Release is debounced for 20 ms; it emits `stop_released` but leaves the fault
  latched. Only an explicit `release` with STOP no longer held clears the fault.
  Under TX backpressure, button release notification/re-arming waits for queue
  space; presses still latch immediately. Motion commands cannot clear faults.
- A valid command refreshes the watchdog, including a command refused by state
  rules. Invalid JSON/arguments do not. After strictly more than 1000 ms without
  a valid command in run/calibration, the board faults and starts release
  (1005 ms on 5 ms ticks). Idle does not emit
  watchdog events. Timer arithmetic tolerates `millis()` wraparound.
- Missing INA219 emits `ina_missing` and refuses target/follow with `err state`.
  Jog and release remain available for setup. A runtime sensor read failure
  inhibits assistance until reset and releases/faults any active motion.

The 24-pixel ring shows five 4-pixel pull bars (how much the glove is opening
each finger) in wire order: thumb 0–3, index 5–8, middle 10–13, ring 15–18,
pinky 20–23. Pixels 4/9/14/19 are dark
1-pixel gaps (no trailing gap). Bars are dim white in idle, blue in follow,
orange in target and amber in calibration. Fault overrides **all 24 pixels**,
including gaps, with a 2 Hz red blink. At zero calibrated pull (slack) a segment
is dark, including before calibration.

## Bounded loop and allocation audit

Each 5 ms tick handles STOP, serial, current, watchdog, ramps, release detach,
telemetry and the ring in that order. Missed ticks do not cause catch-up jumps.
Serial work is bounded to 64 received bytes and one completed command per tick.
Replies/events use a fixed 16-line queue, with four slots reserved for safety;
command parsing pauses before consuming those slots. STOP cannot re-arm while
notifications lack space. UART writes consume only advertised free capacity;
telemetry is skipped when there is insufficient room. No UART flush or print
wait is used. At 115200 baud a normal 200-byte input takes about 17.4 ms to
arrive; a 64-byte/tick reader keeps pace and the processing delay is below 20 ms
without an existing backlog. Keep command traffic within the link capacity.

Core storage, line buffers and the TX queue are fixed. ArduinoJson 7 uses an
8 KiB static arena through its allocator API; no heap allocator is used by the
codec. The fixed decimal writer also avoids float `printf`/`dtoa` heap paths.
LEDC drivers are prepared without connecting PWM to servo pins. ESP32Servo
serves four channels per LEDC timer, so the five servos reserve two timers
(`lib/core/pwm_plan.h`); with one, the fifth attach would fail silently. Wire,
UART and the ring allocate only during setup. The ring uses Adafruit's pixel
buffer and a persistent asynchronous RMT driver with static transmission items;
calling NeoPixel `show()` each frame would allocate on this Arduino core.

Adafruit configures the INA219 at boot with its 32 V / 2 A calibration. During
control, a static IDF I2C command repeats its 4096 calibration value and reads
the signed CURRENT register with the identical 0.1 mA/LSB scaling. Combining
these operations imposes one 1 ms transaction deadline; the library's
`getCurrent_mA()` would otherwise use separate deadlines. Any bus error fails
closed. This bus has one owner after setup. No driver is reinstalled in a tick.

Budget estimate at 240 MHz: strict decode of 200 bytes and fixed-arena parsing
0.25 ms, current transaction at most 1 ms plus about 0.1 ms API overhead, safety
and five PWM writes 0.1 ms, formatting/queue/UART copies 0.2 ms, RMT preparation
0.15 ms: **1.8 ms**. Normal I2C bus time is about 0.21 ms (400 kHz), rather than
the timeout budget. This is an engineering estimate, not a measurement or a
hard real-time guarantee against arbitrary interrupt/RTOS delays. The team must
record the actual maximum under traffic, faults and ring updates in BENCH.md.
For logic-analyzer timing, compile with `-DREHAB_TIMING_PIN=18` added to the
ESP32 build flags; a high pulse brackets the entire control tick. Keep GPIO18
unconnected except to the analyzer, and retain all existing build flags.
