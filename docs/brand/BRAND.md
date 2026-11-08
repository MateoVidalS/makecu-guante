# memo — brand guidelines

memo is the product name of this repo's robotic tendon glove, webcam and voice coach for hand rehabilitation after a stroke.
"Rehab Hub" remains the internal code name in `docs/plan/`, `handoffs/` and `AGENTS.md`. Everything a patient, helper,
therapist or judge sees says **memo**.

The visual system (tokens, components, layouts) is in [`docs/design/DESIGN_SYSTEM.md`](../design/DESIGN_SYSTEM.md). This file covers
what sits above it: why the product exists, how it speaks, and how the name and logo are used.

---

## 1. Strategy

### Purpose
memo exists to help people after a stroke get the opening of their hand back at home, one honest attempt at a time.

### Positioning
> For people recovering hand function after a stroke, and the therapists who guide them,
> **memo** is a home practice system (a soft tendon glove, a webcam and a voice coach)
> that lets the patient try first and helps only with the opening they can't do yet.
> Unlike passive motion devices that move the hand for you, or rehab games that score you,
> memo measures your own effort honestly and never does the work you can do yourself.

### The name
- **Muscle memory.** Recovery after a stroke is relearning by repetition. memo is the reminder your hand practices with.
- **A memo is a short note.** It fits the product's main rule: one instruction at a time, six words or fewer.
- **Small and human.** It is a word you'd say to a family member ("did you do memo today?"), not a device code.

### Archetype
**Caregiver** first, **Sage** second. memo looks after the person (warm, patient, never blaming) and is honest about the data
(estimates are labeled, gaps stay gaps). It is never a Hero ("crush your goals") and never a Jester (no points, no confetti).

### Tagline
**Your hand remembers.**

Supporting lines, for different contexts:
- "Try first. memo helps with the rest." (how it works)
- "Practice opening, one try at a time." (the session)
- "Honest numbers for the people who guide you." (therapist-facing)

### Personality

| memo is | memo is not |
|---|---|
| **Patient:** it waits for you, then helps | Pushy, hurried, countdown-driven |
| **Warm:** effort counts, help is not failure | Sugary, childish, over-cheerful |
| **Plain:** short words, one idea per line | Clinical jargon, marketing hype |
| **Honest:** estimates are estimates | Overclaiming ("clinically proven", "cures") |
| **Calm:** quiet until safety needs it loud | Gamey, flashy, alarming for no reason |

---

## 2. Voice and tone

The voice stays the same everywhere; the tone moves with the situation.

| Context | Tone | Example |
|---|---|---|
| Patient, live exercise | Gentle, very short (≤ 6 words on screen) | "Try to open your hand." · "The glove helped with the rest." |
| Patient, session end | Warm, specific, never comparative to others | "Your index opened further on your own than last week." |
| Safety | Direct and calm. No exclamation marks, no blame | "The glove released. Your hand is safe." |
| Helper, setup | Step-by-step, practical | "Plug in the glove, then click Connect." |
| Therapist, Doctor view | Precise, hedged where it should be | "Estimated resistance to opening. Not a validated clinical measure." |
| Demo, pitch | Confident, concrete, still honest | "memo only helps with the part of the opening you can't do yet." |

### Word list

| Say | Avoid |
|---|---|
| try, on your own, your hand | fail, wrong, missed, bad rep |
| the glove helped | the robot, the machine took over |
| practice, attempt | workout, grind, challenge |
| estimate, about | accurate, proven, diagnostic |
| stop, release, safe | emergency (unless it is one) |
| person, patient (in clinical views) | user, subject, victim, "suffers from" |

### Writing rules
- **The name is always lowercase: memo**, even at the start of a sentence or a title ("memo helps you open your hand").
  Never "Memo", "MEMO" or "MeMo". When a sentence would start awkwardly, rephrase it.
- Sentence case for headings and buttons. No ALL CAPS.
- One idea per sentence. Active voice. Talk to the person ("you"), not about them.
- Product copy is in English. Spanish text, when written, never uses the opening `¿` or `¡`.

---

## 3. Logo

Asset files are in [`assets/`](assets/). In the app use the components in `frontend/src/design-system/Logo.tsx`:
`<Logo />` (lockup), `<LogoMark />` and `<Wordmark />`. Never typeset "memo" in a font as a logo.

### The mark
A solid **m** in front of a taller, faint **m**, on a deep blue tile, with a thin gap cut between them.
It is memo's core screen in one symbol: the faint, taller shape is the **target** (the ghost hand, more open), the solid
shape is **you**, reaching up toward it. The arches also read as knuckles, the joints memo helps to open.

