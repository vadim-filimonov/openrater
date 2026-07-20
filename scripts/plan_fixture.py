#!/usr/bin/env python3
"""Generic plan-fixture export/load — any plan id, any fixture path.

The deploy seed (`deploy/overlay/openrater_deploy/seed.py`) pre-loads every
`*.plan.json` under `docs/fixtures/`. This script captures a plan from a
DB into that data-driven fixture shape (and can load one back).
PLAN_TABLES below is the single source of truth for what a plan fixture
spans — loaders are data-driven off each fixture's own table specs, so
only capture reads this list.

Capture a plan:
    python scripts/plan_fixture.py export meridian-shopfront-bop-ne-2026 \
        docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json \
        --db /tmp/openrater-dev.db

Load one into a DB (idempotent delete + re-insert of that plan):
    python scripts/plan_fixture.py load <ignored-or-plan-id> \
        docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json \
        --db /tmp/openrater-dev.db
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

#: Every table a plan's substrate spans, in FK-safe insert order
#: (deletes run in reverse).
PLAN_TABLES = [
    "rating_plans",
    "rating_plan_stages",
    "rating_plan_stage_outputs",
    "plan_dimensions",
    "plan_factor_tables",
    "plan_factor_table_cells",
    "plan_class_codes",
    "plan_input_mappings",
    # The policy tail is plan substrate (migration 031) — composed tail
    # adjustments ship with the plan, no browser localStorage step.
    "plan_policy_tail",
    # The build report is the plan's provenance: without it a seeded box
    # has no "Built from workbook" fact, no report drawer, and the
    # re-ingest door can't recognize the plan (it would mint a
    # duplicate). Carries the workbook bytes (base64 in the fixture
    # JSON — see encode_cell) so revisions diff against the base.
    "plan_build_reports",
]


def _cols(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def encode_cell(v):
    """JSON-safe cell: BLOBs such as build-report workbook bytes travel as {"$b64": "..."}. Mirrored by `decode_cell`
    here and in deploy/overlay/openrater_deploy/seed.py — keep in sync."""
    if isinstance(v, (bytes, bytearray)):
        import base64

        return {"$b64": base64.b64encode(bytes(v)).decode("ascii")}
    return v


def decode_cell(v):
    if isinstance(v, dict) and set(v) == {"$b64"}:
        import base64

        return base64.b64decode(v["$b64"])
    return v


def export(plan_id: str, fixture: Path, db: str) -> None:
    conn = sqlite3.connect(db)
    out: dict = {"plan_id": plan_id, "model_id": None, "tables": {}, "model": None}
    for t in PLAN_TABLES:
        c = _cols(conn, t)
        rows = [
            {k: encode_cell(v) for k, v in zip(c, r)}
            for r in conn.execute(
                f"SELECT {','.join(c)} FROM {t} WHERE rating_plan_id=?", (plan_id,)
            )
        ]
        out["tables"][t] = {"columns": c, "rows": rows}
    conn.close()
    if not out["tables"]["rating_plans"]["rows"]:
        raise SystemExit(f"plan {plan_id!r} not found in {db}")
    fixture.parent.mkdir(parents=True, exist_ok=True)
    fixture.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    total = sum(len(s["rows"]) for s in out["tables"].values())
    print(f"exported {plan_id}: {total} rows / {len(PLAN_TABLES)} tables -> {fixture}")


def load(fixture: Path, db: str) -> None:
    data = json.loads(fixture.read_text())
    plan_id = data["plan_id"]
    conn = sqlite3.connect(db, timeout=30)
    for t in reversed(PLAN_TABLES):
        conn.execute(f"DELETE FROM {t} WHERE rating_plan_id=?", (plan_id,))
    for t in PLAN_TABLES:
        spec = data["tables"].get(t)
        if spec is None:  # fixture predates this table
            continue
        c = spec["columns"]
        ph = ",".join("?" * len(c))
        for row in spec["rows"]:
            conn.execute(
                f"INSERT INTO {t} ({','.join(c)}) VALUES ({ph})",
                [decode_cell(row[k]) for k in c],
            )
    conn.commit()
    conn.close()
    total = sum(len(s["rows"]) for s in data["tables"].values())
    print(f"loaded {plan_id}: {total} rows into {db}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mode", choices=["export", "load"])
    ap.add_argument("plan_id", help="plan id (export) — ignored on load (fixture wins)")
    ap.add_argument("fixture", type=Path)
    ap.add_argument("--db", required=True)
    args = ap.parse_args()
    if args.mode == "export":
        export(args.plan_id, args.fixture, args.db)
    else:
        load(args.fixture, args.db)


if __name__ == "__main__":
    main()
