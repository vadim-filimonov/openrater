# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The populated-migration class test.

The class this closes (inherited from the pre-detachment history): a
rebuild migration passed every CI job and bricked every real box,
because rebuild migrations behave differently on POPULATED databases
and CI only ever migrated empty ones. The mechanism: build a database
at a pinned OLD migration level, fill it with the committed seed
fixtures, run the CURRENT migration chain over it, and assert the
world survives — no MigrationError, foreign keys clean, every plan's
substrate intact, and the newest schema semantics live.

Post-squash (Detachment Brief 1 S4) the anchor is the 001 baseline
itself — migration history starts there, so every FUTURE migration
(002+) is automatically exercised against data that predates it. With
no post-anchor migrations yet the chain step is a no-op; the test's
value is the armed harness, not today's run.
"""

from __future__ import annotations

import base64
import json
import sqlite3
from pathlib import Path

from openrater.persistence.db import Database

_REPO = Path(__file__).resolve().parents[2]
_FIXTURES = _REPO / "docs" / "fixtures"

#: The 001 baseline (the S4 squash). Every future migration is
#: post-anchor by construction — never move this forward.
ANCHOR = 1

_REAL_DISCOVER = Database._discover_migrations


def _decode(v):  # {"$b64": …} cells → bytes (scripts/plan_fixture.py contract)
    if isinstance(v, dict) and set(v) == {"$b64"}:
        return base64.b64decode(v["$b64"])
    return v


def _migrate_to(path: Path, upto: int) -> None:
    """Apply the real migration prefix ≤ `upto` — the fresh-install path
    of that era, byte-for-byte."""
    Database._discover_migrations = staticmethod(  # type: ignore[method-assign]
        lambda: [(v, sql) for v, sql in _REAL_DISCOVER() if v <= upto]
    )
    try:
        db = Database(path=path)
        db.connection().close()
    finally:
        # Restore as a DESCRIPTOR — a bare function here would become a
        # bound method (self passed) and poison every later Database.
        Database._discover_migrations = staticmethod(  # type: ignore[method-assign]
            _REAL_DISCOVER
        )


def _seed_fixtures_at_anchor(path: Path) -> dict[str, dict[str, int]]:
    """Insert every committed fixture with COLUMN INTERSECTION against the
    anchor schema (a fixture captured at a NEWER schema is a superset —
    exactly like a real box that had rows before those columns landed).
    Returns {plan_id: {table: rowcount}} as inserted."""
    counts: dict[str, dict[str, int]] = {}
    conn = sqlite3.connect(path)
    try:
        for fixture in sorted(_FIXTURES.glob("*.plan.json")):
            data = json.loads(fixture.read_text())
            plan_id = data["plan_id"]
            counts[plan_id] = {}
            for table, spec in data["tables"].items():
                have = {
                    r[1] for r in conn.execute(f"PRAGMA table_info({table})")
                }
                assert have, f"{table} does not exist at anchor {ANCHOR:03d}"
                cols = [c for c in spec["columns"] if c in have]
                ph = ",".join("?" * len(cols))
                for row in spec["rows"]:
                    conn.execute(
                        f"INSERT INTO {table} ({','.join(cols)}) VALUES ({ph})",
                        [_decode(row[c]) for c in cols],
                    )
                counts[plan_id][table] = len(spec["rows"])
        conn.commit()
    finally:
        conn.close()
    return counts


def test_current_migrations_survive_a_populated_anchor_db(tmp_path):
    """The class, closed: real migrations × real populated data."""
    path = tmp_path / "populated-anchor.db"
    _migrate_to(path, ANCHOR)
    counts = _seed_fixtures_at_anchor(path)
    assert counts, "no committed seed fixtures found in docs/fixtures/"
    assert "meridian-shopfront-bop-ne-2026" in counts, (
        "the Meridian reference plan is the anchor's seed"
    )

    # The moment that bricked real boxes: the CURRENT chain over data.
    db = Database(path=path)
    conn = db.connection()  # raises MigrationError on regression
    try:
        # Enforcement is honest after the pass.
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1

        # Every plan's substrate survived, row for row.
        for plan_id, tables in counts.items():
            for table, expected in tables.items():
                n = conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE rating_plan_id = ?",
                    (plan_id,),
                ).fetchone()[0]
                assert n == expected, (
                    f"{plan_id}/{table}: {n} rows after migration, "
                    f"expected {expected}"
                )

        # Baseline semantics live on the migrated-with-data box: the
        # product CHECK accepts personal lines (the widened axis the
        # pre-squash chain introduced late — proof the baseline carries
        # the full effective schema, not an old era's).
        conn.execute(
            "INSERT INTO rating_plans (rating_plan_id, display_name, "
            "line_of_business, effective_date, status, created_at, product) "
            "VALUES ('probe_ho_check', 'HO probe', 'cgl', '2026-01-01', "
            "'draft', '2026-01-01T00:00:00+00:00', 'homeowners')"
        )
        conn.execute(
            "DELETE FROM rating_plans WHERE rating_plan_id='probe_ho_check'"
        )
        conn.commit()

        # And the ledger is fully stamped — nothing pending.
        applied = {
            r[0] for r in conn.execute("SELECT version FROM schema_version")
        }
        available = {v for v, _ in _REAL_DISCOVER()}
        assert available <= applied
    finally:
        conn.close()


def test_anchor_is_the_baseline_and_versions_are_contiguous(tmp_path):
    """The anchor must stay meaningful: 001 is the chain's first
    migration, the prefix applies cleanly on its own, and available
    versions are contiguous from the anchor (guards against
    renumbering or a gap that would silently hollow the class test
    out)."""
    path = tmp_path / "anchor-only.db"
    _migrate_to(path, ANCHOR)
    conn = sqlite3.connect(path)
    try:
        applied = {r[0] for r in conn.execute("SELECT version FROM schema_version")}
        assert applied == {ANCHOR}
        versions = sorted(v for v, _ in _REAL_DISCOVER())
        assert versions[0] == ANCHOR == 1, (
            "the anchor is the squashed baseline; renumbering migrations "
            "invalidates the class test"
        )
        assert versions == list(range(1, len(versions) + 1)), (
            f"migration versions must be contiguous from 001, got {versions}"
        )
    finally:
        conn.close()
