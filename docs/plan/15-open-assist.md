# 15 — Pivot: the glove helps the hand OPEN (extension assist)

**Owner decision (Nov 7):** the motors no longer help the patient close the hand; they help the patient **open** it. Same
servos, spools, threads, INA219, STOP and ring. Only the logic changes. This doc **overrides** `04-firmware.md`, `06-session.md`
and `12-five-finger-update.md` wherever they assume closing assistance. Handoffs: `handoffs/open/`.

Why: after a stroke most patients can still make some fist; what they lose is opening the hand against flexor tone. Extension
assist is the clinically relevant direction, and Evaluation now measures flexor spasticity (the clinically standard question).

## 1. Physical model (what the software must assume)

| # | Fact | Consequence |
|---|---|---|
| P1 | The thread runs over the **back** of each finger (dorsal routing, hardware team). Winding the spool pulls the finger **straight**. | The glove can only **reduce** closure. It can never close a finger. |
| P2 | An unwound (slack) tendon lets the hand return to its resting posture, which after a stroke is **flexed**. | `pull = 0` (slack) is still the safe state. Every fault, STOP, watchdog and release unwinds. |
| P3 | Holding a hand open fights flexor tone **continuously**, not just while moving. | Sustained current during ASSIST/ASSIST_HOLD. The 150 ms stagger limits starts, not holding; a load governor is needed (§4.3). |
| P4 | Opening fast stretches spastic flexors (velocity-dependent stretch reflex). | Assist stays slow (≤ 0.20/s by default, 0.30/s only with consent). Fast sweeps are only for Evaluation, under its low limit. |
| P5 | A patient can close faster and stronger than the glove opens (flexor spasm). | In `follow`, the thread must **pay out faster than it is wound** so the glove never blocks closing: unwinding runs at `V_RELEASE`. |
| P6 | Pulling beyond straight hyperextends the joints. | The servo calibration `max` is set at **straight, neutral** fingers, and assist targets are capped at `MAX_ASSIST_PULL = 0.95` of that range. |
| P7 | Micro servos (~1.7–2.5 kg·cm, 10 mm spool, 2–2.7× friction loss) deliver maybe 8–12 N at the fingertip. | Unknown whether that opens a spastic hand. **Hardware gate** (§7). The software is built and validated in the simulator first. |

## 2. Decisions

1. **The wire speaks tendon pull, not finger closure.** `target.f`, `follow.f`, `tel.a`, `tel.tg` are **pull** per finger:
   `0` = slack (calibrated `min_deg`, safe), `1` = full calibrated pull (`max_deg`, fingers straight). The firmware stays
   anatomy-agnostic and its invariant "0 is safe" is unchanged. **Never invert the direction by swapping `min`/`max` in the
   calibration**: release, fault, watchdog and first-attach all go to 0, which would then yank the hand open at 3.0/s.
2. **One mapping, in the contract:** `pullFromClosure(c) = clamp01(1 − c)` and `closureFromPull(p) = clamp01(1 − p)` in
   `frontend/src/contracts/glove.ts`. Every comparison between `tel.a` and vision closure, and every `target`/`follow` vector,
   goes through it. Vision, poses, metrics and the UI keep speaking closure.
3. **Asymmetric ramps in the firmware (and the sim):** in `run`, a servo whose goal is **below** its position (unwinding) moves at
   `V_RELEASE` (3.0/s), for both `follow` and `target`; winding uses `V_FOLLOW` (follow) or `min(v, V_MAX)` (target).
4. **`FOLLOW_SLACK` 0.05 → 0.08**: follow holds the thread 8% of the range "more closed" than the vision opening.
5. **`Calibration.assist_direction`** (`'close' | 'open'`, absent = legacy `'close'`). `CURRENT_ASSIST_DIRECTION = 'open'`.
   A calibration that is not `'open'` counts as **calibration needed** (its servo ranges were measured for the palm-side routing
   and are meaningless, or dangerous, for the dorsal one). Same pattern as `camera_view`.
6. **Which poses are assisted:** the glove assists only fingers that must **open** to reach the target
   (`vision closure > target + tolerance`). Closing poses (`full_fist`, `straight_fist`, `hook`, `tabletop`, `pinch`) are practiced
   by the patient alone: in ATTEMPT the glove only follows (pays out); if the attempt is not reached, there is no ASSIST phase.
