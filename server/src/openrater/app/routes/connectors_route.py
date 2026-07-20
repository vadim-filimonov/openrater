# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""API Lab connectors router (Brief 47) — generic + manifest-driven.

  · GET    /connectors                                  — registry (bundled ⊕ user)
  · POST   /connectors                                  — author a connector (no-code studio)
  · POST   /connectors/test                             — run a DRAFT manifest (no snapshot)
  · GET    /connectors/{id}                             — full manifest (load to edit/clone)
  · PUT    /connectors/{id}                             — update a user-authored connector
  · DELETE /connectors/{id}                             — delete a user-authored connector
  · POST   /connectors/{id}/invoke                      — run any connector → raw outputs
  · GET    /connectors/snapshots/{snapshot_id}          — provenance lookup

Connector errors are `RaterError` subclasses, so they flow through the central
error envelope without per-route try/except. Wiring inputs/outputs to a plan is
the job of Routes (Brief 48); a plan's input variables come from the frontend
`deriveRequiredInputs` (the Inputs-workspace union), not this router.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Request, Response
from fastapi import Path as FPath

from openrater.auth import current_operator
from openrater.connectors.base import connector_info
from openrater.connectors.manifests_repo import delete_manifest, get_manifest, upsert_manifest
from openrater.connectors.models import (
    ConnectorInfo,
    ConnectorInvokeRequest,
    ConnectorInvokeResponse,
    ConnectorListResponse,
    ConnectorManifest,
    EnrichmentSnapshot,
    SetSecretRequest,
    TestConnectorRequest,
    TestConnectorResponse,
)
from openrater.connectors.registry import is_bundled, registry_for
from openrater.connectors.secrets_vault import (
    clear_secret,
    has_secret,
    master_key_available,
    set_secret,
)
from openrater.connectors.service import invoke_connector, test_draft_connector
from openrater.connectors.snapshots_repo import get_snapshot
from openrater.errors import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from openrater.persistence import Database

router = APIRouter(tags=["api-lab connectors"])


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


@router.get("/connectors", response_model=ConnectorListResponse)
async def list_connectors(request: Request) -> ConnectorListResponse:
    """The connector registry — bundled ⊕ user-authored — with each manifest's
    declared inputs + outputs, whether its secret is configured, and its `source`
    (bundled = read-only, user = editable)."""
    db = _resolve_db(request)
    infos = registry_for(db).infos(
        secret_set=lambda cid: has_secret(db=db, connector_id=cid)
    )
    return ConnectorListResponse(connectors=infos, vault_available=master_key_available())


@router.post(
    "/connectors/{connector_id}/invoke",
    response_model=ConnectorInvokeResponse,
)
async def invoke_connector_endpoint(
    request: Request,
    connector_id: Annotated[str, FPath(description="The connector to run.")],
    payload: Annotated[ConnectorInvokeRequest, Body(...)],
) -> ConnectorInvokeResponse:
    """Run a connector on the supplied inputs; capture the snapshot; return the
    RAW outputs. No interpretation — mapping + rating happen downstream."""
    db = _resolve_db(request)
    return await invoke_connector(
        db=db,
        connector_id=connector_id,
        inputs=payload.inputs,
        registry=registry_for(db),
    )


@router.get(
    "/connectors/snapshots/{snapshot_id}",
    response_model=EnrichmentSnapshot,
)
async def get_snapshot_endpoint(
    request: Request,
    snapshot_id: Annotated[str, FPath(description="The enrichment snapshot id.")],
) -> EnrichmentSnapshot:
    """Fetch one snapshot — the 'why did this value resolve?' provenance."""
    db = _resolve_db(request)
    snapshot = get_snapshot(db=db, snapshot_id=snapshot_id)
    if snapshot is None:
        raise NotFoundError(
            f"Snapshot {snapshot_id!r} not found.",
            code="snapshot_not_found",
            param="snapshot_id",
        )
    return snapshot


# --- connector authoring (the no-code studio) --------------------------------


@router.post("/connectors", response_model=ConnectorInfo, status_code=201)
async def create_connector_endpoint(
    request: Request,
    manifest: Annotated[ConnectorManifest, Body(...)],
) -> ConnectorInfo:
    """Persist a user-authored connector. The body IS the manifest (Pydantic
    validates its shape). Built-in ids are reserved; a duplicate user id → PUT to
    update. No secret is stored — `secret_env` is only the NAME of an env var."""
    db = _resolve_db(request)
    if is_bundled(manifest.connector_id):
        raise ConflictError(
            f"{manifest.connector_id!r} is a built-in connector id; choose another.",
            code="connector_id_reserved",
            param="connector_id",
        )
    if get_manifest(db=db, connector_id=manifest.connector_id) is not None:
        raise ConflictError(
            f"A connector with id {manifest.connector_id!r} already exists; "
            "update it with PUT instead.",
            code="connector_exists",
            param="connector_id",
        )
    saved = upsert_manifest(db=db, manifest=manifest, created_by=current_operator())
    return connector_info(saved, source="user")


