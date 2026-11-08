# Five-servo firmware bench acceptance — hardware team only

Status: **NOT RUN**. Host tests and the ESP32 build do not verify electrical or
mechanical behavior. These checks require the team's ESP32-WROOM-32, five micro
servos, INA219, STOP button, 24-pixel ring and a 5 V / 2.5 A laboratory supply.
Never run fault/stall tests on a person. Start with tendons disconnected, then
use a fixture or empty glove. Cut supply power if motion, current or wiring
differs from expectations. Do not copy example angles into patient calibration.

## Record before starting

| Field | Value |
| --- | --- |
| Operator / date | Pending |
| Board / wiring revision | Pending |
| Firmware commit / toolchain / build overrides | Pending |
| Supply / current limit / DMM / analyzer | Pending / 2.5 A / Pending / Pending |
| INA219 / shunt / current accuracy check | Pending |
| Servo rail bulk capacitor / voltage rating / polarity | Pending (470–1000 µF required) |
| Spool radius / fixture or empty glove | Pending |
| Serial host / keepalive interval | Pending / 300 ms |

Finger indices and wiring are fixed:

| Index | Finger | Signal | Servo |
| --- | --- | --- | --- |
| 0 | Thumb | GPIO25 | Unknown; identify and measure housing/torque |
| 1 | Index | GPIO26 | TowerPro SG92R |
| 2 | Middle | GPIO27 | MG90S |
| 3 | Ring | GPIO13 | Smraza S51 |
| 4 | Pinky | GPIO4 | Smraza S51 |

Other pins: INA219 SDA21/SCL22 (0x40), STOP32 to GND with internal pull-up,
NeoPixel33 through a level shifter and 330 ohm resistor. GPIO4 is **not** a free
timing probe. Optional timing instrumentation uses GPIO18 (unused and connected
only to the analyzer); firmware rejects conflicting probe pin builds.

## Measure each actual servo — all profile values are to be measured

The values in `include/config.h::SERVO_PROFILES` are placeholders, including
maximum unloaded speed. With all other servo power leads disconnected, use a
separate current meter or subtract a measured rail baseline. Record the voltage,
angle range, load, method and instrument uncertainty with the captures. Never
claim per-finger attribution from the total INA219 when other servos are active.

Measure powered idle/holding current at slack, mean and peak moving current over
a safe unloaded sweep, and maximum unloaded speed (degrees/s). Use a team-approved
brief loaded fixture test for stall current; stop immediately at a limit, fault,
voltage droop or excessive heat. Do not raise the firmware cap to force a stall
measurement. If the limit prevents a safe measurement, record it as unmeasured
with the observed lower bound and let the hardware team characterize separately.

| Finger / model / unit ID | Idle mA | Moving mean / peak mA | Stall mA / duration | Max unloaded deg/s | Voltage / range / evidence |
| --- | --- | --- | --- | --- | --- |
| Thumb / unknown / Pending | To be measured | To be measured | To be measured | To be measured | Pending |
| Index / SG92R / Pending | To be measured | To be measured | To be measured | To be measured | Pending |
| Middle / MG90S / Pending | To be measured | To be measured | To be measured | To be measured | Pending |
| Ring / S51 / Pending | To be measured | To be measured | To be measured | To be measured | Pending |
| Pinky / S51 / Pending | To be measured | To be measured | To be measured | To be measured | Pending |

| Thumb identification / mechanical fit | Measured value / evidence |
| --- | --- |
| Manufacturer / model / markings / photo | To be measured |
| Housing length × width × height (mm) | To be measured |
| Mounting tabs / screw spacing / shaft offset (mm) | To be measured |
| Torque (kg·cm) / voltage / fixture method | To be measured |
| Wrist-module fit / required mechanical follow-up | Pending |

Attach captures and replace config estimates only after review of these real
measurements. Stall torque/current are not patient force limits. No per-finger
soft current limit is enabled: one INA219 measures the aggregate; the total
1500 mA default / 2200 mA maximum / continuous 100 ms cut-off is authoritative.
Build overrides may lower the default/maximum, never exceed 2200 mA.

## Checklist

1. With power off, check all five signal pins above, common GND, and the INA219
   in the servo positive rail. Verify the **470–1000 µF capacitor across servo
   5 V/GND**, near the connectors, with correct polarity and voltage rating above
   5 V. Verify the ring's level shifter/resistor. Set the supply to **5.0 V with
   a 2.5 A current limit**, verify with a DMM before connecting servos, and record
   the rail voltage at the connectors. Never feed servos from ESP32/USB power.
