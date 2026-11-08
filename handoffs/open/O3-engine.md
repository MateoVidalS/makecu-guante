# O3 — Session engine for the opening glove (owns `frontend/src/engine/**`)

Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` (all; §4.3 is your spec), `docs/plan/06-session.md` and
`frontend/src/engine/README.md`. Safety-critical: the coordinator reviews every state transition.

## Build
1. **One mapping.** Every `follow`/`target` vector and every comparison between `tel.a`/`tel.tg` and vision closure goes through
   `pullFromClosure`/`closureFromPull` from `contracts/glove.ts`. Add a test that fails if `1 -` closure/pull arithmetic appears
   elsewhere in `engine/**` (a simple source scan is fine).
2. **ATTEMPT/HOLD follow:** `follow(pullFromClosure(vision))` per glove finger (firmware subtracts the 0.08 slack).
3. **Assistable finger:** pose target not `null` and `vision closure > target + tolerance`. Pull goal =
   `min(cap_i, pullFromClosure(target))`, `cap_i = MAX_ASSIST_PULL` (1.0 only with consented `intensify(further)`). Closing deficits are
   never assisted.
4. **Held fingers** (free, reached, queued, not assistable) in the full-vector target:
   `min(current a, max(0, pullFromClosure(vision) − FOLLOW_SLACK))`, refreshed on every target refresh, so a held finger never stops the
   patient closing. Never raise a held finger's pull.
5. **No assistable finger** when ATTEMPT ends (timeout/plateau) → skip ASSIST, go to RELEASE (`assisted=false`, `reached_final=false`).
6. **Scheduler (`assist.ts`):** goals in pull; order by the largest **opening deficit** (`vision − target`); stagger 150 ms, max 3 moving,
   persistence across ATTEMPT → ASSIST unchanged. Replace `MAX_ASSIST_CLOSURE` with `MAX_ASSIST_PULL`.
7. **Reach while assisted (open targets):** `closure ≤ max(target, closureFromPull(cap)) + tolerance`. **Settled:** `a` within 0.02 of
   the pull target for 1 s.
8. **Attribution and resistance:** gap = `a_i − pullFromClosure(vision_i)`; "not following" = vision closure has **not decreased** by
   more than 0.02 in 200 ms. Thresholds per servo profile unchanged. Freeze at `min(a, goal)`; lower that finger's speed for the session.
9. **Sustained-load governor (new):** in ASSIST and ASSIST_HOLD, `ceiling = 0.8 × the active current limit` (the calibration's
   `current_limit_ma`, or the firmware `info.limit` if the runtime passes it; add an engine option). If `tel.ma > ceiling` for 200 ms →
   stop starting new fingers and lower the most recently started finger's pull target by 0.05 (repeat every 200 ms while above, next
   finger once one is back at its held value). Record `{ source: 'load_shed', finger, ma }` in the attempt's `safety_events` (not an
   `EngineEvent`, no pause). Document it in `engine/README.md`.
10. **Plateau** for open targets = no **decrease** in closure > 0.03. Metrics: `active_min`/`assist_needed` for open targets already
    exist; make sure `assisted`/`assist_needed` are reported only for fingers that were assistable.
11. **Therapy (`therapy.ts`):** easier = less opening: for opening targets `closure' = 1 − (1 − c)·scale` (closing targets keep `c·scale`);
    `intensify('further')` = full opening (target closure 0, cap 1.0) and is refused for closing targets ("The glove can only help this
    finger open."); the patient-intent regex accepts opening words (open, wider, stretch, straighten, abrir, abri, estirar) and no longer
    closing ones; every refusal/explanation string speaks of opening. Speed caps (0.20 / 0.30 consented) unchanged.
12. **Evaluation (`evaluation.ts`):** each sweep pulls only that finger from 0 to `MAX_ASSIST_PULL` (done at `a ≥ 0.93`), the others at 0,
    from a relaxed (flexed) hand. Friction run unchanged. Docs/comments: resistance to opening (flexor tone).
13. `assist_started.from/to` stay in closure units.

## Tests (deterministic, with the existing fake world; use O2's model only if it is merged when you start)
Fist attempt sends only follow, never a raising target; open attempt assists only fingers lacking opening; held fingers never rise;
skip-ASSIST path; governor sheds load and the total stays under the ceiling in a scripted high-tone world; resistance on a rigid finger
freezes before 200 ms + one tick; vision loss/STOP/overcurrent/disconnect still release and pause; therapy scale/intensify/regex in the
opening direction; evaluation sweep endpoints; the full `OPEN_ASSIST_PLAN` completes with 10 attempts and the old plan still runs
(closing poses unassisted).

## Acceptance
`make test` green; diff only under `frontend/src/engine/**`; `engine/README.md` updated; no frozen contract edits.
