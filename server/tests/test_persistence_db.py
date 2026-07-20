# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Connection-level guarantees from `Database.connection()`.

Two audit fixes ride here:

  · item 3 — a `PRAGMA busy_timeout` so concurrent writers queue instead of
    raising "database is locked" the moment sqlite3's 5s connect default is
    exceeded.
  · item 2 (prep) — a corrected claim: `isolation_level=None` is sqlite3
    AUTOCOMMIT mode (the old comment said "autocommit off", backwards), which
    is exactly why multi-statement work like `publish_snapshot` must open an
    explicit `BEGIN IMMEDIATE` to be atomic.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from openrater.persistence.db import Database


@pytest.fixture()
def db(tmp_path: Path) -> Database:
    return Database(tmp_path / "probe.db")


class TestConnectionPragmas:
    def test_busy_timeout_is_15s(self, db: Database) -> None:
        """A writer waits up to 15s for another writer's lock (not sqlite3's
        5s connect default) before raising 'database is locked'."""
        conn = db.connection()
        try:
            assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 15000
        finally:
            conn.close()

    def test_wal_and_foreign_keys_still_enabled(self, db: Database) -> None:
        """The new PRAGMA sits alongside the existing ones — none regressed."""
        conn = db.connection()
        try:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
            assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        finally:
            conn.close()


class TestAutocommitMode:
    """`isolation_level=None` is AUTOCOMMIT: a bare statement commits on its
    own. This is the fact the corrected db.py comment documents and the reason
    `publish_snapshot` needs an explicit transaction to be atomic."""

    def test_driver_reports_autocommit(self, db: Database) -> None:
        conn = db.connection()
        try:
            assert conn.isolation_level is None
        finally:
            conn.close()

    def test_bare_write_is_visible_to_another_connection_without_commit(
        self, db: Database
    ) -> None:
        writer = db.connection()
        reader = db.connection()
        try:
            writer.execute("CREATE TABLE probe (v INTEGER)")
            writer.execute("INSERT INTO probe (v) VALUES (42)")
            # No writer.commit(): under autocommit the INSERT has already
            # landed, so a separate connection sees it. Were the driver in a
            # deferred-transaction mode, this row would be invisible here.
            row = reader.execute("SELECT v FROM probe").fetchone()
            assert row is not None and row[0] == 42
        finally:
            writer.close()
            reader.close()