7. **New default plan** `OPEN_ASSIST_PLAN`: alternate `full_fist` (active, the glove follows) and `open` (assisted), 5 × 1 rep
   each = 10 attempts. The fist brings the hand to a closed start, so the open attempt has something to assist even for a demo
   volunteer without tone. The old plan stays as `TENDON_GLIDE_PLAN` (observation of the glides). `DEFAULT_PLAN` flips to
   `OPEN_ASSIST_PLAN` in O7 (keeps tests green until then).
8. **History keeps legacy data, marked:** `Session`, `RomPoint`, `AssistPoint`, `ResistancePoint` gain optional
   `assist_direction` (derived from the calibration; absent = `'close'`). Charts never join a trend line across directions; old
   points render as "earlier closing-assist glove". Evaluation resistance now means **resistance to opening (flexor tone)**.
9. `MAX_ASSIST_PULL = 0.95` replaces `MAX_ASSIST_CLOSURE` (kept as a deprecated alias until O3/O6 stop importing it).
10. `assist_started.from/to` stay in **closure** units (UI-facing), converted by the engine.

## 3. Firmware (O1, `firmware/**`)

- `safety.cpp tick()`: in `State::Run`, per finger, `rate = goal < pos ? V_RELEASE : speed_`. Jog and release unchanged.
- `config.h`: `FOLLOW_SLACK = 0.08F`. Comments: pull semantics.
- Rename "open" → "slack" in code and comments where it means pull 0 (`release()`, `opened` in `tick()`, the first-attach comment in
  `handle()`). Behavior unchanged.
- Native tests: follow unwinds at 3.0/s and winds at 1.5/s; target unwinds at 3.0/s whatever `v`, winds at `min(v, V_MAX)`; slack
  0.08; follow → target → follow transitions never jump; everything that was already tested still passes.
- `firmware/README.md`: a "Direction" section (pull semantics, the never-swap-min/max rule, calibration procedure).
- `BENCH.md` (§7 below): dorsal routing check, calibration, sustained hold current, extension strength gate, STOP while held open,
  fast close during follow.
- Ring: the bar shows pull (how much the glove is opening the finger). Colors unchanged.

## 4. Laptop logic

### 4.1 Contracts (O0, coordinator)
`glove.ts` (mapping functions + pull comments), `calibration.ts` (`AssistDirection`, `CURRENT_ASSIST_DIRECTION`,
`Calibration.assist_direction?`, servo/camera calibration comments), `poses.ts` (`MAX_ASSIST_PULL`, `OPEN_ASSIST_PLAN`,
`TENDON_GLIDE_PLAN`), `api.ts` (optional `assist_direction` on `Session` and history points), `therapist.ts` (comments),
`engine.ts` (comments), `protocol.h` comments, `03-contracts.md`. The Pydantic mirror (`backend/app/contracts/types.py`) and
`contracts/fixtures/calibration.json` (`"assist_direction": "open"`) are delegated to O5, because the backend must persist and
export the field in the same change.

### 4.2 Simulator (O2, `frontend/src/glove/**`)
- `simFirmware`: asymmetric ramps and `FOLLOW_SLACK = 0.08`, identical to the firmware; conformance tests updated.
- Patient model inverted. Each finger has a resting closure `rest`, an active range (`active_min` = most open the patient reaches
  alone, `active_max` = most closed), flexor tone `tone_ma` (current per unit of stretch beyond `rest`), a velocity-dependent
  term (spasticity catch) and an optional `rigid_floor` (closure the finger cannot be opened past).
  Real closure = `max(rigid_floor, min(patient_closure, closureFromPull(pull)))` + noise.
- Current per servo = idle + moving term + **sustained** `tone_ma × max(0, (1 − pull_closure) − (1 − rest))` style load + stall
  when the commanded pull exceeds what the finger can reach; total through `supplyPower`.
- Presets: `demo` (no tone, rests open, can open fully), `mild` (rest 0.6, opens alone to 0.3), `moderate` (rest 0.75, opens alone
  to 0.55, moderate tone), `spastic` (rest 0.85, opens alone to 0.75, high tone, strong velocity term), `rigid_index`.

