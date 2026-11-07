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
