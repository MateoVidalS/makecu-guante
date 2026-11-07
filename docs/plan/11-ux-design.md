# 11 — UX & UI design

The design spec every frontend WP builds against (WP0 tokens/shell, WP6 hand, WP7 live pages, WP8 coach panel, WP9 data views,
WP11 QA). `08-frontend.md` says *what* is on each page; this doc says *how it should feel, look and behave*.

---

## 1. Who we are designing for

| Person | Context | Design consequences |
|---|---|---|
| **Patient** (post-stroke) | Affected hand in the glove, the other hand often weak too or busy steadying; sitting ~0.8–1.2 m from the laptop; tires quickly; may have **aphasia** (trouble with words), **visual neglect** (ignores one side of space, usually the left), reduced vision, slower processing; may feel discouraged | Hands-free by default (voice). **One instruction at a time.** Huge, high-contrast, centered essentials. Every instruction both **spoken and shown** (icon + ≤ 6 words). Nothing time-critical on the screen edges. Neutral-to-warm tone, so assistance never reads as failure. Short sessions, visible progress, easy to stop |
| **Helper** (family member or team member) | Sets up the glove, runs calibration, stands next to the patient; mouse/trackpad | Clear step-by-step wizard, live diagnostics, plain-language safety warnings, undo/redo of steps |
| **Therapist** | Reviews later, on the same laptop or a printout | Dense but calm data views, honest uncertainty, demo data clearly marked, export |

## 2. Design principles
1. **The hand is the hero.** On the exercise screen the virtual hand gets ≥ 55% of the width; everything else is secondary and quiet.
2. **One thing at a time.** One pose, one instruction, one primary action per screen. No competing animations.
3. **Effort over success.** Trying alone is the achievement. The glove "helping" is shown in a warm, positive color, never red; the copy says
   "The glove helped with the rest", never "Failed".
4. **Safety is loud; everything else is quiet.** Red, alarm sounds and full-width banners are **reserved for safety**. Nothing else uses them.
5. **Say it and show it.** Each instruction has a voice line + a short text + an icon. Each state change has an audible cue + a visual change.
6. **Calm, not gamey.** No points or confetti. Use soft progress rings, gentle pulses, and plain numbers framed as estimates.
7. **Same color = same meaning everywhere:** the UI, the virtual hand, the NeoPixel ring on the glove, the charts.
8. **Honest data.** Estimates are labeled as estimates, demo data is labeled, missing data shows as a gap, not zero.

## 3. Visual system (tokens, WP0 `src/styles/` + `tokens.ts`)

### 3.1 Semantic colors (light / dark)
| Token | Light | Dark | Meaning — used ONLY for this |
|---|---|---|---|
| `--bg` | `#F7F6F3` (warm off-white) | `#15171A` | page |
| `--surface` | `#FFFFFF` | `#1E2125` | cards |
| `--surface-2` | `#EFEDE8` | `#262A2F` | insets, chart backgrounds |
| `--text` | `#1D1F22` | `#F1F2F4` | body |
| `--muted` | `#5C6168` | `#A3A9B1` | secondary text (still ≥ 4.5:1) |
| `--border` | `#DAD7D0` | `#363B42` | |
| `--accent` | `#2A5BD7` | `#7EA2FF` | primary buttons, links, focus |
| `--target` | `#8A9099` (ghost hand, 35% opacity) | `#C5CAD1` | the pose to reach |
| `--active` | `#2F6FEB` | `#6E9BFF` | patient moving **on their own** |
| `--assist` | `#E8890C` | `#FFB257` | **the glove helping** (warm, not a warning) |
| `--reached` | `#1F9D55` | `#4CCB86` | position reached / success |
| `--danger` | `#C62828` | `#FF6B6B` | **safety only** (overcurrent, STOP, disconnect) |
| `--demo` | `#7B61FF` | `#A996FF` | demo-data badge/hatching |
| `--finger-thumb / -index / -middle` | `#7B61FF` / `#00A3BF` / `#C2185B` | lighter variants | per-finger series in charts only |

Glove ring alignment (`04-firmware.md §5`): follow = **blue** (`--active`), target/assist = **orange** (`--assist`), calib = amber, idle = dim white, fault = **red** blinking.

### 3.2 Typography
- Family: **Atkinson Hyperlegible** (designed for low vision; via `@fontsource/atkinson-hyperlegible`, self-hosted), with the system UI font as fallback. Numbers use
  `font-variant-numeric: tabular-nums`.
