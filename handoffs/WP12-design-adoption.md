# WP12 — Design-system adoption + UX audit fixes

**Goal:** make every page look and behave like one neat, professional product by adopting the design system
(`frontend/src/design-system/`, merged in PR #18) and fixing the design lead's UX audit findings below.

**Read:** `AGENTS.md`, **`docs/design/DESIGN_SYSTEM.md` (component rules + migration guide)**, `docs/plan/11-ux-design.md`
(updated with §10 amendments), the gallery at `/_dev/design` (`make dev-mock`).

**You own:** `frontend/src/pages/{Home,Setup,Calibrate,Exercise,Evaluate,History,SessionReplay,EvaluationDetail,Doctor,Profile}/**`,
`frontend/src/components/{common,charts}/**`, `frontend/src/voice/CoachPanel*`. Do **not** edit `src/runtime/**`, `frontend/e2e/**` or
`App.tsx` (WP10 is integrating them in parallel). Don't change the design system itself; if it's missing something, add a page-local component and
list it in the PR.

## Rules
- Use design-system primitives instead of ad-hoc markup: Button/ButtonLink (exactly **one primary** per view), Card, Stack/Inline/Grid,
  Heading/Text, StatusChip, Pill, Tabs, Stepper, Field/Input/Select/Slider/Switch/Checkbox, Dialog, Toast, Banner, ProgressRing, Meter, KpiTile,
  EmptyState, Skeleton, Icon. Tokens only, no hard-coded colors or sizes.
- Size tiers: 64 px patient views (Exercise live, Home primary), 48 px helper/data, 36 px doctor.
- Status vocabulary: "Paused" is neutral; "Stopped" and red are for safety only. Orange means only "the glove is helping"; use `--caution` amber for heads-ups.
- Dates "Nov 5, 2026"; numbers rounded (mA integers, % integers, seconds 1 decimal).

## Audit findings to fix (from the design lead)
**P0**
1. Exercise live must **fit 1280×720 with no scroll**: the hand ≥ 55% of the width; the side column collapses to a bottom strip; the camera PiP hides first; the coach caption is
   one line; Pause/Skip sit directly under the instruction.
2. `GloveChip`: Paused → neutral "Paused" (not red "Stopped"); the "Ready" dot is green (`StatusChip` tone mapping in DESIGN_SYSTEM.md).
3. Remove the in-page "End practice"; the shell's "End session" is the only one.
4. Keep the voice effects depending only on stable functions (`start`/`stop`), never on the whole `useVoice()` object (a past infinite-render bug).

**P1**
- **Setup:** the glove heading must match its state (no "Glove ready" next to "Click Connect"); one primary "Continue to calibration"; the Simulator card uses
  `Card tone="demo"`; never show "Connect camera" and "Stop camera" together.
- **Calibrate:** use `Stepper`; round mA; one "Release glove"; Back left + one primary right; captured values shown ("Set open ✓ 22°"); finger status as icon + word.
- **Exercise plan:** one label per row, aligned inputs; presets as `Pill` with a selected state; Start is a normal-width primary.
- **Evaluate:** large checkboxes; system-known facts (glove connected, calibrated) as status rows, not checkboxes; the disabled Start explains why.
- **Home:** the readiness list with icon + status + a fix-it link per item; date format; no raw % list under the sparkline; only one primary.
- **Coach panel:** "Mic on" must not look disabled → `Switch`; mode → `Select`; fallback note → `Banner tone="warning"`.
- **History:** views as `Tabs`; tighten spacing; the demo notice as a `Banner`/`DemoBadge`; numbers as `KpiTile`.
- **Session replay:** Delete = quiet trigger + `Dialog` with a red confirm; Previous/Next use ←/→; tiles show values, not "Yes"/"Not reached" words where a value exists.
- **Evaluation detail:** one demo badge per chart card; check the demo fixtures (the curves are flat lines).
- **Doctor:** don't repeat the bar's title in the page heading; export buttons the same size and baseline.

## Acceptance criteria
- [ ] Every finding above fixed or explained in the PR.
- [ ] Screenshots of every page at 1280×720 and 1440×900, light + dark, in `docs/design/screenshots/after-wp12/`.
- [ ] Exercise live has no vertical scroll at 1280×720 (a test asserts `document.documentElement.scrollHeight <= innerHeight`).
- [ ] `make test` green; no console errors on any route in `make dev-mock`.
