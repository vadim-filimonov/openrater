# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The ingest CLI — the same code path as the endpoint, headless.

    python -m openrater.rates.ingest check <workbook.xlsx> [--json]
    python -m openrater.rates.ingest diff <base.xlsx> <revised.xlsx> [--json]

Exit codes: 0 = clean · 1 = check failed (errors) · 2 = unusable
invocation (missing file, unknown command). `diff` (Brief 92.R) lets a
transcriber preview exactly what a revision changes before the
platform is ever involved — parse-level, no DB, no server. `--json` emits the raw
CheckResult for scripting/CI; the default output is the grouped,
cell-addressed human report (the terminal twin of the Brief 92
check screen).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from openrater.rates.ingest.service import CheckResult, check_workbook


def _print_human(result: CheckResult) -> None:
    print(f"workbook  {result.filename or '-'}")
    print(f"hash      {result.workbook_hash[:16]}…  ·  {result.sheet_count} sheets  ·  spec {result.spec_version}")
    if result.ok:
        print("check     PASSED — ready to build")
    else:
        print(
            f"check     FAILED — {len(result.errors)} error(s), "
            f"{len(result.warnings)} warning(s). Nothing would be created."
        )
    for group, label in ((result.errors, "ERROR"), (result.warnings, "WARN "), (result.notices, "note ")):
        for i in group:
            where = f"{i.sheet or '-'}!{i.cell}" if i.cell else (i.sheet or "-")
            print(f"  {label} {i.rule}  {where:<28} {i.message}")
    if result.manifest is not None:
        c = result.manifest.counts
        p = result.manifest.provenance
        prov = " · ".join(
            v for v in (p.carrier, p.product, p.state, p.effective_date) if v
        )
        print(f"plan      {p.display_name or '-'}  ({prov})")
        print(
            "creates   "
            f"{c.dimensions} dimensions ({c.dimension_levels} levels) · "
            f"{c.factor_tables} tables ({c.factor_cells} cells) · "
            f"{c.chains} chains ({c.chain_stages} stages) · "
            f"{c.gates} gates · {c.inputs} inputs ({c.inputs_with_defaults} defaulted) · "
            f"{c.outputs} outputs · {c.test_cases} vectors · "
            f"{c.declared_gaps} declared gaps"
        )


def _default_db_path() -> str:
    import os

    return os.environ.get(
        "RATER_DB_PATH", str(Path.home() / ".openrater" / "openrater.db")
    )


def _run_build(args: argparse.Namespace) -> int:
    from openrater.persistence import Database
    from openrater.rates.ingest.service import (
        PlanAlreadyBuiltError,
        PlanIdTakenError,
        WorkbookNotCleanError,
        build_workbook,
    )

    db = Database(args.db or _default_db_path())
    try:
        outcome = build_workbook(
            db=db,
            data=args.workbook.read_bytes(),
            filename=args.workbook.name,
        )
    except WorkbookNotCleanError as exc:
        _print_human(exc.result)
        return 1
    except (PlanAlreadyBuiltError, PlanIdTakenError) as exc:
        # Brief 95 A2 — pinned plan ids: same bytes = already built;
        # different bytes = the re-ingest door (`reingest` subcommand).
        print(str(exc))
        return 1
    if args.json:
        print(outcome.model_dump_json(indent=2))
        return 0
    v = outcome.report.vectors
    print(f"built     {outcome.rating_plan_id}  ·  {outcome.display_name}")
    print(f"report    {outcome.report.report_id}")
    if v.status == "ran":
        print(
            f"vectors   {v.matched} match · {v.near} near · {v.mismatched} "
            f"mismatch  (of {v.total_cases} cases)"
        )
        for c in v.checks:
            if c.status not in ("match",):
                print(f"  {c.status.upper():<8} {c.case_id} {c.field}: "
                      f"expected {c.expected} got {c.actual} (Δ {c.delta})")
    else:
        print(f"vectors   {v.status} — {v.detail}")
    print(f"gaps      {len(outcome.report.gaps)} declared row(s) echoed to the report")
    return 0 if v.status != "ran" or v.mismatched == 0 else 3


