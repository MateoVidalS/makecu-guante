# Screen scenes

`ScreenFrame` loads `public/recordings/manifest.json` through the frozen `RecordingManifest` contract. A clip with the requested ID replaces its screenshot adapter automatically. The mock uses real screenshots from `docs/design/screenshots/ux-u4/`, `five-fingers-data/`, and `metrics-data/`; source screenshots remain unmodified. Tall-page crops are CSS viewports, with their own recording coordinates. Every mock shot says “Screenshot preview · recording pending”. The coach decision is explicitly illustrative; the summary is the screenshot's stored fixture, labeled Demo data.

```tsx
<ScreenFrame clip="session-main" from={0} camera={[
  { at: 0, target: 'focus:virtual-hand', zoom: 1 },
  { at: 36, target: 'focus:virtual-hand', zoom: 1.6 },
]}>
  <Callout point="focus:ghost" label="Ghost = the goal" dotColor={c.target} side="left" at={40} />
</ScreenFrame>
```

`at` starts a 24-frame eased move (optionally `transition: 15..24`). Box targets and callout points are in recording pixels, with no 1920/3840 assumption. The camera fits the complete recording at zoom 1 inside a caption-safe area (64 px minimum horizontal margin; everything ends before y=900), then clamps both axes. This means portrait-ish mocks have wider paper gutters. Zoom is clamped to 1..2.2. Focus anchors interpolate between successive events with the same label. Callouts, cursor, and source highlights share that exact camera transform. Missing callout/highlight anchors are omitted safely.

Expected focus labels are listed in `mock/manifest.ts`: `virtual-hand`, `ghost`, `solid`, `index`, `helped-fingers`, `finger-meters`, `hand-and-meters`, `safety-and-coach`, `coach-panel`, `coach-decision`, `then`, `now`, `per-finger`, `phase-bands`, `vision-servo`, `current`, `summary`, `summary-sentence`, `export` (all prefixed `focus:`). Case and punctuation differences are tolerated. Cursor events use any `kind: 'click'` event with a box or point. Clip IDs are exactly the V1 shot list. No contract shapes are changed.

Footage at `public/footage/session-hand.mp4` or `coach-talk.mp4` replaces the corresponding slate placeholder. Only coach-talk retains its audio, inside frames 144–468. The session inset is exactly 480×270 and remains above captions. Legend pulse estimates use the actual `session-4` VO duration when V2's manifest exists, with the planned slot as fallback.

## Verification

Run from `video/studio/`:

```sh
pnpm check
node src/components/screen/test-camera.mjs
pnpm exec remotion bundle src/index.ts --out-dir=out/v5-bundle
node src/components/screen/render-evidence.mjs
python src/components/screen/contact-sheet.py
```

The renderer writes five review stills in `evidence/V5/`, three mid-zoom frames plus extra scene/Main checks in ignored `out/v5-review/`. The contact sheet is the sixth committed still, with three complete mid-zoom views and original-pixel endpoint crops. Pillow is only needed to assemble that sheet, not to run or render the video.

The mock screenshots show an older hook exercise and older app wording; they establish camera and layout, not an opening-session recording. Verify event labels, phase/VO alignment, sharpness and the real summary crop again after V1 lands. No recording, Gemini request, hardware interaction, or patient measurement is fabricated here.