2. Flash using the team-only instructions in README.md, open 115200 baud, reset,
   and capture `evt boot` then `info`. Expect `fingers:5`, limit 1500 mA (unless
   lowered in this build), and five null calibration entries. Record the boot
   `reset_reason` numeric code (power-on 1, software reset 3, brown-out 9 in the
   pinned SDK). Firmware must restore neither motion nor calibration.
3. Scope **GPIO4 and GPIO13** from power application through setup, with servo
   power already present. Repeat cold boot, board reset, STOP-held boot and the
   controlled brown-out recovery in step 13. Confirm no PWM pulse or servo twitch
   before an explicit accepted move, and low/detached outputs in idle after boot.
   Save traces for both pins. Software leaves all five channels detached, but
   cannot prove ROM/reset-time behavior. Any boot pulse/twitch blocks acceptance.
4. With tendons disconnected, jog each index 0–4 to a safe absolute angle;
   verify <=60 degrees/s. `release` must immediately detach an uncalibrated jog.
   Try 4 and 176 degrees and index 5: expect `bad_args` and no motion. Check a
   mirrored channel independently. Complete the current/speed and thumb tables.
   Then jog all five channels so they are attached **at the same time** and
   confirm the fifth one still moves: ESP32Servo serves four channels per LEDC
   timer, so this proves the second timer is allocated (`lib/core/pwm_plan.h`).
5. Establish five safe empty-glove ranges. Send `calib` for 0–3; target/follow must
   still return `no_calib`. Send index 4 and capture one `calib_ok`. Send target
   `[0.5,0.5,0.5,0.5,0.5]`, v=0.5 with valid pings every 300 ms. Confirm five-value
   `a` and `tg`, correctly ordered bars/servos, and <=200-byte JSON lines including
   the largest observed timestamp/current. Try v=5: every channel winds at <=1
   calibrated range/s; target and follow unwind at 3 ranges/s. Verify hard clamps,
   mirrored mounting, and that starting a new calibration batch requires all five
   new ranges. Reset: all five null.
6. On an unloaded fixture, start **all five servos together** with a single small
   target from slack and keepalives, using the **2.5 A limit and installed bulk
   capacitor**. Scope the 5 V servo rail and ESP32 power; capture the minimum
   voltage and current peak. Repeat start/release cycles and confirm the ESP32
   **does not reset** (no new boot event, continuous telemetry `ms`). The firmware
   current cut-off remains active; if it trips, record the trip and reduce the
   safe test travel/speed. Do not increase caps to pass. A reset fails this check:
   repair power/wiring/capacitance, then repeat. The app normally staggers assist;
   this bench step deliberately checks simultaneous startup resilience.
7. Gently restrain a single spool on a bench fixture, monitoring supply and DMM.
   Repeat across all five channels as safely possible. Confirm the aggregate
   threshold and `evt overcurrent` peak. From **filtered threshold crossing** to
   fault/release: 100 ms +/- one 5 ms tick; allow filter/INA conversion delay from
   physical load onset. A sub-100 ms spike must not latch. All five must unwind
   to slack, then detach 500 ms after slack. Stop if current disagrees with the DMM
   or the mechanism does not unwind. Never rigidly stall longer than necessary.
8. Press STOP during five-servo target, follow and individual jogs: verify release
   and latched fault. Held STOP + `release` returns `err fault`. On letting go,
   expect `stop_released` with fault still latched. Target/follow/jog stay refused
   until explicit release. Contact bounce must not re-enable motion.
9. With the separate servo supply connected, pull USB during five-servo motion:
   verify release on the first tick strictly after 1000 ms from the last valid
   message (1005 ms on 5 ms ticks), unwinding at 3 ranges/s, then PWM detach
   500 ms after slack. Reconnect; an accepted move reattaches. If USB removal
   powers down the ESP32, record that limitation and repeat by stopping messages
   with board power retained to isolate the watchdog.
10. Boot without INA219: expect `ina_missing`, target/follow refused with
    `err state`, jog/release still available. Disconnect the sensor during a
    fixture target: verify fault and release across all five channels, with
    assistance inhibited until reset. Check a wedged bus fails closed.
11. Follow must replace target and set each goal to `clamp(f - 0.08, 0, 1)`,
    where `f` is vision converted to pull by the host. Check rising/falling pull
    on all five fingers: winding at 1.5 ranges/s, unwinding at 3 ranges/s.
    Ring bars show pull (how much the glove is opening each finger): thumb 0–3,
    index 5–8, middle 10–13, ring 15–18, pinky 20–23; gaps 4/9/14/19 stay dark
    except in fault. Colors: blue follow, orange target, amber calibration, dim
    white idle. Fault overrides all 24 pixels with a 2 Hz red blink. Verify 20%
    brightness and no PWM/control glitch during ring updates.
