# U4 — Live exercise screen + focus shell

Read `handoffs/ux/COMMON.md` first. Findings 1 (plan page), 2 (layout), 3, 4, 9, 10 in `docs/plan/14-ux-fixes.md`; spec
`11-ux-design.md §4, §5.2, §5.4, §6.2, §8` and `DESIGN_SYSTEM.md §4.2`. **Starts after A1, A2, A4, U1 and U2 are merged**: run
`git merge origin/MateoVidalS/rehab-hub` and confirm that `CoachDecisions.tsx`, `CalibrationIssueBanner.tsx` and the new hand look are there.
This is the most important patient screen: be careful and verify in the running app, not just in tests.

**You own:** `frontend/src/pages/Exercise/**`, `frontend/src/App.tsx`, `frontend/src/styles/shell.css`,
`frontend/src/runtime/{RuntimeStatus,FallbackControls}.tsx` (+ tests), `frontend/src/components/common/**`,
`frontend/src/components/therapy/**` (layout only), `frontend/src/voice/CoachPanel*`. Selector-only edits in `frontend/e2e/**` that your
changes break (list them in the PR; A5 merges first).
**Do not edit:** engine, runtime logic, voice logic, safety behavior. You change how things look and where they sit, not what they do.

## Do
1. **Progress label (P0).** The focus shell shows "Pose 2 of 5 · Rep 1 of 3" (poses and reps from the plan), not "Pose 1 of 15 · Rep 1".
   If the runtime view doesn't expose pose count and reps-per-pose, derive them from the plan in the page/shell; don't change the contract.
   The same fix applies to the evaluation label.
2. **Patient-view noise (P1).** In the focus shell, hide the Saving/Saved status while healthy (show it only when "Offline" or saving takes
   > 2 s) and hide the demo-tools menu unless the demo/sim flag is set **and** the page is not live (keep it reachable from the setup shell).
   The safety banner must still close any open popover (existing rule).
3. **Layout at 1280×720, no scroll, in every phase and with the SafetyBanner showing (P0/P1).**
   - The hand ≥ 55% of the width at 1440 and the largest element at 1280; instruction in `--display`, centered over the hand.
   - Side column (phase ring, finger bars, coach) → bottom strip below 1280 px, as the spec says. Hide the camera PiP before the bars.
   - The SafetyBanner overlays the top of the stage (or the stage shrinks) instead of pushing content off screen; Resume gets focus.
   - The camera PiP never floats in an empty gap: it docks in the side column or a fixed corner that doesn't cover the hand.
4. **Coach panel (P1)**, spec §5.4 merged with A4's work: a speaking indicator (3 bars, static under reduced motion), a status word
   (Listening / Speaking / Simple voice / Voice off), the last coach line as a caption (`h3`), "You said: …" muted, the mic toggle as a
   labeled `Switch`, the A4 coach-decision line with Undo, and **Brake always visible**. All of it fits the side column without scrolling;
   older decisions collapse.
5. **Exercise plan page (P0 from finding 1).** Replace the plain blocking sentence with U1's `CalibrationIssueBanner`; Start is disabled
   with a reason next to it.

## Acceptance criteria
- [ ] Browser test (Playwright, 1280×720 and 1440×900): for PRESENT, ATTEMPT, ASSIST, HOLD, REST, PAUSED and each safety banner (overcurrent, STOP, unplug, camera lost) `scrollHeight <= innerHeight`, and the hand, instruction, phase ring, all five bars, Pause/Skip and Brake are inside the viewport.
- [ ] The hand's canvas width ≥ 55% of the viewport at 1440.
- [ ] Label test: the Tendon glides plan shows "Pose 1 of 5 · Rep 1 of 3" and advances correctly.
- [ ] Focus shell shows no "Saved" chip and no demo menu in a healthy live session; "Offline" still shows.
- [ ] Every existing safety assertion (unit + e2e) still passes. Screenshots of every phase + safety state, light, 1280 and 1440, in `docs/design/screenshots/ux-u4/`. `make test` + `make e2e` green.
