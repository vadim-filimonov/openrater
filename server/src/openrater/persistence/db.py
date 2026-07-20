# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""SQLite connection management + schema migration.

The `Database` class carries a `Dialect` (see persistence/dialect.py),
so callers can write portable SQL via
`db.dialect.placeholders(n)`, `db.dialect.upsert_clause(...)`,
`db.dialect.json_extract_text(...)`. Default dialect is SQLite —
existing call sites are unaffected.

Design rules:
  - Connections are short-lived and per-call. SQLite is CPU-locked anyway;
    no pool needed at this scale.
  - WAL mode for concurrent reads (dashboards read while the
    pipeline writes).
  - Foreign keys enabled (off by default in SQLite — the foot-gun of the
    century).
  - Migrations run on first connection.
  - **Each migration is its own transaction.** A partial failure leaves
    `schema_version` consistent with the actual schema state — the next
    boot will not see "DB at v2 but tables already at v3 shape" and
    crash with a cryptic SQLite error.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable, Iterator

from openrater.persistence.dialect import (
    Dialect,
    DialectKind,
    SqliteDialect,
    get_dialect,
)


class MigrationError(RuntimeError):
    """Raised when a migration fails, with a clear recovery hint.

    The migration runner wraps each migration in a transaction; this
    error surfaces the underlying SQLite error AND tells the operator
    what to do (almost always: regenerate the demo DB).
    """


# Migration files are loaded by name; each file's filename starts with a
# zero-padded integer matching its `version` number.
_MIGRATIONS_DIR = Path(__file__).parent / "migrations"