12. Record host-send to `tel.md == target` latency for >=100 requests without a
    prior input backlog (p95 <50 ms). With `REHAB_TIMING_PIN=18` added to existing
    build flags, scope maximum tick width during 200-byte commands, five-channel
    PWM, telemetry, faults and ring updates (target <2 ms). The README's 1.8 ms
    estimate is not measured evidence. Check heap stability across attach/detach
    and ring cycles. Flood malformed/oversized lines, pause output consumption
    and stop pings: safety still releases, events survive, telemetry may drop.
    One oversized line produces one `bad_json`; the next valid line is accepted.
13. Using a hardware-team-controlled power fixture, verify brown-out reset
    reporting without a glove on a person. Do not disable the ESP32 brown-out
    detector or bypass any current limit. After a genuine brown-out recovery,
    expect `{"t":"evt","e":"boot","reset_reason":9}` followed by five null
    calibration entries and no resumed motion; repeat step 3's no-pulse checks.
    Capture a normal power-on/software reset too to distinguish reasons. If no
    controlled brown-out can be safely induced, leave this check pending. This
    deliberate reset test is separate from step 6, which must run without reset.

## Opening glove gate

Complete the checklist above first, then these gates **in this order**. Pull 0
is slack at calibrated `min`; pull 1 is full pull at `max`, fingers straight.
Never swap those endpoints to reverse direction. Keep the configured firmware
current limit and supply limit active throughout; record the actual limits.
Gates 1–3 use an empty glove or fixture. Only after they pass may the hardware
team use a relaxed volunteer hand for gates 4 and 6; use a fixture/empty glove
for fault gates 5 and 7. No patient use until every gate passes. Never run
fault/stall tests on a person. Results remain **NOT RUN**.

### 1. Dorsal routing

On the empty glove, confirm the threads pass over the back of every finger.
Slowly wind each spool independently: it must straighten/open that finger.
Unwind to pull 0: the tendon must become slack. Stop and repair routing if
winding closes a finger or pull 0 keeps tension. Do not reverse calibration.

| Finger | Winding opens / pull 0 slack | Result | Evidence |
| --- | --- | --- | --- |
| Thumb | Pending / Pending | Not run | Pending |
| Index | Pending / Pending | Not run | Pending |
| Middle | Pending / Pending | Not run | Pending |
| Ring | Pending / Pending | Not run | Pending |
| Pinky | Pending / Pending | Not run | Pending |

### 2. Calibration per finger

On the fixture, reproduce a relaxed full fist. With the low setup current limit,
jog until the thread is just taut without extending the finger: **Slack** is
`min` (pull 0). Jog slowly to a straight, neutral finger, **never bent back**:
**Open** is `max` (pull 1). Require both angles within 5–175 degrees and
`|max - min| >= 20 degrees`. Send release before calibration; confirm it unwinds
to slack. Repeat calibration for the actual hand before its relaxed-hand gates.

| Finger | Slack `min` deg | Open `max` deg | Separation >=20 deg / release to slack | Result / evidence |
| --- | --- | --- | --- | --- |
| Thumb | Pending | Pending | Pending / Pending | Not run |
| Index | Pending | Pending | Pending / Pending | Not run |
| Middle | Pending | Pending | Pending / Pending | Not run |
| Ring | Pending | Pending | Pending / Pending | Not run |
| Pinky | Pending | Pending | Pending / Pending | Not run |

### 3. Extension strength gate

One finger at a time on the fixture/empty glove, have a helper resist opening
with moderate effort. The servo must open the finger and hold it straight for
**2 seconds below the active current limit**. Record peak and sustained current,
the applied load/method, and rail baseline with other servos slack. One INA219
only measures the total. Stop immediately at a fault, discomfort, heat or droop;
never raise a limit to pass. Failure requires a **stronger servo or bigger
spool/lever**, reviewed by the hardware team and the full gate repeated, before
any patient use.

| Finger | Limit mA | Peak mA | Sustained mA / hold s | Result / load method / evidence |
| --- | --- | --- | --- | --- |
| Thumb | Pending | Pending | Pending / Pending | Not run |
| Index | Pending | Pending | Pending / Pending | Not run |
| Middle | Pending | Pending | Pending / Pending | Not run |
| Ring | Pending | Pending | Pending / Pending | Not run |
| Pinky | Pending | Pending | Pending / Pending | Not run |

