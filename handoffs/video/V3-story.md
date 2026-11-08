# V3: story scenes (hook, problem, reveal, close)

Read `handoffs/video/README.md` first (design direction + what we keep from the earlier cut). You own
`src/scenes/{Hook,Problem,Reveal,Close}.tsx` and `src/components/story/**`. Copy comes from `COPY` in `src/script.ts`; VO lines
and their frames from `VO` (captions are drawn globally; leave the bottom 180 px free while a VO line plays).
Use `src/brand/tokens.ts`, `<T/>`, `<Words/>`, `<Fill/>`, `<Mark/>`, `<Lockup/>`, `<Badge/>` from `src/components/brand.tsx`.

## Illustration system (build first, in `src/components/story/`)
- Flat vector hands in the app's language: round **6 px ink strokes** (`c.text`), skin fill = `c.hand` for Rosa; the grandson's hand a
  second, warmer skin tone; both skin tones live in `story/palette.ts` (the one allowed hard-coded palette, documented).
- Hands are parametric: `<Hand openness={0..1} side="left|right" ghost? />` built from SVG paths (palm + 5 fingers with 2 joints),
  so "closed fist → half open → open" is an interpolation, not a swap of drawings. A `ghost` hand is the target: stroke `c.target`,
  no fill, 60% opacity (the app's ghost language).
- Set: a kitchen table line, a window, a mug with a thin steam line, on paper. Minimal, lots of air. No gradients.

## Scenes (frames are scene-relative; 1 bar = 72 f)
**Hook (216 f).** Rosa's closed hand rests on the table (left). `COPY.hook.line1` types in top-left (Words). A small open hand
enters from the right for a high-five (f ~40). Rosa's hand tries (opens 10–15%, a visible effort tremble of ≤ 2 px), stays a fist,
and they touch knuckles-to-palm. Hold 6 f, then `COPY.hook.punch` lands in a dark pill at the bottom (f ~150). `COPY.hook.note` at
caption size bottom-right the whole time. Hard cut on the bar.

**Problem (360 f).** Paper. `COPY.problem.a` then `.b` as Words at display size, left-aligned; "Opening" gets emphasis by
**weight and an underline that draws itself in ink**, not by color. At VO `problem-3` (f 252) push to the stat: `77%` at hero size
counting up 0 → 77 over 24 f (tabular), label under it, citation at caption size. A tiny row of 10 hand icons, 8 of them
"weak" (stroke only), is optional if it reads in < 1 s.

**Reveal (360 f).**
1. f 0–60: the mark builds: tile fades in, the ghost m appears, the solid m rises into place (`<Mark ghost reach tile/>`), then the
   lockup + `COPY.reveal.tagline`. Calm, 15-frame moves.
2. f 96–216: the hardware, `<HardwareTurntable/>` from `src/components/hardware/Hardware.tsx` (V4). Until V4 merges, render a
   placeholder box with the same props so the swap is one import.
3. f 216–360: triad, one per beat-pair: **It watches.** (a hand of 21 landmark dots joined by thin lines, drawing in, ink + memo blue
   dots) · **It coaches.** (a calm audio waveform in memo blue) · **It helps open.** (a hand opening with the fingers filling
   `c.assist`, the only state color in the triad, because it IS the glove helping). Title at h1, sub at body muted.

**Close (288 f).** f 0–144: Rosa again (badge `illustrative`), the grandson's hand up; a **ghost** open hand appears over Rosa's
fist, then her solid hand opens to meet it (blue while she opens on her own, the last 15% fills orange: the glove helped), they
high-five, the hand turns green for 12 f (reached). `COPY.close.tagline` at display size. f 144–288: end card on paper: lockup
(height 96), `COPY.close.line`, team names from `src/team.ts`, `COPY.close.event`, `COPY.close.disclaimer` at caption, and the music
credit if `public/audio/music/manifest.json` has one (`useJson`). Everything still by f 270.

## Acceptance
- [ ] Four scenes render alone (`scene-hook`, …) and inside `Main`; `pnpm check` green.
- [ ] Stills in `evidence/V3/` (at least: hook punch, problem stat, reveal mark, reveal triad, close high-five, end card).
- [ ] No state color used as decoration; no all caps; no hex outside tokens/palette.ts.
