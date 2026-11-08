# Launch-video app capture

From `video/studio`, after the repository's `make setup` and `pnpm install`:

```sh
node capture/capture.mjs
node capture/check.mjs
pnpm check
```

One command records all seven required clips, writes `public/recordings/manifest.json`, and makes a six-frame PNG contact sheet per clip in `evidence/V1/`. Optional calibration footage is omitted. Requires the frontend's installed Playwright Chromium, Python/uv, and `ffmpeg`/`ffprobe` on PATH. Install the browser with `cd ../../frontend && pnpm exec playwright install chromium` if needed. No new dependencies are added.

For a single replacement:

```sh
node capture/capture.mjs --only=session-resist
```

Multiple clips can be selected with a comma-separated `--only=session-resist,coach-panel`.

`--probe` captures the first 12 frames to a temporary directory without replacing deliverables. The printed temporary directory also contains server logs. Ports 8100 and 5273 must be free; the runner refuses to attach to an existing app. The runner starts and stops its own stack, uses only `/tmp/memo-video.db`, and resets **demo records in that database** for a full run. Before doctor takes, it restores the packaged demo-only cohort and its existing real Gemini summaries atomically; it refuses to overwrite non-demo records. It never opens a serial port or activates bench mirroring. For a clean reproduction after a partial/failed run, use the full command.

## Recording and timing

- Real Vite app, real FastAPI/SQLite, production runtime, production simulator/firmware model, real charts and exports. The existing `e2e/ai-therapist-harness.ts` substitutes the Live audio device and steps the seeded simulator; it does not replace app components, safety rules, traces, or coach tools.
- Chromium: 1920×1080 CSS viewport, device scale 2, light theme. JPEG screenshots at quality 95, one for every output frame. Encoding and decoding use two threads to limit memory on shared hosts. H.264, 3840×2160, constant 30 fps, CRF 14, limited-range yuv420p, fast-start MP4. No WebM recording or upscaling.
- On macOS the runner uses Chromium's Metal renderer. The Playwright clock fixes the browser date and steps UI timers independently of screenshot/rendering speed.
- `session-main`: simulator time runs at 0.4× output time so the editor has room for ghost, active blue, assist orange and reached green callouts. `session-resist`: 2/3×, with rigidity introduced only after ASSIST begins. The actual engine gates and firmware current/watchdog paths remain unchanged.
- The harness simulates a patient's request for help when the UI offers it. Coach tool calls in `coach-panel` are scripted, applied by the production therapy runtime and persisted to the isolated database. This clip demonstrates the UI, not an unscripted Gemini conversation.
- The mouse is hidden. Manifest clicks identify the exact real control and frame for a cursor overlay. Only the developer-only Demo tools entry point and bench-mirror diagnostic are hidden; the app's purple `Test mode · no motors`, Demo data labels, resistance messages and safety controls remain visible.

## Clip guide

| Clip | Seconds | Content |
| --- | ---: | --- |
| `session-main` | 45 | Opening, partial voluntary effort, sequential help, green reached fingers, release |
| `session-resist` | 20 | Opening, rigid index, production resistance stop/caption and release |
| `coach-panel` | 20 | Gentler index help, highlighted index, actual Undo, decision timeline |
| `doctor-history` | 15 | History first/latest hand and per-finger bars; slow scroll, then Doctor range trends |
| `doctor-replay` | 12 | Stored opening attempt: camera, commanded pull, current, phase bands |
| `doctor-summary` | 15 | Navigate to Doctor view and reveal a stored real Gemini therapist summary |
| `doctor-export` | 6 | JSON/CSV/print controls; actual CSV download and success message |

The app has no separate “Therapist summary” reveal button: the stored summary is always visible on Doctor view. This capture uses that real navigation rather than simulating regeneration. The resistance UI currently says “Stopped — resistance in your index” and “The glove stopped pulling. Relax your hand.” The coach also supplies its production resistance caption. These exact UI words take precedence over the brief's illustrative sentence.

## Manifest and editor coordinates

`width`/`height` describe the **encoded recording pixels**, 3840×2160; the source CSS viewport is 1920×1080. All `box` and `point` values are in recording pixels (`getBoundingClientRect()` × 2), matching V5's zoom/callout coordinate space. Full scrollable section boxes may extend past the viewport. Fingertip points are estimates relative to the visible canvas and explicitly labeled `approximate`; they are not measured anatomical landmarks. Each phase repeats the hand, meters and fingertip anchors.

`node capture/contact.mjs` rebuilds all contact sheets from the encoded MP4s; pass clip IDs to rebuild selected sheets. Opening, resistance and coach sheets sample their actual event frames so the reached state, release and Undo remain visible.

Individual `<id>.events.json` files are recovery checkpoints and match their entries in the combined manifest. `check.mjs` compiles the JSON literal against the frozen `RecordingManifest` interface and checks required IDs, media dimensions/codec/pixel format/frame count/CFR, event ordering, visible boxes, coordinate bounds, contact sheets, phase sequence, resistance/release and Undo markers. If 4K assets exceed 150 MiB in total, the runner also produces 1080p `<id>.proxy.mp4` files.

## Gemini and reproducibility

The stack always receives an **empty** `GEMINI_API_KEY`, so automatic summaries and Live tokens cannot spend quota. The browser gets a deliberately fake Live-device token and cannot contact Gemini. Its summary POSTs are blocked; GETs still read real stored summaries.

The two permitted generation requests failed during production. The team app already had real Gemini summaries for an explicitly synthetic demo patient. `fixtures/demo-with-summary.sql.gz` packages those current logical rows (25 demo sessions, 5 demo evaluations, demo profile, traces, decisions, calibrations and stored summaries). It excludes deleted/freelist data and an unrelated progression-settings table. No shared database was modified. Its schema and foreign keys are checked during restoration.

The doctor takes restore this exact cohort so the charts and stored summary describe the same records. The visible summary is the stored `gemini-3.5-flash-lite` result generated on 2026-11-08; its JSON is also included under `public/recordings/therapist-summary.json`. This avoids using a summary from one seed revision with charts from another. All history labels remain those of the current app, including opening-assist copy and Demo data.

`summary.py` first reuses a stored result. If none exists, it can import the key at runtime from the path in the brief, in a separate Python process. The key is never returned to the browser, copied to a file, or logged. A persistent `/tmp/memo-video-summary-budget.json` counter enforces at most **two underlying model requests**, including fallback or shortening calls, across reruns. That budget is now exhausted; do not remove the counter to retry. Provider exception details are suppressed. Normal reruns use the packaged stored result and make no model requests.

Frame timing, simulator seed, UI actions and scrolling are scripted. Browser time is fixed to the demo date; database IDs and font/GPU rasterization can differ between machines. Reproduction means the same shots and events, not identical MP4 bytes.
