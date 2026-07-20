# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for plan snapshots — Brief 43 §4 / PR 43.1.

Three operations:
  · insert_snapshot      — create one (append-only; raises on name collision)
  · list_snapshots       — read summaries for a plan (no body)
  · get_snapshot         — read one with the body

No update / delete in v1. Snapshots are the audit trail.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from typing import Any
from uuid import uuid4

from openrater.persistence.db import Database
from openrater.rates.snapshots.models import (
    PlanPublishFacts,
    PlanSnapshot,
    PlanSnapshotSummary,
)


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def new_snapshot_id() -> str:
    """Stable ID: `ps_<12 hex>`. Mirrors the established `<prefix>_<hex>`
    pattern used by plan IDs (author.py) + audit IDs."""
    return f"ps_{uuid4().hex[:12]}"


def _row_to_summary(row: sqlite3.Row) -> PlanSnapshotSummary:
    return PlanSnapshotSummary(
        snapshot_id=row["snapshot_id"],
        plan_id=row["plan_id"],
        display_name=row["display_name"],
        notes=row["notes"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        published_at=row["published_at"],
        published_by=row["published_by"],
    )


def _row_to_snapshot(row: sqlite3.Row) -> PlanSnapshot:
    body: dict[str, Any] = json.loads(row["body_json"])
    return PlanSnapshot(
        snapshot_id=row["snapshot_id"],
        plan_id=row["plan_id"],
        display_name=row["display_name"],
        notes=row["notes"],
        body=body,
        created_at=row["created_at"],
        created_by=row["created_by"],
        published_at=row["published_at"],
        published_by=row["published_by"],
    )


# ---------------------------------------------------------------
# Writes
# ---------------------------------------------------------------


class SnapshotNameCollisionError(Exception):
    """Raised when (plan_id, display_name) already exists."""

    def __init__(self, plan_id: str, display_name: str) -> None:
        super().__init__(
            f"snapshot display_name {display_name!r} already exists for plan {plan_id}"
        )
        self.plan_id = plan_id
        self.display_name = display_name


def insert_snapshot(
    *,
    db: Database,
    plan_id: str,
    display_name: str,
    notes: str | None,
    body: dict[str, Any],
    created_by: str,
) -> PlanSnapshot:
    """Append-only insert. Raises SnapshotNameCollisionError on the
    UNIQUE (plan_id, display_name) constraint."""
    snapshot_id = new_snapshot_id()
    now = _now_iso()
    body_json = json.dumps(body, separators=(",", ":"), sort_keys=True)
    with db.connection() as conn:
        try:
            conn.execute(
                """
                INSERT INTO plan_snapshots
                    (snapshot_id, plan_id, display_name, notes, body_json,
                     created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot_id,
                    plan_id,
                    display_name,
                    notes,
                    body_json,
                    now,
                    created_by,
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            # UNIQUE constraint on (plan_id, display_name) violated
            if "UNIQUE" in str(exc).upper():
                raise SnapshotNameCollisionError(plan_id, display_name) from exc
            raise
    return PlanSnapshot(
        snapshot_id=snapshot_id,
        plan_id=plan_id,
        display_name=display_name,
        notes=notes,
        body=body,
        created_at=now,
        created_by=created_by,
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def list_snapshots(*, db: Database, plan_id: str) -> list[PlanSnapshotSummary]:
    """List every snapshot for a plan, newest first."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT snapshot_id, plan_id, display_name, notes,
                   created_at, created_by, published_at, published_by
            FROM plan_snapshots
            WHERE plan_id = ?
            ORDER BY created_at DESC
            """,
            (plan_id,),
        ).fetchall()
    return [_row_to_summary(r) for r in rows]


def get_snapshot(
    *, db: Database, plan_id: str, snapshot_id: str
) -> PlanSnapshot | None:
    """Fetch one snapshot including the body. Returns None if not found.
    Scoped to plan_id so an enumeration on one plan can't surface another
    plan's snapshots."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT snapshot_id, plan_id, display_name, notes, body_json,
                   created_at, created_by, published_at, published_by
            FROM plan_snapshots
            WHERE plan_id = ? AND snapshot_id = ?
            """,
            (plan_id, snapshot_id),
        ).fetchone()
    return _row_to_snapshot(row) if row else None


def publish_overview_for_plans(
    *, db: Database, plan_ids: list[str]
) -> dict[str, PlanPublishFacts]:
    """Batch publish facts for the plans index (Brief 84 D-F): each plan's
    CURRENT published version (metadata + the content hash captured in its
    body, pulled via json_extract — no body blobs) plus how many
    integrations serve it live. Exactly TWO queries regardless of N — the
    whole point is that the index never fans out per-plan.

    Plans with nothing published and no live exposures simply don't appear
    in the returned map — callers treat a missing key as "draft"."""
    if not plan_ids:
        return {}
    placeholders = ",".join("?" for _ in plan_ids)
    merged: dict[str, dict[str, Any]] = {}
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        pub_rows = conn.execute(
            f"""
            SELECT plan_id, snapshot_id, display_name, published_at,
                   json_extract(body_json, '$.plan_content_hash')
                       AS published_content_hash
            FROM plan_snapshots
            WHERE published_at IS NOT NULL AND plan_id IN ({placeholders})
            ORDER BY published_at DESC
            """,
            plan_ids,
        ).fetchall()
        live_rows = conn.execute(
            f"""
            SELECT rating_plan_id, COUNT(*) AS live_count
            FROM integration_exposed_plans
            WHERE live = 1 AND rating_plan_id IN ({placeholders})
            GROUP BY rating_plan_id
            """,
            plan_ids,
        ).fetchall()
    for r in pub_rows:
        # Newest published_at wins — the write path keeps exactly one
        # published row per plan anyway (belt-and-braces tiebreak, same
        # as get_published_snapshot).
        if r["plan_id"] in merged:
            continue
        hash_val = r["published_content_hash"]
        merged[r["plan_id"]] = {
            "published_snapshot_id": r["snapshot_id"],
            "published_display_name": r["display_name"],
            "published_at": r["published_at"],
            "published_content_hash": hash_val
            if isinstance(hash_val, str)
            else None,
        }
    for r in live_rows:
        merged.setdefault(r["rating_plan_id"], {})["live_integration_count"] = r[
            "live_count"
        ]
    return {pid: PlanPublishFacts(**vals) for pid, vals in merged.items()}


def get_published_snapshot(
    *, db: Database, plan_id: str
) -> PlanSnapshot | None:
    """The plan's CURRENT published version, body included, or None when
    nothing is published. `publish_snapshot` keeps exactly one current per
    plan (it demotes the prior in the same transaction), so this returns
    that one; the ORDER BY is a belt-and-braces tiebreak."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT snapshot_id, plan_id, display_name, notes, body_json,
                   created_at, created_by, published_at, published_by
            FROM plan_snapshots
            WHERE plan_id = ? AND published_at IS NOT NULL
            ORDER BY published_at DESC
            LIMIT 1
            """,
            (plan_id,),
        ).fetchone()
    return _row_to_snapshot(row) if row else None


def get_published_snapshot_id(*, db: Database, plan_id: str) -> str | None:
    """The CURRENT published snapshot's id, or None when nothing is
    published — the same selection as `get_published_snapshot` but id-only,
    so callers that just need to COMPARE the live version (the integration
    seam's drift gate) never haul the ~0.8 MB body to read one string."""
    with db.connection() as conn:
        row = conn.execute(
            """
            SELECT snapshot_id
            FROM plan_snapshots
            WHERE plan_id = ? AND published_at IS NOT NULL
            ORDER BY published_at DESC
            LIMIT 1
            """,
            (plan_id,),
        ).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------
# Publish (Brief 64 §4)
# ---------------------------------------------------------------


def publish_snapshot(
    *, db: Database, plan_id: str, snapshot_id: str, published_by: str
) -> PlanSnapshotSummary | None:
    """Mark `snapshot_id` as the plan's CURRENT version, clearing the prior
    current in the SAME transaction so exactly one is current per plan.
    Returns the updated summary, or None when the snapshot doesn't exist on
    the plan. Idempotent — re-publishing the same snapshot just refreshes
    its `published_at`."""
    now = _now_iso()
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        exists = conn.execute(
            "SELECT 1 FROM plan_snapshots WHERE plan_id = ? AND snapshot_id = ?",
            (plan_id, snapshot_id),
        ).fetchone()
        if exists is None:
            return None
        # Demote-then-promote MUST be one transaction. The connection runs
        # in autocommit mode (db.py `isolation_level=None`), so without an
        # explicit BEGIN each UPDATE would commit on its own — and a crash
        # (or lock timeout) landing between them would leave the plan with
        # EVERY version demoted and NONE promoted, i.e. no published
        # version, which 404s `no_published_version` for every default-
        # version quote. BEGIN IMMEDIATE takes the write lock up front and
        # commits both UPDATEs atomically; any failure rolls the pair back.
        conn.execute("BEGIN IMMEDIATE;")
        try:
            prior = conn.execute(
                """
                SELECT snapshot_id, display_name, published_at
                FROM plan_snapshots
                WHERE plan_id = ? AND published_at IS NOT NULL
                ORDER BY published_at DESC
                LIMIT 1
                """,
                (plan_id,),
            ).fetchone()
            # Demote the prior current(s) on this plan.
            conn.execute(
                """
                UPDATE plan_snapshots
                SET published_at = NULL, published_by = NULL
                WHERE plan_id = ? AND snapshot_id != ?
                """,
                (plan_id, snapshot_id),
            )
            # Promote the target.
            conn.execute(
                """
                UPDATE plan_snapshots
                SET published_at = ?, published_by = ?
                WHERE plan_id = ? AND snapshot_id = ?
                """,
                (now, published_by, plan_id, snapshot_id),
            )
            # The go-live record (2026-07-11 audit + migration 040): the
            # demote above NULLs the prior row's published_at/by — correct
            # for the one-current invariant, but WITHOUT this event the
            # platform forgets what was live when. The audit log is
            # append-only and survives hard-delete (soft plan ref), so
            # "which version served callers last Tuesday" stays answerable.
            from openrater.rates.plans.author import write_audit_event

            target = conn.execute(
                """
                SELECT display_name FROM plan_snapshots
                WHERE plan_id = ? AND snapshot_id = ?
                """,
                (plan_id, snapshot_id),
            ).fetchone()
            if prior and prior["snapshot_id"] == snapshot_id:
                note = "Re-published the current version (refresh)"
            elif prior:
                note = (
                    f"Publish repoint — callers switch from "
                    f"{prior['display_name']!r}"
                )
            else:
                note = "First publish — the quote API turns on"
            write_audit_event(
                db=db,
                conn=conn,
                rating_plan_id=plan_id,
                event_kind="publish",
                before=(
                    {
                        "snapshot_id": prior["snapshot_id"],
                        "display_name": prior["display_name"],
                        "published_at": prior["published_at"],
                    }
                    if prior
                    else None
                ),
                after={
                    "snapshot_id": snapshot_id,
                    "display_name": target["display_name"] if target else None,
                    "published_at": now,
                },
                operator_id=published_by,
                note=note,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute(
            """
            SELECT snapshot_id, plan_id, display_name, notes,
                   created_at, created_by, published_at, published_by
            FROM plan_snapshots
            WHERE plan_id = ? AND snapshot_id = ?
            """,
            (plan_id, snapshot_id),
        ).fetchone()
    return _row_to_summary(row) if row else None
