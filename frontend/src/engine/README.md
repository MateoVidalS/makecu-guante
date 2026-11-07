# Deterministic engine integration

The factories in `index.ts` replace the WP0 stubs. Drive them with monotonic
milliseconds in `start`, `tick`, and lifecycle methods; execute returned commands
in array order and deliver events to subscribers. `phaseElapsed`, `t_rel`, trace
times and `time_to_position_s` are seconds. Attempt indexes start at zero; reps
start at one. The plan runs each item's repetitions before the next item.

The engine does not read a clock. Supply a fixed monotonic-to-UTC mapping for
persisted timestamps, captured by the runtime outside the engine, for example:

```ts
const options = {
  timestamp: (now: number) => new Date(epochOffsetMs + now).toISOString(),
};
const exercise = createExerciseEngine(options);
const evaluation = createEvaluationEngine(options);
```

The default timestamp conversion interprets the injected `now` as Unix epoch
milliseconds, which is useful in deterministic tests. Live `performance.now()`
requires the offset above. This option is local to `src/engine`; contracts are
unchanged.

Exercise publishes all results through `attempt_done` and `session_done`.
Evaluation publishes its final result in `state().result`; no evaluation event
was added to the frozen `EngineEvent` union. Both paths report safety through
existing safety events. A fault telemetry frame without its matching event
still pauses exercise; the actual cause is reported if the event arrives later.

For calibration step 3, call `frictionRun(options)` to create a driver with the
same `start(settings, calibration, now)`, `tick`, `stop`, and `state` interface.
After `state().stage === 'done'`, `curves()` returns raw-current friction curves
at each configured speed, binned to 0.05 position. Aborted sweeps are omitted;
a stopped run returns no curves. It never subtracts an existing calibration.
The UI remains responsible for confirming the glove is off the hand for this
run, or that the hand is relaxed for an evaluation. `friction_used` is true only
when every recorded evaluation sweep had a curve at its requested speed.

Safety decisions that need coordinator review:

- The brief forbids `target` at confidence below 0.6, while the phase table asks
  for a freeze `target` after 300 ms unseen. Exercise releases at 300 ms instead
  and pauses at 1 s. If visibility returns after that release, explicit resume
  is still required. The deadline spans ASSIST and ASSIST_HOLD.
- Detected frames must have finite closures and be no older than 300 ms.
  Evaluation also requires good vision before starting a sweep and aborts a
  moving sweep on lost vision, because its API has no pause/resume operation.
- A PRESENT re-prompt uses the existing `phase: PRESENT` event every 8 seconds;
  the contracts have no separate instruction-repeat event.

The engine adds browser-side precautions to firmware safety. Firmware remains
responsible for its own STOP latch, watchdog, current limit, and calibrated
position/speed clamps.

Five-finger assist uses `PowerAwareExerciseSettings` (an engine-local extension
of the frozen settings contract). `assist_stagger_ms` defaults to 150 ms and
may be increased; `assist_max_parallel` defaults to 3 and may be reduced to 1
or 2. Invalid values are rejected before commands are emitted. The scheduler
starts one unreached finger at a time, largest vision-to-target gap first,
including opening movements. It holds free, reached, and queued fingers at the
measured servo position. Vision drift can queue a newly unreached finger; it
cannot bypass the stagger or restart the other motors. A slot remains occupied
until telemetry confirms arrival at its command. Settling requires the queue
and moving set to be empty for one second. Assisted destinations and assisted
reach checks use the 0.95 calibrated-range cap.

Resistance uses per-finger provisional stall-current profiles matching F1/F2
(thumb/index/middle/ring/pinky: 650/800/750/650/650 mA). The extra-current
threshold is `min(250, stall_ma * 250 / 800)`. Bench values can be injected via
`EngineOptions.servoProfiles`. Attribution uses the largest ramped servo
setpoint (`tel.a`) minus vision gap in the last 300 ms, across all five fingers.
Resistance requires a current gap above 0.05 in addition to sustained excess
current and stalled vision: ordinary camera noise around a settled finger must
not stop a different finger's staggered movement. A resistance stop freezes all
servo commands and cancels further queued starts. These checks supplement the
independent firmware limits.

Evaluation still reports per-sweep closure in `progress`; its local state also
returns `completedSweeps`, `totalSweeps`, and `overallProgress` for a session
progress display. The default selection runs ten slow/fast sweeps over all five
fingers. A subset retains selection order and removes duplicates. Friction is
looked up independently for each finger and speed. The runtime can expose the
additional settings and progress fields when the shared contracts are updated.

The AI therapist policy lives in `therapy.ts`. Exercise phase entry consumes its
bounded overrides before actions run. Target speeds never exceed 0.30/s or the
session's lower selected cap. Since the wire accepts one speed per full-vector
target, each scheduler command uses the minimum configured speed of the moving
fingers. This conservatively slows concurrent fingers; it preserves the 150 ms
stagger, maximum parallel count, calibrated target cap and current protections.
`EngineOptions.onTherapyOutput` lets the runtime execute immediate release/lower
commands synchronously. Unit tests capture that callback using the same fake world
as normal engine outputs; generated tool sequences verify motor-command invariants.
