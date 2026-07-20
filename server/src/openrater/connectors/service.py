# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Connector + route execution (Briefs 47/48) — generic, vendor-agnostic.

`invoke_connector` runs ANY registered connector on caller-supplied inputs and
captures a snapshot. `test_draft_connector` runs an unsaved manifest (the authoring
studio). `apply_route` runs a saved Route and pushes outputs onto the plan's input
values. Nothing interprets the raw facts here — that's the Plan's dimensions' job.
"""

from __future__ import annotations

import json
from typing import Any

from openrater.connectors.base import HttpTransport, httpx_transport, make_snapshot
from openrater.connectors.models import (
    ApplyRouteResponse,
    ConnectorInvokeResponse,
    ConnectorManifest,
    ResolvedPush,
    Route,
    TestConnectorResponse,
)
from openrater.connectors.registry import ConnectorRegistry, default_registry
from openrater.connectors.rest_connector import RestConnector
from openrater.connectors.routes_repo import get_plan_input_value, upsert_plan_input_value
from openrater.connectors.secrets_vault import get_secret
from openrater.connectors.snapshots_repo import insert_snapshot
from openrater.errors import RaterError
from openrater.persistence.db import Database


def _coerce(value: Any) -> str | float | bool | None:
    """Flatten a raw output value to a Plan-input-storable scalar."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    return json.dumps(value, separators=(",", ":"))


async def invoke_connector(
    *,
    db: Database,
    connector_id: str,
    inputs: dict[str, Any],
    registry: ConnectorRegistry | None = None,
    transport: HttpTransport | None = None,
) -> ConnectorInvokeResponse:
    """Run one connector, persist its snapshot, return its raw outputs.

    `transport` is resolved at call time (not bound as a default) so tests can
    monkeypatch `httpx_transport`.
    """
    transport = transport or httpx_transport
    registry = registry or default_registry()
    connector = registry.get(connector_id)

    # E06 — resolve the in-product key from the encrypted vault (None ⇒ the
    # connector falls back to its env var inside `_secrets`).
    secret_value = get_secret(db=db, connector_id=connector_id)
    run = await connector.execute(inputs, transport=transport, secret_value=secret_value)
    snapshot = make_snapshot(connector.manifest, run)
    insert_snapshot(db=db, snapshot=snapshot)

    return ConnectorInvokeResponse(
        connector_id=connector_id,
        outputs=run.outputs,
        snapshot_id=snapshot.snapshot_id,
        status_code=run.response.status_code,
        cost_usd=connector.manifest.cost_per_call_usd,
        vendor_request_id=run.vendor_request_id,
    )


async def test_draft_connector(
    *,
    manifest: ConnectorManifest,
    inputs: dict[str, Any],
    secret_value: str | None = None,
    transport: HttpTransport | None = None,
) -> TestConnectorResponse:
    """Run a DRAFT (unsaved) connector against example inputs; return the raw
    response + the outputs its declared ports extract. No snapshot is persisted
    (the draft has no id). Config / upstream / missing-input failures are returned
    as `error` (not raised) so the studio shows an inline hint instead of a thrown
    request. The secret is still injected from env at call time (never echoed)."""
    transport = transport or httpx_transport
    connector = RestConnector(manifest)
    try:
        run = await connector.execute(inputs, transport=transport, secret_value=secret_value)
    except RaterError as exc:
        return TestConnectorResponse(ok=False, error=exc.message)
    return TestConnectorResponse(
        ok=True,
        status_code=run.response.status_code,
        response_json=run.response.json_body,
        outputs=run.outputs,
    )


async def apply_route(
    *,
    db: Database,
    route: Route,
    values: dict[str, Any],
    persist: bool,
    operator: str,
    registry: ConnectorRegistry,
    transport: HttpTransport | None = None,
) -> ApplyRouteResponse:
    """Run a saved route: resolve each bound param from `values` (else the plan's
    stored input value), invoke the connection, snapshot, and push outputs back to
    the plan's input values (when `persist`). Connection/upstream failures are
    returned as `error`, not raised."""
    transport = transport or httpx_transport
    connection = registry.get(route.connection_id)
    secret_value = get_secret(db=db, connector_id=route.connection_id)

    inputs: dict[str, Any] = {}
    for b in route.bindings:
        v = values.get(b.plan_input_key)
        if v in (None, ""):
            stored = get_plan_input_value(db=db, plan_id=route.plan_id, input_key=b.plan_input_key)
            v = stored.value if stored else None
        if v not in (None, ""):
            inputs[b.param_name] = v

    try:
        run = await connection.execute(inputs, transport=transport, secret_value=secret_value)
    except RaterError as exc:
        return ApplyRouteResponse(ok=False, route_id=route.route_id, error=exc.message)

    snapshot = make_snapshot(connection.manifest, run)
    insert_snapshot(db=db, snapshot=snapshot)

    resolved: list[ResolvedPush] = []
    for p in route.pushes:
        value = _coerce(run.outputs.get(p.output_port))
        resolved.append(
            ResolvedPush(plan_input_key=p.plan_input_key, output_port=p.output_port, value=value)
        )
        if persist:
            upsert_plan_input_value(
                db=db,
                plan_id=route.plan_id,
                input_key=p.plan_input_key,
                value=value,
                source=f"Route · {connection.manifest.display_name} · {p.output_port}",
                snapshot_id=snapshot.snapshot_id,
                updated_by=operator,
            )

    return ApplyRouteResponse(
        ok=True,
        route_id=route.route_id,
        status_code=run.response.status_code,
        resolved=resolved,
        snapshot_id=snapshot.snapshot_id,
        cost_usd=connection.manifest.cost_per_call_usd,
    )


__all__ = [
    "invoke_connector",
    "test_draft_connector",
    "apply_route",
    "default_registry",
]
