# WP7 — Live pages: Home, Setup, Calibrate wizard, Exercise, Evaluate

**Goal:** the patient- and helper-facing live experience, built against the runtime API so it works with the stub now and the real runtime after WP10.

**Read:** `AGENTS.md`, `docs/plan/01-product.md`, **`docs/plan/08-frontend.md §1, §2, §4`**, **`docs/plan/11-ux-design.md` (all; this is your design spec)**,
`docs/plan/03-contracts.md §3` (runtime, glove, vision types), `docs/plan/06-session.md §3` (phases you visualize).

**You own:** `frontend/src/pages/{Home,Setup,Calibrate,Exercise,Evaluate}/**`, `frontend/src/components/common/**`, and their tests. You may fill
the status chips and safety banner slots in `App.tsx` (the only allowed App.tsx edit; list it in the PR).

## Deliverables
- [ ] Common components (`08-frontend.md §4` + `11-ux-design.md §4`): GloveChip, CameraChip, PhaseRing, FingerBars, SafetyBanner, AttemptToast,
      SessionSummaryCard, Stepper, Toasts, ConfirmDialog, BrowserSupportBanner, EmptyState, BigButton.
- [ ] Pages exactly per `08-frontend.md §4` with the layouts, states and copy of `11-ux-design.md §5–7`, using `useRuntime`, `useGlove`, `useVision`, `useVoice`
      and `<VirtualHand/>` / `<CameraOverlay/>` / `<CoachPanel/>` from their owners (placeholders until those merge).
- [ ] Calibrate wizard with all 3 steps + review, resumable (state kept if the user navigates away mid-wizard), with the safety copy on step 1.
- [ ] Exercise: plan → live → summary; keyboard shortcuts; the safety interrupt flow (`11-ux-design.md §6`); a route-leave guard that stops the session.
- [ ] Evaluate: checklist → live sweep chart → results.
- [ ] Tests: each page renders every state with the stub runtime; the wizard step validation; the safety banner appears on a `safety` event and Resume calls
      `runtime.exercise.resume`; keyboard shortcuts.

## Acceptance criteria
- [ ] With `make dev-mock`, every flow can be clicked through end to end with no console errors.
- [ ] It meets the readability rules in `11-ux-design.md §8` (sizes, contrast, 1 m legibility) — check them against the screenshots in the PR at 1440×900 and 1280×720.
- [ ] A frame-driven render on the Exercise page costs < 4 ms (React profiler note in the PR); the hand never re-renders through React state.
- [ ] Every interactive element is keyboard-reachable with a visible focus ring.
