# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Migration-runner FK regression (the migration-048 failure mode).

Rebuild-pattern migrations (create-new / copy / drop / rename — 045,
048) open with ``PRAGMA foreign_keys = OFF``, but that pragma is a NO-OP
inside a transaction and the runner wraps every migration in a
SAVEPOINT. On a fresh DB the rebuilt tables are empty so nothing trips;
on a POPULATED DB dropping a parent with live child rows raised
``FOREIGN KEY constraint failed`` and bricked the boot (found ingesting
the WI workbooks into a pre-048 dev DB, 2026-07-16).

The fix: the runner disables enforcement at the CONNECTION level for the
migration pass (legal — no transaction open), restores it after, and
runs ``PRAGMA foreign_key_check`` so the OFF window cannot silently
admit dangling references.

These tests reproduce the failure shape with synthetic probe tables —
one migration creates a parent/child pair WITH ROWS, a later one
performs the exact drop+rename dance — so they never depend on any real
table's DDL.
"""

from __future__ import annotations

import sqlite3

import pytest

from openrater.persistence.db import Database, MigrationError

_CREATE_PROBE = """
CREATE TABLE fk_probe_parent (id TEXT PRIMARY KEY);
CREATE TABLE fk_probe_child (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES fk_probe_parent(id)
);
INSERT INTO fk_probe_parent (id) VALUES ('p1');
INSERT INTO fk_probe_child (id, parent_id) VALUES ('c1', 'p1');
"""

# The 045/048 rebuild dance, verbatim shape — including the in-script
# pragma that the SAVEPOINT renders a no-op.
_REBUILD_PROBE = """
PRAGMA foreign_keys = OFF;
CREATE TABLE fk_probe_parent_new (id TEXT PRIMARY KEY);
INSERT INTO fk_probe_parent_new (id) SELECT id FROM fk_probe_parent;
DROP TABLE fk_probe_parent;
ALTER TABLE fk_probe_parent_new RENAME TO fk_probe_parent;
PRAGMA foreign_keys = ON;
"""

# A BAD migration: deletes the parent row and leaves the child dangling.
_DANGLE_PROBE = """
PRAGMA foreign_keys = OFF;
DELETE FROM fk_probe_parent WHERE id = 'p1';
PRAGMA foreign_keys = ON;
"""


def _with_synthetic(monkeypatch, extra: list[tuple[int, str]]) -> None:
    real = list(Database._discover_migrations())
    monkeypatch.setattr(
        Database,
        "_discover_migrations",
        staticmethod(lambda: [*real, *extra]),
    )


def test_rebuild_migration_survives_populated_child_table(tmp_path, monkeypatch):
    """The 048 failure mode: drop+rename a parent whose child has rows."""
    _with_synthetic(
        monkeypatch, [(9998, _CREATE_PROBE), (9999, _REBUILD_PROBE)]
    )
    db = Database(path=tmp_path / "probe.db")
    conn = db.connection()
    try:
        # Both synthetic migrations applied; the child row survived the
        # rebuild and its FK resolves against the renamed parent.
        row = conn.execute(
            "SELECT parent_id FROM fk_probe_child WHERE id='c1'"
        ).fetchone()
        assert row is not None and row[0] == "p1"
        assert conn.execute("PRAGMA foreign_key_check;").fetchall() == []
        # Enforcement is back ON after the pass.
        assert conn.execute("PRAGMA foreign_keys;").fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO fk_probe_child (id, parent_id) VALUES ('c2', 'nope')"
            )
    finally:
        conn.close()


def test_migration_leaving_dangling_fk_fails_the_boot(tmp_path, monkeypatch):
    """The OFF window must not silently admit dangling references."""
    _with_synthetic(
        monkeypatch, [(9998, _CREATE_PROBE), (9999, _DANGLE_PROBE)]
    )
    db = Database(path=tmp_path / "probe.db")
    with pytest.raises(MigrationError, match="foreign-key violations"):
        db.connection()
