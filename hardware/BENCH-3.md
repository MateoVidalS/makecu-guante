# Bench: third session (Nov 8, 2026, morning)

Monitoring of the real board from the laptop while the fixes in [FIXES.md](FIXES.md) were
being made. **No tendons and no glove**: this does not pass any step of
[firmware/BENCH.md](../firmware/BENCH.md). Claude ran the tests with
[`firmware/tools/bench_monitor/bench_monitor.py`](../firmware/tools/bench_monitor/bench_monitor.py)
(see the end), with the COM3 port reserved for it.

## Setup

The same as the second bench session (branch `bench/hil-segunda-sesion`), with **all 5
fingers on Smraza S51**. The diagram is in the report
[docs/qa/memo-qa-report.html](../docs/qa/memo-qa-report.html), section
*Armado del banco para retomar* (bench setup to resume from).

| Part | Connection |
| --- | --- |
| Supply | Facmogu at 7.5 V → MB102 (USB-side jumper removed) |
| Servo 5 V | 5V pin of the MB102's middle strip → INA219 `VIN+` → `VIN−` → servo **+** row |
| Servo GND | GND pin of the MB102's middle strip → servo **−** row |
| ESP32 | USB to the laptop, VIN not connected, GND to the **−** row (common ground) |
| INA219 (data) | `VCC`→3V3, `GND`→GND, `SDA`→D21, `SCL`→D22. **Soldered at the end of the session** |
| Capacitor | 470 µF / 25 V between the + row and the − row |
| Servos | Thumb D25, index D26, middle D27, ring D13, pinky D4. Red to +, brown to − |
| STOP (D32) | Not connected |
| Firmware | `0.1.0` (`hello` → `{"fingers":5,"limit":1500}`), no saved calibration |

> The servos were rewired that afternoon to thumb D4, index D13, middle D27, ring D26,
> pinky D25 (see [FIXES.md](FIXES.md)). This log keeps the morning's pin map.

## What happened, in order

| Time | What was done | Result |
| --- | --- | --- |
| 07:43 | Thumb (D25), `jog` 60°→120°→90° | 0 mA the whole time. The index (D26), as a control, also 0 mA. It wasn't the thumb |
| 07:44 | Reset | Booted with **`ina_missing`**: the INA219 was disconnected, which is why everything read 0 mA |
| 07:49–08:00 | Reconnecting the INA219 | The software reset (CP2102 RTS) left the board stuck at boot **three times**: it only prints `ets Jul 29 2019 12:21:46` and sends neither `boot` nor telemetry. With **EN** or by unplugging the USB it boots fine |
| 08:03 | Sweep of the 5 channels with a single servo plugged in | Only D25 draws current: 3 mA at rest, up to 69 mA average while moving, 451 mA peaks. **The thumb works: it was the connection** (FIXES step 1) |
| 08:04 | Same sweep, channel D4 | 657–712 mA peaks **with the board idle**, no motor powered: it came from outside (a servo plugged in with the supply on) |
| 08:11 | Thumb, index and middle, one at a time | All 3 draw current while moving (see table). Rest for the 3: 13 mA (~4 mA per servo) |
| 08:17 | A servo was plugged in with the supply on | **1142 mA** spike with everything still; rest went from 13 to 16 mA. At 08:17:35, **`ina_missing` mid-use**: an INA219 data wire had moved. Pressing EN didn't recover it until the wires were reseated |
| 08:21 | 2-min round, `jog` 60°↔120°, one servo at a time, `limit` 750 | 9 rounds, no events. At the end, 16 mA at rest |
| 08:23 | Pinky and thumb still, holding 90° | **16 mA, same as at rest.** The pinky's ~150 mA at rest (FIXES step 2) doesn't show up, without thread |
| 08:25 | 3-min sweep at full travel and max speed (`target`, see note) | 22 travels per servo, no cutoffs. At 08:28:39, **`ina_missing` again**, from the servos' vibration |
| 08:34 | INA219 **soldered**, EN | The sensor is back. 1-min sweep like the previous one: 8 travels per servo, no `ina_missing` and no cutoffs |

> **Note:** the 08:25 and 08:34 sweeps used a bench calibration of **5°–175°** (the maximum
> the firmware allows). FIXES.md recommends **~10°–170°** for the S51 so its internal end
> stop isn't forced, so part of the peaks may be the servo pressing against the end stop.
> No servo jammed. The tool now uses 10°–170° by default.

## Measured currents (MB102 through the INA219, no tendons)

**Finger by finger, `jog` 60°→120°→90° (08:11):**

| Finger | Pin | Moving (max. average) | Peak |
| --- | --- | --- | --- |
| Thumb | D25 | 92 mA | 431 mA |
| Index | D26 | 83 mA | 413 mA |
| Middle | D27 | 85 mA | 390 mA |