### 4.3 Engine (O3, `frontend/src/engine/**`)
- **follow** sends `pullFromClosure(vision)` (the firmware subtracts the slack).
- **Assistable** finger: pose target not `null` **and** `vision closure > target + tolerance`. Pull goal =
  `min(cap_i, pullFromClosure(target))`, `cap_i = MAX_ASSIST_PULL` (1.0 only for consented `intensify(further)`).
- **Held** fingers (free, reached, queued, not assistable): `min(current a, max(0, pullFromClosure(vision) − FOLLOW_SLACK))`,
  refreshed so a held finger never stops the patient closing.
- **No assistable finger at the end of ATTEMPT** → skip ASSIST, go to RELEASE (`assisted=false`).
- Scheduler order: largest **opening deficit** (`vision − target`) first; stagger 150 ms, max 3 moving (unchanged).
- **Reach while assisted** (open targets): `closure ≤ max(target, closureFromPull(cap)) + tolerance`.
- **Settled**: `a` within 0.02 of the pull target for 1 s (unchanged, in pull).
- **Attribution/resistance gap** = `a_i − pullFromClosure(vision_i)`; "not following" = vision closure has **not decreased** by
  more than 0.02 in 200 ms. Resistance freezes at `min(a, goal)` and lowers that finger's speed for the session (unchanged).
- **Sustained-load governor (new):** in ASSIST and ASSIST_HOLD, with `ceiling = 0.8 × the active current limit`: if `tel.ma > ceiling`
  for 200 ms → no new starts, and lower the most recently started finger's pull target by 0.05 (repeat every 200 ms while above).
  Record it in the attempt's `safety_events` as `source: 'load_shed'` (not an `EngineEvent`; no pause).
- **Plateau** on open targets = no **decrease** in closure > 0.03.
- **Therapy:** easier = less opening: `closure' = 1 − (1 − c)·scale` for opening targets (closing targets keep `c·scale`);
  `intensify(further)` = full opening (target closure 0, cap 1.0); intent regex for opening words (open, wider, stretch, straighten,
  abrir, abri, estirar); refusal copy speaks of opening. Speed caps unchanged.
- **Evaluation:** sweep pull 0 → `MAX_ASSIST_PULL` (done at `a ≥ 0.93`), the others at 0; the hand starts relaxed (flexed).
  Friction run unchanged. Results mean resistance to opening.

### 4.4 Runtime, Setup, Calibrate (O4)
- `calibrationValidation`: not `'open'` → calibration needed (with the existing `camera_view` logic). `save()` writes
  `assist_direction: 'open'`.
- Servo step: per finger, "**Slack**" = make a relaxed full fist, jog until the thread is just taut → set; "**Open**" = jog until the
  finger is straight, never bent back → set. Copy warns about hyperextension. ≥ 20° apart (unchanged).
- Camera step: **closed** = the patient's own fist (always); **open** = relax, the glove opens all five fingers in stages (the existing
  staged-closure helper inverted); with a simulated glove, the patient's own open hand. Pinch unchanged.
- Setup and simulator controls copy: "the glove helps you open your hand"; sim preset picker uses the new presets.

### 4.5 Backend + voice (O5)
- DB: nullable `calibration.assist_direction`; Pydantic optional field; sessions/history points derive it from the calibration
  (null → `'close'`); aggregations never average across directions; export column; demo seeder with `'open'` data (plus two
  legacy sessions to exercise the marking).
- Summaries and Live prompts: extension assist, active opening, flexor tone; tool descriptions (`further` = open further).
- `frontend/src/voice/**`: cues ("I'll help you open", "I feel resistance opening your index, let's stop here"), safety net,
  fallback coach, finger phrases.

### 4.6 Live and data UI (O6)
Exercise (glove motor panel = opening help, assist copy), Evaluate and EvaluationDetail (resistance to opening), Home range,
History/Replay/Doctor charts (legacy marking, no cross-direction lines, "opening deficit" wording), metrics formatting.

### 4.7 Integration + docs (O7)
Flip `DEFAULT_PLAN`, e2e for the open-assist flow, MSW mocks/demo data, a sim soak (10 attempts, `moderate` and `spastic`, total
current < 2.2 A, no overcurrent), README §3 concept, `docs/HARDWARE_CHECKLIST.md`, `docs/DEMO.md`. The coordinator then updates
`04`, `06`, `12` and `README` of the plan.