class Database:
    """Thin connection factory + migration runner.

    Use as a context manager for short-lived transactional work:

        with Database(path).connection() as conn:
            conn.execute("INSERT ...", (...))
            conn.commit()

    Or pass to a repository which manages its own connections.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        dialect: Dialect | None = None,
    ) -> None:
        self.path = Path(path)
        self._migrated = False
        # Every Database carries a Dialect. Default is
        # SqliteDialect (matches the existing engine). Callers
        # building a Postgres-backed Database pass `dialect=
        # PostgresDialect()` and supply a psycopg-aware
        # Database subclass. The env var
        # `RATER_DB_DIALECT` overrides the default at boot time so
        # developers can sanity-check portability against a local
        # Postgres without code changes.
        if dialect is None:
            env_kind = os.environ.get("RATER_DB_DIALECT", "").strip().lower()
            if env_kind:
                try:
                    dialect = get_dialect(DialectKind(env_kind))
                except ValueError:
                    dialect = SqliteDialect()
            else:
                dialect = SqliteDialect()
        self.dialect: Dialect = dialect

    def connection(self) -> sqlite3.Connection:
        """Open a fresh connection. Caller is responsible for close()/commit().

        Returns a connection with:
          - foreign-keys enabled
          - row factory set to sqlite3.Row (column access by name)
          - WAL journal mode (concurrent readers)
          - text_factory = str (not bytes) for ergonomics
        """
        self._ensure_parent_dir()
        conn = sqlite3.connect(
            self.path,
            # AUTOCOMMIT mode: the sqlite3 driver opens no implicit
            # transaction, so every bare statement commits on its own.
            # Multi-statement atomicity is therefore opt-in — callers that
            # need it issue an explicit BEGIN/COMMIT (see `patch_status` and
            # `publish_snapshot`'s BEGIN IMMEDIATE). (The prior comment here
            # read "autocommit off" — that was backwards.)
            isolation_level=None,
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        conn.row_factory = sqlite3.Row
        conn.text_factory = str
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")  # WAL + NORMAL is durable + fast
        # Raise the busy timeout from sqlite3's 5s connect default to 15s.
        # WAL lets readers run concurrently with the single writer, but
        # writers still serialize; a slow writer (a bulk import,
        # a batch of placement events) can hold the lock past 5s while other
        # write traffic — parallel quote-sets stamping idempotency records,
        # publishes — waits behind it. A longer wait turns spurious
        # "database is locked" 5xx into a brief queue. Applied per
        # connection; overrides the connect-level timeout.
        conn.execute("PRAGMA busy_timeout = 15000;")
        if not self._migrated:
            self._migrate(conn)
            self._migrated = True
        return conn

    def _ensure_parent_dir(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Apply any pending migrations.

        Convention: every file in `migrations/` is named `{NNN}_*.sql`.
        We scan the directory, sort by NNN, and apply any whose version
        is NOT recorded in `schema_version` — using the SET of applied
        versions, not just the max.

        Why a set, not a max: the platform sometimes adds a migration
        with a NUMERICALLY LOWER version than ones already applied
        (e.g., 004 was added after 006 and 008 had already shipped to
        existing demo databases). The old "MAX" check skipped any new
        migration whose version was below the current max, leaving the
        schema permanently out-of-sync with the codebase.

        Apple-style migrations (Alembic, Django, etc.) all use the
        applied-set pattern. We do too.

        Each migration is wrapped in its own SAVEPOINT. If migration N
        fails, schema_version doesn't record it, so re-booting either
        succeeds (transient failure) or fails the same way (real bug).
        Either way the operator gets a clear error pointing to recovery.
        """
        # Bootstrap: ensure the schema_version table exists.
        cursor = conn.cursor()
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            "  version INTEGER PRIMARY KEY,"
            "  applied_at TEXT NOT NULL"
            ")"
        )

        cursor.execute("SELECT version FROM schema_version")
        applied: set[int] = {r[0] for r in cursor.fetchall()}

        pending = [
            (version, sql)
            for version, sql in self._discover_migrations()
            if version not in applied
        ]
        if not pending:
            conn.commit()
            return

        # Rebuild-pattern migrations (045's plan_runs, 048's rating_plans —
        # the drop + rename dance) open with `PRAGMA foreign_keys = OFF`,
        # but that pragma is a NO-OP inside a transaction and every
        # migration here runs inside a SAVEPOINT. On a fresh DB the tables
        # being rebuilt are empty, so nothing trips; on a POPULATED DB (a
        # dev DB, an upgraded deploy) dropping a parent with live child
        # rows fails with "FOREIGN KEY constraint failed". Disable
        # enforcement at the connection level for the whole pass — legal
        # here because no transaction is open yet — and restore it after.
        # The `foreign_key_check` below keeps the OFF window honest.
        cursor.execute("PRAGMA foreign_keys = OFF;")
        try:
            for version, sql in pending:
                # Run each migration in its own SAVEPOINT so partial
                # failures don't pollute schema_version. We CAN'T use
                # `executescript()` here — it issues an implicit COMMIT
                # at the start that destroys any outer SAVEPOINT, then
                # runs the script in autocommit-ish mode where DDL
                # auto-commits each statement. Instead we split the
                # script ourselves and execute statements through the
                # same cursor, all inside one SAVEPOINT.
                try:
                    cursor.execute(f"SAVEPOINT migration_{version};")
                    for stmt in _split_sql_statements(sql):
                        cursor.execute(stmt)
                    cursor.execute(
                        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                        (version, datetime.now(UTC).isoformat()),
                    )
                    cursor.execute(f"RELEASE migration_{version};")
                except sqlite3.Error as e:
                    # Roll back the failed migration. schema_version stays
                    # at the prior version so re-running boot doesn't
                    # double-apply.
                    try:
                        cursor.execute(f"ROLLBACK TO migration_{version};")
                        cursor.execute(f"RELEASE migration_{version};")
                    except sqlite3.Error:
                        pass  # best-effort cleanup
                    # Surface a clear, actionable error.
                    raise MigrationError(
                        f"Migration {version:03d} failed: {e}\n"
                        f"\n"
                        f"This usually means the DB at {self.path} is in an "
                        f"inconsistent state from a partial earlier run.\n"
                        f"For the demo, the safest recovery is to delete the "
                        f"DB file and re-boot — the seed will recreate it:\n"
                        f"\n"
                        f"  rm -f {self.path} {self.path}-wal {self.path}-shm\n"
                    ) from e
            conn.commit()
        finally:
            cursor.execute("PRAGMA foreign_keys = ON;")

        # Enforcement was off while migrations ran — refuse this boot if
        # the pass left (or surfaced) dangling references, naming the rows
        # instead of letting them bite later as inscrutable 500s. One-shot
        # by construction: each migration committed at its RELEASE, so a
        # re-boot without repair proceeds (the pre-check posture) — but
        # the operator has been told exactly which rows to fix.
        violations = cursor.execute("PRAGMA foreign_key_check;").fetchall()
        if violations:
            sample = "; ".join(
                f"{row[0]} rowid {row[1]} -> missing {row[2]}"
                for row in violations[:5]
            )
            more = f" (+{len(violations) - 5} more)" if len(violations) > 5 else ""
            raise MigrationError(
                f"Migrations applied but the DB at {self.path} has foreign-key "
                f"violations: {sample}{more}.\n"
                f"These rows may predate this migration run. Inspect with "
                f"`PRAGMA foreign_key_check;` and repair or delete the named "
                f"rows, then re-boot."
            )

    @contextmanager
    def transaction(self) -> Iterator["Database"]:
        """One atomic scope over many domain writes.

        Yields a `Database` whose `connection()` always returns the SAME
        underlying connection, wrapped so the domain layer's own
        transaction habits compose instead of colliding:

          · `BEGIN` / `BEGIN IMMEDIATE` → a SAVEPOINT (nested, not an
            error inside the outer transaction);
          · `COMMIT` → RELEASE of that savepoint;
          · `ROLLBACK` → rollback TO that savepoint;
          · `conn.commit()` / `conn.close()` → no-ops (the scope owns
            both).

        The scope opens `BEGIN IMMEDIATE` on entry, commits on clean
        exit, and rolls the WHOLE scope back on any exception — so a
        multi-write composition (create plan + substrate + stages)
        either lands completely or not at all, with every write still
        going through the typed domain functions. This preserves the ingest
        builder's "one transaction, never raw SQL" contract.
        """
        conn = self.connection()
        scoped = _ScopedDatabase(self, conn)
        try:
            conn.execute("BEGIN IMMEDIATE;")
            yield scoped
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.close()

    @staticmethod
    def _discover_migrations() -> Iterable[tuple[int, str]]:
        """Return (version, sql) tuples in ascending order."""
        if not _MIGRATIONS_DIR.exists():
            return []
        files = sorted(f for f in _MIGRATIONS_DIR.iterdir() if f.suffix == ".sql")
        out: list[tuple[int, str]] = []
        for f in files:
            try:
                version = int(f.stem.split("_", 1)[0])
            except (ValueError, IndexError):
                continue
            out.append((version, f.read_text(encoding="utf-8")))
        return out


