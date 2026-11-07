# 10 — Orchestration: Orca handoffs to Codex

## 1. Roles
- **Coordinator:** the Claude Code session in the `rehab-hub` worktree, on the integration branch `MateoVidalS/rehab-hub`. It owns
  `docs/plan/**`, `handoffs/**` and `AGENTS.md`; launches the handoffs; reviews and merges PRs; applies contract changes; runs integration checks.
- **Workers:** one Codex agent per work package, each in its own Orca worktree branched from the integration branch. Codex runs with
  `danger-full-access` / `approval never` and model `gpt-6.1-sol` at `high` effort (from `~/.codex/config.toml`), so it installs, tests, pushes and
  opens PRs unattended.
- **Mateo:** approves the plan, merges `rehab-hub → main`, provides `GEMINI_API_KEY`, and runs the hardware bench steps.

Handoffs are **full handoffs**: launch, confirm the prompt was accepted, record it in `handoffs/STATUS.md`, and stop watching. The deliverable is a **PR
into `MateoVidalS/rehab-hub`**, which the coordinator picks up (`gh pr list --base MateoVidalS/rehab-hub`, `orca worktree ps --json`).

## 2. Work packages

| WP | Name | Brief | Depends on | Wave | Effort |
|---|---|---|---|---|---|
| WP0 | Foundation: scaffold, contracts, stubs, mocks, stub runtime | `WP0-foundation.md` | – | 0 | high |
| WP1 | ESP32 firmware + native safety tests + bench guide | `WP1-firmware.md` | WP0 | 1 | **xhigh** |
| WP2 | Glove link: Web Serial client, codec, SimWorld (SimGlove + patient + SimVision) | `WP2-glove-link.md` | WP0 | 1 | high |
| WP3 | Vision: MediaPipe, flexion → closure, pinch, One Euro, calibration stats, overlay | `WP3-vision.md` | WP0 | 1 | high |
| WP4 | Session engine: exercise state machine, assist-as-needed, evaluation, metrics | `WP4-engine.md` | WP0 | 1 | **xhigh** |
| WP5 | Backend: SQLite, REST, history, export, Gemini summaries | `WP5-backend.md` | WP0 | 1 | high |
| WP6 | Virtual hand (three.js procedural rig) | `WP6-virtual-hand.md` | WP0 | 1 | high |
| WP7 | Live pages: Home, Setup, Calibrate wizard, Exercise, Evaluate + common components | `WP7-live-pages.md` | WP0 | 1 | high |
| WP8 | Voice: Gemini Live coach, safety net, fallback, token endpoint | `WP8-voice.md` | WP0 | 1 | **xhigh** |
| WP9 | History, replay, evaluation detail, doctor view, profile, charts | `WP9-history-doctor.md` | WP0 | 1 | high |
| WP10 | Runtime integration + e2e | `WP10-integration.md` | WP2, WP3, WP4, WP5 merged (WP6–9 before finishing) | 2 | **xhigh** |
| WP11 | Polish, demo seed, demo script, hardware checklist | `WP11-polish-demo.md` | WP10 | 3 | high |

```
WP0 ─┬─ WP1 (firmware) ───────────────────────────────┐
     ├─ WP2 (glove link + sim) ──┐                    │
     ├─ WP3 (vision) ────────────┤                    │
     ├─ WP4 (engine) ────────────┼─▶ WP10 ─▶ WP11 ◀───┘
     ├─ WP5 (backend) ───────────┤      ▲
     ├─ WP6 (virtual hand) ──────┼──────┤
     ├─ WP7 (live pages) ────────┼──────┤
     ├─ WP8 (voice) ─────────────┼──────┤
     └─ WP9 (history/doctor) ────┘──────┘
```
Wave 1 has **9 parallel Codex workers**. They don't conflict because WP0 stubs every file and each WP edits only its own paths (`02-architecture.md §4`).

