# S — Flow simplification (after F7)

Source: the flow analysis (helper setup ~80 clicks → ~45, demo ~25–30 → ~12). Owner decisions:
- **Demo:** real glove + simulator backup → the demo/recovery menu stays, but tidy and only behind a demo/sim flag (`VITE_DEMO=1` or sim active).
- **Evaluate:** only seeded data in the demo → Evaluate leaves the main nav (reachable from Home and Doctor); **glove friction moves to Evaluate's preflight** (no taking the glove off mid-calibration).
- **Camera in the live session:** small, **off by default**, toggle to show it (the virtual hand is the hero).
- **Postpone** (keep code, out of the main flow): Pinch practice (preset + pinch capture in calibration), Observation-only mode, theme toggle (light only). **Keep** Profile.

## Must NOT be cut
SafetyBanner + local phrase + Resume; "Release glove now" and the "keep the hand relaxed / STOP" strip; per-finger Set open / Set closed; camera open + glove-closed captures; "Hand relaxed" check and mandatory friction before Evaluate; the current limit (hidden, not removed); Saving/Saved; "Demo data" and "estimate" labels; Session replay with the current chart; orange = glove helped, red = safety only.

## S1 — Live flows and shell (pages Home/Setup/Calibrate/Exercise, `App.tsx`, `components/common`, `runtime/FallbackControls.tsx` + simulator controls)
1. **One demo/simulator menu** in the header ("Demo recovery" + simulator patient/faults incl. Rigid finger), shown only with the demo/sim flag; offer only the options that apply. Remove Simulator controls from the Exercise side column and Setup's simulator card. **Popovers close automatically when the SafetyBanner appears and can never cover it.**
2. Setup: Connect glove, camera, "Camera sees the hand" + glove-detection check, Continue. Everything else (glove diagnostics, `calib_ok` log, Send calibration, System diagnostics, Disconnect) in one collapsed "Advanced". "Release glove" stays visible.
3. Calibrate = 3 steps: Glove range ×5 (sending ranges automatically after the last finger), Camera range (open + glove-closed; pinch capture removed), Review (compact; degree tables under "Details"; **current limit read-only**, editable only under Advanced). One simulator shortcut only, only in sim mode. Remove "Use estimates for ring and pinky".
4. After saving, "Start practice" starts the default plan directly (same as Home).
5. Nav: Home · History · Setup (+ Doctor view button, Profile icon). Exercise becomes "Customize plan" under Home's start button; its Advanced settings (9 timings), per-pose reps and Observation-only are hidden/removed from the UI. Presets: Tendon glides, Short session (same as Home's checkbox, no duplicate), **"Fist only, 1 rep"** (demo). Pinch preset postponed.
6. Live session: camera panel small and off by default (toggle remembers); header End session asks the same "Finish for today?" confirmation as Esc; Microphone toggle hidden in Simple voice.
7. Summary: merge "Your hand today" and "On your own and with the glove" into one card; **clamp all displayed percentages to 0–100%** (never 110%).
8. Theme toggle removed from the header (light only); keep the code.
9. Clear message when "Glove closes the hand" stops (say which limit/safety event fired).

## S2 — Data and evaluation (pages History/SessionReplay/EvaluationDetail/Doctor/Evaluate, `components/charts`)
1. Patient History = **Overview + Sessions** only; Active range, Assistance and Resistance live in Doctor view only. Remove Export from History (Doctor keeps it).
2. Doctor view: **Therapist summary + Generate at the top**, then KPIs + At a glance, then the 10 small multiples in a collapsed "Details"; links to session replay and evaluation detail; hide "Patient profile" when empty.
3. Evaluate: reached from Home and Doctor (not the nav); **friction measurement moves into its preflight** (mandatory before the first evaluation, skipped if a recent friction calibration exists); one End/Stop control; fix the header "Pose 1 of 0" in Evaluate.
4. Evaluation detail: the 5 sweep curves collapsed by default.

Both: update tests and e2e selectors for the new flow (keep every safety assertion), screenshots in `docs/design/screenshots/simplify/`, `make test` + `make e2e` green.
