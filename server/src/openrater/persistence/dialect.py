# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""SQL dialect abstraction — the AWS-portability lever.

The codebase has grown up speaking SQLite: `?` placeholders,
`json_extract(col, '$.path')`, `INSERT OR REPLACE`, `strftime`,
`PRAGMA`, etc. When Aurora Postgres swaps in (post-detachment
production target), those constructs need to translate.

This module is the single funnel for that translation. Two
patterns:

  1.  **New code** uses the helper methods directly:
        sql = (
            f"INSERT INTO foo (a, b) VALUES "
            f"({db.dialect.placeholders(2)}) "
            f"{db.dialect.upsert_clause(...)}"
        )
      Reads on any backend.

  2.  **Existing migrations** still contain SQLite-isms (e.g.
      `strftime`, `INSERT OR IGNORE`). The migration runner can
      apply best-effort `translate_sql()` when run against a
      non-SQLite target — but the plan is to write Postgres-native
      versions of the migrations rather than rely on translation.

Two dialects supported:

  SQLite     — local dev (default), `~/.openrater/openrater.db`
  Postgres   — production target (Aurora / RDS / vanilla)

Selection: env var `RATER_DB_DIALECT` (`sqlite` | `postgres`).
Defaults to `sqlite`. The Database class picks at construction.

Port note (M3.5.3): an `AthenaDialect` lived here through
2026-05-20 alongside SQLite + Postgres. It was speculative — no
known carrier or integrator runs a P&C rating engine against
Athena (an S3 Parquet analytical store, not an OLTP DB). The
extra surface area + the `MERGE`/`INSERT OR REPLACE` impedance
mismatch were carrying cost without a real demand signal, so it
came out. If an analytics-only read replica becomes a real
requirement later, a per-need dialect can land then.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from enum import Enum
from typing import Sequence


class DialectKind(str, Enum):
    SQLITE = "sqlite"
    POSTGRES = "postgres"


class Dialect(ABC):
    """Abstract dialect interface — the contract that lets a single
    Python codebase target SQLite or Postgres.

    Subclasses MUST be stateless + thread-safe — instances may be
    cached at module load.
    """

    kind: DialectKind

    # -----------------------------------------------------------------
    # Parameter substitution
    # -----------------------------------------------------------------

    @abstractmethod
    def placeholder(self) -> str:
        """Single placeholder — '?' (SQLite), '%s' (psycopg)."""

    def placeholders(self, n: int) -> str:
        """Comma-separated list of n placeholders."""
        return ", ".join([self.placeholder()] * n)

    # -----------------------------------------------------------------
    # JSON column access
    # -----------------------------------------------------------------

    @abstractmethod
    def json_extract_text(self, column: str, path: str) -> str:
        """Extract a top-level JSON field as TEXT.

        `path` is a single key (no dots). Nested access composes:
        `json_extract_text(json_extract_text(col, 'a'), 'b')`."""

    # -----------------------------------------------------------------
    # Upsert / conflict resolution
    # -----------------------------------------------------------------

    @abstractmethod
    def upsert_clause(
        self,
        *,
        conflict_cols: Sequence[str],
        update_cols: Sequence[str],
        update_table_alias: str = "excluded",
    ) -> str:
        """The conflict-resolution suffix for INSERT.

        SQLite + Postgres both speak `ON CONFLICT(...) DO UPDATE SET
        ...` (SQLite ≥ 3.24, 2018). Athena has no UPSERT — callers
        targeting Athena must use a separate MERGE statement."""

    def upsert_do_nothing(
        self,
        *,
        conflict_cols: Sequence[str],
    ) -> str:
        """`ON CONFLICT(...) DO NOTHING` — idempotent inserts."""
        cols = ", ".join(conflict_cols)
        return f"ON CONFLICT({cols}) DO NOTHING"

    # -----------------------------------------------------------------
    # Casts + type system
    # -----------------------------------------------------------------

    @abstractmethod
    def cast_text(self, expr: str) -> str:
        """Wrap an expression in a portable text cast."""

    @abstractmethod
    def cast_real(self, expr: str) -> str:
        """Wrap an expression in a portable floating-point cast."""

    @abstractmethod
    def column_type(self, kind: str) -> str:
        """Map abstract column kind → dialect-specific DDL type.

        Supported kinds: TEXT, INT, BIGINT, REAL, BOOL, JSON, UUID,
        TIMESTAMP, DATE."""

    # -----------------------------------------------------------------
    # Time
    # -----------------------------------------------------------------

    @abstractmethod
    def now_iso(self) -> str:
        """SQL fragment returning the current UTC instant as ISO-8601
        text. Used for `materialized_at` / audit columns."""

    # -----------------------------------------------------------------
    # Best-effort SQL translation (for non-portable migrations)
    # -----------------------------------------------------------------

    def translate_sql(self, sql: str) -> str:
        """Best-effort translation of common SQLite-isms to this
        dialect. Default: no-op (target is SQLite or already
        portable). Subclasses override.

        NOT recommended for hot-path code — use the helper methods
        instead. Translation exists for the migration-runner's
        emergency boot path during the Phase 8e cutover."""
        return sql


