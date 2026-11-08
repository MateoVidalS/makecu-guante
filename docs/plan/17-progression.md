# 17 — Adaptive progression ("today's plan")

> **Nov 8.** Each practice can start from the patient's recent sessions instead of the same standard plan.
> **Off by default:** the therapist turns it on in the Doctor view. While it is off, practice, the demo and every
> stored record behave exactly as before.

## 1. Why

Before this, every session started from scratch. The coach adapted *within* a session (docs/plan/13), and history
recorded everything, but nothing fed the records back into the next session. Rehabilitation depends on progression:
the right challenge today, and less help as the patient improves. Constant help also builds dependence, which is
why README §5 lists "Fading feedback". This is the first, deliberately conservative step toward it.

## 2. What it does

From the last **3** completed opening-glove sessions (open-hand attempts that were not interrupted, same demo/real
cohort as the practice about to start), the browser computes **today's plan**:

| Rule | Value | Effect |
|---|---|---|
| **Per-finger target (shaping)** | A finger that reached the full opening alone in < 60% of recent tries gets `target_scale = ceil₀.₁(opening_alone + margin + tolerance)`, floor 0.6, max 1. Margin 0.10 (standard) / 0.05 (gentle) | The opening asked of that finger is a little beyond what it opens alone. Reached when opening ≥ scale − tolerance, i.e. roughly 0.1–0.2 more than its recent mean |
| **Full target** | ≥ 60% of recent tries reached alone, or not enough data | `target_scale = 1`: the standard pose target |
| **Time to try alone (fading)** | Open-hand attempts reached alone ≥ 70% → +2 s; ≥ 40% → +1 s; gentle at most +1 s; within `THERAPY_LIMITS.attempt_s` [4, 9] | Help is offered later, so the patient tries longer alone |
| **Strain hold** | Pain ≥ 2 or fatigue ≥ 6 recorded in the latest session | Trying time stays standard |
| **Minimum data** | A finger needs measurements from ≥ 2 sessions and ≥ 3 attempts | Otherwise that finger stays standard |

`opening_alone = 1 − active_max` of each open-hand attempt (the best opening during ATTEMPT, before any help).

With the seeded demo history (moderate → mild patient), standard challenge gives:
thumb 80%, index full, middle 90%, ring 80%, pinky 60%; standard 6 s to try alone.

## 3. Safety argument

- The plan can only **lower** opening targets (`target_scale ≤ 1`) or **add** time to try alone. It never changes
  assist speed, pull caps (`MAX_ASSIST_PULL`), current limits, staggering, help-on-request or any firmware rule.
- A lower opening target also lowers how far the glove pulls when the patient asks for help (the scheduler's goal
  comes from the shaped pose). Tested in `engine/progression.test.ts`.
- `TherapyController.reset` clamps the plan again to `THERAPY_LIMITS` (scale ≥ 0.5, ≤ 1; attempt_s in [4, 9], never
  below today's settings), so a bad or tampered plan cannot make practice harder. A clamped plan is logged `clamped`.
- The coach's live adjustments (`adjust_target`, `adjust_help`, …) start from the plan and keep their own bounds and
  consent rules. Undo does not revert the plan.
- The browser remains a second safety layer; the firmware is unchanged.
- Clinical framing: an estimate inspired by shaping and prompt fading. It is not a validated progression protocol;
  the therapist decides whether to use it.

## 4. Where it lives

| Part | File |
|---|---|
| Contract (switch only) | `frontend/src/contracts/progression.ts`, `backend/app/contracts/progression.py`, `contracts/fixtures/progression_settings.json`, 03-contracts §4.2 |
| Storage + REST | `progression_settings` table (one row), `GET/PUT /api/progression/settings` (`backend/app/api/progression.py`) |
| Planner (pure) | `frontend/src/progression/plan.ts`: `planToday`, `applyPlan`, `planSummary`, `PROGRESSION` constants |
| Hook | `frontend/src/progression/useTodaysPlan.ts`: loads the switch and recent session details, returns `apply(settings)` |
| Engine | `PowerAwareExerciseSettings.progression` → `TherapyController.applyProgression` (engine-local, never stored as contract settings) |
| Audit | One `CoachDecision` `tool: "progression_plan"`, `source: "local_rule"`, saved with the session (runtime enqueues start-time decisions); labeled "Today's plan applied" in replay and the coach timeline |
| Patient UI | `TodaysPlanCard` on the practice screen (`/exercise`, reached from Home → Customize plan): eased fingers, extra trying time, "Use today's plan" switch (on by default once enabled). Quick starts (Home, Setup, Calibrate) apply the plan without showing the card |
| Therapist UI | `AdaptivePlanSection` in the Doctor view: on/off, Standard/Gentle, preview table (opens alone, full opening alone, target) |
| Mock | MSW handlers in `frontend/src/mocks/handlers.ts` (off by default, reset with the mocks) |

Every "Start practice" button (Home, Setup safety check, Calibrate, Practice) passes its settings through
`apply`. `apply` returns the same settings object when the plan is off, still loading, failed to load, or standard,
so a slow or failed request never blocks or changes practice.

Cohort: like session records, any simulated source means demo data. The practice plan uses the cohort of the sources
selected at Start; the Doctor preview uses the cohort of the most recent opening session.

## 5. Demo impact

None unless someone turns it on. To show it (optional, ~30 s, after the History step of docs/DEMO.md): Doctor view →
**Adaptive plan** → turn on → Practice shows **Today's plan** for the demo patient (pinky 60%, …) → Start. Turn it off
again after the demo if the next presenter expects the standard plan.

## 6. Tests

- `frontend/src/progression/plan.test.ts`: thresholds, gentle vs standard, bounds, fading, strain hold, cohort window,
  `applyPlan` identity when unchanged, and the seeded demo story.
- `frontend/src/engine/progression.test.ts`: no plan = no change and no decision; plan applied and audited; clamping;
  lower glove pull; coach adjustments from the plan.
- `frontend/src/progression/progression.ui.test.tsx`: off by default (no card, same settings); Doctor switch → card →
  applied settings; per-session opt-out.
- `backend/tests/api/test_progression.py`: default off, roundtrip, validation, fixture.

## 7. Not done / follow-ups

- The Live coach sees the plan only through `LiveTherapyState.adjustments`; it is not told why. A sentence in the
  coach prompt could explain today's targets.
- Therapist summaries and the doctor chat do not mention the plan yet.
- No per-finger therapist overrides or goals; the switch and challenge apply to all fingers.
- Uses open-hand attempts only. Finger-by-finger poses are shaped by the plan but do not feed it.
- Fading is time-to-offer only. Reducing how often help is offered (every other attempt) would be the next step and
  needs a therapist decision.
- History has no dedicated "opening ↑, help ↓" view; the Doctor view's active range and assistance trends cover it.
- Physical validation: none. Like everything else, the plan has only run against the simulator.