**Full travel at max speed, one servo at a time, `limit` 750 mA:**

| Finger | 3 min before soldering: average / peak | 1 min with the INA219 soldered: average / peak |
| --- | --- | --- |
| Thumb | 188 / 507 mA | 138 / 454 mA |
| Index | 175 / 504 mA | 132 / 315 mA |
| Middle | 184 / 477 mA | 116 / 376 mA |
| Ring | 165 / 532 mA | 124 / 301 mA |
| Pinky | 197 / 599 mA | 128 / 418 mA |

- Full-travel times, the same on all 5 fingers: **out 1.03–1.04 s**
  (`V_MAX` = 1 range/s) and **back 0.37–0.38 s** (`V_RELEASE` = 3 ranges/s).
- With the INA219 soldered the currents come out lower and more even. With the loose
  connection the readings were inflated, or the intermittent contact added draw.
- No peak reached the 750 mA cutoff. A single servo at max speed draws 300–600 mA peak:
  the MB102 (~0.8 A) handles one at a time, not several together.

## Conclusions

- **Step 1 (thumb):** solved. The servo on D25 moves and draws current; the problem was the
  connection.
- **Step 2 (pinky):** without thread, at rest it draws the same as idle. Still needs
  checking **with the thread attached**, as FIXES asks.
- **Step 3 (supply):** unchanged. With the MB102 and "one motor at a time" it's enough to
  move one servo at a time, even at max speed.
- **Step 4 (verify):** all 5 move and draw current while moving, and draw little at rest.
  Still need to check **by eye** that commanding one finger doesn't move another (a single
  INA219 can't measure that), recalibrate in memo (~10°–170°) and the full test with the app.
- **INA219:** disconnected twice with breadboard wiring (when touching wires and from
  vibration). Soldered, it held for 1 min of sweeping. The earlier drop happened at ~3 min,
  so a 3-min test should be repeated.
- **360°:** not possible. The S51s are position servos (~180°) and the firmware limits them
  to 5°–175°. `jog` runs at 60°/s; `target` reaches ~165°/s over the full range.

## Lessons

1. **Without the INA219, the board reads 0 mA and won't cut on overcurrent**, but `jog`
   keeps working. `ina_missing` only appears at boot or when the sensor is lost, and the
   firmware doesn't look for it again until a reset with **EN**. After `ina_missing`
   mid-use, the current value stays frozen at the last reading.
2. **Don't reset via software** (CP2102 RTS) with this setup: the board got stuck at boot
   three times. Use **EN** or unplug the USB. The cause wasn't found.
3. **Unplug the servo supply before plugging in a servo:** with the supply on there was a
   1142 mA surge, and handling things moved the INA219 wires.
4. **Solder the INA219** (or secure its data wires) before using the glove: on the
   breadboard it comes loose with vibration.
5. **Only one program on COM3 at a time:** while the monitor runs, the app can't connect to
   the glove.

## To do

- 3-min sweep with the INA219 soldered, at **10°–170°**.
- Pinky with the thread attached (FIXES step 2).
- Check by eye that no finger moves when another is commanded.
- Recalibrate all 5 fingers in memo and the full test with the app (FIXES step 4).

## Tool: bench monitor (`bench_monitor.py`)

[`firmware/tools/bench_monitor/bench_monitor.py`](../firmware/tools/bench_monitor/bench_monitor.py)
opens the port without resetting the board, sends `ping` every 300 ms, logs every
`info`/`evt`/`err` to `bench.log` plus a telemetry summary every 5 s, and warns if the
rest draw exceeds 80 mA. If the USB is unplugged, it exits on its own. **Bench only.**

```sh
uv run --no-project --with pyserial python firmware/tools/bench_monitor/bench_monitor.py COM3 <folder>
```

Tests are requested by appending a JSON line to `<folder>/cmd.jsonl`; any other JSON line
is sent as-is to the board:

| Command | What it does |
| --- | --- |
| `{"t":"__test_finger","i":0}` | Rest, `jog` 60°→120°→90° of one finger, `release`, rest. Reports whether it draws current while moving |
| `{"t":"__scan"}` | `__test_finger` on all 5 channels, one at a time (useful to find which pin a servo is on) |
| `{"t":"__burnin","seconds":120}` | Round of `jog` 60°↔120°, one servo at a time, with `limit` 750. Stops on any safety event |
| `{"t":"__sweep","seconds":180}` | Full travel at max speed (bench `calib` + `target`), one servo at a time, `limit` 750. 10°–170° by default |
| `{"t":"__quit"}` | `release` and exit |

Bench calibrations live only in the board's memory: they are wiped on reset.
Recalibrate in memo before using the app with the glove.
