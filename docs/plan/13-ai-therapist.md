# 13 — Live AI therapy assistant (Gemini Live + tool calling)

Turns the voice coach from a reactive commentator into a **therapy assistant that decides**: it watches each finger
live, gives specific feedback ("push your index a bit more"), checks in ("how does that feel?"), records how the patient
feels, and **adjusts the session through tools**: more or less help per finger, more time, rest, next pose, and braking.

## 1. Owner decisions
- **Autonomy:** the assistant applies its decisions on its own **within fixed safe limits**. Every decision is shown on screen
  with **Undo** and stored for the therapist (session replay + doctor view).
- **Braking:** (a) the patient asks for it ("stop", "it hurts", "enough"; Spanish too: "para", "basta", "me duele"), handled by a **local
  word rule before Gemini answers**; (b) **reported pain ≥ 4/10** → release + pause. The assistant may also call `brake` itself;
  braking only ever **releases**.
- **Limits:** fixed conservative defaults in code (§3). No therapist form for now.

## 2. Safety principles (non-negotiable)
1. The model never commands motors. Tools call the runtime's **coach control API**, which clamps every value and can only change
   engine settings inside §3. The firmware and engine safety rules are unchanged.
2. **Braking is always allowed and immediate** (release + pause). Nothing the model does can increase force beyond the calibrated
   range, the assist speed cap, or the current limit.
3. **Pain and stop words are deterministic and local** (no LLM in the loop). Gemini latency (~1.5 s first audio) never delays a brake.
4. Adjustments are rate-limited (at most one per finger per attempt) and apply at the **next phase boundary**, never mid-pull,
   except `brake` and lowering help, which apply immediately.
5. Everything is auditable: every tool call is logged with its requested args, clamped args, result and reason.

## 3. Tools (Gemini function declarations) and limits

| Tool | Args | Effect (clamped) | When it applies |
|---|---|---|---|
| `get_live_state` | – | Returns `LiveTherapyState` (§4), including the glove state/current, the last safety event and the highlighted finger | immediately |
| `adjust_help` | `finger` (thumb…pinky \| `all`), `direction` (`more` \| `less` \| `gentler`), `reason` | **more** = the glove starts helping this finger sooner (per-finger assist delay −1 s, within **[1, 9] s**); **less** = later (+1 s); **gentler** = slower assist for this finger (−0.05/s within **[0.10, 0.20]/s**). **Assist speed never goes above the default 0.20/s** (spasticity is velocity dependent: faster pulling raises resistance). A `resistance` event on a finger lowers its speed automatically | next ATTEMPT (gentler/less: immediate) |
| `assist_finger_now` | `finger`, `reason` | Starts glove help on that finger now, at its (gentle) assist speed, to the shaped target; same stagger/power rules | immediately, only in ATTEMPT |
| `adjust_target` | `finger`, `direction` (`lower` \| `raise`), `reason` | **Shaping**: that finger's required closure = pose target × scale, scale ± 0.1 within **[0.5, 1.0]**; never above the calibrated range | next ATTEMPT |
| `highlight_finger` | `finger` | Highlights the finger on the virtual hand for ~4 s while the coach names it (helps aphasia/neglect) | immediately |
| `note_for_therapist` | `text` | Stores a clinical note (e.g. "reports tingling in the little finger"); shown in replay and fed to the therapist summary | immediately |
| `repeat_pose` | `reason` | One more rep of the current pose (≤ 3 extra reps per session) | after the current attempt |
| `intensify` | `finger`, `kind` (`further` \| `hold_longer` \| `faster`), `consent` (`patient_asked` \| `accepted_offer`), `patient_quote` | **Patient-requested intensity** (owner decision, Nov 7): **further** = close that finger up to **100% of its calibrated range**; **hold_longer** = +≤ 2 s hold; **faster** = assist up to **0.30/s**. Allowed only if the patient asked, or said yes to the coach's offer, **within the last 20 s** (the voice layer reports patient speech via `therapy.notePatientSpeech`); blocked if pain ≥ 2 or a resistance event on that finger in the last 60 s; **reverted automatically** if resistance or pain appears. The coach may *offer* more intensity after good progress, but never applies it without a yes | next ATTEMPT |
| `set_attempt_time` | `seconds`, `reason` | Attempt time within **[4, 9] s** (default 6) | next ATTEMPT |
| `add_rest` | `seconds`, `reason` | Extra rest before the next pose, **≤ 20 s** per call, ≤ 60 s per session | next REST |
| `choose_next_pose` | `pose`, `reason` | Overrides the next pose from the plan's poses (not pinch); the plan length doesn't change | next PRESENT |
| `record_feeling` | `pain` 0–10, `fatigue` 0–10, `note` | Stores a feeling entry; **pain ≥ 4 → brake + pause** (deterministic) | immediately |
| `brake` | `reason` | `release` + PAUSED (safety source `coach_brake`) | immediately |
| `undo_last_adjustment` | – | Reverts the last non-brake adjustment | next boundary |
| (kept, session control) `pause_session`, `resume_session`, `skip_pose`, `repeat_instruction`, `stop_session`, `get_progress` | | unchanged | |

Rejected calls (out of range, unknown finger, too frequent, session not running) return `{ok:false, reason}` to the model,
which must say something natural and not retry blindly.

**Never available to the model:** direct motor commands, raising the current limit (it is the emergency brake: raising it only delays the cut when a finger jams), changing calibration (a person sets the comfortable range with the hand in the glove), and raising intensity on its own initiative. Intensity above the gentle defaults is possible only through `intensify`, at the patient's request, inside the calibrated range.

