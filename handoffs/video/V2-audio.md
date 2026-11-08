# V2: voice-over, music and mix

Read `handoffs/video/README.md` first. You own `video/studio/audio/**` (scripts), `video/studio/public/audio/**`,
`video/studio/src/audio/**`. Contracts: `VoManifest`, `MusicManifest`, `SfxManifest` in `src/contracts.ts`. The copy is in
`src/script.ts` (coordinator-owned: never rewrite a line; report lines that don't fit their slot).

**The music matters most.** The owner asked specifically for a great demo track. A good bed is half of a YC launch video.

## Gemini key and quota
Read `GEMINI_API_KEY` at runtime from `/Users/mateovidal/orca/workspaces/makecu-guante/rehab-hub/backend/.env`. Never copy, commit or
print it. The key is on the **free tier: ~20 requests/day per model** plus per-minute limits. Plan requests; cache every response
to disk (`audio/cache/`, git-ignored) and never re-request something you already have.
Models on this key: TTS `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview`,
`gemini-2.5-pro-preview-tts`, `gemini-2.5-flash-preview-tts`; music `lyria-3.5`, `lyria-3-pro-preview`, `lyria-3-clip-preview`.
Check the current API docs for request shapes (google-genai is already a backend dependency; `uv run` from `backend/` or a small
Node script with `@google/genai`).

## 1. Voice-over
- **Auditions first** (≤ 4 requests): the three `problem-*` lines read by 3–4 narrator voices (suggestions: Sulafat, Achird, Charon,
  Kore). Direction: warm, calm, confident, mid pace, American English, not salesy, not whispery. Save to
  `public/audio/auditions/vo-<voice>.wav`. Pick the best yourself and continue; the coordinator may swap later, so make the
  voice a one-line config.
- Coach lines (`voice: 'coach'`) use **Puck** (the app's Gemini Live voice, `GEMINI_LIVE_VOICE`).
- To save quota, synthesize a whole scene per request with clear pauses, then split on silence into one file per line id;
  verify each split matches its text (duration sanity + listen to boundaries). Trim leading/trailing silence to ≤ 40 ms.
- Output `public/audio/vo/<id>.wav` (48 kHz) + `public/audio/vo/manifest.json` with `durationFrames` at 30 fps.
- `pnpm check` fails if a line is longer than its slot. If one doesn't fit, try a slightly faster read once; if it still doesn't,
  report it.

## 2. Music (100 BPM, exactly 5184 frames = 172.8 s)
The cut is on a 100 BPM grid (`src/timeline.ts`). Scene starts in seconds: hook 0, team 7.2, problem 16.8, reveal 28.8,
session 40.8, coach 91.2, doctor 110.4, underHood 139.2, next 153.6, close 163.2, end 172.8.
Arc:
- 0–28.8 s: sparse felt piano + soft warm pad, wistful but kind (Rosa, the problem). Light, lots of space for VO.
- 28.8 s (reveal): the lift. A gentle pulse arrives (muted plucks, soft kick/shaker, warm bass), optimistic, modern, human.
  Think Apple/Linear/Stripe launch films, not corporate ukulele, not EDM, not epic trailer.
- 40.8–139 s: steady, light groove under the demo, leaves the mid range free for the voice.
- ~70.8 s (resist moment, session +900 f): drop to almost nothing for ~2.5 s, return at ~79.2 s (the release line).
- 139.2 s: a little more drive under "the board decides".
- 153.6 s: pull back for the founders.
- 163.2 s: resolve; final chord lands and rings out by 172.8 s.
Generate with Lyria. Try **2–3 candidates** (check how long a single Lyria generation can be; if shorter than 172.8 s, generate
sections that share key/tempo/instrumentation and crossfade them on bar lines, 1 bar = 2.4 s). Save candidates to
`public/audio/auditions/music-<n>.wav`, pick the best, conform it to exactly 172.8 s, fill `MusicManifest` (`source`, `cues` for
the arc's level automation). If Lyria isn't available on this tier, fall back to a CC-licensed track (the team's earlier cut used
Sascha Ende, ende.app, CC BY 4.0): pick a 95–105 BPM one, credit it in `credit`, and say so in the PR.

## 3. SFX (subtle, few)
At most 6 sounds, CC0 (Kenney UI/interface packs) or synthesized: a soft click for app clicks, a quiet tick for "reached",
a low soft tone for the safety release (calm, not an alarm), a page whoosh is **not** allowed. `SfxManifest` + license in `source`.
Expose an `<Sfx id="…" />` component in `src/audio/` that scenes can drop in.

## 4. Mix
Refine `src/audio/AudioLayer.tsx`: VO ducking (music −10 dB under VO with 200 ms ramps), music cues, SFX bus. Target the final
render at −14 LUFS integrated, true peak ≤ −1 dBTP; add `audio/loudness.sh` that measures a render with ffmpeg `ebur128`.

## Deliverables / acceptance
- [ ] Auditions + chosen VO for every `VO` id, manifest, `pnpm check` green.
- [ ] Music candidates + the conformed bed (172.8 s, 100 BPM, cues), source and license documented.
- [ ] SFX + `<Sfx/>`.
- [ ] A test render of `Main` with audio (`npx remotion render Main out/v2-mix.mp4`), its loudness numbers in the PR.
- [ ] Request log in the PR: how many requests per model you used.
