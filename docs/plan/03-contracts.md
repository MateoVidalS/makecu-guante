# 03 — Contracts (source of truth)

Every work package codes against this file. **Workers must not change it.** If something is wrong or missing, work
around it locally and write a `## Contract change request` in the PR. The coordinator decides and updates this file
on the integration branch.

Implemented in WP0 as:
- `frontend/src/contracts/*.ts`: TypeScript types + the serial codec types + constants (frozen).
- `backend/app/contracts/*.py`: Pydantic v2 models for REST and DB-facing shapes (frozen).
- `firmware/lib/core/protocol.h`: the C++ message structs and constants (frozen after WP0; owned by WP1 for the implementation).
- `contracts/fixtures/*.json`: shared fixtures, validated by backend tests and type-checked by the frontend.

---

## 1. Vocabulary & units

| Term | Meaning |
|---|---|
| `GloveFinger` | All five fingers are actuated (**fixed at 5**, see `12-five-finger-update.md`). **Array order on the wire is always `[thumb, index, middle, ring, pinky]`** (index 0–4). |
| `FingerId` | `"thumb" \| "index" \| "middle" \| "ring" \| "pinky"`. Vision measures all five; the session engine scores and assists all five. |
| Closure | 0.0 = open, 1.0 = closed, per finger. Vision closure is normalized by the patient's camera calibration and may read up to 1.1. Servo position `a` is normalized by the servo calibration. |
| Speed `v` | Fraction of the calibrated range per second (e.g. 0.5 = half the range per second). |
| Current | Milliamps (mA), the **total** for all servos (one INA219). |
| Time | Browser `performance.now()` ms for live data; firmware `ms` = `millis()`; REST/DB use ISO-8601 UTC. |
| IDs | Integers (SQLite). |

---

## 2. Serial protocol (laptop ↔ ESP32)

USB CDC at **115200 baud**. One compact JSON object per line, `\n`-terminated, at most 200 bytes. Unknown fields are
ignored; unknown `t` → `err`. This extends `README.md §4.4` (the additions are marked ➕).

### 2.1 Laptop → ESP32

| `t` | Example | Allowed in state | Effect |
|---|---|---|---|
| `target` | `{"t":"target","f":[0.8,0.6,0.0,0.5,0.5],"v":0.5}` | `idle`, `run` | Ramp each servo to `f[i]` (clamped 0–1) at `min(v, V_MAX)`. Mode → `target`. State → `run` |
| `follow` | `{"t":"follow","f":[0.3,0.4,0.1,0.2,0.2]}` | `idle`, `run` | Take up slack: each servo goes to `max(0, f[i] − FOLLOW_SLACK)` at `V_FOLLOW`. It never pulls beyond the vision position. Mode → `follow`. State → `run` |
| `release` | `{"t":"release"}` | any | All servos → 0 at `V_RELEASE`, then PWM detaches after 500 ms. **Clears `fault`.** State → `idle` |
| `calib` | `{"t":"calib","i":1,"min":20,"max":150}` | `idle` | Servo angles (degrees) for 0% and 100% of finger `i` (0–4). Must satisfy `HARD_MIN ≤ min, max ≤ HARD_MAX` and `|max − min| ≥ 20`. `min > max` is allowed (mirrored mount) |
| `limit` | `{"t":"limit","ma":900}` | any | Overcurrent threshold, clamped to `[100, LIMIT_MAX_MA]` |
| `ping` | `{"t":"ping"}` | any | Keepalive (any valid message also feeds the watchdog) |
| ➕ `jog` | `{"t":"jog","i":1,"deg":95}` | `idle` (or `calib`) | Move servo `i` to an absolute angle within `[HARD_MIN, HARD_MAX]` at `V_JOG_DEG` deg/s. Used by the calibration wizard before a `calib` exists. State → `calib` |
| ➕ `hello` | `{"t":"hello"}` | any | Firmware answers with `info` |

Before all 5 fingers have received `calib`, `target` and `follow` are rejected with `err no_calib`.

**Client queueing rule (resolved from WP2):** `release` jumps the queue and **discards any not-yet-sent `target`/`follow`/`jog`** (stale motion must never restart the glove after a release). Other commands (`calib`, `limit`, `hello`, `ping`) are never dropped.

### 2.2 ESP32 → laptop

