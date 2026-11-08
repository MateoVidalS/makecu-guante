# Historical demo data

Run `make demo-seed` from the repo root. It inserts 25 flagged demo sessions and five
flagged evaluations. Repeating the command leaves existing demo history alone.
`make demo-seed DEMO_SEED_ARGS=--reset` replaces only flagged sessions and evaluations;
real records and a real patient's profile remain intact.

`generate_demo.ts` produces deterministic **synthetic historical artifacts**, including
20 Hz replay traces. These are illustrative data, not measurements or a simulator safety
test. The generator uses the shared closure/pull mapping, pose definitions and session
summary function. It does not depend on the live simulator's current mechanics, so old
closing history can coexist reproducibly with the opening glove.

One patient (M.R., demo) over about six weeks. The first three sessions use an unmarked legacy
calibration (returned as `close` on session and history responses). The remaining 22 use an
`open` calibration and alternate independent fists with assisted openings, recorded with the
engine's semantics and seeded noise: the patient opens alone until a plateau, then the glove
winds each short finger 150 ms apart at 0.20/s and holds it open against flexor tone, so
holding current is sustained and falls as tone eases. Story beats: index improves most and
the thumb least, the little finger plateaus after week three, a week off with a cold, a rigid
index resistance stop on the first day back, a tired week (the ring finger dips and the coach
eases its target), and a pain 4/10 brake that ends one session early. The voice coach starts
18 days before the end: varied check-ins, coach decisions (focus, rest, gentler help, target,
a rejected and an accepted intensity request, an undo, therapist notes) and transcripts.
Five opening evaluations show flexor resistance and velocity dependence easing, the little
finger least.
Coach check-ins appear only in the last week. None of these patterns imply clinical efficacy.

The seeder runs the additive database migration, validates the full payload before replacing
anything, and commits a reset atomically. Calibration reuse requires identical settings as
well as the historical date; it never relabels or overwrites a hardware calibration.

The MSW fixture is generated from this same entry point with
`node frontend/src/mocks/generate-demo.mjs`. Backend and MSW adapters retain separate
calibrations and previous-session comparisons for each direction.

## Live summary check

`uv run python -m tools.summary_check` (from `backend`, needs `GEMINI_API_KEY`) seeds the story
into a temporary database, generates patient summaries for the sessions that stress the prompt
(latest, first opening, rigid-index stop, pain brake, tired week, legacy glove) and therapist
summaries for 7 and 30 days, and checks each against the prompt rules: word limits, plain text,
no raw fractions, field or tool names, ISO dates or mA for patients, therapist headings, and the
demo-data statement. It makes 8 requests; the AI Studio free tier allows about 20 per model per
day.
