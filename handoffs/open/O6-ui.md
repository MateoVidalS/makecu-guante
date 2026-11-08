# O6 — Live and data UI for the opening glove (owns `frontend/src/pages/{Exercise,Evaluate,Evaluation,EvaluationDetail,Home,History,SessionReplay,Doctor,Profile,DevHand}/**`, `frontend/src/components/**`, `frontend/src/hand3d/**`, `frontend/src/design-system/**` copy only)

Wave 2: O3 and O5 are merged when you start. Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` §2, §4.6 and
`docs/plan/11-ux-design.md` (tokens, copy, accessibility). Use tokens; never hard-code colors or sizes.

## Build
1. **Exercise:** the glove motors panel (`GloveMotors.tsx`) shows per-finger **opening help** (`tel.a` is pull; label it "Glove opening
   help", 0–100%); assist copy "The glove is helping you open"; fist attempts say the glove only follows. Orange = glove helping stays the
   rule. Any place that compares the servo bar with the vision closure converts through `closureFromPull`. A `load_shed` safety entry is
   shown in the attempt feedback as "Eased off to protect the glove" (not red).
2. **Evaluate / Evaluation / EvaluationDetail:** "Resistance to opening (flexor tone)"; the relaxed-hand check says the hand will rest
   curled and the glove opens one finger at a time; slow vs fast = velocity dependence (spasticity).
3. **Home / History / SessionReplay / Doctor / charts (`components/charts`, `components/metrics`):**
   - "Assist needed" → "Opening the glove completed"; active range of opening for open poses.
   - Use `assist_direction`: legacy (`'close'`) points render muted with the label "Earlier closing-assist glove"; trend lines and deltas
     never connect or compare across directions; tooltips and the hand map say which.
   - Replay: the servo trace is drawn as opening help (pull), next to vision closure, with a legend that explains it.
4. Remove the last imports of `MAX_ASSIST_CLOSURE` in your paths (use `MAX_ASSIST_PULL` or the pose target).
5. Copy sweep: no UI string in your paths should say the glove closes the hand.

## Tests
Component/browser tests for the panel labels and conversions, legacy marking and broken trend lines, evaluation copy; existing browser
specs updated (1280×720 and 1440×900 fit still passes). `make test` and `make e2e` green.

## Acceptance
Diff only in the owned paths; screenshots (Exercise during an assisted open, Evaluate result, History with legacy + open data) in the PR.
