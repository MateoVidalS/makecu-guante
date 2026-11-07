# Firmware bench acceptance — hardware team only

Status: **NOT RUN**. The coding worker built and tested on the host only. These
checks require the team's physical ESP32-WROOM-32, micro servos, INA219, STOP
button and 24-pixel ring. Do not perform fault/stall tests with a glove attached
to a person. Start with tendons disconnected, then use a fixture or empty glove.
Cut supply power if motion, current or wiring differs from expectations.

Record operator, date, board revision, firmware commit, servo model, supply/DMM,
sensor shunt value and serial host below before starting. Never copy example
servo angles into a patient calibration.

| Field | Value |
| --- | --- |
| Operator / date | Pending |
| Board / wiring revision | Pending |
| Firmware commit / toolchain | Pending |
| Servo model / spool radius | Pending |
| Supply / DMM / analyzer | Pending |
| INA219 / shunt | Pending |
| Serial host / keepalive interval | Pending |

## Checklist

1. With servo power disconnected, verify common GND, INA219 in the servo positive
   rail, STOP from GPIO32 to GND, and signal pins against README.md. Verify 5.0 V
   with a DMM **before** connecting servos. Set the supply current limit to 1.5 A.
   The ESP32/USB rail must not supply servo power. Verify level shifter and
   330 ohm data resistor on the ring.
2. Flash using the team-only instructions in README.md, open 115200 baud, reset,
   and capture `evt boot` plus `info`. Check all three calibration entries are
   null. Verify no PWM pulses/twitch at boot, including with STOP held at reset.
3. With tendons disconnected, `jog` index to 90 degrees; verify <=60 degrees/s.
   `release` must detach an uncalibrated jog immediately. Try 4 and 176 degrees:
   both must give `bad_args` with no move. Check a mirrored channel independently.
4. Establish safe empty-glove ranges, send all three `calib` commands, and capture
   one `calib_ok`. Send target 0.5 with v=0.5 and a 300 ms keepalive. Confirm the
   commanded telemetry ramps at that rate. Try v=5: it must remain <=1 range/s.
   Verify hard clamps and that starting a new calibration requires all three
   new ranges. Reset and confirm calibration is forgotten.
5. On a bench fixture, gently restrain the spool, monitoring the supply and DMM.
   Confirm the INA219 threshold and `evt overcurrent` peak. Timestamp from the
   **filtered telemetry threshold crossing** to release: 100 ms +/- one 5 ms
   tick; allow filter/INA conversion delay from physical load onset. A brief
   sub-100 ms spike must not latch. Stop immediately if current does not match
   the DMM or the mechanism does not unwind. Do not rigidly stall a servo for
   longer than necessary. Record total-current attribution limits.
6. Press STOP during target, follow and jog; confirm release and latched fault.
   Hold it and send `release`: expect `err fault`. Let it go: expect
   `stop_released`, still faulted. Confirm target/follow/jog are rejected until
   an explicit release. Verify contact bounce does not re-enable motion.
7. With the separate 5 V servo supply still connected and a bench fixture only,
   pull USB while running: verify release starts within 1 s of the last valid
   message. Observe opening at <=3 ranges/s, then PWM detach 500 ms after open.
   Reconnect, verify a valid new move reattaches. If USB removal powers down the
   ESP32, also record that limitation and repeat by stopping host messages while
   retaining board power to isolate the firmware watchdog.
8. Boot without the INA219: capture `ina_missing`; calibrate, then verify target
   and follow are refused with `err state`. Jog/release must still work. On an
   empty fixture, unplug the sensor during a target: verify a fault and release,
   then refusal of assistance until reset. Check a wedged bus fails closed.
9. Verify follow goals are `clamp(vision - 0.05, 0, 1)`, replacing a prior target.
   Test both rising and falling input and all three ring segments, blue follow,
   orange target, amber calibration, dim white idle, all-red 2 Hz fault blink.
   Verify 20% brightness and absence of timing glitches under ring updates.
10. Record host-send to `tel.md == target` latency over at least 100 requests
    without a prior input backlog; target p95 <50 ms. With optional
    `REHAB_TIMING_PIN=4`, measure the maximum tick pulse under maximum 200-byte
    commands, telemetry, current faults, STOP and ring updates. Target <2 ms;
    distinguish this measured value from the 1.8 ms engineering estimate. Check
    no periodic heap decline after repeated attach/detach and ring cycles.
11. Flood malformed/oversized serial lines, pause output consumption, and stop
    keepalives. STOP/current/watchdog must still release; only telemetry may be
    dropped. Confirm queued events are delivered and one oversized line produces
    one `bad_json`, with the next valid line accepted. Repeat reset/detach checks.

## Results

Attach raw serial captures, oscilloscope/analyzer traces and current measurements
to the PR or team's hardware record. Do not mark a row passed without evidence.

| Check | Expected | Result | Measured value / evidence |
| --- | --- | --- | --- |
| 1. Electrical | 5.0 V, 1.5 A limit, common GND | Not run | Pending |
| 2. Boot | boot + info, null calibration, no twitch | Not run | Pending |
| 3. Jog | bounded angle/speed; release detaches | Not run | Pending |
| 4. Calib/target | calib_ok, rate cap, fresh batch | Not run | Pending |
| 5. Overcurrent/spike | 100 ms +/-5 ms after filtered crossing | Not run | Pending |
| 6. STOP | press latches, held release refused | Not run | Pending |
| 7. Watchdog/detach | release starts <=1 s, detach open+500 ms | Not run | Pending |
| 8. INA loss | assistance refused; runtime failure releases | Not run | Pending |
| 9. Follow/ring | slack goals, segments and colors | Not run | Pending |
| 10. Latency/tick/heap | p95 <50 ms, max tick <2 ms, stable heap | Not run | Pending |
| 11. Serial flood | safety preserved, events delivered | Not run | Pending |

Any failed check blocks patient use and must be fixed and repeated by the team.
Host tests prove commanded software behavior; they cannot prove mechanical
comfort, actual finger position, board timing or current calibration.
