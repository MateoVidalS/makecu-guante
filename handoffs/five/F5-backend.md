# F5 — Backend for 5 fingers
Owns: `backend/**`.
- Aggregations, history endpoints, export (CSV one row per attempt × finger, now 5), summaries prompts mention all fingers, demo seeder producing 5-finger data (via the TS sim? keep the existing approach; adapt to 5).
- Mixed history: old 3-finger sessions → ring/pinky null and "not measured" in aggregations (never 0).
- Tests for mixed data and exports.
