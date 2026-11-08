# Pending hardware fixes (Nov 8, 2026)

Found while testing the app with the real board, without glove or hand. **The software
already coordinates well with the board:** what the app sends arrives in 20–40 ms, at the
right finger, one motor at a time, and the brake releases everything in ~140 ms. What fails
is physical.

**The pins don't change**, and neither the firmware nor the app needs touching.

> **Status as of Nov 8, 08:36** (bench session with Claude; details and measurements in [BENCH-3.md](BENCH-3.md)):
> - **1. Servo that doesn't move:** solved. The thumb (D25) moves and draws current; it was the connection.
> - **2. Pinky:** without thread, at rest it draws the same as idle (16 mA with all 5). Still needs checking with the thread attached.
> - **3. Power supply:** unchanged (MB102 + "one motor at a time"). One servo at a time, even at maximum speed, never reached the 750 mA cutoff.
> - **4. Verify:** all 5 move and draw current; still need to check by eye that no other finger moves, recalibrate in memo, and the test with the app.
> - **New:** the INA219 kept disconnecting on the breadboard (`ina_missing`); it is now soldered. Its data lines go to 3V3, GND, D21 (SDA) and D22 (SCL), and it is only detected at boot: after connecting it, press **EN**.

Before touching any wires: **unplug the servo supply and the USB.** All of this is done
without a hand: never test jams or faults with the glove on.

## Servos: all 5 are now the same

All five fingers use the **Smraza S51** (9 g micro servo, SG90 type). The thumb used to be
an unidentified black servo that **didn't move** (drew no current); if that servo has been
replaced with an S51, the problem should be solved. It still needs verifying (section 4).

| Finger | Signal pin (orange) | Servo |
| --- | --- | --- |
| Thumb | D4 (GPIO4) | Smraza S51 |
| Index | D13 (GPIO13) | Smraza S51 |
| Middle | D27 (GPIO27) | Smraza S51 |
| Ring | D26 (GPIO26) | Smraza S51 |
| Pinky | D25 (GPIO25) | Smraza S51 |

> **Nov 8, 2026, afternoon:** the servos were rewired to this map (before: thumb D25, index
> D26, middle D27, ring D13, pinky D4). Pin mentions further down use the old map, from when
> those problems were found.

Each servo's red goes to the **+** row, brown to the **−** row. Careful: on the breadboard
the + and − rows are swapped between top and bottom.

**After changing servos, recalibrate** each finger in the app (Calibrate), because the arm
positions changed. With the S51, keep each finger within **~10° to 170°** so its internal
end stop isn't forced.

---

## 1. If a servo doesn't move

This happened before with the thumb (D25): the app sent the commands correctly but the
servo neither moved nor drew current.

1. **Wires.** With everything unplugged: brown on **−**, red on **+**, orange on its pin
   (table above). Make sure they're seated firmly and in the right row.
2. **Voltage at the servo.** Plug in the supply and measure with the multimeter between red
   and brown **at the servo connector**. It should read ~5 V. If it reads 0 V, change the
   wire or the breadboard row.
3. **Swap.** Move its connector to the pin of a finger that works (for example D26):
   - It moves there → the problem is the signal wire or the pin.
   - Still doesn't move → **the servo is broken: replace it.**
   - When done, put each servo back on its own pin.

## 2. Pinky (D4): drew ~150 mA at rest

Powered and not moving, it drew ~150 mA, when an idle unloaded servo draws almost nothing:
it was pushing against something. **It's not the pin**: D4 works fine.

1. **Unhook the thread** from the spool. If the draw drops to ~20 mA, the thread or the
   finger anchor is too tight or jammed: loosen it or redo the anchor. If it stays high
   without the thread, the servo is strained or damaged: replace it.
2. **Arm (horn).** Make sure it doesn't hit the case, the spool or the mount at any point.
3. If the servo was replaced with a new S51, still check with the thread attached: the
   problem may be the thread, not the servo.

> **"D4 moved without being commanded"** is a different issue: the old firmware powered all
> 5 servos on any command. That is fixed (new firmware flashed on Nov 8). Also, in the
> opening poses the glove deliberately takes up the slack on every finger, and a powered-off
> servo jumps quickly to its "slack" position the first time it is powered. If after all
> that D4 still moves when another finger is commanded, report it: there may be a crossed
> signal.

## 3. Power supply: the current one is enough (upgrading is optional)

The breadboard's **MB102** module provides ~0.8 A at most. That's why the app has the
**"one motor at a time"** mode: with it, the draw never exceeds what the supply provides.
The tests that passed were done this way. **Nothing needs to be bought.** Just leave memo set to:

- **Setup → "One motor at a time (low-power supply)"** checked (it is checked by default).
- **Calibrate → current limit ~700 mA.**

What this supply can't do: move several fingers at the same time, and on a fast release the
servos finish a bit late (0.6–0.8 s). For a prototype that's fine.

**Optional, if you ever want more force or to move several fingers together:** the
bottleneck is the MB102, not the adapter. The **Facmogu** adapter we already have
(3–12 V, 5 A) can feed the servos directly:

1. Set it to **5.0 V and measure it with the multimeter before connecting**: it should read
   4.9–5.2 V. **At 7.5 V (as used with the MB102) it burns out the servos.**
2. Wiring:
   ```
   Adapter +5.0 V ──► INA219 (VIN+) ──► INA219 (VIN−) ──► servo + row
   Adapter  GND   ──────────────────────────────────────► servo − row
                                                             │
   ESP32 GND ────────────────────────────────────────────────┘  (common ground)
   ESP32 ◄── USB (laptop). No VIN. The MB102 no longer powers the servos.
   ```
3. **470 to 1000 µF electrolytic capacitor, rated 10 V or more**, across the rail near the
   servos, with the **stripe (−)** on −. **Reversed, it can explode.**
4. **Short, thick wires**: the breadboard handles more than 1–2 A poorly.
5. The adapter **does not limit current**: the protection is the board's.
6. Then, in memo: current limit **~1500 mA**, and "One motor at a time" can be unchecked.

## 4. Verify after fixing

1. **Only one program on the USB at a time:** the app in Chrome, or an agent's tests.
   Never both at once.
2. **Finger-by-finger test** (ask Claude, with the port reserved for it): moves each servo
   alone and measures the current. Expected:
   - All 5 visibly move and draw current while moving.
   - At rest and powered they draw little (without the pinky's ~150 mA).
   - When one finger is commanded, **no other finger moves**.
3. **Recalibrate in memo** all 5 fingers (new servos) within ~10–170°.
4. **Full test with the app** (also Claude): a practice session with the simulated patient
   and the real motors; everything should come out green.
5. Write down what was done and what was measured in [BENCH-1.md](BENCH-1.md).
