# 01 — Product spec

Concept: `README.md` (robotic tendon glove + webcam + assist-as-needed). This doc turns it into a buildable scope.

## 1. Who
- **Patient (primary):** post-stroke paretic hand, practicing at home. The affected hand is in the glove, so the app has to work hands-free
  (voice) and be readable from about 1 m.
- **Helper:** sets up the glove and runs the calibration wizard (a team member at the event).
- **Therapist (secondary):** a read-only "Doctor view" button on the same computer, plus the Gemini therapist summary and export.

## 2. Modes in scope
- **Exercise** (core): target pose → patient tries alone → the glove completes the rest → metrics.
- **Evaluation:** relaxed hand, the glove closes each finger slowly and then fast → resistance and velocity dependence.
- Out of scope: Mirror mode, feedback fading, ring/pinky actuation, remote access, auth, multiple patients, languages other than English.

## 3. User stories

| # | Story | Acceptance |
|---|---|---|
| U1 | The helper connects the glove and camera | Setup page: Connect glove (Web Serial), pick the camera, see live telemetry + the hand overlay; "Use simulator" for both |
| U2 | The helper calibrates for this patient | 3-step wizard: servo ranges → camera range → thread friction, threads unhooked (skippable; see 16-bare-hand.md); saved and sent to the glove |
| U3 | The patient sees the target pose | The virtual hand shows the target (ghost) and the real hand (solid) overlaid, with < 150 ms visible lag |
| U4 | The patient tries alone, and the glove helps only if needed | Follow mode during the attempt (no pulling); assist to the target after a timeout or plateau; the hand turns green on reaching |
| U5 | The coach guides by voice | Gemini Live says the instruction, encourages, debriefs each attempt, and answers questions; voice commands work: pause, continue, skip, repeat, stop, how am I doing |
| U6 | Safety is visible and spoken instantly | Overcurrent, STOP, watchdog, camera lost or resistance → the glove releases, the voice announces it within ~300 ms (local), the session pauses |
| U7 | Every attempt is recorded | Per-finger active max, time to position, assist needed, current, safety events, 20 Hz trace |
| U8 | The patient sees the session result | Summary screen + a Gemini patient summary + a spoken recap |
| U9 | Evaluation measures stiffness | Per-finger slow/fast resistance and velocity dependence, aborting safely on overcurrent |
| U10 | Progress over time | History: active range per finger over sessions, assist needed over sessions, resistance over evaluations |
| U11 | Session replay | Per-attempt chart of vision closure vs. servo position vs. current, with phase bands, plus the transcript |
| U12 | The therapist reviews | Doctor view: read-only dashboard, Gemini therapist summary (on demand), print to PDF, JSON/CSV export |
| U13 | Works without hardware | Simulated glove + simulated patient/camera, with dev controls (STOP, unplug, rigid finger, hand out of frame) |
| U14 | Works without a Gemini key | Fixed-phrase voice; the summaries show "unavailable" |

Nice-to-have: **Profile** (pseudonym, affected hand, condition, goals, therapist contact). Optional; it only personalizes the coach
and the doctor view, and sets the affected hand for vision (which is also editable in calibration).

## 4. Decisions (agreed)
| Topic | Decision |
|---|---|
| Stack | React + Vite + TS (browser does vision, glove link, engine, voice) · FastAPI + SQLite (storage, Gemini) |
| Voice | **Gemini Live** coach + a **local safety net** (Web Speech + earcons) + a fixed-phrase fallback |
| Summaries | Gemini text: patient session summary (automatic at session end) + therapist summary (on demand) |
| Poses | Tendon glides (open, hook, tabletop, straight fist, full fist) + thumb–index pinch |
| Calibration | Guided wizard: servo ranges (jog) → camera open/closed (closed = the patient's own fist, see 15/16) + pinch → thread friction (unhooked) |
| Firmware | Written by a Codex worker (PlatformIO), with native unit tests for all safety logic |
| Simulator | A TS `SimWorld`: a firmware-faithful SimGlove + a patient model + SimVision |
| Carried over | Patient-first, doctor view button, history trends + replay + per-finger breakdown, optional profile, English |
| Demo data | Flagged `is_demo` everywhere and labeled in the UI |

## 5. Copy rules
Short, encouraging, second person. Show closure as % ("Index: 55%"). Never "mA" in patient views (the doctor view and replay may show it).
Clinical framing: "estimate inspired by clinical practice", never "validated measurement".

## 6. Demo storyline (README §8)
1. A team member with a relaxed hand: the virtual hand asks for a fist, they try halfway, the glove completes it, the hand turns green.
2. **Key moment:** they stiffen the index on purpose → the current rises on screen → the glove stops on its own → the voice says "I felt resistance
   in your index, let's stop here."
3. History with seeded demo sessions (labeled), and the evaluation resistance trend.
4. Doctor view → the Gemini therapist summary in one click.
