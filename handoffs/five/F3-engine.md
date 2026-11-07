# F3 — Engine for 5 fingers
Owns: `frontend/src/engine/**`.
- Scoring, reach, plateau, metrics and attribution over all 5 fingers.
- **Staggered power-aware assist** (`12 §3.2`): start unreached fingers 150 ms apart, at most 3 moving at once (settings `assist_stagger_ms`, `assist_max_parallel`), finger order by largest gap first.
- Reachable targets: cap assisted targets at 0.95 of the calibrated range; "settled" uses the capped target.
- Resistance thresholds per servo profile (lower for weaker servos); attribution to the finger with the largest commanded-vs-vision gap.
- Evaluation over a selectable subset of the 5 fingers (default all; 10 sweeps), progress reporting, friction per finger.
- Tests: stagger never has > 3 moving; with the F2 sim power model the total stays < 2.2 A during a 5-finger assist; every existing scenario with 5 fingers.