## 5. Work packages

| WP | Name | Owns | Depends | Wave | Effort |
|---|---|---|---|---|---|
| O0 | Contracts + plan + briefs | contracts, `docs/plan/**`, `handoffs/**` | – | 0 (coordinator) | – |
| O1 | Firmware: asymmetric ramps, slack 0.08, slack naming, tests, README, BENCH | `firmware/**` | O0 | 1 | xhigh |
| O2 | Sim + glove link: firmware mirror, inverted patient model, sustained load, presets | `frontend/src/glove/**` | O0 | 1 | high |
| O3 | Engine: mapping, assistability, held fingers, governor, resistance, therapy, evaluation | `frontend/src/engine/**` | O0 | 1 | xhigh |
| O4 | Runtime + Setup + Calibrate | `frontend/src/runtime/**`, `pages/{Setup,Calibrate}/**` | O0 | 1 | high |
| O5 | Backend + voice | `backend/**`, `frontend/src/voice/**` | O0 | 1 | high |
| O6 | Live + data UI | other `pages/**`, `components/**`, `hand3d/**` copy | O3 merged, U4 merged | 2 | high |
| O7 | Integration, e2e, mocks, soak, docs | `frontend/e2e/**`, `frontend/src/mocks/**`, `DEFAULT_PLAN`, README, `docs/*.md` | O1–O6 | 3 | high |

Merge order: O1 → O3 → O2 → O5 → O4 → O6 → O7 (O5 brings the Pydantic half of the contract and the calibration fixture), then `MateoVidalS/rehab-hub → main` (merge commit).

## 6. Acceptance (whole pivot)
1. With the sim (`moderate` preset): the default plan runs 10 attempts; fist attempts never send a closing `target`; open attempts
   assist only fingers that lack opening; no command ever pulls beyond `MAX_ASSIST_PULL` without consent.
2. Release, STOP, watchdog and overcurrent always end with pull → 0 (slack). Firmware and sim agree (conformance).
3. A fast simulated fist during `follow` never trips overcurrent (asymmetric unwinding).
4. 5-finger assisted opening with the `spastic` preset stays under 2.2 A (the governor sheds load); resistance stops before the
   firmware cut on `rigid_index`.
5. A legacy (`'close'` or absent) calibration forces recalibration; history shows legacy sessions marked and never mixed.
6. `make test`, `make e2e`, `pio test -e native`, `pio run -e esp32dev` green.

## 7. Hardware gate (team, before any person)
`firmware/BENCH.md` gains, in order: (1) dorsal routing: winding opens each finger on an empty glove; (2) calibration (slack with a
relaxed fist, open at straight); (3) **extension strength gate**: a helper resists opening one finger with moderate effort; the servo
must open it and hold 2 s under the limit, record current; (4) all five held open on a relaxed hand, total current < limit;
(5) STOP while held open → slack in < 0.5 s; (6) a fast fist during `follow` does not trip overcurrent. If (3) fails, the team needs
stronger servos or a larger spool/lever before patient use. Software work does not wait for the gate.

## 8. Outcome (Nov 7)

Built by Codex workers through Orca handoffs, reviewed and merged by the coordinator with merge commits:
O1 firmware #75 · O2 sim #76 · O3 engine #81 · O5 backend + voice #82 · O4 runtime + Setup/Calibrate #77 · O6 UI #85 · O7 integration #86.
Final integration: `make test` (122 backend, 899 frontend, lint/typecheck, 48 native firmware) and `make e2e` (39/39) green; ESP32 builds.

Coordinator review fixes during the wave:
- O3: glove-started fingers oscillated (released 8%, re-pulled 150 ms later) once they reached tolerance; fixed with hysteresis
  (started fingers keep their target until RELEASE unless resistance, the governor or therapy lowers it) plus regression tests.
- O1: the watchdog gate "slack within 1 s" was impossible under the protocol (fault strictly after 1000 ms, then ≤ 335 ms unwinding);
  reconciled to fault ≤ 1005 ms and slack ≤ 1.5 s.
- O2 merged first and inverted the sim; engine/runtime/backend-demo callers were migrated by O3/O4/O5 on notice.

Still open: the hardware gate (§7) is **not run**. Servo profiles are placeholders. No person uses the glove before BENCH's opening gate passes.