_TX_KEYWORDS = ("BEGIN", "COMMIT", "ROLLBACK")


def _tx_keyword(sql: str) -> str | None:
    head = sql.lstrip().split(None, 1)
    if not head:
        return None
    word = head[0].rstrip(";").upper()
    return word if word in _TX_KEYWORDS else None


class _TxCursor:
    """Cursor proxy — routes BEGIN/COMMIT/ROLLBACK through the scope's
    savepoint stack; everything else delegates."""

    def __init__(self, cursor: sqlite3.Cursor, scope: "_TxConnection") -> None:
        self._cursor = cursor
        self._scope = scope

    def execute(self, sql: str, *args: Any) -> "_TxCursor":
        if self._scope.route_tx_statement(sql):
            return self
        self._cursor.execute(sql, *args)
        return self

    def executemany(self, sql: str, seq: Any) -> "_TxCursor":
        self._cursor.executemany(sql, seq)
        return self

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)

    def __iter__(self) -> Any:
        return iter(self._cursor)


class _TxConnection:
    """Connection proxy for `Database.transaction()` scopes.

    Translates the domain layer's explicit transaction statements into
    savepoints so they nest inside the scope's outer BEGIN, and no-ops
    `commit()`/`close()` so no callee can end the scope early. All other
    attributes delegate to the real connection.
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._sp_depth = 0

    # -- transaction-statement routing --------------------------------

    def route_tx_statement(self, sql: str) -> bool:
        """Handle BEGIN/COMMIT/ROLLBACK; True when consumed."""
        word = _tx_keyword(sql)
        if word is None:
            return False
        if word == "BEGIN":
            self._sp_depth += 1
            self._conn.execute(f"SAVEPOINT tx_scope_{self._sp_depth};")
        elif word == "COMMIT":
            if self._sp_depth > 0:
                self._conn.execute(f"RELEASE tx_scope_{self._sp_depth};")
                self._sp_depth -= 1
        elif word == "ROLLBACK":
            if self._sp_depth > 0:
                self._conn.execute(f"ROLLBACK TO tx_scope_{self._sp_depth};")
                self._conn.execute(f"RELEASE tx_scope_{self._sp_depth};")
                self._sp_depth -= 1
            # A bare ROLLBACK outside any callee BEGIN is the scope
            # owner's job — swallow it (the exception that caused it
            # propagates and rolls the whole scope back).
        return True

    # -- sqlite3.Connection surface ------------------------------------

    def execute(self, sql: str, *args: Any) -> Any:
        if self.route_tx_statement(sql):
            return self._conn.cursor()  # a harmless empty cursor
        return self._conn.execute(sql, *args)

    def executemany(self, sql: str, seq: Any) -> Any:
        return self._conn.executemany(sql, seq)

    def cursor(self) -> _TxCursor:
        return _TxCursor(self._conn.cursor(), self)

    def commit(self) -> None:  # the scope owns the real commit.
        return None

    def rollback(self) -> None:  # scope-level rollback happens on raise.
        return None

    def close(self) -> None:  # the scope owns the real close.
        return None

    def __enter__(self) -> "_TxConnection":
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)


class _ScopedDatabase(Database):
    """A Database whose every `connection()` is the scope's one
    connection (proxied). Migrations already ran on the real one."""

    def __init__(self, base: Database, conn: sqlite3.Connection) -> None:
        super().__init__(base.path, dialect=base.dialect)
        self._migrated = True
        self._tx_conn = _TxConnection(conn)

    def connection(self) -> sqlite3.Connection:  # type: ignore[override]
        return self._tx_conn  # type: ignore[return-value]


def _split_sql_statements(sql: str) -> list[str]:
    """Split a migration SQL script into executable statements.

    Tailored for the project's migration files, which have:
      - SQL line comments (`-- ...`) — stripped
      - SQL block comments (`/* ... */`) — preserved (in-statement only)
      - Statements separated by `;`
      - No semicolons inside string literals (we control the SQL)
      - **Triggers with `BEGIN ... END;` bodies**

    Trigger handling: when a chunk contains `CREATE TRIGGER`, we
    re-join with subsequent chunks (preserving the `;` separators)
    until we encounter a chunk whose stripped uppercase ends with `END`.
    That re-joined block is the full `CREATE TRIGGER ... BEGIN ... ; END;`
    statement.

    This is robust against SQLite's trigger syntax:
        CREATE TRIGGER foo BEFORE UPDATE ON bar
          WHEN OLD.status = 'archived'
        BEGIN
          SELECT RAISE(ABORT, 'message');
        END;

    Returns a list of non-empty stripped statements without trailing `;`.
    The caller passes each into `cursor.execute()`. Empty/comment-only
    chunks are dropped.
    """
    # Strip line comments first (`-- ...` to end of line)
    lines = []
    for raw_line in sql.splitlines():
        # Remove `-- ...` comments — but only if the `--` is at column-0
        # or preceded by whitespace, to avoid clobbering inside string
        # literals. Our migrations don't have `--` inside literals.
        idx = raw_line.find("--")
        if idx >= 0:
            lines.append(raw_line[:idx])
        else:
            lines.append(raw_line)
    cleaned = "\n".join(lines)

    chunks = cleaned.split(";")
    out: list[str] = []
    i = 0
    while i < len(chunks):
        chunk = chunks[i]
        # Detect the start of a trigger body. Be tolerant of indentation
        # and case ("CREATE TRIGGER", "create trigger", etc.).
        if "CREATE TRIGGER" in chunk.upper():
            # Trigger statement: walk forward joining chunks (with `;`
            # restored) until we find one that ends with `END`. The
            # final `END;` may have whitespace after it before the next
            # trigger or DDL begins — `.strip()` handles that.
            buf = [chunk]
            i += 1
            ended = False
            while i < len(chunks):
                buf.append(chunks[i])
                if chunks[i].strip().upper().endswith("END"):
                    ended = True
                    break
                i += 1
            stmt = ";".join(buf).strip()
            if stmt:
                out.append(stmt)
            i += 1
            if not ended:
                # Unterminated trigger — let SQLite produce the error
                # rather than swallow it silently.
                continue
        else:
            stmt = chunk.strip()
            if stmt:
                out.append(stmt)
            i += 1
    return out


__all__ = ["Database", "MigrationError"]
