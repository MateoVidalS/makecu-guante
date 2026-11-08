# Video handoff status (coordinator-maintained)

Integration branch: `MateoVidalS/video` · Repo id: `de782449-371b-4870-89e2-d609eaf149b6`

| WP | Brief | Worktree | Agent handle | Branch | PR | Status |
|---|---|---|---|---|---|---|
| V1 | [capture](V1-capture.md) | `…/v1-capture` | `term_dfdca374` | `MateoVidalS/v1-capture` | #162 | merged |
| V2 | [audio](V2-audio.md) | `…/v2-audio` | `term_ec42310b` | `MateoVidalS/v2-audio` | #161 | merged |
| V3 | [story](V3-story.md) | `…/v3-story` | `term_0593e68a` | `MateoVidalS/v3-story` | #157 | merged |
| V4 | [hardware-hood](V4-hardware-hood.md) | `…/v4-hardware-hood` | `term_21e221f7` | `MateoVidalS/v4-hardware-hood` | #163 | merged |
| V5 | [screen](V5-screen.md) | `…/v5-screen` | `term_4f3f2b3c` | `MateoVidalS/v5-screen` | #158 | merged |
| V6 | [gemini](V6-gemini.md) | `…/v6-gemini` | `term_c0a14ea1` | `MateoVidalS/v6-gemini` | #167 | merged |
| V7 | [build-callouts](V7-build-callouts.md) | `…/v7-build-callouts` | `term_618c7689` | `MateoVidalS/v7-build-callouts` | #171 | merged |
| V5b | screen polish | `…/v5-screen` | `term_4f3f2b3c` | `MateoVidalS/v5-polish` | #173 | merged |
| V2b | music for the new order | `…/v2-audio` | `term_ec42310b` | `MateoVidalS/v2-remix` | #172 | merged |
| V2c | music for the final cut | `…/v2c-music` | `term_10be2606` | `MateoVidalS/v2c-music` | #176 | merged |

Final cut: `video/previews/memo-final-4k.mp4` (not in git), 3840x2160, 30 fps, 177.6 s, -14.0 LUFS, -1.2 dBTP.
Team footage in: team-intro, coach-talk, bench-real. Still a placeholder: session-hand (PiP in the session).

## App follow-up found while recording the coach take (not fixed here)
- **Help-request race:** when the patient says "help", `VoiceController.checkHelpRequest` waits `HELP_SENTENCE_MS` (700 ms)
  before `exercise.requestHelp`. Gemini Live often calls `assist_finger_now` first; the engine's `assistNow` then rejects it
  (`onRequest && !helpRequested`), so the coach says it cannot help. For the take, `HELP_SENTENCE_MS = 0` fixed it locally
  (reverted). A proper fix: in `therapy.ts`'s ATTEMPT branch, when `patientAskedForHelp()` is true, register the patient's
  request before calling `assistNow`.
- The coach prompt names the device "the glove"; the owner prefers "memo" in anything shown publicly.
