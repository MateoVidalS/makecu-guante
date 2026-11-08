# 06 — Session engine: exercise, assist-as-needed, evaluation, metrics

Code: `frontend/src/engine/` (WP4). **Pure TypeScript**: no React, no DOM, no timers. It is driven by `tick(input)` calls
carrying time, the latest `VisionFrame` and the latest `GloveTelemetry`, and it returns `{ commands: GloveCommand[], events: EngineEvent[] }`.
The runtime (WP10) feeds it and executes the commands. Types: `03-contracts.md §3`.

## 1. API

```ts
interface EngineInput { now: number; vision: VisionFrame | null; tel: GloveTelemetry | null;
                        gloveEvents: GloveEvent[]; gloveConnected: boolean }
type GloveCommand = { t: "target"; f: Quint; v: number } | { t: "follow"; f: Quint } | { t: "release" } | { t: "limit"; ma: number };
interface ExerciseEngine {
  start(plan: ExercisePlanItem[], settings: ExerciseSettings, calibration: Calibration, now: number): Output;
  tick(input: EngineInput): Output;
  pause(now: number): Output; resume(now: number): Output; skip(now: number): Output; stop(now: number): Output;
  state(): { phase: ExercisePhase; pose: PoseId; rep: number; index: number; total: number; phaseElapsed: number };
}
interface EvaluationEngine { start(settings: EvalSettings, calibration: Calibration, now: number): Output; tick(input: EngineInput): Output; stop(now: number): Output; state(): {...} }
```
Run at the vision rate (~30 Hz) plus one tick per telemetry message (the runtime calls `tick` on both).

## 2. Pose library (`contracts/poses.ts`, WP0 writes it from this table)

| Pose | thumb | index | middle | ring* | pinky* | Render joints (index–pinky: MCP/PIP/DIP °; thumb MCP/IP) | Instruction |
|---|---|---|---|---|---|---|---|
| `open` | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0/0/0; thumb 0/0 | "Open your hand wide" |
| `hook` | null | 0.6 | 0.6 | 0.6 | 0.6 | 0/90/70; thumb 10/10 | "Make a hook: bend the top two joints" |
| `tabletop` | null | 0.35 | 0.35 | 0.35 | 0.35 | 90/0/0; thumb 20/10 | "Make a tabletop: bend only at the knuckles" |
| `straight_fist` | 0.5 | 0.7 | 0.7 | 0.7 | 0.7 | 90/100/0; thumb 40/30 | "Make a straight fist" |
| `full_fist` | 0.7 | 1.0 | 1.0 | 1.0 | 1.0 | 90/100/80; thumb 50/50 | "Make a full fist" |
| `pinch` | 0.5 | 0.55 | null | null | null | index 50/50/20, others 0; thumb 30/30 | "Pinch your thumb and index finger together" (`pinch.max_ratio` = calibrated `pinch_closed` × 1.3) |

\* Ring and pinky are rendered in the target hand but never scored or assisted (`scored=false`). A `null` target = free.
**Known limitation:** closure % is the *sum* of joint flexion, so hook, tabletop and straight fist differ in their targets but not in which joint
moves. The glove (one tendon per finger) can't shape individual joints either. A per-joint "shape match" is a stretch metric.

**Default plan** (the README's acceptance demo): `open, hook, tabletop, straight_fist, full_fist` × 3 reps. The pinch plan is optional.

## 3. Exercise state machine

```
PRESENT ──present_s──> ATTEMPT ──reached (dwell)──> HOLD ──hold_s──> RELEASE ──> REST ──rest_s──> next PRESENT | DONE
                          │
                          └──timeout(attempt_s) or plateau──> ASSIST ──reached or settled──> ASSIST_HOLD ──hold_s──> RELEASE
 any active phase ──safety event──> PAUSED ──resume──> RELEASE (attempt recorded as interrupted) ──> REST
```

| Phase | Glove commands | Rules |
|---|---|---|
| PRESENT | `release` on entry | The UI shows the target pose and the voice says the instruction. The patient may already move (not scored yet). Lasts `present_s` (default **3 s**) **and** needs the hand visible (confidence ≥ 0.6) for 0.5 s before ATTEMPT starts; it waits indefinitely (UI: "Show me your hand"), with a voice re-prompt every 8 s |
| ATTEMPT | `follow(vision closure of the glove fingers)` on every vision tick with confidence ≥ 0.6 | Track `active_max` (or `active_min` for the `open` pose) per scored finger, and the pinch min. **Reached** = every scored finger within `tolerance` of the target (closing: `closure ≥ target − tol`; open: `closure ≤ target + tol`) **and** the pinch ratio ≤ max (pinch pose), sustained for `reach_dwell_s` → `reached{assisted:false}` → HOLD. **Plateau:** after ≥ 3 s, if no scored finger improved by > 0.03 in the last `plateau_s` → end early. Timeout `attempt_s` → ASSIST (or RELEASE when `assist_enabled=false`) |
| HOLD | keep `follow` | After `hold_s`, record. Leaving the range during the hold doesn't fail (it's logged as `final`) |
| ASSIST | `target(to, assist_speed)` once on entry; refresh the target if vision drifts by > 0.1 | `to[i]` = the pose target for unreached scored fingers; for reached or free fingers, `to[i]` = their current closure (hold position). `null` targets → current servo `a`. Emits `assist_started`. Ends when vision reports reached for `reach_dwell_s` (`reached{assisted:true}`) **or** every servo's `a` has been within 0.02 of `to` for 1 s (settled) **or** `assist_max_s` passes |
| ASSIST_HOLD | keep the target | `hold_s`, then RELEASE |
| RELEASE | `release` | 0.5 s, then record the attempt (`attempt_done`) → REST |
| PAUSED | `release` | Entered on safety events. Leaves only on `resume()` (voice or button). If the firmware is in `fault`, the runtime has to send `release` first (to clear it), which the engine does on resume |
| REST | none (already released) | `rest_s` |