# ---------------------------------------------------------------------------
# SQLite — the default
# ---------------------------------------------------------------------------


class SqliteDialect(Dialect):
    kind = DialectKind.SQLITE

    def placeholder(self) -> str:
        return "?"

    def json_extract_text(self, column: str, path: str) -> str:
        return f"json_extract({column}, '$.{path}')"

    def upsert_clause(
        self,
        *,
        conflict_cols,
        update_cols,
        update_table_alias="excluded",
    ) -> str:
        cols = ", ".join(conflict_cols)
        sets = ", ".join(f"{c} = {update_table_alias}.{c}" for c in update_cols)
        return f"ON CONFLICT({cols}) DO UPDATE SET {sets}"

    def cast_text(self, expr: str) -> str:
        return f"CAST({expr} AS TEXT)"

    def cast_real(self, expr: str) -> str:
        return f"CAST({expr} AS REAL)"

    def column_type(self, kind: str) -> str:
        return {
            "TEXT": "TEXT",
            "INT": "INTEGER",
            "BIGINT": "INTEGER",
            "REAL": "REAL",
            "BOOL": "INTEGER",
            "JSON": "TEXT",
            "UUID": "TEXT",
            "TIMESTAMP": "TEXT",
            "DATE": "TEXT",
        }[kind]

    def now_iso(self) -> str:
        return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"


# ---------------------------------------------------------------------------
# Postgres — Aurora / RDS production target
# ---------------------------------------------------------------------------


class PostgresDialect(Dialect):
    kind = DialectKind.POSTGRES

    def placeholder(self) -> str:
        # psycopg's default paramstyle. Numeric `$N` is also legal but
        # `%s` is more universal across DB-API drivers.
        return "%s"

    def json_extract_text(self, column: str, path: str) -> str:
        return f"({column}::jsonb)->>'{path}'"

    def upsert_clause(
        self,
        *,
        conflict_cols,
        update_cols,
        update_table_alias="excluded",
    ) -> str:
        cols = ", ".join(conflict_cols)
        sets = ", ".join(f"{c} = {update_table_alias}.{c}" for c in update_cols)
        return f"ON CONFLICT({cols}) DO UPDATE SET {sets}"

    def cast_text(self, expr: str) -> str:
        return f"({expr})::text"

    def cast_real(self, expr: str) -> str:
        return f"({expr})::double precision"

    def column_type(self, kind: str) -> str:
        return {
            "TEXT": "TEXT",
            "INT": "INTEGER",
            "BIGINT": "BIGINT",
            "REAL": "DOUBLE PRECISION",
            "BOOL": "BOOLEAN",
            "JSON": "JSONB",
            "UUID": "UUID",
            "TIMESTAMP": "TIMESTAMPTZ",
            "DATE": "DATE",
        }[kind]

    def now_iso(self) -> str:
        return "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"

    def translate_sql(self, sql: str) -> str:
        # Best-effort SQLite → Postgres translation. Used by the
        # migration runner during the boot-time cutover. NOT
        # exhaustive — Phase 8e ships a dedicated Postgres migration
        # set for production.
        out = sql
        out = re.sub(r"\bINSERT\s+OR\s+REPLACE\s+INTO\b", "INSERT INTO", out, flags=re.I)
        out = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", out, flags=re.I)
        out = re.sub(r"^\s*PRAGMA[^;]*;\s*$", "", out, flags=re.I | re.M)
        out = re.sub(
            r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT",
            "BIGSERIAL PRIMARY KEY",
            out,
            flags=re.I,
        )
        return out


# ---------------------------------------------------------------------------
# Module-level cache + factory
# ---------------------------------------------------------------------------


_INSTANCES: dict[DialectKind, Dialect] = {
    DialectKind.SQLITE: SqliteDialect(),
    DialectKind.POSTGRES: PostgresDialect(),
}


def get_dialect(kind: str | DialectKind = DialectKind.SQLITE) -> Dialect:
    """Return the cached dialect singleton for `kind`.

    `kind` accepts the enum value or a string (`'sqlite'` or
    `'postgres'`). Unknown values raise ValueError.
    """
    if isinstance(kind, str):
        kind = DialectKind(kind.lower())
    return _INSTANCES[kind]


__all__ = [
    "Dialect",
    "DialectKind",
    "PostgresDialect",
    "SqliteDialect",
    "get_dialect",
]