## 3. Branches, PRs, merges
- The integration branch `MateoVidalS/rehab-hub` is pushed to `origin` before any handoff.
- Workers push their Orca-created branch and open `gh pr create --base MateoVidalS/rehab-hub`. They never merge.
- The coordinator merges with **`gh pr merge <n> --merge`** (a merge commit, never squash or rebase), then `make test` on the integration branch.
- Wave 1 merge order: **WP1 → WP4 → WP2 → WP3 → WP5 → WP8 → WP6 → WP7 → WP9**.
- At the end: PR `MateoVidalS/rehab-hub → main` with a merge commit, merged by Mateo or on his explicit go-ahead.

## 4. Runbook

**Step 0.** Mateo approves → the coordinator commits the plan on `MateoVidalS/rehab-hub` and pushes it.

**Step 1: Wave 0.**
```bash
orca worktree create --repo id:de782449-371b-4870-89e2-d609eaf149b6 \
  --name wp0-foundation --base-branch MateoVidalS/rehab-hub --parent-worktree active \
  --agent codex --setup skip --json \
  --prompt "You are the WP0 worker for Rehab Hub. Read AGENTS.md, then handoffs/WP0-foundation.md, and execute it end to end. Open a PR into MateoVidalS/rehab-hub when done. Do not merge."
```
Check that `agentTerminalHandle` (or `startupTerminal.handle`) is present and the prompt was accepted → update STATUS.md →
`orca worktree set --worktree id:<id> --comment "WP0 handed to Codex" --json`. When the PR is ready: review → merge → `make setup && make test`.

**Step 2: Wave 1** (after WP0 is merged). For each `<N> <slug>`: `1 firmware`, `2 glove-link`, `3 vision`, `4 engine`, `5 backend`,
`6 virtual-hand`, `7 live-pages`, `8 voice`, `9 history-doctor`:
- **high effort** WPs (2, 3, 5, 6, 7, 9): the same command as Step 1 with `--name wp<N>-<slug>` and the prompt pointing at `handoffs/WP<N>-<slug>.md`.
- **xhigh effort** WPs (1, 4, 8): the custom launcher path:
```bash
orca worktree create --repo id:de782449-371b-4870-89e2-d609eaf149b6 --name wp<N>-<slug> \
  --base-branch MateoVidalS/rehab-hub --parent-worktree active --setup skip --json
orca terminal create --worktree id:<repoId>::<newPath> --title wp<N>-<slug> \
  --command 'codex -c model_reasoning_effort="xhigh"' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json      # require satisfied: true; retry once with 120000
orca terminal send --terminal <handle> --text "<prompt>" --enter --json
```
Launch them one at a time, checking each result before the next.

**Step 3: WP10** once WP2, WP3, WP4 and WP5 are merged. **Step 4: WP11** after WP10.

## 5. Review checklist (per PR)
1. `git diff --stat origin/MateoVidalS/rehab-hub...` shows only owned paths (or justified exceptions).
2. Contracts untouched, or a change request is written up.
3. Acceptance criteria demonstrated.
4. `/code-review` on the branch; high-severity findings fixed or sent back. **Extra scrutiny for WP1, WP2's sim conformance and WP4:** they are the
   safety-critical paths. Read every state transition against `04-firmware.md §4` and `06-session.md §3`.
5. `make test` green on the branch.
6. Merge commit → STATUS.md.

## 6. Contract change protocol
Workers propose changes in the PR (`## Contract change request`). If accepted, the coordinator updates `03-contracts.md` + `frontend/src/contracts` +
`backend/app/contracts` + `firmware/lib/core/protocol.h` + the fixtures in one commit on the integration branch, then notifies in-flight workers:
`orca terminal send --terminal <handle> --text "Contract update on MateoVidalS/rehab-hub: <summary>. Run git pull origin MateoVidalS/rehab-hub before finishing." --enter --json`.

## 7. Failure handling
Stuck worker → `orca terminal read` → send a correction; if it's hopeless, close it and re-launch with a sharper brief. Lockfile conflicts (`uv.lock`,
`pnpm-lock.yaml`) → take the integration side and regenerate. Wrong safety behavior found after a merge → fix it on the integration branch right away,
before anything touches real hardware.

## 8. Hardware gate
**No one connects a person's hand to the glove** until `firmware/BENCH.md` steps 1–7 have passed on the real board and are recorded (WP1 writes
the guide; the team runs it). The calibration wizard's servo step starts with the glove on a **mannequin hand or the helper's hand**, never a patient's.
