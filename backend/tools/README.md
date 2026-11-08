# Historical demo data

Run `make demo-seed` from the repo root. It inserts 14 flagged demo sessions and four
flagged evaluations. Repeating the command leaves existing demo history alone.
`make demo-seed DEMO_SEED_ARGS=--reset` replaces only flagged sessions and evaluations;
real records and a real patient's profile remain intact.

`generate_open_demo.ts` produces deterministic **synthetic historical artifacts**, including
20 Hz replay traces. These are illustrative data, not measurements or a simulator safety
test. The generator uses the shared closure/pull mapping, pose definitions and session
summary function. It does not depend on the live simulator's current mechanics, so old
closing history can coexist reproducibly with the opening glove.

The first two sessions use an unmarked legacy calibration (returned as `close` on session
and history responses). The remaining 12 use an `open` calibration and alternate independent
fists with assisted openings. Opening deficits shrink at different rates, with a tired week
and a little-finger plateau. One opening records a rigid-index resistance interruption.
Four opening evaluations illustrate flexor resistance and velocity dependence decreasing.
Coach check-ins appear only in the last week. None of these patterns imply clinical efficacy.

The seeder runs the additive database migration, validates the full payload before replacing
anything, and commits a reset atomically. Calibration reuse requires identical settings as
well as the historical date; it never relabels or overwrites a hardware calibration.

`generate_demo.ts` / `generate_demo.mjs` retain the earlier closing story for the
existing MSW artifact equality check. O7 can switch the MSW regeneration command to
`generate_open_demo.mjs` when it adds direction-aware mock persistence and history.
The backend seeder already uses the opening entry point.
