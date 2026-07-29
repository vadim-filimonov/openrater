"""The shipped demo-plan seed.

The deploy pre-loads every bundled `*.plan.json` fixture so a fresh box
boots with working, fully-rated plans in the list. The fixture set is
the SYNTHETIC demo program (Detachment Brief 1 §4 S3 — the Meridian
plans land in Phase D; until then `docs/fixtures/` ships empty and this
seeder no-ops cleanly). Fixtures may carry their BUILD REPORTS —
workbook hash, vector results, the gaps ledger, and the workbook bytes
themselves (base64 in the JSON, decoded on insert) — so a seeded box
has the "Built from workbook" provenance, the report drawer, and a
working re-ingest door. Plan ids are the workbooks' own
`rating_plan_id`s — stable on every box.

**On by default in the deploy** (the compose file defaults
`RATER_SEED_COLD_TEST` to "1"); set `SEED_COLD_TEST=0` to ship empty.

This is a DEPLOY-ONLY concern, kept out of the OSS core: the core
deliberately does not auto-seed plans. The apply logic here is
DATA-DRIVEN — it writes whatever tables + model each fixture carries
(each table spec includes its own `columns`) — so it can never drift
from the committed files in `docs/fixtures/*.plan.json`, captured/
restored by `scripts/plan_fixture.py`.

Modes (`RATER_SEED_COLD_TEST`), applied PER PLAN:
  "1" / "true" / "yes" / "on" (the default)   -> seed only plans that are absent,
                                                 so user edits survive restarts.
  "reset"                                     -> delete + re-insert, restoring
                                                 every pristine plan on boot.
  "0" / "false" / "no" / "off" / ""           -> skip (ship empty).

Fixture discovery (`RATER_COLD_TEST_FIXTURE`):
  · unset      -> the repo's `docs/fixtures/*.plan.json`
  · a file     -> that single fixture (the pre-multi-plan deploy shape)
  · a directory-> every `*.plan.json` inside it (the deploy image ships
                  `/app/fixtures/`)
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from openrater.observability.logging import get_logger

_log = get_logger("openrater_deploy.seed")

_FALSEY = {"", "0", "false", "no", "off"}


def _decode_cell(v: Any) -> Any:
    """Fixture cells are JSON scalars, except BLOBs (the build report's
    workbook bytes, Brief 95 A1) which travel as {"$b64": "..."} —
    mirror of scripts/plan_fixture.py `encode_cell`/`decode_cell`."""
    if isinstance(v, dict) and set(v) == {"$b64"}:
        return base64.b64decode(v["$b64"])
    return v


def _fixture_paths() -> list[Path]:
    """Locate the committed fixture JSONs (see the module docstring)."""
    env = os.environ.get("RATER_COLD_TEST_FIXTURE", "").strip()
    if env:
        p = Path(env).expanduser()
        if p.is_file():
            return [p]
        if p.is_dir():
            return sorted(p.glob("*.plan.json"))
        return []
    fallback = Path(__file__).resolve().parents[3] / "docs/fixtures"
    if fallback.is_dir():
        return sorted(fallback.glob("*.plan.json"))
    return []


def _seed_one(conn: sqlite3.Connection, fixture: Path, *, reset: bool) -> None:
    """Apply one fixture into an open connection (if-absent unless reset)."""
    data = json.loads(fixture.read_text())
    plan_id: str = data["plan_id"]
    tables: dict[str, dict] = data["tables"]  # parent->child insert order
    model = data.get("model")
    model_id = data.get("model_id")

    present = (
        conn.execute(
            "SELECT 1 FROM rating_plans WHERE rating_plan_id=?", (plan_id,)
        ).fetchone()
        is not None
    )
    if present and not reset:
        _log.info("cold_test_seed_skipped_present", plan_id=plan_id)
        return
    if present:  # reset: clear this plan's rows, children->parents first
        for table in reversed(list(tables)):
            conn.execute(f"DELETE FROM {table} WHERE rating_plan_id=?", (plan_id,))
    # Insert parents->children.
    for table, spec in tables.items():
        cols = spec["columns"]
        placeholders = ",".join("?" * len(cols))
        conn.executemany(
            f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})",
            [[_decode_cell(row[c]) for c in cols] for row in spec["rows"]],
        )
    if model and model_id:
        cols = model["columns"]
        placeholders = ",".join("?" * len(cols))
        # Idempotent for the shared `models` table (not plan-scoped).
        conn.execute("DELETE FROM models WHERE model_id=?", (model_id,))
        conn.execute(
            f"INSERT INTO models ({','.join(cols)}) VALUES ({placeholders})",
            [model["row"][c] for c in cols],
        )
    _log.info(
        "cold_test_seed_loaded",
        plan_id=plan_id,
        fixture=fixture.name,
        rows=sum(len(s["rows"]) for s in tables.values()),
        model=bool(model and model_id),
        mode="reset" if reset else "if-absent",
    )


def maybe_seed_cold_test(db: Any) -> None:
    """Env-gated, best-effort seed of the bundled reference plans into `db`.

    `db` is the core's `openrater.persistence.Database` (exposes `.path`).
    Failures are logged and swallowed — a seed hiccup must never stop the app
    from booting. Each fixture applies independently: one bad fixture cannot
    block the others.
    """
    mode = os.environ.get("RATER_SEED_COLD_TEST", "").strip().lower()
    if mode in _FALSEY:
        return
    reset = mode == "reset"

    fixtures = _fixture_paths()
    if not fixtures:
        _log.warning(
            "cold_test_seed_skipped_no_fixture",
            hint="set RATER_COLD_TEST_FIXTURE to a fixture JSON or a directory",
        )
        return

    conn = sqlite3.connect(str(db.path), timeout=30)
    try:
        for fixture in fixtures:
            try:
                _seed_one(conn, fixture, reset=reset)
                conn.commit()
            except Exception:  # noqa: BLE001 — best-effort per fixture
                conn.rollback()
                _log.exception("cold_test_seed_failed", fixture=fixture.name)
    finally:
        conn.close()