- Scale (rem at 18 px root): `display 3.5` (instruction on the exercise screen) · `h1 2.25` · `h2 1.6` · `h3 1.25` · `body 1` · `small 0.85` (never smaller in
  patient views) · `caption 0.75` (charts and the doctor view only).
- Line length ≤ 60 characters for instructions; sentence case; no all-caps paragraphs.

### 3.3 Space, shape, depth, motion
- 4 px grid; spacing tokens `4 8 12 16 24 32 48 64`. Radii `8` (inputs), `16` (cards), `999` (pills). Elevation: 2 levels (card, overlay) with soft shadows;
  dark mode uses borders instead of shadows.
- Motion: `--dur-fast 120ms`, `--dur 240ms`, `--dur-slow 480ms`; easing `cubic-bezier(.2,.8,.2,1)`. Phase transitions cross-fade (240 ms).
  The reach pulse is 400 ms. **`prefers-reduced-motion`**: no pulses or slides, only instant state changes + sound.
- Sound design (WebAudio, WP8): `cue` (soft two-note rise: attempt start), `reached` (soft chime), `assist` (low single tone),
  `safety` (distinct three-beep pattern, louder). Volumes are set so the coach voice stays clear on top.

## 4. App shell & modes (WP0)

Two shell densities:

```
SETUP / DATA SHELL (Home, Setup, Calibrate, History, Profile)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◐ Rehab Hub   Home  Exercise  Evaluate  History  Setup     [Glove ●] [Cam ●]  [Doctor view] │
├──────────────────────────────────────────────────────────────────────────────┤
│ (safety banner slot)                                                          │
│                                                                               │
│   page content, max-width 1200, 32 px gutters                                 │
└──────────────────────────────────────────────────────────────────────────────┘

FOCUS SHELL (Exercise live, Evaluate running) — nav hidden, nothing on the edges that matters
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✕ End session                               Pose 2 of 5 · Rep 1 of 3   [Glove ●] [Cam ●] │
├──────────────────────────────────────────────────────────────────────────────┤
│                         (safety banner slot, full width)                      │
│                       content centered, essentials in the middle 60%          │
└──────────────────────────────────────────────────────────────────────────────┘
```
- The status chips are always visible: a dot + a word ("Glove: Ready / Helping / Stopped / Not connected", "Camera: Sees hand / Can't see hand").
- The Doctor view uses its own **Doctor shell** with a slate banner "Doctor view · read-only" and an Exit button.

### Core components (WP7 owns them unless noted)
- **BigButton:** min 64 px tall, 20 px label, icon left; primary (accent fill), secondary (outline), quiet (text). Only one primary per view.
- **StatusChip:** dot + label, with a tooltip/popover for details.
- **PhaseRing:** a circular ring around a phase icon showing elapsed/total; a calm continuous fill (no ticking numbers in patient views).
- **FingerBars:** three vertical bars (thumb, index, middle), each with: a target line (grey notch), the live closure (blue fill), the active-max tick (thin blue line
  that stays), and an assist segment (orange) stacked above the active max when the glove helps. A label below each, a % above in `h3`.
- **SafetyBanner:** full width, `--danger` background, white text: icon + one sentence + the **Resume** button (primary on red, white) + "What happened?" disclosure.
- **AttemptToast:** bottom-center, 4 s, never covers the hand: "Index 55% on your own · glove helped 10%".
- **Stepper** (wizard): numbered steps with labels, the current step bold, completed ✓, clickable back to completed steps.
- **KpiTile, EmptyState, ConfirmDialog, Toasts** (top-right for system messages, never during focus mode except for errors).

## 5. Key screen designs

### 5.1 Virtual hand visual language (WP6)
- **Target ghost:** a matte translucent grey (`--target`, 35%), slightly larger (1.03×) so its outline frames the real hand.
- **Actual hand:** solid, a soft clay material in a warm neutral skin-agnostic tone (`#D9CFC4`, dark `#BFB3A6`), per-finger tint overlay by state:
  blue (moving alone) → orange (glove helping) → green (reached). Ring/pinky stay neutral.
