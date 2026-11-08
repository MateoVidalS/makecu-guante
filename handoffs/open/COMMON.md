# Open-assist pivot — common rules for O1–O7

- Read `AGENTS.md`, then **`docs/plan/15-open-assist.md` (all of it)**, then `docs/plan/03-contracts.md` §1–§2. Section 15 overrides
  `04-firmware.md`, `06-session.md` and `12-five-finger-update.md` wherever they assume the glove closes the hand.
- The pivot in one line: same hardware, threads routed over the back of the fingers, so **winding a spool opens a finger**. The glove can
  only reduce closure. Pull 0 = slack = the safe state, always.
- Contract already on the integration branch (O0): `pullFromClosure` / `closureFromPull` and pull comments in `contracts/glove.ts`;
  `AssistDirection`, `CURRENT_ASSIST_DIRECTION = 'open'`, `Calibration.assist_direction?` in `contracts/calibration.ts`;
  `MAX_ASSIST_PULL = 0.95`, deprecated `MAX_ASSIST_CLOSURE`, `TENDON_GLIDE_PLAN`, `OPEN_ASSIST_PLAN` in `contracts/poses.ts`; optional
  `assist_direction` on `Session`, `Evaluation`, `RomPoint`, `AssistPoint`, `ResistancePoint` in `contracts/api.ts`; `FOLLOW_SLACK = 0.08`
  and asymmetric ramps in `03-contracts.md` §2. **Never convert closure ⇄ pull by hand; import the two functions.**
- Other O-workers run in parallel. Stay strictly inside the paths your brief owns; list any unavoidable exception under
  `## Out-of-scope edits`. Contract problems → `## Contract change request` in the PR (only O5 and O7 have listed contract edits).
- Safety: never weaken a firmware or engine safety rule; release/fault/watchdog/STOP must always end at pull 0. Never flash firmware or
  move servos attached to a person.
- `make test` green (plus `make e2e` if you change a UI flow; `mixed-camera-simulator` and `recovery.spec:76` are load-flaky: rerun them
  alone once). Commit often with the trailer `Co-Authored-By: Codex <noreply@openai.com>`.
- Before the PR: `git merge origin/MateoVidalS/rehab-hub` and re-run the tests. Open the PR into `MateoVidalS/rehab-hub` titled
  `On: <name>` with the AGENTS.md template. **Do not merge.** Print the PR URL and stop.
