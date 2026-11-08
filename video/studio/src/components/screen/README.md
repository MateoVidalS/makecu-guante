# Screen scenes

All seven shots now use V1's committed 3840×2160 recordings from `public/recordings/manifest.json`. The temporary local copies were removed before merging PR #162; V5 does not modify recordings or the frozen manifest. Screenshot adapters remain only as a fallback when a clip is absent. Drawn copy uses memo/device; original app UI text stays unchanged.

`ScreenFrame` preserves recording-pixel coordinates across camera motion, attached callouts, click cursor and source highlights. A shot fits inside a caption-safe area at zoom 1, then eases between camera targets over 15–24 frames with zoom clamped to 1..2.2 and no empty recording edges. `fit="cover"` fills the coach split window. Every screen overlay and its shadow is clipped below y=64, reserving the chapter-label area. All content ends above y=900.

`recording.ts` adapts V1 event names in memory without changing the contract. It aliases the decision panel, derives ghost/solid anchors from the hand canvas, follows the recorded history scroll and derives camera regions for replay/current, summary and export. `focus:then-now` combines both hand boxes, keeping the hands centered. The hand-plus-meters camera uses the hand's occupied region so all five meters remain visible.

Optional playback keyframes map scene time onto V1's actual phase events. Session's ATTEMPT, ASSIST and reached hold coincide with their callouts, with resistance appearing at the coach line. Both video playback and overlays use the same mapped clip frame. Approximate hand anchors are derived layout anchors, not measured tracking telemetry.

## Timing

The current 5328-frame cut starts Session at 1080, Coach at 2376 and Doctor at 3312. Main evidence frames are derived from `src/timeline.ts` rather than duplicated starts.

- Session: 1296 frames. The innovation line shows a fading passive-movement icon beside memo's ghost-and-solid hand. During 162–342, an illustrative 21-point MediaPipe diagram uses `COPY.session.vision`; the hand-footage inset moves right for that beat so both insets stay above captions. The final statement holds during 1152–1295.
- Coach: 504 frames. Team conversation/audio remains exactly 144–468. Camera follows the real decision card and Undo, then the decision timeline when it opens. There is no closing motor-rule card; the Gemini scene owns that explanation.
- Doctor: history 0–200, replay 200–300 (complete chart held for 66 frames before moving to current), summary 300–560, export 560–600, honest statement 600–720.
- Summary: begins at source frame 72 with the stored real Gemini summary already visible. Cursor is disabled; no generation click is implied. One existing active-range line receives a soft marker. Export starts at source frame 48 so the actual CSV click at 60 is visible.

`footage/session-hand.mp4` and `footage/coach-talk.mp4` replace team placeholders automatically. Only coach-talk retains audio, inside its reserved slot. Legend pulses estimate timing from V2's line duration and word count.

## Verification

Run from `video/studio/`:

```sh
pnpm check
node src/components/screen/test-camera.mjs
node capture/check.mjs
pnpm exec remotion bundle src/index.ts --out-dir=out/v5-bundle
node src/components/screen/render-evidence.mjs
python src/components/screen/contact-sheet.py
```

The six committed images in `evidence/V5/` cover the innovation/callouts/vision storyboard, legend, resistance, coach split, doctor review, and three-frame zoom proof. The doctor sheet preserves full-resolution frames of both hands, complete replay, current and the real summary. Main images include the chapter label. Additional standalone and boundary frames live in ignored `out/v5-review/`. Pillow is needed only to assemble contact sheets, not to render the video. Tests cover camera clamps, moving anchors, native 4K coordinates, paired-hand centering, immutable manifest adaptation and phase retiming.