- When not visible: the actual hand fades to 30% + a centered label "I can't see your hand — move it into view" + a camera icon.
- **Reached:** a green rim light pulse (400 ms) + the `reached` chime. The ghost briefly brightens, then fades out during HOLD (so the patient sees their own hand).
- Camera: a fixed 3/4 palm-up view chosen per pose family (a slightly side-on view for pinch). Background: a subtle radial gradient on `--surface-2`, no grid or floor.
- Mirroring follows the affected hand (left hand shows as a left hand).

### 5.2 Exercise — live (the most important screen)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✕ End session                          Pose 2 of 5 · Rep 1 of 3   [Glove: Helping ●] [Cam ●] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│          ┌─────────────────────────────────────┐    ┌──────────────────┐     │
│          │                                     │    │  ◔  Try now      │     │
│          │        VIRTUAL HAND                 │    │  (phase ring)    │     │
│          │   ghost = target, solid = you       │    ├──────────────────┤     │
│          │                                     │    │ Thumb Index Middle│    │
│          │                                     │    │  ▮     ▮▮    ▮    │    │
│          │                                     │    │ 35%   55%   60%   │    │
│          └─────────────────────────────────────┘    ├──────────────────┤     │
│                                                     │ [camera PiP]     │     │
│            Make a hook                              ├──────────────────┤     │
│            Bend the top two joints   (display 3.5)  │ 🎙 Coach: "Keep  │     │
│                                                     │ going, a bit more│     │
│                                                     │ with your index" │     │
│                                                     └──────────────────┘     │
│   [ Pause ]                 [ Skip pose ]                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```
- The hand + the instruction occupy the central 60%. The side column holds the details (phase, bars, PiP, coach). **On a 1280 px screen the side column
  collapses** into a bottom strip, so nothing important sits on the left edge (neglect).
- **Phase states** (icon + label in the ring, plus the hand tint):
  | Phase | Ring label | Visual | Voice/sound |
  |---|---|---|---|
  | PRESENT | "Get ready" | ghost appears (fade-in 480 ms), the actual hand neutral | coach says the instruction · `cue` sound at the end |
  | ATTEMPT | "Try now" | ring fills over `attempt_s`; blue tint as fingers move; active-max ticks appear | brief encouragement (≤ 1) |
  | HOLD | "Hold it" | green tint, ring refills over `hold_s` | `reached` chime + "Great, hold it" |
  | ASSIST | "The glove is helping" | orange tint on the helped fingers, orange segments on the bars | `assist` tone + "Good effort, the glove will help now" |
  | ASSIST_HOLD | "Hold it" | green once reached | chime |
  | RELEASE / REST | "Relax your hand" | ghost fades, the hand opens; the next pose preview in small text: "Next: tabletop" | coach debrief |
  | PAUSED | "Paused" | everything dims 40%; the Resume button is centered | – |
- PRESENT waits until the hand is visible (see `06-session.md §3`): the ring shows "Show me your hand" with a camera icon instead of counting down.
- Keyboard: Space pause/resume, S skip, Esc end (confirm). Voice equivalents are listed in a "You can say…" tooltip on the coach panel.

### 5.3 Camera overlay (WP3)
The video at 50% brightness so the drawn skeleton pops: bones 3 px white with a dark outline, joints as 6 px dots colored by finger state, a confidence pill top-left
("Sees hand 92%"). A guide frame (dashed rounded rectangle) shows where to keep the hand; it turns green when the hand is inside and seen. On the Setup page it's large;
on the exercise screen it's a 240 px PiP.

### 5.4 Coach panel (WP8)
A compact card: an avatar dot that animates while speaking (3 bars, reduced-motion → static), a status label ("Listening", "Speaking", "Simple voice", "Voice off"),
a mic toggle (big, labeled "Mic on/off"), the **caption of the last coach line** (`h3`, fades after 8 s), and "You said: …" in muted text. Mode switch in a menu:
Live coach / Simple voice / Off. On failure: an amber note "Live coach unavailable — using simple voice".

### 5.5 Session summary
```
┌──────────────────────────────────────────────┐
│  Session complete                    (h1)     │
│  15 attempts · 9 on your own · 6 with help    │
│                                               │
│   Thumb      Index      Middle   (on your own)│
│   38% ▲+3    55% ▲+15   61% ▲+4   vs last time│
│                                               │
│  "You closed your index further on your own   │
│   than last week. Nice steady work."  (Gemini)│
│                                               │
│  [ Practice again ]  [ See progress ]  [Home] │
└──────────────────────────────────────────────┘
```
Deltas: green ▲ for improvement, muted ▼ for decline (never red). The text says "estimate".

### 5.6 Calibration wizard
```
 ① Glove range  ─  ② Camera range  ─  ③ Glove friction  ─  ④ Review
