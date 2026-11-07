# UX fixes — common rules for U1–U4

- Read `AGENTS.md`, `docs/plan/14-ux-fixes.md` (findings, waves, the must-not-cut list), `docs/plan/11-ux-design.md` and
  `docs/design/DESIGN_SYSTEM.md`. Open the gallery at `/_dev/design` (`make dev-mock`) before building anything new.
- **Reproduce each finding first** in `make dev-mock` (or `make dev-sim`) at 1280×720. If one is already fixed on the integration
  branch, say so in the PR and move on.
- Stay inside the paths your brief owns. Other workers run in parallel. Listed exceptions only.
- Design-system primitives and tokens only. One primary button per view. Red = safety only; orange = the glove helped; amber
  `--caution` for heads-ups. Copy: short, second person, ≤ 12 words per sentence in patient views, no "mA" in patient views.
- Don't change contracts; write a `## Contract change request` instead.
- Screenshots before/after of every screen you change, light theme, 1280×720 and 1440×900, in `docs/design/screenshots/ux-<wp>/`
  (e.g. `ux-u1/before-setup-1280.png`). Put the key ones in the PR body.
- `make test` green (and `make e2e` if you touch a flow). Commit often with the trailer `Co-Authored-By: Codex <noreply@openai.com>`.
- Before the PR: `git merge origin/MateoVidalS/rehab-hub`. Open the PR into `MateoVidalS/rehab-hub` titled `Un: <name>`. Do not merge.
- Never flash firmware or move servos attached to a person.