- `memo-mark.svg`: primary mark, 24 px and up.
- `memo-mark-small.svg`: under 24 px (favicons). It drops the ghost so the m stays crisp.
- `memo-mark-512.png`, `frontend/public/apple-touch-icon.png`: raster exports.

### The wordmark
A custom monoline lowercase **memo**: round caps and joins, one even stroke, the same geometry as the mark. Built from
arches and circles so it stays legible at small sizes and low vision (it pairs with Atkinson Hyperlegible).
- `memo-wordmark-ink.svg` (on light), `memo-wordmark-white.svg` (on dark or the doctor bar), `memo-wordmark-blue.svg` (rare, on white only).

### The lockup
Mark on the left, wordmark on the right, both centered on the same line (`memo-lockup-ink.svg`, `memo-lockup-white.svg`).
Wordmark height is about 40% of the mark height.

### Clear space and minimum size
- Keep clear space equal to **half the mark's height** on every side of the lockup, and a quarter of it around the mark alone.
- Minimum sizes: mark **16 px** (small version), lockup **24 px** tall, wordmark alone **48 px** wide.

### Don't
- Recolor the tile with a state color (orange, green, red, purple carry meanings in the product).
- Put the target m in front of the solid one, close the gap between them, or animate them apart. (A single 240 ms fade-in is fine.)
- Stretch, rotate, outline, add shadows, gradients or glows.
- Place the blue tile on a busy photo or on another blue.
- Rebuild the wordmark in a font or change its letter spacing.
- Capitalize the M.

---

## 4. Color

memo has **one brand color**. Everything else is product semantics from the design system.

| Name | Hex | Token | Use |
|---|---|---|---|
| **memo blue** | `#2F5B9A` | `--brand` (logo), `--accent` (UI, light) | The mark's tile, primary buttons, links, focus |
| **Ink** | `#1A1D21` | `--text` | Wordmark and text on light |
| **Paper** | `#FAFAF9` | `--bg` | Backgrounds |
| **White** | `#FFFFFF` | `--surface`, `--on-brand` | Cards, the m on the tile |
| **Slate** | `#2F3A47` | `--chrome` | Doctor bar, dark slides |

memo blue on white is 7.1:1 (AAA). White on memo blue is the same.

The state colors (blue for **on your own**, orange for **the glove helped**, green for **reached**, red for **safety only**)
are not brand colors. Use them only to mean those states, in the app, on the glove LEDs, in charts and in slides that show data.
Never use them for decoration.

Approximate print values for memo blue: RGB 47 91 154 · CMYK 85 55 0 15 · nearest Pantone 7684 C (check a proof).

---

## 5. Typography

- **Atkinson Hyperlegible Next** for everything: app, slides, print, posters. Two weights only: Regular 400 and SemiBold 600.
  It was designed for low vision, which is part of the brand promise.
- Numbers in tabular figures. Sentence case. Left-aligned, except one centered instruction on the exercise screen.
- Fallback: the system UI font.

---

## 6. Imagery

- **Real hands in real homes.** A kitchen table, daylight, a laptop at arm's length. Show effort: a hand halfway open is the hero shot.
- The glove is shown as **soft gear**, like a sports glove, never as a robot or cyborg hand.
- No stock photos of smiling seniors pointing at tablets. No brain-with-lightning, DNA or medical-cross clichés.
- Diagrams use the ghost-and-solid language: a faint target shape and a solid actual shape.
- Icons: the design system's 2 px round-stroke set. No emoji as icons.

---

## 7. Applications

| Where | What to use |
|---|---|
| App header | `<Logo size={24} />`, links home, accessible name "memo, home" |
| Browser tab | `frontend/public/favicon.svg` (small mark), title "memo" |
| Doctor view and printouts | Lockup in white on the slate bar; report eyebrow "memo · Clinical review" |
| Demo slides | Paper background, ink text, the lockup top-left, one memo-blue accent per slide |
| Glove | A small mark on the wrist module; the LED ring keeps its state colors, never memo blue as decoration |
| Social avatar | `memo-mark-512.png` |

---

## 8. Naming notes

- In Spain, "memo" is slang for a fool. In Latin America it is mostly a friendly nickname (for Guillermo). If memo is marketed
  in Spanish, test the name with Spanish-speaking patients first. A descriptor helps: "memo, hand practice".
- The voice coach keeps the generic name **Coach**. memo is the product, not a character.
- Check trademarks and domains before any public launch. Many products are already called "Memo".
