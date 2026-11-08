# O7 — Integration, e2e, soak and docs for the opening glove (owns `frontend/e2e/**`, `frontend/src/mocks/**`, `README.md`, `docs/*.md` (not `docs/plan/**`), plus the listed contract edit; minimal fixes anywhere with justification)

Wave 3: O1–O6 are merged. Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` (all; §6 is your acceptance).

## Build
1. **Contract edit you own:** `frontend/src/contracts/poses.ts` → `DEFAULT_PLAN = OPEN_ASSIST_PLAN` (keep `TENDON_GLIDE_PLAN`), and remove
   the deprecated `MAX_ASSIST_CLOSURE` if nothing imports it. Fix every test that hard-codes the old 15-attempt plan.
2. **e2e:** the full sim flow with the `moderate` preset: calibrate (new servo + camera steps) → exercise the default plan (10 attempts:
   fist attempts never assisted, open attempts assisted, orange only on opening help) → evaluate a subset → history/doctor show the new
   session and the legacy marking; a legacy `'close'` calibration forces recalibration; STOP / overcurrent during an assisted open →
   paused, glove slack.
3. **Soak (vitest, deterministic, sim + engine + runtime):** 10 attempts on `spastic` with all 5 fingers assisted: total current never
   exceeds 2.2 A, no overcurrent fault, the governor's `load_shed` entries appear; `rigid_index` → resistance before the firmware cut;
   a fast fist during follow never trips overcurrent.
4. **Mocks:** MSW fixtures/demo data regenerated from O5's seeder (keep the parity test).
5. **Docs:** `README.md` concept section (extension-assist glove, dorsal routing, the hardware gate), `docs/HARDWARE_CHECKLIST.md`
   (routing, calibration, the opening gate from `firmware/BENCH.md`), `docs/DEMO.md` (the new storyline: make a fist alone, the glove
   helps you open; evaluation = flexor tone).

## Acceptance
`make test`, `make e2e` (flaky specs rerun alone), `make fw-build` green; every item of `docs/plan/15-open-assist.md` §6 demonstrated and
listed in the PR with the test that proves it.
