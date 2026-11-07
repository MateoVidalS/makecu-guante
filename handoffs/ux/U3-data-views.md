# U3 — Believable demo data + data-view layout

Read `handoffs/ux/COMMON.md` first. Findings 7 and 8 in `docs/plan/14-ux-fixes.md`. **Starts after A3 and A4 are merged**: run
`git merge origin/MateoVidalS/rehab-hub` first and check that `pages/Doctor/TherapyReview.tsx` exists.

**You own:** `backend/app/db/seed.py`, `backend/tools/**` (seed generator), `frontend/src/mocks/**`, `frontend/src/pages/{History,Doctor}/**`
(layout and CSS only; don't remove A4's therapy review section), `frontend/src/components/charts/**`.
**Do not edit:** existing `contracts/fixtures/*` (frozen) or the DB schema. If a chart test depends on a frozen fixture, keep it as is.

## 1. Demo data that tells a believable story (P1)
Today every finger shows "▲ 28 points", every resistance delta "+70 mA", and all 8 sessions are "Full fist × 1, 1 attempt, 1 safety event".
- Regenerate the demo seed (backend `make demo-seed` and the MSW mocks so `make dev-mock` shows the same story) with a deterministic
  seeded RNG: ~4 weeks, 10–14 sessions on irregular days, mixed plans (Tendon glides × 3, Short session, Fist only), 5–15 attempts each.
- Per-finger trends differ: e.g. index improves most, thumb slowly, pinky plateaus, one finger dips one week. Noise of a few points
  between sessions. Assist needed falls unevenly. Safety events are rare (0–1 per session, mostly 0), with one rigid-index story.
- Evaluations: 3–4, resistance decreasing at different rates per finger, slow < fast with varied velocity dependence.
- Seeded data stays flagged `is_demo` and labeled everywhere. If the A3 tables exist, seed a few coach decisions and feelings
  (pain 0–3, fatigue rising later in sessions) so replay and the Doctor therapy section have something real-looking.
- Chart titles are generated from the data; check they still state a true takeaway with the new data.

## 2. Doctor and History layout (P2)
- No large empty areas from pairing cards of very different heights. Options: a masonry-free ordering (tall hand card full width, then
  the short cards in pairs), or `align-items: start` with deliberate ordering. Pick one, apply it to both Doctor "At a glance" and History overview.
- Print CSS stays clean (no chart split across pages); check `Print / Save PDF` output at A4 and Letter.

## Acceptance criteria
- [ ] Seed is deterministic (same output for the same seed), covered by a backend test that also asserts per-finger trends are not identical.
- [ ] `make dev-mock` and `make demo-seed` + `make dev` show the same story.
- [ ] Doctor and History screenshots at 1280×720 and 1440×900 show no empty card areas taller than ~120 px; print screenshots for A4 + Letter.
- [ ] All existing chart and Doctor tests pass (update snapshots with a note why). `make test` + `make e2e` green.
