# 14 — UX fixes from the Nov 7 design review

Source: the coordinator's UX/UI review of the running app (`make dev-mock`, 1280×720, every route) against `11-ux-design.md` and
`docs/design/DESIGN_SYSTEM.md`. The foundations are strong. The gaps sit where the design meets real runtime states: recovery paths, the
live exercise screen, and dev/persistence noise in patient views. Briefs: `handoffs/ux/`.

## 1. Findings → work packages

| # | Finding | Severity | WP |
|---|---|---|---|
| 1 | An invalid calibration (camera range > 100%) blocks Start practice with a plain sentence and no way forward; Home says "Calibration: Saved" and Evaluate says "Ready" at the same time | P0 | **U1** (+ U4 for the plan page) |
| 2 | Live screen: the target ghost and the patient's hand are both grey and hard to tell apart; the per-finger blue/orange/green tint is weak or missing; the hand floats small in an empty canvas | P0 | **U2** (rig/material/camera) + **U4** (layout ≥ 55% width) |
| 3 | Focus-shell label says "Pose 1 of 15 · Rep 1" for a 5 poses × 3 reps plan | P0 | **U4** |
| 4 | "Saved" and the demo-tools chip show in the patient focus shell | P1 | **U4** |
| 5 | Same state, different look: the Calibrate safety strip is untinted while Evaluate's is `warning`; Evaluate repeats "Keep your hand relaxed" twice; two simulator shortcuts in Calibrate | P1 | **U1** |
| 6 | Setup: once the glove is connected the left column is nearly empty and the right column is ~1,900 px tall; "Continue to calibration" is far below the fold | P1 | **U1** |
| 7 | Demo seed is uniform: every finger "▲ 28 points", every resistance delta "+70 mA", all sessions "Full fist × 1" with one safety event, so charts look fake or broken | P1 | **U3** |
| 8 | Doctor view: cards with very different heights are paired in a 2-column grid, leaving large empty areas | P2 | **U3** |
| 9 | When the SafetyBanner appears the live layout shifts down; at 720 px the bars and coach area fall below the fold and the camera PiP floats in a gap | P1 | **U4** |
| 10 | Coach panel is one line of text plus a tiny "Coach controls" link (spec §5.4: speaking indicator, big mic toggle, "You said…") and must now also host A4's coach decisions + Brake within 1280×720 | P1 | **U4** (after A2 + A4) |

## 2. Waves and dependencies

The AI-therapist wave (`13-ai-therapist.md`, A1–A4) is in flight. A4 owns `pages/{Exercise,SessionReplay,Doctor}/**` and
`components/**`, A1 owns `runtime/**` and `engine/**`, A2 owns `voice/**`. The U-wave is split so nothing overlaps an open A-branch.

```
now ──┬─ U1 helper flows (Home, Setup, Calibrate, Evaluate, calibration validity) ─┐
      └─ U2 virtual hand legibility (hand3d) ───────────────────────────────────────┤
A1+A2+A3+A4 merged ──┬─ U3 believable demo data + data-view layout ─────────────────┼─▶ coordinator QA pass
                     └─ U4 live screen + focus shell (after U1 + U2 merged too) ────┘
```

| WP | Brief | Starts when | Effort | Launch |
|---|---|---|---|---|
| U1 | `handoffs/ux/U1-helper-flows.md` | now | high | `orca worktree create … --agent codex` |
| U2 | `handoffs/ux/U2-virtual-hand.md` | now | high | `orca worktree create … --agent codex` |
| U3 | `handoffs/ux/U3-data-views.md` | A3 + A4 + #58 (demo seed) merged | high | `orca worktree create … --agent codex` |
| U4 | `handoffs/ux/U4-live-screen.md` | A1, A2, A4, U1, U2 merged | **xhigh** | custom launcher (`10-orchestration.md §4` step 2) |

A5 (therapist e2e) may run in parallel with U3/U4. Merge order in wave 2: **A5 → U3 → U4**; U4 updates any e2e selectors it breaks
after merging the integration branch.

