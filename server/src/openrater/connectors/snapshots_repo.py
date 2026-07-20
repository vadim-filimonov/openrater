# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Persistence for enrichment snapshots — append-only (the audit trail).

Mirrors `openrater.rates.snapshots.repo`: raw SQLite via the `Database` factory,
parametrized SQL, row → model. Insert + get only; snapshots never change.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from openrater.connectors.models import EnrichmentSnapshot, HttpRequest, HttpResponse
from openrater.persistence.db import Database


def insert_snapshot(*, db: Database, snapshot: EnrichmentSnapshot) -> EnrichmentSnapshot:
    """Append-only insert of one snapshot."""
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO connector_snapshots
                (snapshot_id, connector_id, connector_version, request_json,
                 response_json, status_code, vendor_request_id, fetched_at,
                 content_hash, cost_usd)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot.snapshot_id,
                snapshot.connector_id,
                snapshot.connector_version,
                json.dumps(snapshot.request.model_dump(), separators=(",", ":"), sort_keys=True),
                json.dumps(snapshot.response.model_dump(), separators=(",", ":"), sort_keys=True),
                snapshot.status_code,
                snapshot.vendor_request_id,
                snapshot.fetched_at,
                snapshot.content_hash,
                snapshot.cost_usd,
            ),
        )
        conn.commit()
    return snapshot


def get_snapshot(*, db: Database, snapshot_id: str) -> EnrichmentSnapshot | None:
    """Fetch one snapshot (the provenance lookup). None if not found."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT snapshot_id, connector_id, connector_version, request_json,
                   response_json, status_code, vendor_request_id, fetched_at,
                   content_hash, cost_usd
            FROM connector_snapshots
            WHERE snapshot_id = ?
            """,
            (snapshot_id,),
        ).fetchone()
    if row is None:
        return None
    request: dict[str, Any] = json.loads(row["request_json"])
    response: dict[str, Any] = json.loads(row["response_json"])
    return EnrichmentSnapshot(
        snapshot_id=row["snapshot_id"],
        connector_id=row["connector_id"],
        connector_version=row["connector_version"],
        request=HttpRequest(**request),
        response=HttpResponse(**response),
        status_code=row["status_code"],
        vendor_request_id=row["vendor_request_id"],
        fetched_at=row["fetched_at"],
        content_hash=row["content_hash"],
        cost_usd=row["cost_usd"],
    )
