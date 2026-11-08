# Glove link

`WebSerialGlove` and `world.glove` implement the frozen `GloveClient` contract.
The provider exports remain `GloveProvider`, `useGlove`, and `useGloveTelemetry`.
`StubGlove` remains exported for the WP0 scripted-runtime/foundation tests; the
provider uses the real clients.

## Shared simulator

Use one world for both sources; separate worlds cannot model assistance correctly.

```ts
import { createSimWorld, PATIENT_PRESET_OPTIONS } from './sim';
import { pullFromClosure, type Quint } from '../contracts/glove';

const world = createSimWorld({ seed: 42, preset: 'moderate' });
await world.glove.connect();
// As on hardware, send all five servo ranges and the patient's current limit.
world.glove.calib(0, 20, 150);
world.glove.calib(1, 20, 150);
world.glove.calib(2, 20, 150);
world.glove.calib(3, 20, 150);
world.glove.calib(4, 20, 150);
world.glove.limit(1500);
await world.vision.start({ affectedHand: 'right' });
world.vision.setCalibration(cameraCalibration);
world.setIntent('full_fist', 'ATTEMPT'); // Call on engine phase/pose changes.
// Vision/poses speak closure; the glove wire speaks tendon pull.
world.glove.follow([0.6, 0.6, 0.6, 0.6, 0.6].map(pullFromClosure) as Quint);
world.setIntent('open', 'ATTEMPT');
// After the patient's own attempt, the engine can assist opening.
world.setIntent('open', 'ASSIST');
world.glove.target([0.95, 0.95, 0.95, 0.95, 0.95], 0.2);
world.controls.setRigid('index', true);
// Rigidity can target any finger, including ring and pinky.
world.controls.pressStop();
world.controls.releaseStop(); // Still faulted: release is required to clear it.
world.glove.release();
world.controls.handOutOfFrame(2000);
world.controls.unplug(); // Stops transport/keepalive; firmware continues to watchdog.
world.controls.setPreset('spastic');
// Picker options: PATIENT_PRESET_OPTIONS = [{ id, label }, ...].
world.stop(); // Application teardown; releases, disconnects, stops camera and clock.
```

For tests, pass `{ autoStart: false }` and drive `world.advance(milliseconds)`.
For demos, `timeScale` scales elapsed wall time. The control step is always 5 ms;
telemetry deadlines come from integer tick indices. Live timestamps share
`world.origin + world.now`, while firmware `ms` starts at zero. Tests using an
accelerated/manual world should pass `world.timestamp()` to the engine.

The camera delivers 30 Hz captures after 60 ms. Before camera calibration,
`closure` is null, but raw flex/joints remain available for the wizard. Dropouts
clear all hand measurements. Linear `jointsFromClosure` is local until WP6 is
integrated. No image landmarks or video element are synthesized.

## Opening patient model

All five camera fingers come from their physical shaft positions, converted with
`closureFromPull`; telemetry stays in commanded pull. Pull 0 is slack and safe.
The glove can only open a hand. Never swap calibration min/max to invert it.

Per finger, the voluntary closure `q` moves at 0.6/s after a 0.4 s reaction:
`q_goal = clamp(pose_closure + U(-0.02, 0.02), active_min, active_max)`.
Free pose fingers relax to `rest`; RELEASE/REST/PAUSED/DONE return to `rest`.
HOLD/ASSIST/ASSIST_HOLD preserve the voluntary intent. With pull `p`, the real
closure before noise is:

```
c = max(rigid_floor ?? 0, min(q, closureFromPull(p)))
```

Physical tremor adds ±0.01 closure, bounded by the rigid floor and [0,1]. Camera
noise adds ±0.02 and uses the existing camera calibration and latency. Slack
therefore restores the patient's own intent or flexed resting posture.

Stable preset ids and labels are exported in `PATIENT_PRESET_OPTIONS` (also from
`sim/index.ts`); full per-finger profiles are in `PATIENT_PRESETS`. These numbers
apply independently to all five fingers, except the index floor:

| id            | Label          | Rest | Active min / max | Tone (mA/unit) | Reflex (mA per unit stretch per unit/s) | Floor              |
| ------------- | -------------- | ---: | ---------------- | -------------: | --------------------------------------: | ------------------ |
| `demo`        | Demo (no tone) | 0.20 | 0 / 1            |              0 |                                       0 | None               |
| `mild`        | Mild           | 0.60 | 0.30 / 1         |            100 |                                      40 | None               |
| `moderate`    | Moderate       | 0.75 | 0.55 / 1         |            220 |                                     100 | None               |
| `spastic`     | Spastic        | 0.85 | 0.75 / 1         |            550 |                                     400 | None               |
| `rigid_index` | Rigid index    | 0.75 | 0.55 / 1         |            220 |                                     100 | Index closure 0.60 |

All reflex thresholds are 0.15/s. `severe` remains an alias for `spastic`, so old
callers still compile; it is omitted from the picker. Selecting a preset resets
voluntary intent and posture to its rest and sets its rigidity flags. The existing
`setRigid(finger, boolean)` controls and `patient.rigid` reads still work for all
five fingers; a newly toggled rigid finger uses closure floor 0.60. Turning the
flag off removes the floor, including on `rigid_index`.

## Servo profiles and power