┌──────────────────────────────────────────────────────────────────────────────┐
│ Step 1 · Glove range for the INDEX finger            ⚠ Hand relaxed. Stop if it hurts. │
│                                                                               │
│   [ illustration: finger open ↔ closed ]     Servo angle: 95°                 │
│                                               [−5] [−1] [+1] [+5]   ───●───── │
│   Current: ▁▂▂▁ 120 mA (limit 400 while jogging)                              │
│                                                                               │
│   1. Move until the thread is just tight and the finger fully open → [Set open ✓ 22°] │
│   2. Move until the finger is comfortably closed           → [Set closed]     │
│                                                                               │
│   Thumb ✓   Index ●   Middle ○                         [Back]  [Next finger]  │
└──────────────────────────────────────────────────────────────────────────────┘
```
- A persistent safety strip on every glove-moving step: "Keep the hand relaxed. Press STOP or say 'stop' anytime."
- The capture steps show a 2 s "Hold still" ring and give feedback if the hand moved ("Too much movement — let's try again").
- The wizard is resumable; the review shows every value with "Redo" links.

### 5.7 Setup
A two-column layout: Glove (left), Camera (right). Each column has a big Connect button, a status headline ("Glove ready", "Glove not connected — click Connect and pick
the USB device"), and collapsible diagnostics (telemetry bars, current sparkline with the limit line, event log, latency). The simulator panel sits in a clearly
labeled purple "Simulator" card.

### 5.8 Evaluate
A pre-flight checklist with large checkboxes → Start. While running: focus shell, a centered single chart (current vs. position, live, with the friction curve
in grey), "Measuring index · slow (1 of 6)", a stop button. Results: three finger cards with slow/fast/dependence as horizontal bars + an "aborted at 30%"
badge in amber (not red: the abort is the system working).

### 5.9 Home
Greeting + one primary button "Start today's practice" (it starts the default plan if calibrated; otherwise it routes to Calibrate with an explanation).
Below: a readiness checklist (glove, calibration, camera) with fix-it links; a last-session card; a "This week: 3 of 5 days" streak in neutral language.

## 6. Interaction choreography

### 6.1 One attempt, across all channels
| t | Screen | Voice / sound | Glove | Ring LEDs |
|---|---|---|---|---|
| 0 | PRESENT: ghost fades in, "Make a hook" | Coach: "Let's make a hook. Give it a try." | release | dim white |
| ~3 s | ATTEMPT: ring fills, "Try now" | `cue` sound | follow (slack) | blue |
| moving | blue tint, bars rise, ticks | (≤ 1 encouragement) | follow | blue bars |
| reached | green pulse, "Hold it" | chime + "Great, hold it" | follow | blue |
| or timeout | orange tint on unreached fingers | `assist` tone + "Good effort, the glove will help now" | target @0.3/s | orange |
| hold done | "Relax your hand", next-pose hint | Coach debrief (1 sentence) | release | dim white |

### 6.2 Safety interrupt (overcurrent / STOP / disconnect / camera lost)
1. **≤ 50 ms:** the `safety` sound; the SafetyBanner slides in (instant with reduced motion); the hand tint goes neutral; the glove chip turns "Stopped" in red.
2. **≤ 300 ms:** a fixed phrase is spoken locally ("Stopping. I felt resistance in your index.").
3. The coach (Live) follows with a calm check-in ("Are you OK? Say 'continue' when you're ready.").
4. Resume (button or voice) → the banner shows "Releasing the glove…" → after the firmware is back to `idle` → continue with REST.
The banner has a "What happened?" disclosure with the technical detail (mA, which event) for the helper.

### 6.3 Microcopy
| Situation | Copy |
|---|---|
| Glove helps | "The glove helped with the rest." (never "failed", "missed") |
| Reached alone | "You did that on your own." |
| Camera lost | "I can't see your hand. Move it into the frame." |
| Overcurrent | "Stopped — I felt resistance in your {finger}." |
| STOP button | "Stopped. Release the STOP button, then press Resume." |
| Disconnect | "The glove disconnected and has released. Reconnect it in Setup." |
| No calibration | "Let's set up the glove for your hand first. It takes about 3 minutes." |
| Estimates | "Estimated from the camera — not a medical measurement." |
| Demo data | "Demo data" badge + hatched points |

## 7. Data visualization (WP9)
- Line charts for trends over sessions (x = date, true time spacing); small multiples per finger, never all fingers + metrics stacked in one chart.
- Each chart: a title stating the takeaway in plain words ("Index: closing further on its own"), labeled axes with units (%, s, mA), a "↑ better" / "↓ better" hint,
  a dashed baseline at the first session.
- Per-finger colors from the finger palette only; states (active/assist/reached/danger) are never used as series colors.
- Demo points are hollow + hatched with a legend entry. Gaps where data is missing (no interpolation across missing sessions).
- Replay: closure solid, servo position dashed (the same finger color), current on a right axis in a neutral grey with a labeled axis; phase bands as light
  background tints using the phase colors at 10% opacity; safety markers as red ▲ with a tooltip. (This is the only chart where red appears.)
- Tooltips list values with units and the session date. Every chart has an accessible data-table toggle ("Show as table").

## 8. Accessibility & readability rules (testable)
- Patient views at a 1280×720 window: the instruction ≥ 48 px, phase label ≥ 28 px, finger % ≥ 24 px, buttons ≥ 64 px tall.
- Contrast: text ≥ 4.5:1, large text and essential graphics ≥ 3:1 in both themes (verify the tokens with a contrast checker in WP0's PR).
- Color is never the only signal: states carry icons/labels; the hand states carry tint **and** a label in the ring.
- Neglect-safe layout: the critical info (instruction, hand, phase, safety) is centered or spans full width; nothing essential sits only in the left 25%.
- Keyboard: everything reachable; a visible 3 px focus ring (`--accent`); focus moves to the SafetyBanner's Resume when it appears.
- Screen reader: `aria-live="polite"` announces phase changes; `assertive` for safety; the hand has an `aria-label` with the target pose.
- Reduced motion respected everywhere; no flashing > 3 Hz (the ring fault blink is on the glove, not the screen).
- Language: sentences ≤ 12 words in patient views; no jargon (no "mA", "closure", "PWM" in patient views; say "%" and "how far your finger closed").
- Session ergonomics: the default plan ≈ 6–8 min; a "Short session (1 rep each)" option on Home; the voice command "I'm tired" maps to `stop_session` with a kind confirmation.

## 9. UX QA checklist (WP11 runs it; WP7 and WP9 self-check)
- [ ] Every screen in light + dark at 1440×900 and 1280×720 (screenshots).
- [ ] Every exercise phase reachable in `make dev-sim` and visually distinct in grayscale.
- [ ] Safety flows: overcurrent, STOP, disconnect, camera lost — the banner, sound, phrase, resume, focus handling.
- [ ] Copy matches §6.3; no "failed"/"error" wording in patient views except true system errors.
- [ ] §8 sizes and contrast verified (axe-core run in Playwright, zero serious violations).
- [ ] Reduced motion on: no animation except state changes.
- [ ] A first-time helper can complete calibration without reading the docs (hallway test with a teammate; notes in the PR).
- [ ] Demo data is labeled everywhere it appears (history, doctor view, print, export).

## 10. Amendments from the design lead's audit (adopted)
1. A new `--caution` amber role for non-safety heads-ups; orange keeps the single meaning "the glove is helping".
2. Every state color has `-text` (readable on light) and `-soft` (tint background) variants; plain `--assist`/`--reached` are never used for text.
3. Three control sizes: 64 px patient, 48 px helper/data, 36 px doctor (replaces "64 px everywhere").
4. The live exercise screen fits 1280×720 without scrolling (added to the §8 checks).
5. The focus shell owns "End session" and the progress label; pages must not duplicate them.
6. Status vocabulary: "Paused" is neutral; "Stopped" is for safety only.
7. Red is also allowed on the confirm button of destructive actions (e.g. Delete session), the only exception besides safety.
8. Dark mode: cards use borders; dialogs and toasts keep a shadow.
9. Microcopy: dates as "Nov 5, 2026"; mA as integers, % as integers, seconds to 1 decimal.
10. Profile is an icon in the header tools, next to a theme toggle.

The implementation reference is `docs/design/DESIGN_SYSTEM.md` and the `/_dev/design` gallery.