@router.post("/connectors/test", response_model=TestConnectorResponse)
async def test_connector_endpoint(
    payload: Annotated[TestConnectorRequest, Body(...)],
) -> TestConnectorResponse:
    """Run a DRAFT (unsaved) manifest against example inputs → raw response +
    extracted outputs (for click-to-extract). No snapshot persisted; the secret
    is injected from env at call time and never echoed back."""
    return await test_draft_connector(
        manifest=payload.manifest,
        inputs=payload.inputs,
        secret_value=payload.secret_value,
    )


@router.get("/connectors/{connector_id}", response_model=ConnectorManifest)
async def get_connector_endpoint(
    request: Request,
    connector_id: Annotated[str, FPath(description="The connector to fetch.")],
) -> ConnectorManifest:
    """The full manifest (bundled or user) — what the studio loads to edit/clone."""
    db = _resolve_db(request)
    return registry_for(db).get(connector_id).manifest


@router.put("/connectors/{connector_id}", response_model=ConnectorInfo)
async def update_connector_endpoint(
    request: Request,
    connector_id: Annotated[str, FPath(description="The connector to update.")],
    manifest: Annotated[ConnectorManifest, Body(...)],
) -> ConnectorInfo:
    """Update a user-authored connector. Built-in connectors are read-only
    (duplicate to customize)."""
    db = _resolve_db(request)
    if is_bundled(connector_id):
        raise ForbiddenError(
            f"{connector_id!r} is a built-in connector; duplicate it to customize.",
            code="connector_read_only",
            param="connector_id",
        )
    if manifest.connector_id != connector_id:
        raise BadRequestError(
            "Body connector_id must match the URL.",
            param="connector_id",
        )
    if get_manifest(db=db, connector_id=connector_id) is None:
        raise NotFoundError(
            f"Connector {connector_id!r} not found.",
            code="connector_not_found",
            param="connector_id",
        )
    saved = upsert_manifest(db=db, manifest=manifest, created_by=current_operator())
    return connector_info(saved, source="user")


@router.delete("/connectors/{connector_id}", status_code=204)
async def delete_connector_endpoint(
    request: Request,
    connector_id: Annotated[str, FPath(description="The connector to delete.")],
) -> Response:
    """Delete a user-authored connector. Built-in connectors can't be deleted."""
    db = _resolve_db(request)
    if is_bundled(connector_id):
        raise ForbiddenError(
            f"{connector_id!r} is a built-in connector; it can't be deleted.",
            code="connector_read_only",
            param="connector_id",
        )
    if not delete_manifest(db=db, connector_id=connector_id):
        raise NotFoundError(
            f"Connector {connector_id!r} not found.",
            code="connector_not_found",
            param="connector_id",
        )
    return Response(status_code=204)


# --- connector secrets (the in-product API-key vault, E06) -------------------


@router.put("/connectors/{connector_id}/secret", response_model=ConnectorInfo)
async def set_connector_secret_endpoint(
    request: Request,
    connector_id: Annotated[str, FPath(description="The connector to set a key for.")],
    payload: Annotated[SetSecretRequest, Body(...)],
) -> ConnectorInfo:
    """Encrypt + store an API key for a connector so its calls authenticate
    without an env var (E06). Works for bundled AND user connectors (the shipped
    LightBox becomes UI-configurable). Fails 503 if the server master key
    (RATER_SECRETS_KEY) is unset — fail-safe, a key is never stored in the clear.
    The value is write-only and is never returned by any endpoint."""
    db = _resolve_db(request)
    reg = registry_for(db)
    connector = reg.get(connector_id)  # 404 if the connector is unknown
    set_secret(
        db=db,
        connector_id=connector_id,
        value=payload.value,
        updated_by=current_operator(),
    )  # 503 (SecretsVaultUnavailableError) if the vault master key is unset
    return connector_info(
        connector.manifest, source=reg.source_of(connector_id), secret_set=True
    )


@router.delete("/connectors/{connector_id}/secret", status_code=204)
async def clear_connector_secret_endpoint(
    request: Request,
    connector_id: Annotated[str, FPath(description="The connector to clear the key for.")],
) -> Response:
    """Remove a connector's stored API key. Idempotent (204 even if none set)."""
    db = _resolve_db(request)
    clear_secret(db=db, connector_id=connector_id)
    return Response(status_code=204)