**Vision gating:** with confidence < 0.6, ATTEMPT stops sending `follow` (the servos keep their last goal; the watchdog stays fed by
the client's pings) and the timers keep running. In ASSIST, after 300 ms of low confidence → `release` (resolved from WP4: never send a `target` at low confidence, so release instead of freezing); after
1 s → safety `camera_lost` → PAUSED.

**Safety mapping:** glove `evt` `overcurrent` / `stop_button` / `watchdog`, a client disconnect, or `camera_lost` → `safety` event →
PAUSED. Finger attribution for overcurrent = the glove finger with the largest `(commanded a − vision closure)` gap during the last
300 ms (the one being pulled but not moving), else null.

**Resistance (pre-emptive):** during ASSIST, if `ma > baseline + 250` (baseline = median `ma` in the first 300 ms of ASSIST) for > 200 ms
and the attributed finger's vision closure hasn't increased by > 0.02 in that time → `resistance{finger, ma}` (once per attempt), and
freeze the target at the current `a` (so it stops pulling before the firmware's hard cut). The voice says "I feel resistance in your
index, let's stop here." The attempt continues to ASSIST_HOLD with what it achieved.

## 4. Attempt metrics
Per `AttemptResult` (contracts §3):
- `active_max` / `assist_needed` per scored finger: closing targets → `max(0, target − active_max)`; `open` → `max(0, active_min − target)`.
- `time_to_position_s` = ATTEMPT start → the first frame of the successful dwell window (active reach only).
- `active_ratio` = the mean over scored fingers of `clamp01(active_max / target)` (closing) or `clamp01(1 − active_min)` (open).
- `current_peak/mean` during ASSIST + ASSIST_HOLD; null if there was no assist.
- `trace` at 20 Hz from ATTEMPT start to RELEASE end (decimate the 30 Hz vision; sample-and-hold the telemetry).
- `SessionSummary` at the end (without `previous`, which the backend fills).

## 5. Evaluation mode (`evaluation.ts`)
Precondition: the patient's hand is **relaxed** in the glove (the UI asks and confirms), calibration exists, and the firmware is calibrated.
1. `limit(settings.limit_ma)` (default 600 mA, lower than exercise).
2. For each finger in `settings.fingers`, for speed in [slow 0.2/s, fast 1.0/s]: `release` → wait for `a≈0` + 1 s → `target(only this finger → 1.0, others → 0, v)`
   → record `(a, ma)` at the telemetry rate until `a ≥ 0.98` or overcurrent → `release` → wait 2 s.
   Overcurrent → `aborted_at = a`, the sweep is marked aborted, the next speed for that finger is skipped (and so is the fast one if slow aborted), and the
   **firmware fault is cleared with `release`** before continuing.
3. `excess_ma = ma − friction(finger, speed)(pos)`, linearly interpolated from the calibration's friction curves (0 if missing,
   `friction_used=false`).
4. Per finger: `resistance_slow/fast` = mean excess over pos 0.2–0.9; `velocity_dependence = fast − slow`; `peak_excess`.
5. Restore the exercise limit at the end.
Phases are exposed for the UI: `prepare`, `sweep{finger, speed, progress}`, `cooldown`, `done`.

**Friction calibration** uses the same sweep routine with the glove **off the hand** (calibration wizard step 3) and stores
`FrictionCurve`s (pos binned to 0.05).

## 6. Tests (vitest, deterministic, no timers)
A scripted fake `EngineInput` generator plus `SimWorld` from WP2 (when available; until then, the engine tests use their own tiny fake).
Scenarios: active reach → HOLD → no assist; partial → timeout → ASSIST → reached; plateau early-end; open pose; pinch pose; low confidence
in ATTEMPT (no follow sent) and in ASSIST (freeze, then camera_lost → PAUSED); overcurrent with finger attribution; resistance pre-emption;
STOP → PAUSED → resume sends `release` first; disconnect; skip/stop mid-attempt; the full default plan completes with 15 attempts;
evaluation: slow/fast sweeps, abort on overcurrent, friction subtraction, missing friction.
