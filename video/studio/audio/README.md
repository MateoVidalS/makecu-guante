# V2 audio

All shipping audio lives in `public/audio/`. Scene copy and timeline are unchanged.

- Narrator: **Sulafat**; coach: **Puck**. Change narrator in `audio/config.json`.
  Three problem-scene auditions are in `public/audio/auditions/vo-*.wav`.
- Music: **A Kind Of Hope** by Scott Buckley, CC BY 4.0, edited with original
  synthesized 100 BPM percussion. Candidate 1 is piano/strings alone; candidate 2
  adds a quiet kick/shaker pulse. Both are 48-second audition excerpts covering
  the opening and reveal. Candidate 2 becomes the full 177.6-second bed.
- SFX: three original synthesized sounds, released under CC0 1.0: `click`,
  `reached`, and `release`. No alarm or transition whoosh.

## Preview and use

```sh
pnpm studio
npx remotion render Main out/v2-mix-raw.mp4
audio/loudness.sh --normalize out/v2-mix-raw.mp4 out/v2-mix.mp4
audio/loudness.sh out/v2-mix.mp4
```

The raw render is the dialogue/music mix with headroom. The mastering pass targets
−14 LUFS integrated and ≤ −1 dBTP, copies the video stream, and leaves 0.2 dB
of limiter headroom before AAC encoding. Re-measure the encoded file. Re-master
after adding the team's real footage; its dialogue changes the integrated level.

Scenes opt into SFX explicitly, using their recording's actual event frame:

```tsx
import { Sequence } from 'remotion';
import { Sfx } from '../audio';

<Sequence from={eventFrame} layout="none">
  <Sfx id="reached" />
</Sequence>
```

The SFX bus is −6 dB. The mixer ducks music by exactly −10 dB under narration,
using 200 ms attack/release ramps. Overlapping speech intervals use one duck,
so overlapping ramps do not multiply. Real `team-intro`, `team-next`, and
`coach-talk` footage automatically reserve dialogue headroom when present.

`public/audio/music/manifest.json` controls the scene arc independently of VO
ducking: exact silence during the founders from 0–7.2 s; piano enters on the
hook cut at 7.2 s; reveal lift at 24 s; resistance drop at 66 s for 2.5 s;
restrained rebuild until release at 74.4 s; build groove at 134.4 s; bench gain fixed at 35%
from 144–148.8 s (percussion pauses for servo sound); board lift at 148.8 s; founders pullback at 160.8 s; resolution at 168 s; fade to zero at
the 177.6-second end. All boundaries are derived from the current timeline.

## Reproduce and check

From `video/studio/`:

```sh
python3 audio/generate.py replace reveal
python3 audio/generate.py replace session
python3 audio/generate.py replace gemini
python3 audio/generate.py replace judging
pnpm check
node audio/check.mjs
```

From `backend/` (temporary Python packages; no dependency changes):

```sh
uv run --with faster-whisper python ../video/studio/audio/replace_vo.py
uv run --with numpy python ../video/studio/audio/build_music.py
uv run --with faster-whisper python ../video/studio/audio/verify_vo.py
```

Generation reads the key at runtime from the brief's specified `.env`. Never
copy it here. Every API response, including errors, is cached in git-ignored
`audio/cache/`; rerunning an identical request reads that cache. There are no
automatic retries. `audio/request-log.json` records calls without credentials.

Lyria returned HTTP 429: the free-tier daily limit for its underlying Pro model
is **0**. Two requests failed; no Lyria music was returned. Gemini 3.8 Flash TTS
returned nine successful responses, then one daily-limit rejection. The retry
for `coach-1`, corrected brand readings, and `build-1` succeeded on Gemini 3.8 Flash-Lite TTS with the same Sulafat voice.
The original `coach-1` take and its retry both exceeded the 126-frame slot. Two silent gaps in the
retry were shortened to 150 ms, yielding 122 frames; no words or spoken samples
were removed and no time stretching was used. `audio/vo-edit.json` gives exact
source cuts and the pause edits.

The latest owner revisions change five existing lines and add four Gemini
lines plus the bench line, all with Sulafat. These ten lines use four batched
requests. `coach-2` is retired from the manifest. The other 17 retained WAVs
remain byte-for-byte unchanged; hashes are recorded in
`audio/revision-report.json`. Initial full-scene takes are archived in the local
cache; `prepare_vo.py` refuses to overwrite installed owner revisions.

`audio/check.mjs` checks every expected VO id, actual WAV duration against its
manifest and slot, 48 kHz sample rates, exact bed sample count, exact silence before the
7.2-second cut and piano in the first hook frame, cue ordering,
resistance/release levels, SFX licenses/count, and ducking ramp/overlap behavior.
The local Whisper transcript pass (`verify_vo.py`) verifies the split files independently of
the TTS response. Brand-name spelling may differ in automatic transcription. One isolated doctor
clip caused an ASR leading-word hallucination; whole-take recognition and source
word boundaries independently confirm the exact scripted phrase, with no
adjacent words included in the cut. This context review is saved in the report.

## Source and attribution

Music source: [A Kind Of Hope](https://www.scottbuckley.com.au/library/a-kind-of-hope/).
The artist describes piano, strings, and atmospheric synth and grants CC BY 4.0
use on the track page. [License](https://creativecommons.org/licenses/by/4.0/).
The 100 BPM catalog listing is available at
[SongBPM](https://songbpm.com/@scott-buckley/a-kind-of-hope-xc7dc).
The source download URL, SHA-256 and edit decision list are in `audio/music-edit.json`.

Use this credit in the published video's description (also supplied in the music manifest):

> 'A Kind Of Hope' by Scott Buckley — released under CC BY 4.0.
> https://www.scottbuckley.com.au/library/a-kind-of-hope/
> https://creativecommons.org/licenses/by/4.0/
> Edited, crossfaded and mixed with original synthesized percussion for memo.

Candidate excerpts are adapted from the same licensed track and need the same
credit if published separately. SFX mathematical synthesis is original; source
code and WAVs are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

API request shapes were checked against Google's current
[speech generation](https://ai.google.dev/gemini-api/docs/speech-generation) and
[Lyria generation](https://ai.google.dev/gemini-api/docs/music-generation) docs.

## Verified render

The final delivery file is `out/v2-mix.mp4`; mastering is included in the
workflow above. `out/v2-mix-master.mp4` is refreshed with an identical copy.

The encoded 177.6-second master measured **−14.0 LUFS integrated**, **−1.2 dBTP**
and 9.2 LU loudness range. The raw mix measured −17.5 LUFS / −3.4 dBTP.
Full measurement commands and ffmpeg summaries are in `audio/loudness-report.txt`.
Six review PNGs (reveal, safety coach, Gemini, build, bench and the mix map) are in `evidence/V2/`.

## Integration notes

The base branch has visual and team-footage placeholders. V2 changes no scenes
and adds no SFX calls to other workers' files. The coordinator must place the
music credit on the close card (the manifest contains it), align SFX with V1/V5
recording events, and re-master after inserting team dialogue.
