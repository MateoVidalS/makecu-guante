# F9 — Integration + docs
Owns: `frontend/src/runtime/**`, `frontend/e2e/**`, `docs/**` (except docs/plan, owned by the coordinator), `README.md`.
- Runtime for 5 fingers end to end; e2e: calibrate 5 servos, practice with all 5 scored/assisted, stagger visible, resistance on ring, evaluation of a subset, history/doctor with 5, a board reporting 3 fingers rejected.
- Docs: `docs/HARDWARE_CHECKLIST.md` (5 servos, 2.5 A, pins 13/4, posture, camera placement, glove detection test), `docs/DEMO.md`, `docs/DEV.md`, README §3/§4 consistent with 5 fingers (remove the "3 vs 5" warnings).
- `make test` + `make e2e` green; 20-minute sim soak.
