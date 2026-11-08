# memo launch video: handoffs (coordinator: Claude)

A ~2:53 launch video for memo (MakeCU 2026, healthcare track), in the style of a YC launch video, built in Remotion at
`video/studio/`. Integration branch: **`MateoVidalS/video`**. Every worker branches from it and opens a PR **into it**.

| WP | Brief | Owns | Depends on |
|---|---|---|---|
| V1 | [V1-capture.md](V1-capture.md) | `video/studio/capture/**`, `video/studio/public/recordings/**` | – |
| V2 | [V2-audio.md](V2-audio.md) | `video/studio/audio/**`, `video/studio/public/audio/**`, `video/studio/src/audio/**` | – |
| V3 | [V3-story.md](V3-story.md) | `src/scenes/{Hook,Problem,Reveal,Close}.tsx`, `src/components/story/**` | V4 `HardwareTurntable` (placeholder until merged) |
| V4 | [V4-hardware-hood.md](V4-hardware-hood.md) | `src/components/hardware/**`, `src/scenes/UnderHood.tsx` | – |
| V5 | [V5-screen.md](V5-screen.md) | `src/components/screen/**`, `src/scenes/{Session,Coach,Doctor}.tsx` | V1 recordings (mock until merged) |
| – | coordinator | everything else in `video/studio/` (timeline, script, contracts, brand, Main, Team, Next) | – |

Team-only footage (founders, real hand, real Gemini Live conversation, the board): slots exist as placeholders in
`public/footage/<id>.mp4`; nothing to do for workers.

## Rules (on top of `/AGENTS.md`)
- Edit only what you own. `src/timeline.ts`, `src/script.ts`, `src/contracts.ts`, `src/brand/**`, `src/components/{brand,media}.tsx`
  are coordinator-owned: if you need a change, write it under `## Contract change request` in the PR and work around it.
- `cd video/studio && pnpm install && pnpm check` must be green. Render stills of your scenes
  (`npx remotion still scene-<id> out/<name>.png --frame=<n>`) and commit 3–6 of them under `video/studio/evidence/<WP>/`
  so the coordinator can review the design without rendering.
- Never commit or print an API key. Never run anything against the physical glove.
- Commits end with `Co-Authored-By: Codex <noreply@openai.com>`. PR: `gh pr create --base MateoVidalS/video --title "V<n>: <name>"`,
  the AGENTS.md template. **Do not merge.** Print the PR URL and stop.
- The coordinator will review your stills and may send design notes into your terminal. Apply them; they win over this brief.

## Design direction (read this twice)
**Look:** the app's own visual system, scaled for video. Paper background (`c.bg`), ink text, white cards with hairline borders, one
memo-blue accent per frame, slate (`c.chrome`) for at most a few dark beats. Atkinson Hyperlegible Next, 400/600 only, sentence
case, tabular numbers. `src/brand/tokens.ts` has everything; never hard-code a hex in a scene (illustration skin tones are the one
documented exception, kept in one palette file).

**Meaning of color (non-negotiable, it is the product's language):** blue = the patient on their own, orange = the glove helped,
green = reached, red = safety only, purple = demo/simulated, grey ghost = the goal. Never use them as decoration: no green
waveforms, no orange emphasis words, no red for "important".

**Motion:** `ease` (cubic-bezier .2,0,0,1), no overshoot, no bounce, no shake, no whoosh blur, no confetti. Cuts are fast (YC pace,
a new idea every 2–4 s, cut on the beat: 100 BPM → 1 beat = 18 frames, 1 bar = 72 frames). Elements arrive in 9–15 frames.
Ghost-and-solid is the visual metaphor: a faint target shape, a solid shape reaching it.

**Voice:** confident, concrete, still honest. Label everything simulated, demo or illustrative (`<Badge/>`). Never "proven",
"clinically validated", "robot", "cure".

## What we take from the team's earlier cut (`video/memo-launch-v2.mp4`, `video/brag.mp4`), redesigned
| Keep (idea) | Redesign (how) |
|---|---|
| Rosa: "Her grandson wants a high-five." → fist → "Technically a fist bump." as the cold open, and the high-five as the ending | Flat illustration in the app's style (round 6 px ink strokes, `c.hand` skin, paper/kitchen-table set), not the beige cartoon; the closing high-five uses ghost → solid |
| "77% have arm weakness after a first stroke" (Lawrence et al., Stroke, 2001) | Big tabular number, citation visible, on paper, not on a dark gradient |
| "It watches. It coaches. It helps open." | Same triad; the waveform is memo blue, not green; only "helps open" may use the assist orange (it IS the glove helping) |
| Callouts on the live hand: Ghost = the goal, Solid = your hand, Blue = on your own, Orange = the glove helped, Green = you reached it | Pills with a state-colored dot and a leader line driven by recording coordinates; the app is zoomed so the hand fills the frame |
| "The board decides. Not the browser." + the four safety layers | Same list, correct firmware numbers (100 ms cut-off, 1 s watchdog), typeset as app cards |
| STL renders of the wrist module, spools and anchors | Soft studio light on paper, slow turntable, not a dark void |
| End card: lockup, "Your hand remembers.", "Try first. memo helps with the rest.", disclaimer, music credit | Same content; lockup on paper; disclaimer at caption size |
| Six-word counter, campus "REC" frames, "INTRODUCING" all-caps, dark gradients | **Dropped** (gimmicky / off-brand) |
