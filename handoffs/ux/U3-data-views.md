# U3 — Believable demo data + data-view layout

Read `handoffs/ux/COMMON.md` first. Findings 7 and 8 in `docs/plan/14-ux-fixes.md`. **Starts after A3, A4 and PR #58 (demo-story) are
merged**: run `git merge origin/MateoVidalS/rehab-hub` first and check that `pages/Doctor/TherapyReview.tsx` exists.

**Update:** PR #58 already rebuilt the backend demo seed (`backend/tools/generate_demo.ts`, `seed_demo.py`, `tests/db/test_demo_seed.py`):
14 sessions on irregular days, mixed plans, distinct per-finger trends, one rigid-index stop, 4 evaluations, coach decisions and feelings.
**Don't redo the backend seed.** Your data job is to make the MSW mocks (`make dev-mock`) tell the same story, ideally generated from the
same source so they can't drift.

**You own:** `frontend/src/mocks/**`, read-only use of `backend/tools/generate_demo.ts` (a one-line export/hook there is an allowed listed exception), `frontend/src/pages/{History,Doctor}/**`
(layout and CSS only; don't remove A4's therapy review section), `frontend/src/components/charts/**`.
**Do not edit:** existing `contracts/fixtures/*` (frozen) or the DB schema. If a chart test depends on a frozen fixture, keep it as is.

## 1. Demo data that tells a believable story (P1)
Today every finger shows "▲ 28 points", every resistance delta "+70 mA", and all 8 sessions are "Full fist × 1, 1 attempt, 1 safety event".
- Point the MSW mocks at the #58 story (reuse the generator's output; don't hand-write a second dataset). For reference, that story is: ~4 weeks, 10–14 sessions on irregular days, mixed plans (Tendon glides × 3, Short session, Fist only), 5–15 attempts each.
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
- [ ] The MSW mock data comes from the same generator as the backend seed (a test asserts they match, e.g. same session count and per-finger values).
- [ ] `make dev-mock` and `make demo-seed` + `make dev` show the same story.
- [ ] Doctor and History screenshots at 1280×720 and 1440×900 show no empty card areas taller than ~120 px; print screenshots for A4 + Letter.
- [ ] All existing chart and Doctor tests pass (update snapshots with a note why). `make test` + `make e2e` green.
