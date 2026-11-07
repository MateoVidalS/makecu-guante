# WP5 — Backend: SQLite, REST API, history, export, Gemini summaries

**Goal:** persistence and the analysis behind History and the doctor view, plus the Gemini text summaries.

**Read:** `AGENTS.md`, **`docs/plan/03-contracts.md §3–6`**, `docs/plan/06-session.md §4–5` (metric meanings), **`docs/plan/07-voice-and-ai.md §8`**,
`docs/plan/08-frontend.md §5` (how the data is shown).

**You own:** `backend/app/db/repo.py`, `backend/app/api/{profile,calibrations,sessions,evaluations,history,export,health,summaries}.py`,
`backend/app/llm/**`, `backend/tests/{api,db,llm}/**`.

## Deliverables
- [ ] `repo.py`: sync functions for every endpoint, plus `session_summary_with_previous`, `therapist_digest(days)`, and `create_demo_*` helpers usable by WP11's seeder.
- [ ] All routers in your list, with the exact shapes and error codes; traces/sweeps gzip-stored; cascading deletes.
- [ ] `POST /api/sessions/{id}/end` fills `summary.previous` from the last non-demo session (or the last demo one if only demo data exists).
- [ ] History endpoints per contracts §4 (`overview`, `rom`, `assist`, `resistance`), with demo points flagged.
- [ ] Export: JSON (everything, nested) and CSV (one row per attempt × finger with the session columns), with a `Content-Disposition` filename `rehab-hub-export-YYYYMMDD`.
- [ ] `llm/summaries.py`: session and therapist summaries with the `google-genai` SDK (**check the current docs**), the prompts from `07-voice-and-ai.md §8`,
      a 30 s timeout, 503 `llm_unavailable`.
- [ ] Tests: CRUD and round trips (attempt with trace, evaluation with sweeps), aggregation correctness on a hand-computed dataset, the `previous` logic,
      export formats, summaries with a mocked model, 503 without a key.

## Acceptance criteria
- [ ] Every response validates against the Pydantic contract models; the fixtures in `contracts/fixtures` round-trip through POST → GET.
- [ ] The history endpoints return in < 100 ms with 200 sessions × 15 attempts (perf test).
- [ ] No API key in logs or responses. `make test` is green.
