# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Persistence for Routes + plan input values (Brief 48).

A Route binds a plan's input variables to a Connection and pushes outputs back.
Bindings/pushes are small lists stored as JSON on the route. `plan_input_values`
is where route outputs (and provided values) land — what the Inputs screen reads.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from typing import Any
from uuid import uuid4

from openrater.connectors.models import (
    PlanInputValue,
    Route,
    RouteBinding,
    RoutePush,
)
from openrater.persistence.db import Database


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def new_route_id() -> str:
    return f"rt_{uuid4().hex[:12]}"


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _row_to_route(row: sqlite3.Row) -> Route:
    return Route(
        route_id=row["route_id"],
        plan_id=row["plan_id"],
        connection_id=row["connection_id"],
        name=row["name"],
        bindings=[RouteBinding(**b) for b in json.loads(row["bindings_json"])],
        pushes=[RoutePush(**p) for p in json.loads(row["pushes_json"])],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
    )


def create_route(
    *,
    db: Database,
    plan_id: str,
    connection_id: str,
    name: str,
    bindings: list[RouteBinding],
    pushes: list[RoutePush],
    created_by: str,
) -> Route:
    route_id = new_route_id()
    now = _now_iso()
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO enrichment_routes
                (route_id, plan_id, connection_id, name, bindings_json,
                 pushes_json, created_at, created_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                route_id,
                plan_id,
                connection_id,
                name,
                _dumps([b.model_dump() for b in bindings]),
                _dumps([p.model_dump() for p in pushes]),
                now,
                created_by,
                now,
            ),
        )
        conn.commit()
    materialized = get_route(db=db, plan_id=plan_id, route_id=route_id)
    assert materialized is not None, "create + read race; unreachable"
    return materialized


def get_route(*, db: Database, plan_id: str, route_id: str) -> Route | None:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM enrichment_routes WHERE plan_id = ? AND route_id = ?",
            (plan_id, route_id),
        ).fetchone()
    return _row_to_route(row) if row is not None else None


def list_routes(*, db: Database, plan_id: str) -> list[Route]:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM enrichment_routes WHERE plan_id = ? ORDER BY created_at",
            (plan_id,),
        ).fetchall()
    return [_row_to_route(r) for r in rows]


def delete_route(*, db: Database, plan_id: str, route_id: str) -> bool:
    with db.connection() as conn:
        cur = conn.execute(
            "DELETE FROM enrichment_routes WHERE plan_id = ? AND route_id = ?",
            (plan_id, route_id),
        )
        conn.commit()
        return cur.rowcount > 0


# --- plan input values (the push-back store / Inputs-screen source) -----------


def _row_to_value(row: sqlite3.Row) -> PlanInputValue:
    raw = row["value_json"]
    return PlanInputValue(
        plan_id=row["plan_id"],
        input_key=row["input_key"],
        value=json.loads(raw) if raw is not None else None,
        source=row["source"],
        snapshot_id=row["snapshot_id"],
        updated_at=row["updated_at"],
    )


def upsert_plan_input_value(
    *,
    db: Database,
    plan_id: str,
    input_key: str,
    value: str | float | bool | None,
    source: str,
    snapshot_id: str | None,
    updated_by: str,
) -> PlanInputValue:
    now = _now_iso()
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO plan_input_values
                (plan_id, input_key, value_json, source, snapshot_id, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(plan_id, input_key) DO UPDATE SET
                value_json = excluded.value_json,
                source = excluded.source,
                snapshot_id = excluded.snapshot_id,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (
                plan_id,
                input_key,
                None if value is None else _dumps(value),
                source,
                snapshot_id,
                now,
                updated_by,
            ),
        )
        conn.commit()
    return PlanInputValue(
        plan_id=plan_id,
        input_key=input_key,
        value=value,
        source=source,
        snapshot_id=snapshot_id,
        updated_at=now,
    )


def get_plan_input_value(
    *, db: Database, plan_id: str, input_key: str
) -> PlanInputValue | None:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM plan_input_values WHERE plan_id = ? AND input_key = ?",
            (plan_id, input_key),
        ).fetchone()
    return _row_to_value(row) if row is not None else None


def list_plan_input_values(*, db: Database, plan_id: str) -> list[PlanInputValue]:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM plan_input_values WHERE plan_id = ? ORDER BY input_key",
            (plan_id,),
        ).fetchall()
    return [_row_to_value(r) for r in rows]