`sim/servoProfiles.ts` mirrors the provisional firmware servo profiles. Idle,
moving, stall currents and unloaded speeds still require bench measurement at
5 V, including identifying the thumb. `world.servoPosition` tracks physical pull
separately from the commanded telemetry, respecting mechanical speed, rigid
floors, available servo torque and supply saturation.

For each attached servo, use the geometry above with its commanded pull to
estimate torque demand. For velocity `v` in pull/s and calibrated range `r` in
degrees:

```
stretch = max(0, q - c)
moving = (moving_ma - idle_ma) * (0.25 + 0.75 * clamp(abs(v)*r/max_speed_deg_s, 0, 1))
         // zero when stationary; halve when unwinding
load = tone_ma_per_unit * stretch
     + reflex_ma_per_unit_speed * max(0, v - 0.15) * stretch
     + 12000 * max(0, rigid_floor - closureFromPull(commanded_pull))
servo_ma = clamp(idle_ma + moving + load + U(-3, 3), 0, stall_ma)
```

Unwinding sets load to zero; stationary holding retains tone and rigid-stall
load. Detached servos draw zero. A current demand at stall stops that physical
shaft winding even though its commanded ramp continues. This creates the
pull/vision gap used for engine resistance attribution. It can always unwind. A shaft that lags behind the commanded ramp never winds
to catch up during a target/follow unwind or a release.

`power.ts` sums these demands plus 30 mA electronics, then caps the measured total
at the 2500 mA supply. `world.power` exposes `perServoMa`, uncapped `demandMa`,
measured `totalMa`, and `saturated`. Saturation prevents further physical winding
but allows unwinding. It models loss of torque rather than an ESP32 reboot.
Five full stalls demand 3530 mA before clipping, so clipping cannot hide overload
from firmware current protection.

**Held-opening load reference (no governor, zero velocity/noise, resting hand):**
at pull 0.95 each spastic finger is stretched by 0.80. The currents are
`[460, 460, 460, 455, 455]` mA plus electronics = **2320 mA**, above 2200 mA,
even after all movement has stopped. The same demo hold draws **120 mA**, below
1500 mA. Real ramps can draw more due to friction and reflex. The simulator has
no load governor: the engine must shed load. Independent firmware overcurrent
still trips after 100 ms continuously over the selected limit. A single stall
can be below the default total limit, so engine resistance detection is needed;
the 600 mA evaluation test faults after passing the rigid index's pull ceiling.

## Firmware conformance

In both follow and target, each finger winds at its mode speed (1.5/s for follow,
`min(v, 1)` for target), and unwinds at 3.0/s. Follow subtracts 0.08 pull slack.
Ticks cap movement to one 5 ms control period, including missed deadlines.
Mode changes do not jump positions. Release, STOP, watchdog, current limits,
fault latching and 500 ms detach timing retain their safety behavior; all unwind
to pull 0. The fixed-step world retains 200 Hz control and 50 Hz telemetry.

## Provider and subscriptions

`useGlove()` exposes `client`, `connection`, `connectionError`, `latest`, `events` (last 100),
`setKind`, and the shared `world` (use `world.vision` in the simulator runtime).
`VITE_SIM=1` selects and connects the simulator. Serial starts disconnected:
call `client.connect()` from a user gesture. Switching kind disconnects/releases
the old transport; switching to serial does not open the chooser automatically.

Use `useGloveTelemetry(selector)` for React telemetry reads. For non-React
consumers, `subscribe(cb)` receives telemetry and `subscribeTelemetry(selector,
cb)` emits only when the selected value changes. Both return unsubscribe
functions and remain bound to the active client across source switches.

## Serial behavior

The serial adapter accepts an injected `SerialPortLike` or `SerialApi` for tests.
It uses incremental UTF-8 decoding on byte streams, bounded line buffering,
a 2 s info timeout, a 100 ms keepalive check, and at most 30 Hz follow writes.
Malformed lines increment `codecStats.malformedLines`; they never stop reading.
Reconnect reuses the selected/granted port. Chooser cancellation is respected;
unsupported filters retry without filters.

An `info` reporting a finger count other than five immediately rejects the
handshake with "This glove reports N fingers. Rehab Hub requires 5-finger
firmware." The connection becomes `error`, streams close, and
`connectionError` retains the message for Setup. The same check applies to
later `info` messages. Reconnect and source switches clear the old message.
`onError` forwards local connection failures with `c: 'connect'`; firmware
error messages retain their wire command/reason. Incompatible identities are
rejected separately from `codecStats.malformedLines`.

Release jumps ahead of queued configuration. It also cancels unsent motion
(target/follow/jog) so stale motion cannot restart after release. In-flight writes
cannot be recalled. A target/jog replaces an older pending follow. Other commands
are sent in order. Disconnect/unload release is best effort; the independent
firmware watchdog remains the safety layer when USB or the browser fails.

## Verification

Run `pnpm --dir frontend test --run src/glove`. The named conformance suite maps
to firmware safety rules, including filtered current timing, calibration, STOP,
watchdog, ramps and detach. Fake-port tests cover framing, handshakes, recovery,
write stalls, keepalive and release priority. Patient/camera/provider tests cover
shared timing, reaction, opening-only physics, sustained tone, velocity catch,
fast-fist pay-out, deterministic noise, latency and lifecycle.
Hardware bench verification remains a team task; these tests never flash or move
physical servos.
