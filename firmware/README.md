# Rehab Hub firmware

ESP32-WROOM-32, Arduino-ESP32, PlatformIO. The board owns every motion limit,
fault latch and watchdog. The browser is not a safety layer. No board was flashed
or exercised during development; hardware acceptance belongs to the team using
[BENCH.md](BENCH.md).

## Build and test

From this directory:

```sh
uv tool install platformio
pio pkg install -e esp32dev -e native
pio test -e native
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
| NeoPixel ring data | GPIO33 | 3.3 V to 5 V level shifter, then 330 ohm resistor |
| INA219 SDA | GPIO21 | I2C address 0x40, 400 kHz |
| INA219 SCL | GPIO22 | I2C |
| STOP | GPIO32 | Normally open button to GND; internal pull-up |

Avoid GPIO0, 2, 5, 12, 14 and 15 for actuator signals. Use a laboratory **5 V
supply limited to 1.5 A**. Verify the voltage with a DMM before connecting any
servo. Feed the servo positive rail through the INA219. **Never power servos from
the ESP32 or USB rail.** Share GND between the ESP32, sensor, servos, ring and
supply. Ring brightness is capped at 20% because it shares that supply. Use the
specified micro servos; substituting higher-torque servos changes the hazard.

## Team-only flashing and serial monitor

First complete the electrical checks in BENCH.md with the glove off any person.
These commands are for the hardware team; the coding worker does not run them:

```sh
pio run -e esp32dev -t upload --upload-port /dev/your-board
pio device monitor -b 115200 --port /dev/your-board --filter send_on_enter
```

Choose the actual port locally; reset the board after opening the monitor to see
`evt boot` and `info`. Lines are compact JSON, at most 200 bytes before the LF;
CRLF is accepted. Finger order is always thumb, index, middle. A partial or
oversized line never feeds the watchdog. Unknown fields are ignored. Malformed
JSON, non-finite numbers and invalid arguments cannot command motion.

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
{"t":"target","f":[0.5,0.5,0.5],"v":0.5}
{"t":"ping"}
{"t":"release"}
```

Mirrored ranges are supported. A jog must stay within 5–175 degrees, is limited
to 60 degrees/second and is allowed only in idle/calibration. Send `release`
before sending calibration ranges. Receiving the third valid range emits
`calib_ok`. Starting a new calibration batch invalidates the old batch, requiring
all three ranges again. Calibration is never stored in NVS.

## Safety behavior

- Boot leaves PWM detached and signal pins low. No remembered calibration or
  motion is restored. The initial commanded position of a newly attached,
  calibrated servo is its calibrated open angle. An uncalibrated jog starts from
  the last commanded angle (90 degrees on boot), without position feedback.
- Target closure is clamped to 0–1 and speed to at most 1 range/second. Follow
  replaces target, uses 1.5 ranges/second and sets goals to
  `clamp(vision - 0.05, 0, 1)`. The output is commanded position, not measured
  position; neither tracking error nor tendon force is directly measured.
- All calibrated release paths unwind to the open angle at 3 ranges/second,
  then wait 500 ms **after reaching open** before detaching PWM. This includes
  faults. A pre-calibration jog has no known safe unwind direction, so release
  detaches that channel immediately. A new accepted move reattaches PWM.
- Current is the total servo current. A two-sample median (the midpoint for two
  samples) followed by an alpha-0.5 EMA filters it. Continuous filtered current
  above the clamped 100–1400 mA threshold for 100 ms faults and reports its peak.
  The default limit is 900 mA. Filtering adds roughly 10 ms to detection at the
  physical sensor; the 100 ms timer starts at the filtered threshold crossing.
- STOP is latched on the first falling edge, sampled before serial commands.
  Release is debounced for 20 ms; it emits `stop_released` but leaves the fault
  latched. Only an explicit `release` with STOP no longer held clears the fault.
  Under TX backpressure, button release notification/re-arming waits for queue
  space; presses still latch immediately. Motion commands cannot clear faults.
- A valid command refreshes the watchdog, including a command refused by state
  rules. Invalid JSON/arguments do not. At 1000 ms without a valid command in
  run/calibration, the board faults and starts release. Idle does not emit
  watchdog events. Timer arithmetic tolerates `millis()` wraparound.
- Missing INA219 emits `ina_missing` and refuses target/follow with `err state`.
  Jog and release remain available for setup. A runtime sensor read failure
  inhibits assistance until reset and releases/faults any active motion.

The ring shows three 8-pixel position bars: dim white in idle, blue in follow,
orange in target and amber in calibration. Fault overrides all pixels with a
2 Hz red blink. At zero calibrated closure a segment is dark, including before
calibration.

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
codec. LEDC drivers are prepared without connecting PWM to servo pins. Wire,
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
and three PWM writes 0.1 ms, formatting/queue/UART copies 0.2 ms, RMT preparation
0.15 ms: **1.8 ms**. Normal I2C bus time is about 0.21 ms (400 kHz), rather than
the timeout budget. This is an engineering estimate, not a measurement or a
hard real-time guarantee against arbitrary interrupt/RTOS delays. The team must
record the actual maximum under traffic, faults and ring updates in BENCH.md.
For logic-analyzer timing, compile with `-DREHAB_TIMING_PIN=4` added to the
ESP32 build flags; a high pulse brackets the entire control tick. Keep GPIO4
unconnected except to the analyzer, and retain all existing build flags.
