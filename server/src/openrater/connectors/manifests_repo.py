# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Persistence for user-authored connector manifests (Brief 47, Phase B).

A connector is DATA — the generic `RestConnector` runs any manifest. Code-bundled
manifests (`manifests.py`) stay canonical; this repo stores the ones a user
authors through the studio. Mirrors `rates.templates.repo`: raw SQLite via the
`Database` factory, JSON blobs for the nested lists/objects, `ON CONFLICT` upsert
that preserves `created_at`.

Secrets are never persisted — `secret_env` is an env-var NAME, not a key.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from typing import Any

from openrater.connectors.models import ConnectorManifest, InputParam, OutputPort
from openrater.persistence.db import Database


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _row_to_manifest(row: sqlite3.Row) -> ConnectorManifest:
    raw_request_json = row["request_json"]
    return ConnectorManifest(
        connector_id=row["connector_id"],
        display_name=row["display_name"],
        vendor=row["vendor"],
        category=row["category"],
        kind=row["kind"],
        version=row["version"],
        method=row["method"],
        endpoint=row["endpoint"],
        secret_env=row["secret_env"],
        secret_param=row["secret_param"],
        secret_in=row["secret_in"] if "secret_in" in row.keys() else "query",
        secret_prefix=row["secret_prefix"] if "secret_prefix" in row.keys() else None,
        request_json=json.loads(raw_request_json) if raw_request_json else None,
        request_query=json.loads(row["request_query"]),
        inputs=[InputParam(**d) for d in json.loads(row["inputs_json"])],
        outputs=[OutputPort(**d) for d in json.loads(row["outputs_json"])],
        cost_per_call_usd=row["cost_per_call_usd"],
        ttl_seconds=row["ttl_seconds"],
        docs_url=row["docs_url"],
    )


def list_manifests(*, db: Database) -> list[ConnectorManifest]:
    """Every user-authored manifest, ordered by display_name (stable for the UI)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM connector_manifests ORDER BY display_name"
        ).fetchall()
    return [_row_to_manifest(r) for r in rows]


def get_manifest(*, db: Database, connector_id: str) -> ConnectorManifest | None:
    """Fetch one user-authored manifest. None if not found."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM connector_manifests WHERE connector_id = ?",
            (connector_id,),
        ).fetchone()
    return _row_to_manifest(row) if row is not None else None


def upsert_manifest(
    *, db: Database, manifest: ConnectorManifest, created_by: str
) -> ConnectorManifest:
    """Insert or update a manifest. Preserves `created_at` / `created_by` on update."""
    now = _now_iso()
    request_json = _dumps(manifest.request_json) if manifest.request_json is not None else None
    request_query = _dumps(manifest.request_query)
    inputs_json = _dumps([p.model_dump() for p in manifest.inputs])
    outputs_json = _dumps([p.model_dump() for p in manifest.outputs])

    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO connector_manifests (
                connector_id, display_name, vendor, category, kind, version,
                method, endpoint, secret_env, secret_param, secret_in,
                secret_prefix, request_json, request_query, inputs_json,
                outputs_json, cost_per_call_usd, ttl_seconds, docs_url,
                created_at, created_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(connector_id) DO UPDATE SET
                display_name = excluded.display_name,
                vendor = excluded.vendor,
                category = excluded.category,
                kind = excluded.kind,
                version = excluded.version,
                method = excluded.method,
                endpoint = excluded.endpoint,
                secret_env = excluded.secret_env,
                secret_param = excluded.secret_param,
                secret_in = excluded.secret_in,
                secret_prefix = excluded.secret_prefix,
                request_json = excluded.request_json,
                request_query = excluded.request_query,
                inputs_json = excluded.inputs_json,
                outputs_json = excluded.outputs_json,
                cost_per_call_usd = excluded.cost_per_call_usd,
                ttl_seconds = excluded.ttl_seconds,
                docs_url = excluded.docs_url,
                updated_at = excluded.updated_at
            """,
            (
                manifest.connector_id,
                manifest.display_name,
                manifest.vendor,
                manifest.category,
                manifest.kind,
                manifest.version,
                manifest.method,
                manifest.endpoint,
                manifest.secret_env,
                manifest.secret_param,
                manifest.secret_in,
                manifest.secret_prefix,
                request_json,
                request_query,
                inputs_json,
                outputs_json,
                manifest.cost_per_call_usd,
                manifest.ttl_seconds,
                manifest.docs_url,
                now,
                created_by,
                now,
            ),
        )
        conn.commit()
    materialized = get_manifest(db=db, connector_id=manifest.connector_id)
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def delete_manifest(*, db: Database, connector_id: str) -> bool:
    with db.connection() as conn:
        cur = conn.execute(
            "DELETE FROM connector_manifests WHERE connector_id = ?",
            (connector_id,),
        )
        conn.commit()
        return cur.rowcount > 0
