"""Restore the packaged demo-only cohort and its existing real Gemini summaries."""
import gzip
import os
import sqlite3
from pathlib import Path

path = Path(os.environ["REHAB_DB_PATH"])
if path != Path("/tmp/memo-video.db"):
    raise SystemExit("Capture fixture can only restore /tmp/memo-video.db")
source = sqlite3.connect(":memory:")
source.executescript(gzip.decompress((Path(__file__).parent / "fixtures/demo-with-summary.sql.gz").read_bytes()).decode())
for table in ("session", "evaluation"):
    if source.execute(f"SELECT count(*) FROM {table} WHERE NOT is_demo").fetchone()[0]:
        raise SystemExit("Capture fixture must contain only demo records")
if "demo patient" not in source.execute("SELECT pseudonym FROM profile").fetchone()[0]:
    raise SystemExit("Capture fixture must have a demo profile")
target = sqlite3.connect(path)
for table in ("session", "evaluation"):
    if target.execute(f"SELECT count(*) FROM {table} WHERE NOT is_demo").fetchone()[0]:
        raise SystemExit("Refusing to replace non-demo records in the capture database")
source_tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
target_tables = {row[0] for row in target.execute("SELECT name FROM sqlite_master WHERE type='table'")}
if source_tables != target_tables:
    raise SystemExit("Demo fixture schema differs: refresh the capture fixture explicitly")
# Keep the server's schema and inode, and replace the cohort atomically between takes.
target.execute("PRAGMA foreign_keys=OFF")
with target:
    target.execute("BEGIN IMMEDIATE")
    for table in sorted(target_tables):
        target.execute(f'DELETE FROM "{table}"')
    for table in sorted(target_tables):
        source_columns = [r[1] for r in source.execute(f'PRAGMA table_info("{table}")')]
        target_columns = [r[1] for r in target.execute(f'PRAGMA table_info("{table}")')]
        if source_columns != target_columns:
            raise SystemExit(f"Demo fixture columns differ for {table}")
        rows = source.execute(f'SELECT * FROM "{table}"').fetchall()
        placeholders = ",".join("?" for _ in source_columns)
        target.executemany(f'INSERT INTO "{table}" VALUES ({placeholders})', rows)
    if target.execute("PRAGMA foreign_key_check").fetchall():
        raise SystemExit("Demo fixture contains invalid references")
print("Restored 25 demo sessions, 5 demo evaluations and stored Gemini summaries; no model calls.")
