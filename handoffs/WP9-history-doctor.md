# WP9 — History, replay, evaluation detail, doctor view, profile, charts

**Goal:** make progress visible and trustworthy for the patient and the therapist.

**Read:** `AGENTS.md`, `docs/plan/01-product.md`, `docs/plan/03-contracts.md §3–4`, **`docs/plan/08-frontend.md §5`**,
**`docs/plan/11-ux-design.md` §2, §4, §7 (data-viz and doctor-view design)**, `docs/plan/06-session.md §4–5` (metric meanings).

**You own:** `frontend/src/pages/{History,SessionReplay,EvaluationDetail,Doctor,Profile}/**`, `frontend/src/components/charts/**`, and their tests.

## Deliverables
- [ ] Charts (Recharts) styled per `11-ux-design.md §7`: `TrendSmallMultiples`, `FingerTrend`, `AssistTrend`, `ResistanceSlowFast`, `ReplayChart`
      (closure solid / servo dashed / current on a secondary axis / phase bands / safety markers), `SweepCurves`, `Sparkline`, `KpiTile`, with empty
      and loading states, and demo points hollow + labeled.
- [ ] Pages per `08-frontend.md §5`, the doctor view with its own layout + print CSS, and JSON/CSV export buttons.
- [ ] Pure transforms (`toFingerSeries`, `assistSeries`, `resistanceSeries`, `phaseBands`, `decimate`) with vitest tests.

## Acceptance criteria
- [ ] With `make dev-mock`, every page renders from the fixtures with no console errors; the improvement in the fixtures is visible.
- [ ] The doctor-view print preview fits A4/Letter with no chart split (screenshot in the PR).
- [ ] Charts pass the `11-ux-design.md §7` checklist (labeled axes with units, direction-of-better hints, colorblind-safe palette, no dual-axis confusion:
      the replay's secondary axis is labeled and tinted).
