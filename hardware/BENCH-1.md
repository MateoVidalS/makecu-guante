# Bench test: first time with the real board (Nov 7, 2026)

Log of the first test of the repo firmware on the real board, without tendons and without
the glove. **It does not replace [firmware/BENCH.md](../firmware/BENCH.md)** nor mark any
of its steps as passed: it records what we saw and what is still missing.

> Third session (Nov 8, morning, 5 S51 servos, fixes from [FIXES.md](FIXES.md)):
> [BENCH-3.md](BENCH-3.md).

## Actual hardware (different from what the repo assumes)

| Part | What the repo assumes | What we used |
| --- | --- | --- |
| Board | ESP32-WROOM-32 | 30-pin ESP32 DevKit (ESP32-D0WD-V3 chip, CP2102 USB) |
| Supply | Bench supply, 5 V with a 2.5 A limit | Facmogu adjustable adapter 3–12 V / 5 A, **no current limit**, at 7.5 V, feeding an MB102 breadboard module (AMS1117 regulator to 5 V, ~0.8 A max) |
| Servo rail capacitor | 470–1000 µF near the connectors | Only the MB102's own (470 µF / 10 V, per its marking). More can be ordered |
| Servos | SG92R, MG90S, 2 × S51 and an unidentified black one | 3 × Smraza S51 and 2 of another brand, not yet identified or measured |
| INA219 | On the servos' + line | Not yet soldered or connected |

## Wiring used

- MB102 plugged into the end of the breadboard, with **both yellow jumpers on 5V**.
- Servos: red to the **+** row, brown to the **−** row, signal: thumb GPIO25,
  index GPIO26, middle GPIO27, ring GPIO13, pinky GPIO4.
- ESP32 GND to the **−** row. ESP32 VIN not connected. ESP32 over USB to the laptop.
- STOP: push button at e8/e10/f8/f10 on the breadboard, d10 to GPIO32 and g8 to the **−** row.

## Results

| Test | Result | How it was observed |
| --- | --- | --- |
| Flashing the firmware | `pio run -e esp32dev -t upload` works on COM3 | esptool output |
| Identity | `hello` replies `{"t":"info","fw":"0.1.0","fingers":5,"limit":1500,"calib":[null,null,null,null,null]}` | Serial monitor |
| `jog` of each finger, no tendons | All 5 servos move, one at a time, between 60° and 120°, at the firmware's limited speed | By eye |
| 5 channels attached at once | The pinky (index 4) moved with the other 4 still attached, because there was no `release` between fingers | By eye |
| STOP | `evt stop_button` and `fault` state; on release `stop_released` arrives and the fault stays latched; only an explicit `release` clears it | Serial monitor |
| No INA219 | `ma` stays at 0 and `jog` still works | Serial monitor |
| Temperature | All 5 servos cool after the tests | By touch |

Not measured: actual speed, per-servo currents, pulses on GPIO4/13 at boot, rejection of
angles outside 5–175°, watchdog, overcurrent cutoff or brown-out.

## Incidents and lessons

1. **Reversed polarity.** On this breadboard the topmost row is **−** and the second is
   **+** (the bottom is the other way round). The index servo's red and brown ended up
   swapped and the servo got hot within seconds. It survived. Go by the printed signs and
   measure with the multimeter before plugging in servos.
2. **MB102 jumper on 3.3.** The servo row read 3.2 V and no servo moved, with no error at
   all from the board. With the jumper on 5V, all 5 move.
3. **The MB102 isn't enough for the glove.** It provides ~0.8 A: fine for moving servos one
   at a time on the bench, not for closing a hand. For the glove, the Facmogu at 5.0 V has
   to go directly to the servo rail (through the INA219), with its own 470–1000 µF capacitor.
4. **With the MB102, the Facmogu must not exceed 9 V**: its capacitor is rated 10 V.
5. A manual bench session needs a `ping` every ~300 ms during `jog`; without it the watchdog
   releases everything after 1 s.

## For the team to decide

- **No current limit on the supply.** The firmware README says a single jammed finger
  (650–800 mA estimated) doesn't reach the 1500 mA cutoff and that it is stopped, among
  other things, by the supply limit. With the Facmogu that layer doesn't exist.
  Proposal: test the cutoff with a low limit (for example `limit 800`) and get a supply
  with a limit or a fuse for the demo.
- Measure and identify the 2 servos of the other brand and fill in the BENCH.md tables.

## Tool: test sketch

[`firmware/tools/prueba_placa/prueba_placa.ino`](../firmware/tools/prueba_placa/prueba_placa.ino)
is an Arduino sketch (not PlatformIO) that moves a servo on GPIO26 to angles typed in the
serial monitor and reports every STOP press. It helps tell a wiring problem from a firmware
one. It builds with the `esp32:esp32` 3.x core and the ESP32Servo 3.x library:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --upload -p COM3 firmware/tools/prueba_placa
```

Afterwards, flash the repo firmware again.

## On Windows

- `make dev` doesn't work yet: the Makefile calls `python3` and `scripts/dev.py` can't find
  `pnpm` (it's a `.cmd`). Meanwhile: `cd backend; uv run python -m app` and
  `cd frontend; pnpm dev` in two terminals.
- `pnpm test` in `frontend/`: `src/runtime/backend.test.ts` fails during cleanup
  (`EBUSY` on `runtime.db`) because uvicorn's `python.exe` stays alive.
