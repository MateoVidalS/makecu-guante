# Rehab Hub design system

The design system turns `docs/plan/11-ux-design.md` (the UX spec) into code. The spec explains **why**. This file explains **how**:
which token or component to use, and when.

- Tokens: `frontend/src/styles/tokens.css` (CSS) and `frontend/src/styles/tokens.ts` (canvas, charts, three.js). A test keeps the two in sync
  and checks contrast (`src/design-system/tokens.test.ts`).
- Components: `frontend/src/design-system/` with one entry point, `import { Button, Card } from '../../design-system'`.
- Living gallery: **`/_dev/design`** (run `make dev-mock` and open http://127.0.0.1:5173/_dev/design). It shows every primitive and state.
  The header button cycles Light → Dark → Match system. Light is the default.
- Shell: `frontend/src/App.tsx` + `frontend/src/styles/shell.css`. Element defaults and legacy classes: `frontend/src/styles/base.css`.

---

## 0. Visual direction (design cleanup, Nov 2026)

Rehab Hub should feel like a calm, clinical, premium product: think Linear, Stripe Dashboard, Apple Health, Notion.
**Restraint over decoration.** Light is the default and primary experience; dark stays available from the theme toggle.

- **Light by default, whatever the OS says.** `Theme.tsx` stores nothing for light; "Dark" and "Match system" are explicit,
  remembered choices. The shell applies the preference before the first render.
- **Surfaces:** near-white page (`--bg` #FAFAF9), white cards (`--surface`), 1 px hairlines (`--border` #E5E5E1). No card
  shadows (`--elevation-card` is `none`). One subtle shadow level for overlays only (`--elevation-overlay`: dialogs, toasts, menus).
- **One accent:** a calm deep blue (`--accent` #2F5B9A) for the primary button, links, focus and the selected nav/tab indicator.
- **State colors are softened** (same meanings, less saturation) so they read clinical, not toy-like. All AA pairs still pass.
- **Type:** Atkinson Hyperlegible Next (variable), 17 px root, two weights only: regular (400) and semibold (600). Left-aligned,
  sentence-case headings. `--weight-bold` still exists but now equals 600.
- **Shape:** 4 / 6 / 10 px radii. The pill radius is only for dots, switches and progress tracks, never for chips, buttons or tabs.
- **Rhythm:** 4/8 px spacing. Pages get 48 px top padding and 32 px gutters inside a 1200 px max width.
- **Motion:** 120–200 ms fades and color changes. No bounce, no scale, no press "jump".

### 0.1 Anti-slop: do / don't (for every page)

| Do | Don't |
|---|---|
| White `Card` with a hairline border; group related content inside one card | Shadows on cards, gradients, glows, glassy blur, tinted card backgrounds for decoration |
| One `primary` button per view; everything else `secondary` (white, hairline, dark text) or `quiet` | Several blue buttons side by side; accent-colored text on every secondary button |
| Status as a small dot + words (`StatusDot`, `StatusChip`) | Badges on everything; colored outlines around every card; a pill around every label |
| Left-aligned `PageHeader`: h1 + one muted lead line | Centered, marketing-style hero headers; eyebrow + title + subtitle + badge stacks |
| Icons only where they carry meaning (close, play/pause, status, an action whose word is ambiguous) | Decorative icons next to every heading, nav item or label; emoji or Unicode glyphs as icons |
| Tones as faint hints: `Card tone="assist"`, `Banner tone="warning"` (faint tint + hairline) | Thick 4 px colored left edges, saturated fills, red for anything but safety |
| Semibold for titles and values; regular for everything else | Bold everywhere; ALL CAPS; letter-spaced labels |
| Tables and `DescriptionList` with hairline row dividers | Each fact in its own bordered box |
| Use tokens (`var(--space-16)`, `var(--radius-card)`, `var(--border)`) | Hard-coded hex colors, radii above 10 px, shadows in page CSS |
| Let content breathe: 24 px inside cards, 32–48 px between sections | Big empty cards stretched to match a neighbour; nested cards in cards |

---

## 1. Principles (short version)

1. **The hand is the hero.** On live screens the hand and the instruction get the middle of the screen. Everything else is quieter.
2. **One thing at a time.** One instruction, **one primary button per view**, no competing motion.
3. **Effort over success.** "The glove helped" is warm orange (`assist`), never red, never "failed".
4. **Safety is loud. Everything else is quiet.** Red fills, alarm sounds and full-width banners are **only** for safety stops.
5. **Say it and show it.** Every state has a word and an icon, not only a color.
6. **Calm, not gamey.** Soft rings and plain numbers. No points or confetti.
7. **Same color, same meaning** in the UI, the 3D hand, the glove LEDs and the charts.
8. **Honest data.** Label estimates and demo data. Show missing data as "—" or a gap, never 0.

## 2. Tokens

All names that existed in WP0 still exist; new names are additive.

### 2.1 Color meaning

| Role | Fill (bars, dots, hand) | Text/icon on a surface | Tint background | Use it for | Never use it for |
|---|---|---|---|---|---|
| Accent | `--accent` | `--accent` | `--accent-soft` | Buttons, links, focus, selected nav/tab | States of the hand |
| Active | `--active` | `--active-text` | `--active-soft` | The patient moving **on their own** | Buttons, links |
| Assist | `--assist` | `--assist-text` | `--assist-soft` | **The glove helping** | Warnings, errors |
| Reached | `--reached` | `--reached-text` | `--reached-soft` | Reached, done, improved (▲) | Generic "OK" decoration |
| Danger | `--danger` | `--danger-text` | `--danger-soft` | **Safety only**: overcurrent, STOP, disconnect, camera lost while moving; destructive confirm | Pause, End session, a decline, validation styling in patient views |
| Caution | `--caution` | `--caution-text` | `--caution-soft` | Heads-up that is **not** safety: coach unavailable, old calibration, "aborted at 30%", the relax-your-hand strip | The glove helping (that's assist) |
| Demo | `--demo` | `--demo-text` | `--demo-soft` | Demo data, simulator | Anything real |
| Target | `--target` | – | – | The ghost hand, target notches | Text |
| Fingers | `--finger-thumb/-index/-middle` | – | – | Chart series per finger | States |

Rules:
- Use the plain state color for **fills**. For **words and icons** use the `-text` variant. The plain `--assist` and `--reached` are
  under 4.5:1 on light surfaces (orange text is unreadable).
- Text on `--accent` uses `--on-accent`. Text on `--danger` uses `--on-danger`.
- Input, checkbox and switch outlines use `--border-strong` (≥ 3:1). Button and pill outlines use the lighter `--border-control`
  (the label identifies the control). `--border` is for card edges, dividers and the top bar.
- Neutrals: `--bg` (page) → `--surface` (cards) → `--surface-2` (insets, chart wells) → `--surface-3` (tracks, skeletons).

### 2.2 Type
Atkinson Hyperlegible Next (variable, `@fontsource-variable/atkinson-hyperlegible-next`), 17 px root, tabular numbers by default.
Two weights: `--weight-regular` 400 and `--weight-semibold` 600 (`--weight-bold` is an alias for 600).

| Token | Size | Use |
|---|---|---|
| `--display` | 3rem (51 px) | The patient instruction on live screens. Nowhere else |
| `--h1` | 2rem (34 px) | One per page (page title) |
| `--h2` | 1.375rem (23 px) | Section titles. **1.75rem (30 px) inside the focus shell** (phase label, finger %) |
| `--h3` | 1.125rem (19 px) | Card titles, coach caption. 1.375rem inside the focus shell |
| `--body` | 1rem (17 px) | Default |
| `--small` | 0.875rem (15 px) | Hints, secondary text, the top bar. The smallest size in patient views |
| `--caption` | 0.75rem (13 px) | Chart axes and the doctor view **only** |

The focus shell (`.shell--focus`) re-declares `--h2`/`--h3` larger, so live patient screens meet the spec's sizes
(instruction ≥ 48 px, phase label ≥ 28 px, finger % ≥ 24 px) without page CSS changes.

Sentence case everywhere. No all-caps paragraphs. Keep lines ≤ 60 characters for instructions (`--instruction-max`) and ≤ 68 for body text (`--text-max`).

### 2.3 Space, shape, depth, motion
- Space: 4 px grid, `--space-4 … --space-64`. Inside cards use 16/24. Between sections use 32/48.
- Radii: `--radius-sm` 4 (badges, kbd), `--radius-input` 6 (buttons, inputs, chips), `--radius-card` 10 (cards, dialogs, banners),
  `--radius-pill` (dots, switches, progress tracks only).
- Elevation: `--elevation-card` is `none` (cards use hairlines). `--elevation-overlay` is the single subtle shadow for dialogs, toasts and menus.
- Control heights: `--control-sm` 32 (doctor/dense, header tools), `--control-md` 44 (helper and data views), `--control-lg` 64 (patient views).
- Motion: `--dur-fast` 120 ms (hover), `--dur` 200 ms (state change), `--dur-slow` 400 ms (ghost fade), `--dur-reach` 400 ms,
  `--ease` `cubic-bezier(.2,0,0,1)` (no overshoot). Under `prefers-reduced-motion` all animation is cut to an instant state change.
- Focus: a 2 px `--focus-ring` outline with a 2 px offset, on `:focus-visible` only. Inputs show an accent border + soft ring.

### 2.4 Key color values (light)

| Token | Before | After |
|---|---|---|
| `--bg` | #F7F6F3 | #FAFAF9 |
| `--surface-2` / `-3` | #EFEDE8 / #E5E2DB | #F4F4F2 / #E8E8E5 |
| `--border` | #DAD7D0 | #E5E5E1 |
| `--border-control` | – | #D6D7D3 (new) |
| `--accent` / hover | #2A5BD7 / #2149B3 | #2F5B9A / #264B80 |
| `--active` | #2F6FEB | #3F72C6 |
| `--assist` | #E8890C | #D58A3C |
| `--reached` | #1F9D55 | #3E9468 |
| `--danger` | #C62828 | #B9382F |
| `--demo` | #7B61FF | #7A6CC0 |
| `--caution` | #C99400 | #BE972F |

Dark values were softened in the same way; see `tokens.css`.

## 3. Components

| Component | Use it for | Do | Don't |
|---|---|---|---|
| `Button` | Every action. `variant`: primary, secondary, quiet, danger. `size`: lg (patient), md (default), sm (doctor). `icon`, `iconAfter`, `loading`, `block` | One `primary` per view. Verb-first labels ("Start practice"). `size="lg"` on patient screens | Use `danger` for End session, Stop or Pause. Use `block` for every button (only wizard footers / narrow columns) |
| `ButtonLink` / `ButtonAnchor` | Navigation or downloads that look like a button | Use them instead of `<Link className="button">` | Make a `<button>` that calls `navigate()` |
| `IconButton` | Close, dismiss, print, small tools | Always pass `label` | Use it for patient-critical actions |
| `Card` | Grouping one topic. `title`, `description`, `actions`, `footer`, `tone` (inset, demo, assist, reached, caution) | Use `tone="demo"` for the Simulator card. Put the status chip in `actions` | Nest default cards inside cards (use `tone="inset"`) |
| `Stack` / `Inline` / `Grid` | Layout. Spacing comes from `gap`, not margins | `Grid min="16rem"` for responsive tiles. `Grid columns={2}` for Setup | Stack paragraphs with default margins inside CSS grids (that is what makes the big gaps today) |
| `PageHeader` | The page title, the lead line and the page's main actions | One per page, at the top | Repeat the page title inside a card |
| `Heading` / `Text` | Typography with separate `level` (outline) and `size` (look). `Text tone=…` | `Text tone="muted" size="small"` for disclaimers | Use `tone="danger"` for anything but safety |
| `StatusChip` | Glove/camera/voice status: icon + dot + "Glove: Ready" | Map states: Ready → reached, Helping → assist, Stopped (safety) → danger, Not connected → off, Simulator → demo, Can't see hand → caution | Show **Paused** as red "Stopped": pausing is not a safety event |
| `Badge`, `DemoBadge` | Static labels: Demo data, Estimate, Aborted at 30% | `DemoBadge` wherever demo rows can appear | Make badges clickable |
| `StatusDot` | The colored dot inside chips, legends and lists | Always next to a word | Use alone |
| `Pill` | Picking a preset or a filter (`aria-pressed`) | Exercise presets (Tendon glides / Pinch / Short) | Use for tabs or for navigation |
| `Tabs` | Switching views of the same data | History views, chart metric switches. Arrow keys work | Use 64 px buttons as tabs; use tabs to navigate between routes |
| `Stepper` | Wizard progress (calibration) | Completed steps are clickable, future ones aren't | Make future steps look like disabled buttons |
| `Input`, `Select`, `Slider`, `Switch`, `Checkbox`, `Field` | Forms. Label above, hint under the label, error under the control | `Slider format={v => `${v}°`}` and pair with ±1/±5 buttons for servo jogging. `Checkbox size="lg"` for pre-flight checklists | Put the label in the placeholder. Repeat the row label in a visible input label ("Open hand · Repetitions for Open hand") — use `hideLabel` |
| `Dialog`, `ConfirmDialog` | Confirmations (End session, Delete session) | Title is a question, one sentence, the safe choice gets focus | Use for information that could be inline |
| `Banner` | Page-level messages: `info`, `warning`, `demo`, `safety` | `tone="safety"` for the SafetyBanner (role=alert, focus moves to Resume). `tone="warning"` for "Keep the hand relaxed" | Use `safety` (red) for anything that is not a safety stop |
| `ToastProvider` / `useToast` / `Toast` | System messages top-right (saved, reconnected). `Toast` alone for in-flow feedback like the AttemptToast | Short, past tense: "Calibration saved" | Toast safety events. Show non-error toasts in the focus shell (the provider suppresses them) |
| `ProgressRing` | PhaseRing base, hold timers | Put icon + label inside; omit `value` for "Show me your hand" | Show ticking seconds in patient views |
| `Meter` | Horizontal measured values: telemetry, slow/fast, readiness. Supports `target`, `limit`, stacked `segments` (active + assist) | Give `valueText` with units | Turn a bar red because it crosses a limit (only safety is red) |
| `KpiTile` | One number + label + optional delta | `better="down"` for metrics where less is better. "—" for missing | Use red for declines (declines are muted ▼) |
| `EmptyState` | No data yet | Icon, one sentence on why, one action | Leave an empty chart frame |
| `Skeleton` | Loading content areas | Match the final layout | Spinners over whole pages |
| `DescriptionList` | Label/value rows (profile, settings) | | Tables for two columns of facts |
| `Icon` | The one icon set (24 px grid, 2 px stroke, `currentColor`) | Add new icons to `Icon.tsx` in the same style | Mix in emoji or Unicode glyphs (◐ ● ◉ ◔ Ⅱ) as icons |
| `PageErrorBoundary` | Wraps the routes in the shell | | – |
| `ThemeToggle` / `ThemeSwitch` | Theme preference (sets `data-theme` on `<html>`) | | – |

## 4. Page patterns

### 4.1 Setup / data shell (Home, Setup, Calibrate, History, Profile, Exercise planning, Evaluate pre-flight)
- Top bar (owned by the shell): a slim (56 px) white bar with a hairline bottom border. Brand, text-only nav
  (Home · Exercise · Evaluate · History · Setup) with a 2 px accent underline on the current page, status as dot + words
  (no chip outlines or icons inside `.statuses`), Doctor view, Profile, theme. One row at ≥ 1280 px; status drops to a second row below.
- Content max 1200 px, 48 px top padding, 32 px gutters. Start with a `PageHeader`.
- Buttons: `md` for helper tasks. `lg` for anything the patient presses (Start today's practice, Start practice).
- Sections are `Card`s in a `Grid`. Don't make every paragraph a separate grid row: wrap text runs in a `Stack gap={8}`.

### 4.2 Focus shell (Exercise live, Evaluate running)
- The shell hides the nav and shows **End session · "Pose 2 of 5 · Rep 1 of 3" · chips**. The page must not add a second "End practice" button.
- The whole live screen must fit **without scrolling at 1280 × 720** (hand, instruction, phase ring, finger bars, Pause/Skip visible).
  Below 1280 px wide the side column becomes a bottom strip; hide the camera PiP before hiding the bars.
- Hand ≥ 55% of the width at 1440. Instruction in `--display`, centered. The phase ring is a `ProgressRing` with an icon + label.
- Pause/Skip are `Button size="lg"` (Pause secondary, Skip quiet), centered under the instruction.
- Patient feedback (AttemptToast) is an in-flow `Toast` placed bottom-center, never over the hand.

### 4.3 Doctor shell
- The shell renders the slate "Doctor view · read-only" bar with Exit. The page doesn't render its own banner or hide the header.
- Dense is fine: `Button size="sm"`, `--caption` for chart axes, `DescriptionList` for the profile.
- Export/print actions sit together in one `Inline` at the top right of the `PageHeader`.

### 4.4 Wizard (Calibrate)
`PageHeader` → `Stepper` → `Banner tone="warning"` safety strip (only on glove-moving steps) → one `Card` per step with the step's
controls → a footer `Inline justify="between"`: Back (secondary) on the left, the step's single primary on the right.
The persistent "Release glove now" is a `Button` inside the safety strip's `action`, not a full-width row.

### 4.5 Data views (History, Replay, Evaluation detail)
- Views of the same data: `Tabs`. Summary numbers: `KpiTile` in a `Grid min="12rem"`.
- Charts: one card per chart, title states the takeaway, a "↑ better / ↓ better" hint in `--small`/`--caption`, "Show as table" disclosure.
- Disclaimers ("Estimated from the camera…") once per page in the `PageHeader` lead or one `Banner tone="info"`, not repeated per paragraph.
- Destructive actions (Delete session) are `Button variant="danger"` inside a `ConfirmDialog`. The trigger button itself is `quiet` or
  `secondary`, at the end of the page, not full width.

## 5. Copy voice
- Plain, warm, short. ≤ 12 words per sentence in patient views. Verb-first buttons.
- Effort framing: "You did that on your own." · "The glove helped with the rest." Never "failed", "missed", "error" in patient views.
- Say what to do next: "I can't see your hand. Move it into the frame."
- Units for helpers and doctors only (mA, °). Patients see % and words.
- Numbers: whole percentages ("55%"), never raw floats ("31.52496186152917 mA").
- Dates: `Nov 5, 2026` (not `11/5/2026`), times as `14:05`.
- Spanish text (if any): never use opening `¿` or `¡`.

## 6. Accessibility checklist (per component and page)
- Everything reachable by keyboard with a visible focus ring. Tabs/Stepper/Theme use roving focus.
- Color is never the only signal (chips have words; deltas have ▲/▼ and "(better)").
- Contrast: text ≥ 4.5:1, outlines and essential graphics ≥ 3:1 — enforced for the tokens by `tokens.test.ts`.
- Live regions: phase changes `polite`, safety `assertive` (`Banner tone="safety"` is `role="alert"`).
- Reduced motion respected globally.

## 7. Migration guide for in-flight pages (WP7, WP8, WP9)

Nothing breaks if you do nothing: `.card`, `.chip`, `.actions`, `.muted`, `.button`, `button.primary` and bare `<button>` still work and now
look calmer (grey outline, bold label). Global element styles are wrapped in `:where()` (zero specificity) so your own classes and the
design-system classes always win. Adopt the primitives as you touch code:

| Today | Replace with |
|---|---|
| `<button className="primary">` / `BigButton variant="primary"` | `<Button variant="primary" size="lg">` (patient) or `size="md"` (helper) |
| `<Link className="button" to=…>` | `<ButtonLink to=…>` |
| `<section className="card">` + `<h2>` | `<Card title=… description=… actions=…>` |
| `<div className="actions">` | `<Inline gap={12}>` |
| `StatusChip` with "● Glove: Ready" text | `<StatusChip tone="reached" icon="glove" label="Glove" value="Ready" />` (see the tone mapping in §3) |
| `<span className="chip">Demo data</span>` | `<DemoBadge />` |
| History view `<nav className="data-tabs">` with buttons | `<Tabs label="History views" items=… />` |
| Calibrate step buttons ("1 Glove range") | `<Stepper steps=… current=… completed=… onSelect=… />` |
| `.safety-strip` | `<Banner tone="warning" title="Keep the hand relaxed." action={<Button size="sm">Release glove now</Button>}>` |
| `.safety-banner` | `<Banner tone="safety" title=… action={<Button size="lg">Resume</Button>} details=…>` inside the shell's `#safety-banner-slot` |
| `.phase-ring` conic gradient + `◔`/`Ⅱ` glyphs | `<ProgressRing value={progress} tone={…} label={phaseLabel}><Icon name="hand" /></ProgressRing>` |
| `.confirm-dialog` | `<ConfirmDialog>` (cancel focused first; `confirmVariant="danger"` only for delete) |
| `.system-toast` / `Toasts` | `useToast()` (the shell already mounts `ToastProvider`, suppressed in focus mode) |
| `.attempt-toast` | `<Toast tone="assist" title="Index 55% on your own" description="The glove helped with the rest." />` |
| `<label><input type="checkbox">…` | `<Checkbox label=… size="lg">` in patient checklists |
| Raw `<input>`/`<select>` + label | `<Input label=…>` / `<Select label=… options=…>` / `<Slider …>` |
| Repeated paragraphs inside a grid | `<Stack gap={8}>` around the text run |
| KPI `<div class="kpi">` | `<KpiTile label value unit delta better>` |
| Hard-coded colors / `var(--text)` dots | Tokens from §2.1, `StatusDot tone=…` |

Specific shell contracts:
- **WP7:** the shell already shows End session and the pose/rep progress in focus mode; remove the in-page "End practice" duplicate.
  Keep `GloveChip`/`CameraChip` inside `.statuses` (the header lays them out), ideally rendering the design-system `StatusChip`.
  When merging App.tsx: take this version and re-apply your three changes (import `GloveChip, CameraChip, SafetyBanner`; render the two
  chips in `.statuses`; render `<SafetyBanner />` inside `#safety-banner-slot`).
- **WP9:** delete `.doctor > header { display: none }` and `.doctor .doctor-banner` from `doctor.css` — the shell now draws the doctor
  bar itself. Print rules that hide `.app-header` are already in `base.css`.
- **WP8:** the coach panel is a `Card` with a `StatusDot` + label, a `Switch` or `Button` for the mic ("Mic on"), a `Select` for the mode,
  and `Banner tone="warning"` for "Live coach unavailable — using simple voice".

## 8. Screenshots
`docs/design/screenshots/cleanup-foundations/`: `before-*` and `after-*` of the design cleanup (foundations only: tokens, primitives,
shell) at 1440 × 900, light.

`docs/design/screenshots/`: `before-*` (integration branch + WP7/WP8/WP9 branches merged locally) and `after-*` (same, plus this
design system), at 1280 × 720. `gallery-*` show `/_dev/design`.