| `t` | Example | Rate | Meaning |
|---|---|---|---|
| `tel` | `{"t":"tel","ms":12345,"a":[0.42,0.40,0.0,0.3,0.3],"ma":312,"st":"run","md":"follow","tg":[0.42,0.45,0.05,0.3,0.3]}` | 50 Hz | `a` = current **commanded, ramped** position per servo (0–1; hobby servos don't report their real position). `ma` = INA219 total current (filtered, 10 ms). `st` = state. ➕ `md` = mode `none\|follow\|target\|jog`. ➕ `tg` = the final target being ramped to |
| `evt` | `{"t":"evt","e":"overcurrent","ma":950}` | on event | `e`: `boot`, `overcurrent`, `stop_button`, `watchdog`, ➕ `stop_released` (button released, still faulted), ➕ `ina_missing` (sensor not found; target/follow refused), ➕ `calib_ok` (all 3 fingers calibrated) |
| ➕ `info` | `{"t":"info","fw":"0.2.0","fingers":5,"limit":1500,"calib":[[20,150],[25,160],null,null,null]}` | on `hello` and boot | Firmware identity + current config |
| ➕ `err` | `{"t":"err","c":"target","why":"no_calib"}` | on error | `why`: `bad_json`, `unknown_type`, `bad_args`, `no_calib`, `fault`, `state` |

### 2.3 Firmware states

```
boot ──setup ok──> idle ──target/follow──> run ──release──> idle
                   │  └──jog──> calib ──release──> idle   (send `calib` only from idle: jog → release → calib)
any ──overcurrent / stop_button / watchdog──> fault ──release (and STOP not held)──> idle
```
In `fault`: servos have been released and detached; `target`, `follow` and `jog` are rejected with `err fault`.

### 2.4 Firmware constants (`firmware/include/config.h`)

| Const | Value | Meaning |
|---|---|---|
| `HARD_MIN` / `HARD_MAX` | 5° / 175° | Absolute servo angle limits |
| `V_MAX` | 1.0 /s | Speed cap for `target`, whatever the laptop asks |
| `V_FOLLOW` | 1.5 /s | Follow speed (it only takes up slack) |
| `V_RELEASE` | 3.0 /s | Release speed (unwinding is safe) |
| `V_JOG_DEG` | 60 °/s | |
| `FOLLOW_SLACK` | 0.05 | Follow stays 5% behind the vision closure |
| `LIMIT_DEFAULT_MA` / `LIMIT_MAX_MA` | 1500 / 2200 | Below the 2.5 A supply limit (5 servos) |
| `OVERCURRENT_MS` | 100 | Current above the limit for this long → fault |
| `WATCHDOG_MS` | 1000 | Elapsed time **strictly greater** than this with no valid message → release + fault (no fault at exactly 1000 ms; it fires on the next tick) |
| `TEL_HZ` | 50 | |
| `CONTROL_HZ` | 200 | Ramp/safety loop |

---

## 3. Frontend types (TypeScript)

```ts
// ---------- glove (src/contracts/glove.ts) ----------
type GloveFinger = FingerId;                            // all five are actuated
const GLOVE_FINGERS: GloveFinger[] = ["thumb", "index", "middle", "ring", "pinky"];
type Quint = [number, number, number, number, number];  // [thumb, index, middle, ring, pinky] (replaces Quint)
type FirmwareState = "boot" | "idle" | "run" | "calib" | "fault";
type FirmwareMode = "none" | "follow" | "target" | "jog";
type GloveEventKind = "boot" | "overcurrent" | "stop_button" | "watchdog" | "stop_released" | "ina_missing" | "calib_ok";

interface GloveTelemetry { t: number; ms: number; a: Quint; ma: number; st: FirmwareState; md: FirmwareMode; tg: Quint | null }
interface GloveEvent { t: number; e: GloveEventKind; ma?: number }
interface GloveInfo { fw: string; fingers: number; limit: number; calib: ([number, number] | null)[] }
interface GloveError { t: number; c: string; why: string }
type GloveConnection = "disconnected" | "connecting" | "connected" | "error";

interface GloveClient {                                  // implemented by WebSerialGlove and SimGlove (WP2)
  readonly kind: "serial" | "sim";
  connection(): GloveConnection;
  connect(): Promise<GloveInfo>;                         // serial: requestPort() needs a user gesture
  disconnect(): Promise<void>;
  target(f: Quint, v: number): void;
  follow(f: Quint): void;
  release(): void;
  calib(i: 0 | 1 | 2 | 3 | 4, minDeg: number, maxDeg: number): void;
  jog(i: 0 | 1 | 2 | 3 | 4, deg: number): void;
  limit(ma: number): void;
  hello(): void;
  onTelemetry(cb: (t: GloveTelemetry) => void): Unsubscribe;
  onEvent(cb: (e: GloveEvent) => void): Unsubscribe;
  onError(cb: (e: GloveError) => void): Unsubscribe;
  onConnection(cb: (c: GloveConnection) => void): Unsubscribe;
  latest(): GloveTelemetry | null;
}
// The client sends `ping` every 300 ms on its own whenever nothing else was sent, so the watchdog only trips on a real failure.

// ---------- vision (src/contracts/vision.ts) ----------
type FingerId = "thumb" | "index" | "middle" | "ring" | "pinky";
type Handedness = "left" | "right";
interface JointAngles { mcp: number; pip: number; dip: number }   // degrees of flexion; thumb: mcp, ip in pip, dip=0
interface VisionFrame {
  t: number;                                   // performance.now()
  detected: boolean;
  confidence: number;                          // 0..1; 0 when not detected
  handedness: Handedness | null;
  closure: Record<FingerId, number> | null;    // normalized + smoothed; null if uncalibrated or not detected
  rawFlexSum: Record<FingerId, number> | null; // degrees, smoothed, before normalization
  joints: Record<FingerId, JointAngles> | null;
  pinch: number | null;                        // thumb-tip↔index-tip distance / hand size (wrist→middle MCP)
  landmarks: [number, number, number][] | null;// 21 image-space points (for the overlay)
}
interface VisionSource {                        // implemented by CameraVision (WP3) and SimVision (WP2)
  readonly kind: "camera" | "sim";
  start(opts: { deviceId?: string; affectedHand: Handedness }): Promise<void>;
  stop(): void;
  setCalibration(c: CameraCalibration | null): void;
  onFrame(cb: (f: VisionFrame) => void): Unsubscribe;
  latest(): VisionFrame | null;
  videoElement(): HTMLVideoElement | null;      // camera preview (null for sim)
}
const VISION_LOW_CONFIDENCE = 0.6;              // below this, frames count as "not seen"

// ---------- calibration (src/contracts/calibration.ts) ----------
interface ServoCalibration { finger: GloveFinger; min_deg: number; max_deg: number }
interface CameraCalibration {
  affected_hand: Handedness;
  open_flex: Record<FingerId, number>;         // raw flex sum, open hand
  closed_flex: Record<FingerId, number>;       // raw flex sum, glove-closed relaxed hand (or the best active fist for ring/pinky)
  pinch_closed: number;                        // pinch ratio when thumb and index touch
  pinch_open: number;
}
interface FrictionCurve { v: number; points: { pos: number; ma: number }[] }   // empty glove, per finger and speed
interface Calibration {
  id: number; created_at: string;
  servo: ServoCalibration[];                   // 5
  camera: CameraCalibration;
  friction: Partial<Record<GloveFinger, FrictionCurve[]>>;   // slow and fast; may be empty if skipped
  current_limit_ma: number;                    // default 900
}

// ---------- poses (src/contracts/poses.ts) ----------
type PoseId = "open" | "hook" | "full_fist" | "tabletop" | "straight_fist" | "pinch";
interface PoseDef {
  id: PoseId; name: string; family: "tendon_glide" | "pinch";
  closure: Record<FingerId, number | null>;    // target per finger; null = free (not scored, not assisted)
  render: Record<FingerId, JointAngles>;       // joint angles for drawing the target hand
  pinch?: { max_ratio: number };               // pinch only: thumb-index tip ratio must be ≤ this
  instruction: string;                         // spoken/displayed, e.g. "Make a full fist"
}
// POSES (constant, in src/contracts/poses.ts; values in 06-session.md §2)

// ---------- session engine (src/contracts/engine.ts) ----------
type ExercisePhase = "PRESENT" | "ATTEMPT" | "HOLD" | "ASSIST" | "ASSIST_HOLD" | "RELEASE" | "PAUSED" | "REST" | "DONE";
interface ExercisePlanItem { pose: PoseId; reps: number }
interface ExerciseSettings {
  present_s: number; attempt_s: number; hold_s: number; assist_max_s: number; rest_s: number;   // 3, 6, 2, 6, 3
  tolerance: number;            // 0.10 closure
  reach_dwell_s: number;        // 0.5
  assist_speed: number;         // 0.3 /s
  plateau_s: number;            // 2.0 (no gain > 0.03 → end the attempt early, after at least 3 s)
  assist_enabled: boolean;      // false = observation only (no glove)
}
type EngineEvent =
  | { kind: "phase"; phase: ExercisePhase; pose: PoseId; rep: number; index: number }   // index = attempt index in the session
  | { kind: "reached"; t_rel: number; assisted: boolean }
  | { kind: "progress"; finger: GloveFinger; active_max: number }                        // throttled to at most 2 Hz per finger
  | { kind: "assist_started"; fingers: GloveFinger[]; from: Quint; to: Quint }
  | { kind: "resistance"; finger: GloveFinger; ma: number }                              // current high + finger not following
  | { kind: "safety"; source: "overcurrent" | "stop_button" | "watchdog" | "camera_lost" | "glove_disconnected"; finger: GloveFinger | null; ma: number | null }
  | { kind: "attempt_done"; result: AttemptResult }
  | { kind: "session_done"; summary: SessionSummary };

interface FingerAttemptMetrics {
  finger: FingerId; scored: boolean;
  target: number | null;
  active_max: number | null;     // max vision closure during ATTEMPT (for an "open" target: the min, i.e. best opening)
  assist_needed: number | null;  // max(0, target − active_max) for closing targets; max(0, active_min − target) for open targets
  final: number | null;          // vision closure at the end of the hold
}
interface AttemptResult {
  pose: PoseId; rep: number; index: number;
  started_at: string; ended_at: string;
  reached_active: boolean;       // reached without help
  reached_final: boolean;        // reached by the end (active or assisted)
  assisted: boolean;
  time_to_position_s: number | null;   // from ATTEMPT start to the active reach; null if not reached actively
  active_ratio: number;          // mean over scored fingers of clamp(active_max / target) (for open: 1 − active_min); 0..1
  fingers: FingerAttemptMetrics[];
  pinch_min: number | null;
  current_peak_ma: number | null; current_mean_ma: number | null;  // during ASSIST
  safety_events: { source: string; t_rel: number; finger: GloveFinger | null; ma: number | null }[];
  interrupted: boolean;
  trace: AttemptTrace;
}
interface AttemptTrace {                  // 20 Hz
  hz: 20; t: number[];                    // seconds from attempt start
  closure: Record<GloveFinger, (number | null)[]>;     // vision
  servo: Record<GloveFinger, number[]>;                // telemetry a
  ma: number[];
  phase: ExercisePhase[];
}
interface SessionSummary {
  attempts: number; reached_active: number; assisted: number; interrupted: number;
  active_ratio_mean: number;
  per_pose: { pose: PoseId; active_ratio_mean: number; assisted: number; reps: number }[];
  per_finger: { finger: GloveFinger; active_max_mean: number | null; assist_needed_mean: number | null }[];
  previous: { active_ratio_mean: number; per_finger: { finger: GloveFinger; active_max_mean: number | null }[] } | null;
}

// ---------- evaluation (src/contracts/evaluation.ts) ----------
interface EvalSettings { slow_v: number; fast_v: number; limit_ma: number; fingers: GloveFinger[] }   // 0.2, 1.0, 600, all
interface EvalSweep {
  finger: GloveFinger; speed: "slow" | "fast"; v: number;
  points: { pos: number; ma: number; excess_ma: number }[];   // excess = ma − friction(pos, speed)
  aborted_at: number | null;                                   // closure where overcurrent hit
}
interface EvalFingerResult {
  finger: GloveFinger;
  resistance_slow_ma: number | null;    // mean excess over pos 0.2–0.9
  resistance_fast_ma: number | null;
  velocity_dependence_ma: number | null;// fast − slow (spasticity proxy)
  peak_excess_ma: number | null;
  aborted: boolean;
}
interface EvaluationResult { started_at: string; ended_at: string; settings: EvalSettings; sweeps: EvalSweep[]; fingers: EvalFingerResult[]; friction_used: boolean }
```

// ---------- runtime (src/contracts/runtime.ts) ----------
// The runtime wires vision → engine → glove → voice → API. WP0 ships a scripted stub with this exact API;
// WP10 implements it for real. Pages (WP7, WP9) and voice (WP8) only talk to the runtime and the providers.
type Unsubscribe = () => void;
interface ExerciseView { phase: ExercisePhase; pose: PoseDef; rep: number; index: number; total: number; phaseElapsed: number;
                         phaseDuration: number | null; activeMax: Partial<Record<GloveFinger, number>>; assisting: boolean;
                         paused: boolean; sessionId: number | null; lastResult: AttemptResult | null; summary: SessionSummary | null }
interface EvaluationView { stage: "idle" | "prepare" | "sweep" | "cooldown" | "done" | "aborted"; finger: GloveFinger | null;
                           speed: "slow" | "fast" | null; progress: number; result: EvaluationResult | null }
interface Runtime {
  sources: { glove: "serial" | "sim"; vision: "camera" | "sim"; setGlove(k: "serial" | "sim"): Promise<void>; setVision(k: "camera" | "sim"): Promise<void> };
  calibration: { current: Calibration | null; reload(): Promise<void>; save(c: Omit<Calibration, "id" | "created_at">): Promise<Calibration>;
                 sendToGlove(): Promise<void> };            // sends the 3 calib + limit messages
  exercise: { start(plan: ExercisePlanItem[], settings: ExerciseSettings): Promise<void>; pause(): void; resume(): void; skip(): void;
              stop(): Promise<void>; view(): ExerciseView; subscribe(cb: (v: ExerciseView) => void): Unsubscribe;
              onEvent(cb: (e: EngineEvent) => void): Unsubscribe };
  evaluation: { start(settings: EvalSettings): Promise<void>; stop(): Promise<void>; view(): EvaluationView;
                subscribe(cb: (v: EvaluationView) => void): Unsubscribe;
                runFriction(fingers: GloveFinger[]): Promise<Partial<Record<GloveFinger, FrictionCurve[]>>> };  // wizard step 3
}
// React: <RuntimeProvider> + useRuntime(), useExerciseView(selector), useEvaluationView(selector), useGlove() (WP2), useVision() (WP3).
// useVision(): { source: VisionSource; latest: VisionFrame | null; subscribe(selector) }
```

---

## 4. REST API (FastAPI, `/api`)

Errors: `{ "error": { "code": "...", "message": "..." } }`. Pydantic models mirror the TS types above (snake_case everywhere).

| Method & path | Body | Response |
|---|---|---|
| `GET /api/health` | – | `{ ok, version, gemini: bool }` |
| `GET /api/profile` · `PUT /api/profile` | `Profile` | `Profile` |
| `GET /api/calibrations/latest` | – | `Calibration \| null` |
| `GET /api/calibrations` | – | `Calibration[]` newest first |
| `POST /api/calibrations` | `CalibrationIn` (Calibration without id/created_at) | `Calibration` |
| `POST /api/sessions` | `{ mode: "exercise", plan: ExercisePlanItem[], settings: ExerciseSettings, calibration_id, is_demo?: false }` | `Session` |
| `POST /api/sessions/{id}/attempts` | `AttemptResult` | `Attempt` (stored, with id) |
| `POST /api/sessions/{id}/end` | `{ summary: SessionSummary }` | `Session` |
| `GET /api/sessions?mode=&limit=&offset=` | – | `Session[]` newest first |
| `GET /api/sessions/{id}` | – | `SessionDetail` (attempts without traces, transcript, safety events) |
| `DELETE /api/sessions/{id}` | – | 204 |
| `GET /api/attempts/{id}/trace` | – | `AttemptTrace` |
| `POST /api/evaluations` | `EvaluationResult + { calibration_id, is_demo? }` | `Evaluation` |
| `GET /api/evaluations` · `GET /api/evaluations/{id}` | – | `Evaluation[]` / `Evaluation` |
| `POST /api/sessions/{id}/transcript` | `{ lines: TranscriptLine[] }` | 204 |
| `GET /api/history/overview` | – | `HistoryOverview` |
| `GET /api/history/rom?finger=&pose=` | – | `RomPoint[]` (active range per session, oldest first) |
| `GET /api/history/assist` | – | `AssistPoint[]` (assist needed per session per finger) |
| `GET /api/history/resistance` | – | `ResistancePoint[]` (per evaluation per finger: slow, fast, dependence) |
| `POST /api/summaries` | `{ kind: "session", session_id } \| { kind: "therapist", days: 7 }` | `Summary`. 503 `llm_unavailable` |
| `GET /api/summaries?kind=&limit=` | – | `Summary[]` |
| `POST /api/voice/token` | `{ session_id: number \| null }` | `VoiceToken`. 503 `voice_unavailable` |
| `GET /api/export?format=json\|csv` | – | file download (all sessions, attempts, evaluations; CSV = one row per attempt-finger) |

```ts
interface Profile { pseudonym: string; affected_hand: Handedness; condition: string; goals: string; therapist_name: string; therapist_email: string }
interface Session { id: number; mode: "exercise"; started_at: string; ended_at: string | null; calibration_id: number;
  plan: ExercisePlanItem[]; settings: ExerciseSettings; is_demo: boolean; summary: SessionSummary | null; n_attempts: number }
interface Attempt extends Omit<AttemptResult, "trace"> { id: number; session_id: number }
interface SessionDetail extends Session { attempts: Attempt[]; transcript: TranscriptLine[] }
interface Evaluation extends EvaluationResult { id: number; calibration_id: number; is_demo: boolean }
interface TranscriptLine { t: string; role: "coach" | "patient" | "system"; text: string }
interface Summary { id: number; kind: "session" | "therapist"; created_at: string; session_id: number | null; days: number | null; model: string; text: string }
interface VoiceToken { token: string; expires_at: string; model: string; voice: string; system_instruction: string; tools: object[] }
interface HistoryOverview { sessions: number; attempts: number; evaluations: number; days_practiced_last_7: number; last_session_at: string | null;
  per_finger: { finger: GloveFinger; active_max_first: number | null; active_max_last: number | null; assist_needed_last: number | null }[] }
interface RomPoint { session_id: number; started_at: string; finger: GloveFinger; pose: PoseId | null; active_max_mean: number; is_demo: boolean }
interface AssistPoint { session_id: number; started_at: string; finger: GloveFinger; assist_needed_mean: number; assisted_rate: number; is_demo: boolean }
interface ResistancePoint { evaluation_id: number; started_at: string; finger: GloveFinger; slow: number | null; fast: number | null; dependence: number | null; is_demo: boolean }
```

---

## 5. SQLite schema (`backend/data/rehab.db`)

```sql
profile(id PK CHECK(id=1), pseudonym, affected_hand, condition, goals, therapist_name, therapist_email)
calibration(id PK, created_at, servo_json, camera_json, friction_json, current_limit_ma)
session(id PK, mode, started_at, ended_at NULL, calibration_id FK, plan_json, settings_json, is_demo BOOL, summary_json NULL)
attempt(id PK, session_id FK, idx, pose, rep, started_at, ended_at, reached_active, reached_final, assisted,
        time_to_position_s NULL, active_ratio, pinch_min NULL, current_peak_ma NULL, current_mean_ma NULL, interrupted,
        safety_json)
attempt_finger(id PK, attempt_id FK, finger, scored, target NULL, active_max NULL, assist_needed NULL, final NULL)
attempt_trace(attempt_id PK FK, blob)                 -- gzip(JSON AttemptTrace)
evaluation(id PK, started_at, ended_at, calibration_id FK, settings_json, sweeps_blob, is_demo BOOL, friction_used BOOL)
evaluation_finger(id PK, evaluation_id FK, finger, resistance_slow_ma NULL, resistance_fast_ma NULL, velocity_dependence_ma NULL, peak_excess_ma NULL, aborted)
transcript_line(id PK, session_id FK, t, role, text)
summary(id PK, kind, created_at, session_id NULL, days NULL, model, text)
```
Cascade deletes from `session` and `evaluation`. WAL mode. Indexes on the foreign keys and `started_at`.

---

## 6. Configuration

Backend `backend/.env`:

| Var | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | – | Voice (Live) and summaries. Missing → voice uses the fixed-phrase fallback, summaries return 503 |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live-extended-thinking` | **Verify the current name** in Google's Live API docs |
| `GEMINI_LIVE_VOICE` | `Puck` | Verify |
| `GEMINI_TEXT_MODEL` | `gemini-4-argon` (falls back to gemini-3.8-flash, gemini-3.5-flash) | Verify |
| `REHAB_DB_PATH` | `data/rehab.db` | |
| `REHAB_PORT` | `8000` | |

Frontend (`frontend/.env`): `VITE_SIM=1` uses SimGlove + SimVision by default (also toggleable in the UI), and `VITE_MOCK_API=1`
serves REST from MSW fixtures.
