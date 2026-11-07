# Five-finger update — common rules for F1–F9

- Read `AGENTS.md`, `docs/plan/12-five-finger-update.md` (decisions §3, your WP row in §4, acceptance §5) and `docs/plan/03-contracts.md`.
- The design is **fixed at 5 fingers** `[thumb, index, middle, ring, pinky]`. F0 already migrated types and arrays; you do the semantic work.
- Stay inside the paths your brief owns. Other F-workers run in parallel. Listed exceptions only.
- Contract changes: propose them in the PR (`## Contract change request`); don't edit frozen contracts unless your brief says so.
- `make test` green (and `make e2e` for UI/integration briefs). Commit often (trailer `Co-Authored-By: Codex <noreply@openai.com>`).
- Before the PR: `git merge origin/MateoVidalS/rehab-hub`. Open the PR into `MateoVidalS/rehab-hub` titled `Fn: <name>`. Do not merge.
- Never flash firmware or move servos attached to a person.
