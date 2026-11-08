# Deterministic engine integration

The factories in `index.ts` are pure TypeScript. Drive `start`, `tick` and
lifecycle methods with monotonic milliseconds, execute returned commands in
array order, and deliver events to subscribers. `phaseElapsed`, `t_rel`, trace
times and `time_to_position_s` are seconds. Attempt indexes start at zero; reps
start at one. Each plan item's repetitions run before the next item.

Motion and safety timing use the injected clock. Audit IDs and timestamps use
wall time. The runtime should capture a monotonic-to-UTC offset and pass
`{ timestamp: (now) => new Date(epochOffsetMs + now).toISOString() }` to both
factories. The default interprets `now` as Unix epoch milliseconds for tests.
These options are local to the engine; shared contracts are unchanged.

Exercise publishes `attempt_done` and `session_done`. Evaluation publishes its
result in `state().result`. Both retain the existing safety events. A fault
telemetry frame pauses exercise even if its matching event has not arrived;
the actual cause is reported when that event arrives.

## Opening assistance

Vision, poses, metrics and `assist_started.from/to` use **closure** (0 open,
1 closed). All motor commands, telemetry and scheduler goals use **tendon
pull** (0 slack, 1 fully wound). Conversion only uses `pullFromClosure` and
`closureFromPull` from `contracts/glove.ts`; a recursive source test guards
against independent inversion formulas. Pull 0 remains the safe state.

ATTEMPT and HOLD send mapped follow commands; firmware subtracts 0.08 slack.
An opening deficit is `vision closure > target + tolerance` on a scored finger.
Closing deficits receive no assistance. If no opening deficit remains at
ATTEMPT timeout or plateau, the engine goes directly to RELEASE, with
`assisted=false` and no final reach claim. Observation mode also skips ASSIST.
Opening plateaus track the absence of a decrease greater than 0.03; open-pose
active metrics use the best active minimum. `assist_needed` records only an
opening deficit outside tolerance, never an unassistable closing deficit.

`PowerAwareExerciseSettings` adds `assist_stagger_ms` (default/minimum 150 ms)
and `assist_max_parallel` (default/maximum 3). Invalid values are rejected
before commands. The scheduler starts one finger per tick, largest opening
deficit first. Its queue and start clock persist across early assistance in
ATTEMPT and the transition to ASSIST. A winding slot stays occupied until
telemetry confirms arrival. Queued, reached, free or otherwise held fingers
use `min(tel.a, max(0, pullFromClosure(vision) - 0.08))` on every target refresh,
including ASSIST_HOLD. Held fingers may only pay out. Safe payout remains
immediate even while other fingers wind.

Ordinary pull goals are capped at `MAX_ASSIST_PULL` (0.95). Only consented
`intensify('further')` permits pull 1.0 for that finger. Assisted opening reaches
at `closure <= max(target, closureFromPull(cap)) + tolerance`; settling requires
all queued/moving fingers to finish and every commanded pull to be within 0.02
for one second. The assist time budget starts with the first actual help,
including early assistance, and is not extended by a phase transition.

## Sustained-load governor and resistance

`EngineOptions.currentLimitMa` accepts the runtime's active firmware `info.limit`.
If omitted, the engine uses the calibration's `current_limit_ma`; invalid limits
are rejected. The governor's ceiling is 80% of that limit. In ASSIST,
ASSIST_HOLD and early assisted ATTEMPT it blocks new starts as soon as current
exceeds the ceiling. After 200 ms continuously above it, the newest started
finger's pull goal decreases by 0.05, then again every 200 ms while high. It
works backwards through started fingers as each returns to its safe held pull.
Shed goals cannot restart at a higher pull during the attempt. Current below
the ceiling clears the blocking window; ordinary queued fingers may then start.

Each reduction records `{ source: 'load_shed', finger, ma, t_rel }` in the
attempt's `safety_events`. It is not an `EngineEvent` and does not pause or
claim a hardware fault. This is a reactive governor with a 200 ms observation
window, not a hard current clamp; firmware current protection remains necessary.
The deterministic flexor-load test verifies recovery below the ceiling while
staying below the firmware limit. Exact deadlines use the fake firmware and scripted load. Integration tests
also run the complete opening plan against O2's mild, moderate and spastic
patient models, and resistance tests exercise its rigid-floor model.

Resistance profiles remain provisional (thumb/index/middle/ring/pinky:
650/800/750/650/650 mA); inject bench values with `EngineOptions.servoProfiles`.
The extra-current threshold is `min(250, stall_ma * 250 / 800)`. Attribution uses
the largest `tel.a - pullFromClosure(vision)` gap in the last 300 ms. Detection
requires sustained excess current, a present gap above 0.05 and no opening
improvement greater than 0.02 for 200 ms. Ordinary camera noise at a settled
finger must not stop its neighbors. Resistance cancels intensity, freezes each
finger at `min(tel.a, pull goal)`, cancels queued starts and lowers that finger's
speed for the session. Subsequent held refreshes can only lower these pulls.

## Vision and firmware safety

Detected frames require finite closures, confidence at least 0.6 and age at
most 300 ms. No motion command is emitted without safe telemetry and visibility.
During assistance, 300 ms unseen releases; 1 s unseen pauses. Visibility
returning after a release still requires explicit resume. The deadline spans
ATTEMPT, ASSIST and ASSIST_HOLD transitions. STOP, watchdog, overcurrent,
disconnect and fault telemetry release and latch PAUSED; resume releases first.
PRESENT repeats its existing phase event every 8 s while waiting for a hand.

Firmware remains independently responsible for STOP, watchdog, current limits,
calibrated clamps and asymmetric ramps. No browser policy replaces those rules.

## Therapy and evaluation

`therapy.ts` keeps ordinary speed at or below 0.20/s. Recent patient consent
permits at most 0.30/s, full opening or two extra hold seconds. Easier opening
scales opening range down and therefore raises target closure; closing poses
retain their closure scale. `further` sets an opening target to closure 0 and
is refused for closing poses. Patient requests recognize opening/stretching
words; closing words cannot authorize further opening. Pain, resistance and
safety still revoke intensity. No tool changes calibration or current limits.
Staged overrides apply before phase entry actions. Full-vector winding speed
uses the minimum speed cap among winding fingers. Pose copies sent to the UI
cannot mutate motor goals. `onTherapyOutput` dispatches immediate reductions
and releases through the same command path as ticks.

Evaluation measures **resistance to opening (flexor tone)** from a relaxed,
flexed hand. Each sweep winds only its selected finger to pull 0.95 and ends at
pull >= 0.93; other fingers stay at pull 0. Its prepare, cooldown, fault-clear,
low current limit and limit restoration rules are unchanged. Per-sweep `progress`
is pull. Local state also exposes `completedSweeps`, `totalSweeps` and
`overallProgress`; the default selection runs ten slow/fast sweeps.

`frictionRun(options)` uses the same driver with the glove **off the hand**.
Its full-range pull sweeps remain unchanged. After `stage === 'done'`, `curves()`
returns raw-current curves binned to 0.05, omitting aborted sweeps. A stopped run
returns none. Evaluation interpolates curves independently by finger and speed;
`friction_used` requires a curve for every recorded sweep. Evaluation aborts on
lost vision because its API has no pause/resume operation.