## 3. Coordinator QA pass (after U4)
Re-run the review: screenshots of every route at 1280×720 and 1440×900 into `docs/design/screenshots/ux-review/`, one live run of
the Tendon glides plan through PRESENT → ATTEMPT → ASSIST → HOLD → REST, the four safety flows (overcurrent, STOP, unplug, camera lost),
and a check of each row in §1. `make test` + `make e2e` green on the integration branch.

## 4. Must not be cut (carried over from `handoffs/five/S-simplify.md`)
SafetyBanner + local phrase + Resume; "Release glove now" and the relaxed-hand/STOP strip; per-finger Set open / Set closed; camera open +
glove-closed captures; the "Hand relaxed" check and mandatory friction before Evaluate; the current limit; Saving/Saved **as a state**
(it may hide when healthy, never when Offline); "Demo data" and "estimate" labels; session replay with the current chart; orange =
glove helped, red = safety only; the A4 Brake control always visible in the live screen.

## 5. Outcome (Nov 8)

All four packages were built by Codex workers through Orca handoffs, reviewed by the coordinator, merged into
`MateoVidalS/rehab-hub` with merge commits, and released to `main`.

| # | Finding | Fixed by | Notes |
|---|---|---|---|
| 1 | Invalid calibration was a dead end; pages disagreed on its status | U1 #55, U4 #72 | One `useCalibrationStatus` selector; `CalibrationIssueBanner` deep-links to the exact step; Start disabled with a reason on the plan page |
| 2 | Target and actual hand hard to tell apart; weak state tint; small hand | U2 #51, U4 #72 | Ghost outline + per-finger blue/orange/green; framing fits the pose family; stage ≥ 55% width at 1440 |
| 3 | "Pose 1 of 15 · Rep 1" | U4 #72 | Counts poses and reps from the plan; evaluation counts sweeps from the selected fingers |
| 4 | "Saved" and demo tools in the patient view | U4 #72 | Hidden while healthy; Offline and slow saves still show; demo tools stay in the setup shell |
| 5 | Inconsistent safety strips and copy in Calibrate/Evaluate | U1 #55 (+ #53) | Shared `RelaxedHandSafetyStrip`; one secondary simulator shortcut |
| 6 | Lopsided Setup, Continue far below the fold | U1 #55 | One column; statuses + Continue above the fold; glove and camera have separate busy states; raw preview while the model loads |
| 7 | Uniform demo data | #58 (backend seed), U3 #69 (MSW) | Mocks are generated from the same story as `make demo-seed`; a parity test prevents drift |
| 8 | Doctor/History grids with large empty areas | U3 #69 | Content-height cards; print keeps sections together (A4 + Letter) |
| 9 | Safety banner pushed the live screen off the fold | U4 #72 | Browser test: every phase and safety state fits 1280×720 and 1440×900; Pause/Skip visible but disabled during the banner; Brake always available |
| 10 | Minimal coach panel | U4 #72 (with A4 #56) | Status + speaking bars, caption, labeled microphone, latest decision + Undo; older decisions in Timeline |

Coordinator review fixes made during the wave: A4's Brake now always releases and pauses even if the therapy API throws (#56);
A1's scripted runtime keeps its controller private so replacing `runtime.therapy` can't break `start()` (#60); a lint fix in A2 (#52).

Releases to `main`: #54 (U2), #59 (U1), #68 (A1–A4), #71 (U3), and the U4 + A5 release.

### Follow-ups
- [x] Home repeated the redo hint above the banner: the hint now only says what Start does.
- [x] The hand rendered small inside the wider live stage at 1280: the stage is height-limited, so the fit rose from 80% to 92% of the
  viewport (the envelope already includes the whole motion path and ghost rim, so it can't clip).
- [x] Contract: `SessionDetail.coach_decisions` / `feelings` (optional, absent = empty), `coach_brake` in `EngineEvent`'s safety
  sources (with SafetyBanner copy), and `Runtime.therapy` required. `03-contracts.md` updated to match.
- [ ] Open: `mixed-camera-simulator` and `recovery.spec:76` e2e plus 5 s unit-test timeouts still flake under heavy host load (they pass
  alone). Not masked with retries on purpose: they cover camera-loss and recovery safety flows. Run e2e with `REHAB_E2E_WORKERS=1` on a busy machine.