def _run_diff(args: argparse.Namespace) -> int:
    from openrater.rates.ingest.diff import diff_workbooks
    from openrater.rates.ingest.parser import parse_workbook

    for f in (args.base, args.revised):
        if not f.is_file():
            print(f"error: no such file: {f}", file=sys.stderr)
            return 2
    base, base_issues = parse_workbook(args.base.read_bytes())
    new_wb, new_issues = parse_workbook(args.revised.read_bytes())
    if any(i.rule == "R-001" for i in base_issues + new_issues):
        print("error: one side is not a readable .xlsx workbook.", file=sys.stderr)
        return 2
    diff = diff_workbooks(base, new_wb)
    if args.json:
        print(diff.model_dump_json(indent=2, by_alias=True))
        return 0
    t = diff.totals
    print(
        f"revision  {args.base.name} → {args.revised.name}\n"
        f"changes   {t.added} added · {t.changed} changed · {t.removed} removed "
        f"across {t.sections_changed} section(s)"
    )
    marks = {"added": "+", "changed": "~", "removed": "-"}
    for sec in diff.sections:
        if not sec.items:
            continue
        print(f"  {sec.label}")
        for item in sec.items[:40]:
            print(f"    {marks[item.state]} {item.summary}")
            for ch in item.changes[:12]:
                pct = f"  ({ch.pct:+.1f}%)" if ch.pct is not None else ""
                print(f"        {ch.field}: {ch.from_} → {ch.to}{pct}")
    for note in diff.ignored:
        print(f"  note: {note}")
    return 0


def _run_reingest(args: argparse.Namespace) -> int:
    from openrater.persistence import Database
    from openrater.rates.ingest.service import reingest_apply

    db = Database(args.db or _default_db_path())
    response = reingest_apply(
        db=db,
        rating_plan_id=args.plan_id,
        data=args.workbook.read_bytes(),
        filename=args.workbook.name,
    )
    if args.json:
        print(response.model_dump_json(indent=2))
    else:
        v = response.report.vectors
        d = response.report.drift
        print(f"applied   {response.rating_plan_id}  ·  verification: {response.verification}")
        print(f"vectors   {v.matched} matched · {v.near} near · {v.mismatched} mismatched")
        if d is not None and d.median_pct is not None:
            print(
                f"drift     the filing's examples moved {d.median_pct:+.1f}% median "
                f"({d.max_pct:+.1f}% max) across {d.compared} checks"
            )
    return 3 if v.status == "ran" and v.mismatched > 0 else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m openrater.rates.ingest")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="Validate a workbook against spec v1.0.")
    check.add_argument("workbook", type=Path)
    check.add_argument("--json", action="store_true", help="Emit the raw CheckResult JSON.")
    build = sub.add_parser(
        "build",
        help="Build a plan from a clean workbook (one transaction), run its "
        "test cases through scoring, persist the build report.",
    )
    build.add_argument("workbook", type=Path)
    build.add_argument(
        "--db",
        default=None,
        help="SQLite path (default: $RATER_DB_PATH or ~/.openrater/openrater.db).",
    )
    build.add_argument("--json", action="store_true", help="Emit the BuildResponse JSON.")
    diff_p = sub.add_parser(
        "diff",
        help="What a revision changes: construct-grain diff of two "
        "workbooks (Brief 92.R). Parse-level — no DB, no server.",
    )
    diff_p.add_argument("base", type=Path)
    diff_p.add_argument("revised", type=Path)
    diff_p.add_argument("--json", action="store_true", help="Emit the WorkbookDiff JSON.")
    reingest = sub.add_parser(
        "reingest",
        help="Apply a revised workbook to the plan it revises (Brief "
        "92.R): one-transaction replay, vectors re-run, drift vs the "
        "prior build recorded.",
    )
    reingest.add_argument("plan_id")
    reingest.add_argument("workbook", type=Path)
    reingest.add_argument(
        "--db",
        default=None,
        help="SQLite path (default: $RATER_DB_PATH or ~/.openrater/openrater.db).",
    )
    reingest.add_argument("--json", action="store_true", help="Emit the BuildResponse JSON.")
    args = parser.parse_args(argv)

    if args.command == "diff":
        return _run_diff(args)

    if not args.workbook.is_file():
        print(f"error: no such file: {args.workbook}", file=sys.stderr)
        return 2

    if args.command == "build":
        return _run_build(args)

    if args.command == "reingest":
        return _run_reingest(args)

    result = check_workbook(args.workbook.read_bytes(), filename=args.workbook.name)
    if args.json:
        print(result.model_dump_json(indent=2))
    else:
        _print_human(result)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
