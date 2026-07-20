# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The operator's data-integrity sweep — Brief 95 B2.

    python -m openrater.persistence check --db <path> [--missing-ok] [--limit N]

Read-only (the DB opens with `mode=ro` — running this can never migrate
or mutate anything), so it is safe as a pre-upgrade step: it is wired
into `deploy/upgrade.sh` between the image build and the restart, so a
box with dangling references refuses the upgrade BEFORE the new code's
migrations run against damaged data (the WI arc found exactly one such
orphan on a long-lived dev DB — a stage output whose stage was deleted
under enforcement-off).

What it reports:
  · PRAGMA quick_check     — structural corruption (btree-level)
  · PRAGMA foreign_key_check — every dangling reference, grouped by
    (child table → missing parent), each row NAMED by its key columns
    (via foreign_key_list), with inspect/repair SQL suggestions
  · pending migrations     — schema_version vs the packaged migrations

Exit codes: 0 clean · 1 violations/corruption found · 2 usage/IO error.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


def _open_readonly(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def _fk_columns(conn: sqlite3.Connection, table: str, fkid: int) -> list[str]:
    """The child table's FK columns for one foreign_key_list entry."""
    return [
        str(r["from"])
        for r in conn.execute(f"PRAGMA foreign_key_list({table})")
        if int(r["id"]) == fkid
    ]


def _named_row(conn: sqlite3.Connection, table: str, rowid: int, cols: list[str]) -> str:
    if not cols:
        return f"rowid {rowid}"
    row = conn.execute(
        f"SELECT {', '.join(cols)} FROM {table} WHERE rowid = ?", (rowid,)
    ).fetchone()
    if row is None:  # raced away — name it by rowid only
        return f"rowid {rowid}"
    named = ", ".join(f"{c}={row[c]!r}" for c in cols)
    return f"rowid {rowid} ({named})"


def check(db_path: str, *, missing_ok: bool = False, limit: int = 10) -> int:
    path = Path(db_path).expanduser()
    if not path.is_file():
        if missing_ok:
            print(f"no database at {path} — nothing to check (fresh box).")
            return 0
        print(f"error: no database at {path}", file=sys.stderr)
        return 2

    try:
        conn = _open_readonly(path)
    except sqlite3.Error as exc:
        print(f"error: cannot open {path} read-only: {exc}", file=sys.stderr)
        return 2

    failed = False
    try:
        # 1. Structural integrity (cheap btree scan).
        quick = [str(r[0]) for r in conn.execute("PRAGMA quick_check")]
        if quick != ["ok"]:
            failed = True
            print(f"quick_check: {len(quick)} problem(s)")
            for line in quick[:limit]:
                print(f"  {line}")
        else:
            print("quick_check: ok")

        # 2. Dangling references, grouped and NAMED.
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            failed = True
            groups: dict[tuple[str, str, int], list[int]] = {}
            for v in violations:
                key = (str(v[0]), str(v[2]), int(v[3]))  # child, parent, fkid
                groups.setdefault(key, []).append(int(v[1]))  # rowid
            print(
                f"foreign_key_check: {len(violations)} dangling reference(s) "
                f"in {len(groups)} group(s)"
            )
            for (child, parent, fkid), rowids in sorted(groups.items()):
                cols = _fk_columns(conn, child, fkid)
                print(f"\n  {child} -> missing {parent}  ({len(rowids)} row(s))")
                for rowid in rowids[:limit]:
                    print(f"    {_named_row(conn, child, rowid, cols)}")
                if len(rowids) > limit:
                    print(f"    … +{len(rowids) - limit} more")
                ids = ", ".join(str(r) for r in rowids[:limit])
                print(f"    inspect: SELECT * FROM {child} WHERE rowid IN ({ids});")
                print(
                    f"    orphaned child rows are usually safe to remove: "
                    f"DELETE FROM {child} WHERE rowid IN ({ids});  -- after inspecting"
                )
        else:
            print("foreign_key_check: clean")

        # 3. Pending migrations (informational — they apply on next boot).
        try:
            applied = {
                int(r[0]) for r in conn.execute("SELECT version FROM schema_version")
            }
        except sqlite3.Error:
            applied = set()
        from openrater.persistence.db import Database

        available = {v for v, _sql in Database._discover_migrations()}
        pending = sorted(available - applied)
        if pending:
            print(
                f"migrations: {len(pending)} pending "
                f"({', '.join(f'{v:03d}' for v in pending[:10])}"
                f"{', …' if len(pending) > 10 else ''}) — they apply on next boot"
            )
        else:
            print("migrations: up to date")
    finally:
        conn.close()

    if failed:
        print(
            "\nRESULT: integrity problems found — fix the named rows before "
            "upgrading (migrations that rebuild tables enforce these "
            "references)."
        )
        return 1
    print("\nRESULT: clean")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="python -m openrater.persistence",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = ap.add_subparsers(dest="command", required=True)
    c = sub.add_parser("check", help="read-only integrity sweep (FK + quick_check)")
    c.add_argument("--db", required=True, help="SQLite DB path")
    c.add_argument(
        "--missing-ok",
        action="store_true",
        help="a missing DB file is OK (fresh box) — exit 0",
    )
    c.add_argument(
        "--limit", type=int, default=10, help="max named rows per group (default 10)"
    )
    args = ap.parse_args()
    return check(args.db, missing_ok=args.missing_ok, limit=args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
