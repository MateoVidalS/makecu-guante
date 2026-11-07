# WP11 final UX QA

Run after merging WP12 (PR #20), November 7, 2026. Screenshots use the real
backend, real engine/SimWorld, an isolated database seeded by `make demo-seed`,
and subsequent browser test sessions. All synthetic records remain demo data.

## Reproduce

```sh
make test
REHAB_QA_SCREENSHOTS=1 make e2e
cd frontend
pnpm exec playwright test --config src/components/common/playwright.config.ts
```

The main matrix records 80 exact viewport captures (1280×720 / 1440×900,
light/dark) and 64 full-page companions. Development galleries are covered by
route/component checks; the screenshot matrix covers product screens. A separate
1× simulator walkthrough captures all nine exercise phases in grayscale under
`phases/`. The hardware-free production fallback smoke check took 38 ms for the
glove and 32 ms for vision, without a reload; driver teardown also has bounded
stalled-reader/write tests. Physical handoff timing still belongs to the team.

## UX checklist — design spec §9

| Item | Result / evidence |
| --- | --- |
| Every screen, both sizes/themes | Checked: the matrix below includes all ten product routes, all History tabs, exercise planning/live/pause/summary, evaluation preflight/live/results, and Doctor print. |
| Every exercise phase; grayscale | Checked with the intended shared labels: `HOLD` / `ASSIST_HOLD` both say “Hold it”; `RELEASE` / `REST` both say “Relax your hand”, as specified in §5.2. All nine phases were reached on real SimWorld, captured in grayscale, with no page errors. Labels and pause icons remain meaningful without color. |
| Safety: overcurrent, STOP, disconnect, camera loss | Checked in the real browser runtime: banner, local phrase, Resume focus/recovery. Overcurrent releases autonomously; STOP is explicitly released before Resume; disconnect recovers through a simulator handoff. Three-beep scheduling and synchronous local speech are unit checked, including Voice Off. Physical speaker volume/release still require the event preflight. |
| Copy | Checked: neutral Microphone labels agree with switch state, STOP gives the release/Resume sequence, camera loss gives a next action, overcurrent names the finger. Patient exercise shows percentages; technical units remain in helper disclosures/replay/doctor views. |
| Sizes / contrast / axe | Checked: patient instruction ≥48 px, phase ≥28 px, buttons ≥64 px at both sizes. Token contrast tests pass; axe WCAG 2 A/AA + 2.1 AA has zero serious/critical violations across 80 screen/theme/size audits. Navigation hit-testing prevents status/recovery overlap. Active/paused practice and the expanded safety banner fit without vertical scrolling. |
| Reduced motion | Checked with reduced motion enabled throughout the matrix: zero running CSS animations during pause. The hand animation tests also suppress reach pulses in reduced motion; ongoing hand tracking remains a state update. |
| First-time helper hallway test | Not run: needs a teammate who has not read the instructions. Automated helper calibration passes, but does not replace that study. Rehearse and record notes before the event. |
| Demo labels | Checked: demo badges/notices in Home, History, replay, evaluation detail, Doctor and print; JSON/CSV retain `is_demo`. The generated history contains replayable traces and improving synthetic trends. |

## Audit amendments — design spec §10

All ten amendments were reviewed after WP12: caution is separate from assistance;
readable state text uses text variants; patient/helper/doctor control tiers are
64/48/36 px; live practice fits the laptop; the shell owns End session and progress;
Paused is neutral while safety Stopped is red; Delete uses a red confirm only;
dark cards use borders and overlays retain shadows; dates and measurements are
formatted; Profile and theme remain header tools. Final WP11 fixes also keep the
header navigation unobstructed and the safety banner inside the live viewport.

Read-only screens may have no primary action. The frozen default plan/settings
remain unchanged; real completion time varies with active reach and assistance.
No hardware, medical validation, or live Gemini service availability is implied
by these browser results. No firmware flashing or person-mounted runs occurred.

## Screenshot matrix

Each normal link has exact viewport dimensions. Files ending `-full.png` show
scrollable content beyond the viewport. Print views deliberately use white paper
in both theme settings.

| Screen | 1280 light | 1280 dark | 1440 light | 1440 dark |
| --- | --- | --- | --- | --- |
| home | [View](UX-1280-light-home.png) | [View](UX-1280-dark-home.png) | [View](UX-1440-light-home.png) | [View](UX-1440-dark-home.png) |
| setup | [View](UX-1280-light-setup.png) | [View](UX-1280-dark-setup.png) | [View](UX-1440-light-setup.png) | [View](UX-1440-dark-setup.png) |
| calibrate | [View](UX-1280-light-calibrate.png) | [View](UX-1280-dark-calibrate.png) | [View](UX-1440-light-calibrate.png) | [View](UX-1440-dark-calibrate.png) |
| exercise plan | [View](UX-1280-light-exercise-plan.png) | [View](UX-1280-dark-exercise-plan.png) | [View](UX-1440-light-exercise-plan.png) | [View](UX-1440-dark-exercise-plan.png) |
| exercise live | [View](UX-1280-light-exercise-live.png) | [View](UX-1280-dark-exercise-live.png) | [View](UX-1440-light-exercise-live.png) | [View](UX-1440-dark-exercise-live.png) |
| exercise paused | [View](UX-1280-light-exercise-paused.png) | [View](UX-1280-dark-exercise-paused.png) | [View](UX-1440-light-exercise-paused.png) | [View](UX-1440-dark-exercise-paused.png) |
| exercise summary | [View](UX-1280-light-exercise-summary.png) | [View](UX-1280-dark-exercise-summary.png) | [View](UX-1440-light-exercise-summary.png) | [View](UX-1440-dark-exercise-summary.png) |
| evaluate preflight | [View](UX-1280-light-evaluate-preflight.png) | [View](UX-1280-dark-evaluate-preflight.png) | [View](UX-1440-light-evaluate-preflight.png) | [View](UX-1440-dark-evaluate-preflight.png) |
| evaluation live | [View](UX-1280-light-evaluation-live.png) | [View](UX-1280-dark-evaluation-live.png) | [View](UX-1440-light-evaluation-live.png) | [View](UX-1440-dark-evaluation-live.png) |
| evaluation results | [View](UX-1280-light-evaluation-results.png) | [View](UX-1280-dark-evaluation-results.png) | [View](UX-1440-light-evaluation-results.png) | [View](UX-1440-dark-evaluation-results.png) |
| history | [View](UX-1280-light-history.png) | [View](UX-1280-dark-history.png) | [View](UX-1440-light-history.png) | [View](UX-1440-dark-history.png) |
| history range | [View](UX-1280-light-history-range.png) | [View](UX-1280-dark-history-range.png) | [View](UX-1440-light-history-range.png) | [View](UX-1440-dark-history-range.png) |
| history assistance | [View](UX-1280-light-history-assistance.png) | [View](UX-1280-dark-history-assistance.png) | [View](UX-1440-light-history-assistance.png) | [View](UX-1440-dark-history-assistance.png) |
| history resistance | [View](UX-1280-light-history-resistance.png) | [View](UX-1280-dark-history-resistance.png) | [View](UX-1440-light-history-resistance.png) | [View](UX-1440-dark-history-resistance.png) |
| history sessions | [View](UX-1280-light-history-sessions.png) | [View](UX-1280-dark-history-sessions.png) | [View](UX-1440-light-history-sessions.png) | [View](UX-1440-dark-history-sessions.png) |
| session replay | [View](UX-1280-light-session-replay.png) | [View](UX-1280-dark-session-replay.png) | [View](UX-1440-light-session-replay.png) | [View](UX-1440-dark-session-replay.png) |
| evaluation detail | [View](UX-1280-light-evaluation-detail.png) | [View](UX-1280-dark-evaluation-detail.png) | [View](UX-1440-light-evaluation-detail.png) | [View](UX-1440-dark-evaluation-detail.png) |
| doctor | [View](UX-1280-light-doctor.png) | [View](UX-1280-dark-doctor.png) | [View](UX-1440-light-doctor.png) | [View](UX-1440-dark-doctor.png) |
| doctor print | [View](UX-1280-light-doctor-print.png) | [View](UX-1280-dark-doctor-print.png) | [View](UX-1440-light-doctor-print.png) | [View](UX-1440-dark-doctor-print.png) |
| profile | [View](UX-1280-light-profile.png) | [View](UX-1280-dark-profile.png) | [View](UX-1440-light-profile.png) | [View](UX-1440-dark-profile.png) |

Grayscale phases: [PRESENT](phases/PRESENT-grayscale.png), [ATTEMPT](phases/ATTEMPT-grayscale.png), [HOLD](phases/HOLD-grayscale.png), [ASSIST](phases/ASSIST-grayscale.png), [ASSIST_HOLD](phases/ASSIST_HOLD-grayscale.png), [RELEASE](phases/RELEASE-grayscale.png), [REST](phases/REST-grayscale.png), [PAUSED](phases/PAUSED-grayscale.png), [DONE](phases/DONE-grayscale.png).

[Expanded overcurrent safety banner](safety/overcurrent-1280-light.png): the hand, instruction and single Resume action fit 1280×720.
