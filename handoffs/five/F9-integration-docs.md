# F9 — Integration + docs
Owns: `frontend/src/runtime/**`, `frontend/e2e/**`, `docs/**` (except docs/plan, owned by the coordinator), `README.md`.
- Runtime for 5 fingers end to end; e2e: calibrate 5 servos, practice with all 5 scored/assisted, stagger visible, resistance on ring, evaluation of a subset, history/doctor with 5, a board reporting 3 fingers rejected.
- Docs: `docs/HARDWARE_CHECKLIST.md` (5 servos, 2.5 A, pins 13/4, posture, camera placement, glove detection test), `docs/DEMO.md`, `docs/DEV.md`, README §3/§4 consistent with 5 fingers (remove the "3 vs 5" warnings).
- `make test` + `make e2e` green; 20-minute sim soak.

## Priority bug (safety, from the flow analysis)
- In one simulated run of `full_fist` with **Rigid index** on, 3 attempts finished with **no overcurrent and no resistance stop** (in another run with the full plan it did stop during "hook"). Reproduce deterministically (seeded SimWorld, clean "Calibrate simulator" calibration), find the cause (stagger order? capped 0.95 target? attribution? patient model?), fix it in the right layer, and add an e2e + unit test proving that a rigid finger always produces a resistance stop or an overcurrent fault during assist, for every finger.
- Also: the summary showed 110% after mixing manual servo ranges with the example camera range — add validation so calibrations that would produce >100% are flagged (S1 clamps the display).
- Firmware note: PR #39 (two LEDC timers so the 5th servo attaches) is merged; keep `BENCH.md` consistent with it.