## 4. Contract additions (**source of truth: `frontend/src/contracts/therapist.ts`**, updated Nov 7 with the tools above; TypeScript in `frontend/src/contracts/therapist.ts`, Pydantic in `backend/app/contracts/therapist.py`)
```ts
type CoachToolName = "get_live_state" | "adjust_help" | "set_attempt_time" | "add_rest" | "choose_next_pose" |
  "record_feeling" | "brake" | "undo_last_adjustment";
interface TherapyLimits { assist_speed: [0.10, 0.30]; assist_step: 0.05; attempt_s: [4, 9]; rest_add_max_s: 20;
  rest_total_max_s: 60; pain_brake_at: 4 }
interface TherapyAdjustments {                // current per-session overrides (start = defaults)
  assist_speed: Record<FingerId, number>; attempt_s: number; extra_rest_s: number; next_pose: PoseId | null }
interface LiveTherapyState {
  phase: ExercisePhase; pose: PoseId; rep: number; index: number; total: number; seconds_in_phase: number;
  fingers: { finger: FingerId; now: number | null; target: number | null; best_alone: number | null;
             glove_helping: boolean; lagging: boolean }[];    // lagging = farthest below target
  last_attempt: { reached_alone: boolean; assisted: boolean; active_ratio: number } | null;
  adjustments: TherapyAdjustments; last_feeling: { pain: number; fatigue: number; minutes_ago: number } | null }
interface CoachDecision { id: string; t: string; session_id: number | null; tool: CoachToolName | string;
  requested: Record<string, unknown>; applied: Record<string, unknown> | null;
  result: "applied" | "clamped" | "rejected" | "undone"; reason: string; source: "coach" | "local_rule" | "patient_ui" }
interface FeelingEntry { t: string; session_id: number; attempt_index: number | null; pain: number; fatigue: number;
  note: string; source: "voice" | "ui" }
// Runtime additions (Runtime.therapy):
interface TherapyApi { state(): LiveTherapyState; adjust(tool: CoachToolName, args: object, source: CoachDecision["source"]): CoachDecision;
  undo(): CoachDecision | null; brake(reason: string, source: CoachDecision["source"]): CoachDecision;
  recordFeeling(f: Omit<FeelingEntry, "t" | "session_id" | "attempt_index">): CoachDecision;
  decisions(): CoachDecision[]; onDecision(cb: (d: CoachDecision) => void): Unsubscribe; limits: TherapyLimits }
```
REST: `POST /api/sessions/{id}/coach_decisions {decisions: CoachDecision[]}`, `POST /api/sessions/{id}/feelings {feelings: FeelingEntry[]}`;
`SessionDetail` gains `coach_decisions` and `feelings`; the session/therapist summaries include feelings and the decisions taken.

## 5. Coaching behavior (prompt + context)
- **Live state stream:** during ATTEMPT/ASSIST/HOLD the client pushes a compact `[live]` line every ~1 s (no speech trigger):
  per finger now/target/best, which finger is lagging, glove helping. Phase events keep their existing `[session]` pushes.
- **Speaking rules:** one short, specific line during an attempt, naming the lagging finger ("A bit more with your index"); praise
  when reached ("Very good!"); after each attempt one sentence; **every 2–3 attempts, a check-in** ("How does your hand feel, from
  0 to 10?") and `record_feeling` with the answer.
- **Decision rules** (in the prompt, applied at phase boundaries): repeated assist on the same finger → `adjust_help less` is never
  used to push harder; instead `set_attempt_time` +1–2 s or `adjust_help more` (faster help) when the patient is tiring; fatigue ≥ 6 →
  `add_rest`; pain ≥ 4 is handled locally (the model just acknowledges); always give the `reason` in plain words.
- The assistant tells the patient what it changed ("I'll give your index a bit more help").

## 6. Work packages (parallel; Codex workers via Orca)
| WP | Owns | What |
|---|---|---|
| **A1 Therapy core** | `frontend/src/engine/**`, `frontend/src/runtime/**` (the TS contract `frontend/src/contracts/therapist.ts` is already written by the coordinator; make `Runtime.therapy` required when done) | The coach control API (`Runtime.therapy`), clamping/rate limits, per-finger assist speed in the engine stagger, attempt time/rest/next-pose overrides at boundaries, undo stack, `brake`, pain ≥ 4 policy, `LiveTherapyState`; unit tests incl. "no tool can increase force" property test |
| **A2 Voice** | `frontend/src/voice/**`, `backend/app/voice/**` | New function declarations + dispatcher to `runtime.therapy`, the therapist prompt, the 1 s `[live]` stream, check-in cadence, **local stop/pain word rule** on patient transcription (EN+ES), fallback (simple voice) still brakes on words; tests with `FakeTransport` |
| **A3 Backend** | `backend/app/contracts/therapist.py` (Pydantic mirror of §4), `backend/app/db/**`, `backend/app/api/**`, `backend/app/llm/**`, `backend/tests/**` | Tables for decisions and feelings, endpoints, `SessionDetail` additions, summaries mention feelings/decisions, export columns |
| **A4 UI** | `frontend/src/pages/{Exercise,SessionReplay,Doctor}/**`, `frontend/src/components/**` | Live: a compact "Coach decisions" line/timeline with Undo (and "Brake" always visible), the feeling check-in as a big 0–10 tap fallback; Replay: decisions + feelings on the timeline; Doctor: pain/fatigue trend + decisions summary. Must keep 1280×720 no-scroll |
| **A5 Integration** (after A1–A4) | `frontend/e2e/**`, docs | e2e with a scripted fake Gemini transport issuing tool calls (adjust, rest, feeling pain 5 → brake, stop word → brake, undo), docs/DEMO.md "AI therapist" moment |

A2 and A4 code against the `TherapyApi` contract above (stub `runtime.therapy` locally until A1 merges).
