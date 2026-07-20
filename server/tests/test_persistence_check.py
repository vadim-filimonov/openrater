# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The operator integrity sweep (`python -m openrater.persistence check`) —
Brief 95 B2.

The exact orphan class the WI arc found on a long-lived dev DB (a stage
output whose stage was deleted under enforcement-off) must be NAMED by
the sweep, with repair suggestions — and the sweep must never mutate
(it opens read-only, so it cannot even migrate)."""

from __future__ import annotations

import sqlite3

from openrater.persistence.__main__ import check
from openrater.persistence.db import Database


def _migrated_db(tmp_path):
    db = Database(path=tmp_path / "sweep.db")
    db.connection().close()
    return db


def test_clean_db_exits_zero(tmp_path, capsys):
    db = _migrated_db(tmp_path)
    assert check(str(db.path)) == 0
    out = capsys.readouterr().out
    assert "foreign_key_check: clean" in out
    assert "quick_check: ok" in out
    assert "migrations: up to date" in out
    assert "RESULT: clean" in out


def test_orphan_is_named_with_repair_hint(tmp_path, capsys):
    """The dev-DB orphan class: a stage output whose stage is gone."""
    db = _migrated_db(tmp_path)
    conn = sqlite3.connect(db.path)
    conn.execute(
        "INSERT INTO rating_plans (rating_plan_id, display_name, "
        "line_of_business, effective_date, status, created_at, product) "
        "VALUES ('p1', 'P1', 'cgl', '2026-01-01', 'draft', "
        "'2026-01-01T00:00:00+00:00', 'bop')"
    )
    # FK enforcement is OFF on raw connections by default — exactly how
    # historical orphans were minted.
    conn.execute(
        "INSERT INTO rating_plan_stage_outputs "
        "(rating_plan_id, stage_id, output_name, data_type) "
        "VALUES ('p1', 'ghost_stage', 'value', 'number')"
    )
    conn.commit()
    conn.close()

    assert check(str(db.path)) == 1
    out = capsys.readouterr().out
    assert "rating_plan_stage_outputs -> missing rating_plan_stages" in out
    assert "stage_id='ghost_stage'" in out, "the row must be NAMED by its keys"
    assert "DELETE FROM rating_plan_stage_outputs WHERE rowid IN" in out
    assert "RESULT: integrity problems found" in out

    # Read-only promise: the sweep must not have repaired anything.
    conn = sqlite3.connect(db.path)
    n = conn.execute(
        "SELECT COUNT(*) FROM rating_plan_stage_outputs"
    ).fetchone()[0]
    conn.close()
    assert n == 1


def test_pending_migrations_are_reported_without_applying(tmp_path, capsys):
    """The sweep on an out-of-date DB reports pending migrations and —
    critically — does NOT apply them (read-only, pre-upgrade safe).
    Post-squash there is no real old era yet, so simulate the next one:
    a fake 002 pending only during the sweep."""
    db = _migrated_db(tmp_path)

    real = Database._discover_migrations
    Database._discover_migrations = staticmethod(  # type: ignore[method-assign]
        lambda: [*real(), (2, "CREATE TABLE probe_pending_002 (id TEXT)")]
    )
    try:
        assert check(str(db.path)) == 0
    finally:
        Database._discover_migrations = staticmethod(  # type: ignore[method-assign]
            real
        )
    out = capsys.readouterr().out
    assert "pending" in out and "002" in out

    conn = sqlite3.connect(db.path)
    applied = {r[0] for r in conn.execute("SELECT version FROM schema_version")}
    tables = {
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    conn.close()
    assert max(applied) == 1, "the sweep must never migrate"
    assert "probe_pending_002" not in tables, "the sweep must never migrate"


def test_missing_db_semantics(tmp_path, capsys):
    missing = tmp_path / "nope.db"
    assert check(str(missing)) == 2
    assert check(str(missing), missing_ok=True) == 0
    out = capsys.readouterr().out
    assert "fresh box" in out
