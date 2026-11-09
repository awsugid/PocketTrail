"""Run: python3 scripts/local-smoke.test.py. Smoke fixture-database selection.

The smoke helper must read the SQLite file Wrangler derives from the configured
D1 database_id, not the first synthetic-looking file under .wrangler/state:
with two local databases, scanning silently picked the wrong one.
"""
import hashlib
import hmac
import importlib.util
import sqlite3
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("smoke", Path(__file__).with_name("local-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

DATABASE_ID = "c0192e27-2795-4f65-94f9-56166b239aa0"
# Recorded by running wrangler 4.158.0 (miniflare 5.20261104.0-beta) against
# this exact database id; the helper must reproduce it.
EMPIRICAL_NAME = "c39df11d115a63b5a1fb4d4e3d043486bac6b4837d60e71b772a967a59f0bba3.sqlite"


def seed(path):
    db = sqlite3.connect(path)
    db.executescript(
        "CREATE TABLE organizations (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, is_synthetic INTEGER);"
        "INSERT INTO organizations (slug, is_synthetic) VALUES ('demo-jakarta', 1);"
    )
    db.commit()
    db.close()


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "wrangler.toml").write_text(
        '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "pockettrail"\n'
        f'database_id = "{DATABASE_ID}"\n'
    )
    d1_dir = root / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
    d1_dir.mkdir(parents=True)
    # Stale sibling holding the same synthetic org, as on machines where an
    # older database id left a second SQLite file.
    seed(d1_dir / ("0" * 64 + ".sqlite"))
    seed(d1_dir / EMPIRICAL_NAME)

    assert smoke.configured_database_path(root).name == EMPIRICAL_NAME
    db = smoke.fixture_database(root)
    assert db.execute(
        "SELECT is_synthetic FROM organizations WHERE slug='demo-jakarta'"
    ).fetchone() == (1,)
    db.close()

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "wrangler.toml").write_text(f'[[d1_databases]]\nbinding = "DB"\ndatabase_id = "{DATABASE_ID}"\n')
    d1_dir = root / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
    d1_dir.mkdir(parents=True)
    seed(d1_dir / ("0" * 64 + ".sqlite"))  # only the decoy exists
    try:
        smoke.fixture_database(root)
        raise SystemExit("fixture_database read the decoy instead of the configured database")
    except AssertionError:
        pass

print("PASS: fixture selection follows the Wrangler-configured D1 database id")