### 4. All five held open

After recalibrating to a relaxed volunteer hand, open all five fingers slowly
in stages without hyperextension and hold for **2 seconds**. Record total peak
and sustained current; both must stay below the active limit throughout the hold.
Do not average away peaks or increase limits to pass.

| Limit mA | Total peak mA | Total sustained mA | Hold s | Result / evidence |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending (>=2) | Not run |

### 5. STOP while held open

While all five are held straight on the fixture, press STOP. All tendons must
reach slack within **0.5 seconds** of the press; record actual motion as well as
telemetry.
The fault must latch and PWM must detach 500 ms after reaching slack. Confirm
that letting go of STOP alone never resumes pulling.

| Starting pull | Press to all-five slack s | Slack to detach ms | Fault stays latched | Result / evidence |
| --- | --- | --- | --- | --- |
| Pending | Pending (<=0.5) | Pending (500) | Pending | Not run |

### 6. Fast fist during follow

From an open hand in follow, make a fast fist while the host streams converted
pull every 20 ms. Goals must be `max(0, f - 0.08)` and pay out at 3 ranges/s,
without blocking closing or tripping overcurrent. Record all five goal/commanded
pull traces and total peak current. Native tests cover a 0.9-to-0 pull ramp in
300 ms; actual tendon tracking and current require this hardware check.

| Fist duration ms | Total peak / limit mA | Goal / pull traces | Overcurrent event | Result / evidence |
| --- | --- | --- | --- | --- |
| Pending | Pending / Pending | Pending | Pending (none) | Not run |

### 7. Watchdog while held open

With board and servo power retained, pull USB while all five are held open on
the fixture. The opening gate requires the **watchdog fault within 1005 ms of the
last valid message and all-five commanded slack within 1.5 s of USB loss** (the
protocol faults strictly after 1000 ms, then unwinds at 3 ranges/s: up to ~335 ms
from full pull, plus mechanical delay). Coordinator decision, Nov 7: this bound
replaces the earlier "slack within 1 second". Record USB-loss time, last valid
message, watchdog event, actual slack and PWM detach separately. Do not mark the
gate passed from a watchdog event alone. If pulling USB removes board power,
record that limitation and repeat with messages stopped and independent board
power, as in checklist 9. Detach remains 500 ms after slack.

| Starting pull | USB loss to slack s | Last message to watchdog ms | Watchdog to slack ms | Slack to detach ms | Result / evidence |
| --- | --- | --- | --- | --- | --- |
| Pending | Pending (<=1.0 required) | Pending (>1000) | Pending | Pending (500) | Not run; timing conflict pending |

## Results

Attach serial captures, scope/analyzer traces and measurement tables to the PR
or team hardware record. Do not mark a row passed without evidence.

| Check | Expected | Result | Measured value / evidence |
| --- | --- | --- | --- |
| 1. Electrical | 5.0 V, 2.5 A, common GND, 470–1000 µF | Not run | Pending |
| 2. Boot/info | reset code, 5 fingers, five null ranges | Not run | Pending |
| 3. GPIO4/13 boot | detached/low, no pulse or twitch in each reset scenario | Not run | Pending |
| 4. Jog/profiles/thumb | five bounded jogs; measurements and thumb fit recorded | Not run | Pending |
| 5. Calib/target/telemetry | all five required, bounded ramps, <=200 bytes | Not run | Pending |
| 6. Simultaneous start | all five start; no ESP32 reset with capacitor | Not run | Pending |
| 7. Overcurrent | 100 ms +/-5 ms; all five release/detach | Not run | Pending |
| 8. STOP | latch; held release refused; explicit recovery | Not run | Pending |
| 9. Watchdog | >1000 ms; slack+500 ms detach on all five | Not run | Pending |
| 10. INA loss | assistance refused; runtime loss releases all | Not run | Pending |
| 11. Follow/ring | five slack goals, bars/gaps, colors/blink | Not run | Pending |
| 12. Latency/tick/heap/flood | p95 <50 ms, tick <2 ms, stable heap, safety preserved | Not run | Pending |
| 13. Brown-out recovery | reason 9, five ranges forgotten, no resumed motion | Not run | Pending |

Any failed check blocks patient use and must be fixed and repeated by the team.
Host tests prove commanded software behavior; they cannot prove actual finger
position, mechanical comfort, board timing, boot glitches or current calibration.
