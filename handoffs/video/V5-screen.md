# V5: screen scenes (session, coach, doctor) and the Screen Studio-style camera

Read `handoffs/video/README.md` first. You own `src/components/screen/**` and `src/scenes/{Session,Coach,Doctor}.tsx`.
Inputs: `public/recordings/manifest.json` (`RecordingManifest`, from V1, 3840×2160 30 fps clips with events). **V1 runs in parallel**:
start with a mock manifest under `src/components/screen/mock/` built from real app screenshots in `docs/design/screenshots/`
(e.g. `ux-u4/after-assist-1440.png`, `after-history-1280-light.png`), and switch to real clips when the coordinator tells you V1 merged.

## 1. Camera system (`src/components/screen/`)
- `<ScreenFrame clip="id" from={frameInClip} camera={keyframes} />`: the recording in a window with radius-card corners and the
  app's overlay shadow, on a paper background with a 64 px margin at zoom 1. Like Screen Studio: the camera zooms to the element
  of interest and follows it smoothly.
- `camera` keyframes: `{ at: sceneFrame, target: eventLabel | box, zoom: 1..2.2 }`; between keyframes interpolate center and zoom
  with `ease` over 15–24 f. Never cut the zoom; never exceed 2.2×. Clamp so the window never shows an empty edge at zoom > 1.
  Optional subtle motion blur is NOT allowed (sharp text wins).
- `<Callout point label dotColor side />`: a white pill (radius pill, 1 px border, overlay shadow), state-colored dot, ink label at
  h3, and a thin ink leader line to a point in recording coordinates (mapped through the current camera transform so it sticks to
  the hand while zooming). Enter: line draws (6 f) then pill fades up (9 f).
- `<Cursor/>` overlay from `click` events (macOS-style arrow, eased path between clicks, a soft press ring on click), so V1 can record
  without a visible cursor.
- Badges: if the clip is `simulated`, keep `<Badge kind="simulated"/>` top-right of the frame for the whole shot; `demoData` →
  `<Badge kind="demoData"/>`.

## 2. Scenes (scene-relative frames; VO timings in `src/script.ts`; keep the bottom 180 px clear under captions)
**Session (1512 f).** One continuous feel, cut only on beats.
- f 0–360 `session-main`: zoom 1 → 1.6 on the virtual hand at PRESENT. Callouts `COPY.session.ghost` (to the ghost) and
  `COPY.session.solid` (to the solid hand) at f ~40/~70. ATTEMPT: callout `blue` (dot `c.active`) when the bars rise.
- f 360–612: ASSIST: callout `orange` (dot `c.assist`) on the helped fingers; then reached: `green` (dot `c.reached`).
- f 612–828 (VO "Blue is you. Orange is the glove. Green means you made it."): pull back to 1.2 so the finger meters and the hand are
  both in frame; the three callouts stack as a legend, each pulsing once exactly on its word (V2 gives word timing only via line
  duration; estimate by word count).
- f 840–1512 `session-resist`: zoom to the index; at the resist moment a small current trace (draw it from the clip's events or a
  stylized line) rises; release; the app banner + the coach line (VO `session-coach` at f 1008, the app shows its own caption: hide
  our global caption collision by keeping the zoom so the app caption is visible above ours). Big statement on paper for the last bar:
  `COPY.session.resist` at display size.
- PiP slot: `footage/session-hand.mp4` (team: the real hand with the glove) as a 480×270 rounded inset bottom-left from f 120 to 600,
  using `TeamFootage`-style placeholder until it exists.

**Coach (576 f).** `coach-panel` zoomed on the coach panel/decision with **Undo**; the highlighted finger on the hand. Frames 144–468
reserve a split: left the team's real conversation (`footage/coach-talk.mp4`, with its audio; placeholder until then), right the app.
At f 474 the rule `COPY.coach.rule` at h1 + `.sub` on paper.

**Doctor (864 f).** `doctor-history` (zoom into then → now per finger) → `doctor-replay` (follow the three lines and phase bands) →
`doctor-summary` (cursor clicks "Therapist summary", camera follows the text appearing; highlight one sentence with a soft
`c.accentSoft` marker) → `doctor-export` → final 168 f: `COPY.doctor.honest` + "Honest numbers for the people who guide you." on paper.

## Acceptance
- [ ] Camera/Callout/Cursor work against the mock; switching to real clips needs only the manifest.
- [ ] Three scenes render alone and in `Main`; stills in `evidence/V5/` (session callouts, legend, resist, coach split, summary).
- [ ] Callouts stay locked to their targets while zooming (render 3 frames mid-zoom to prove it).
- [ ] `pnpm check` green.
