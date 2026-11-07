# 08 — Frontend: virtual hand, pages, components

## 1. Visual system
**Defined in `11-ux-design.md` §2–4** (tokens, typography, motion, sound, the app shell with Setup/Data, Focus and Doctor densities, and
the core components). That doc is the design spec; this one lists the content of each page.

## 2. Routes (App.tsx, WP0)
| Route | Page | Owner |
|---|---|---|
| `/` | Home | WP7 |
| `/setup` | Connect glove + camera, live diagnostics, simulator controls | WP7 |
| `/calibrate` | Calibration wizard | WP7 |
| `/exercise` | Plan picker → live exercise → summary | WP7 |
| `/evaluate` | Evaluation mode | WP7 |
| `/history` | Tabs: Overview · Active range · Assistance · Resistance · Sessions | WP9 |
| `/history/sessions/:id` | Session replay | WP9 |
| `/history/evaluations/:id` | Evaluation detail (curves) | WP9 |
| `/doctor` | Doctor view (own layout, read-only) | WP9 |
| `/profile` | Profile | WP9 |
| `/_dev/hand` | Virtual hand gallery (all poses, sliders) | WP6 |

## 3. Virtual hand (WP6, `src/hand3d/`)
- `@react-three/fiber` scene with a **procedural hand rig**: no external model needed. Palm = a rounded box; each finger = 3 capsule
  phalanges with the joint pivots (thumb: metacarpal + 2 phalanges, set at an opposition angle). Proportions come from a small table. Left/right
  mirroring.
- `<VirtualHand target={JointMap | null} actual={() => JointMap | null} state={(finger) => "idle" | "active" | "assist" | "reached"} />`:
  - **Target ghost**: translucent grey, posed from `PoseDef.render`.
  - **Actual hand**: solid, posed **every frame** from a getter (reads the latest `VisionFrame.joints` through a ref, never React props);
    the joint angles are slerped (α 0.5) for smoothness. Glove fingers are tinted by state (blue active, orange assist, green reached); ring/pinky
    are neutral. Without joints (no detection), the hand fades to 30% and shows "Hand not visible".
  - The camera is fixed at a 3/4 palm view, with soft lighting and no orbit controls in the patient views (they're allowed in `/_dev/hand`).
- `jointsFromClosure(closure, pose)`: synthesizes plausible joint angles from closure only (used by SimVision when there are no joints and in demos).
- Performance: ≥ 55 fps on a laptop with the camera running; there are no allocations in `useFrame`.
- Tests: rig math (joint transforms, mirroring) with vitest; a visual check through `/_dev/hand` (screenshot in the PR).

## 4. Pages (WP7)

### Home
Greeting (pseudonym), big buttons **Start exercise** / **Evaluate**, status checklist (glove connected · calibrated · camera seeing the hand), last
session card (date, active ratio, sparkline over the last 5 sessions), a "Calibration needed" callout.

### Setup (`/setup`)
- **Glove:** Connect (Web Serial gesture) / Reconnect / Disconnect, `info` (fw, limit, calib), a live telemetry panel: 3 position bars
  (`a` vs. `tg`), a current sparkline (last 10 s) with the limit line, state + mode, an event log. Buttons: Release, Send calibration.
- **Camera:** device picker, CameraOverlay, confidence, handedness, the mirror toggle.
- **Simulator panel** (when a sim is active, or `?dev=1`): patient preset (mild / moderate / severe), rigid index toggle, press STOP,
  unplug USB, hand out of frame.
- A browser support banner if `navigator.serial` is missing.

### Calibrate (`/calibrate`), a 3-step wizard (+ review)
1. **Servo ranges** (glove on the hand, hand relaxed): per finger, jog buttons (−5° / −1° / +1° / +5°) and a slider (sends `jog`) to find
   *open* (thread just taut, finger fully open) → "Set open", then *closed* (comfortable full flexion, no pain) → "Set closed". The UI enforces a ≥ 20°
   difference and shows a warning if the current rises above 400 mA while jogging. Ends with `calib` ×3 → wait for `calib_ok`.
2. **Camera range:** confirm the affected hand + the mirror toggle. "Open hand" → hold 2 s (`captureStats`). "Glove closes the hand" →
   `target([1,1,1], 0.3)` with the hand relaxed → hold 2 s capture → `release`. Ring/pinky closed = "make your best fist" with the free fingers, or
   skip (defaults: closed = open + 180°). Pinch: "touch thumb to index" (helper-assisted if needed) → capture.
3. **Friction** (glove **off** the hand, hanging free): `runtime.evaluation.runFriction(all)` → shows the curves. Skippable (Evaluation then reports
   `friction_used=false`).
4. **Review & save:** a summary table → `runtime.calibration.save` → `sendToGlove`. The current limit is editable (default 900 mA, max 1400).

### Exercise (`/exercise`)
1. **Plan:** pick the default plan (5 tendon glides × 3) or the pinch plan, or customize poses/reps; settings in an "Advanced" drawer (contracts
   `ExerciseSettings` with defaults); an "Observation only (no glove help)" toggle. Start → `runtime.exercise.start`.
2. **Live:** the large VirtualHand (≈ 60% of the width); on the side: the pose name + instruction, a phase pill with a countdown ring, per-finger bars (target marker,
   the live closure, the active-max tick, an orange assist overlay), small camera PiP, coach panel (status, mute, caption of the last coach line),
   buttons Pause/Resume · Skip · Stop. Keyboard: Space pause/resume, S skip, Esc stop (confirm). On a safety event: a full-width red banner with
   the reason + a "Resume" button (which sends release first).
3. **Attempt toast** after each attempt: active %, per finger, assisted ✓/✗, time.
4. **Summary:** the SessionSummary vs. the previous session, the Gemini patient summary (loading → text; unavailable → hidden), buttons: Again ·
   History · Home.

### Evaluate (`/evaluate`)
A checklist ("Hand relaxed in the glove", "Calibrated", "Glove connected") → Start → a live chart of current vs. position for the current sweep,
with the friction curve overlaid → per-finger result cards (slow, fast, dependence; aborted badge) → Save (automatic) → link to the history detail.

### Common components (WP7, `src/components/common/`)
GloveChip, CameraChip, PhaseRing, FingerBars, SafetyBanner, AttemptToast, SessionSummaryCard, Toasts, ConfirmDialog, BrowserSupportBanner.

## 5. History, replay, doctor (WP9)
- **Overview:** KPIs (sessions, attempts, days practiced in the last 7, evaluations), per-finger "first vs. last active range" cards.
- **Active range:** a line chart per finger (3 small multiples, x = session date, y = mean active max %, a dashed baseline at the first
  session), a pose filter, demo points hollow and labeled.
- **Assistance:** assist needed % and assisted rate per finger over sessions (lower is better).
- **Resistance:** slow vs. fast resistance per finger over evaluations (grouped lines), with the velocity-dependence callout.
- **Sessions:** a table (date, plan, attempts, active ratio, assisted, safety events, demo badge) → replay.
- **Session replay:** attempt list (↑/↓); a chart with vision closure (solid) and servo position (dashed) per glove finger + current on a
  secondary axis + phase background bands + safety markers; the metrics row; a collapsible transcript; delete with confirm.
- **Evaluation detail:** current-vs-position curves per finger, slow vs. fast, with friction.
- **Doctor view:** its own layout and banner "Doctor view · read-only", Exit; profile card; all the history charts in compact form; the
  latest therapist summary + "Generate (last 7 days)"; Export JSON / CSV; Print (print CSS: white, no nav, no chart splits).
- **Profile:** a form.
