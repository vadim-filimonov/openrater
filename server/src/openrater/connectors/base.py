# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Connector base — the protocol every connector implements + the snapshot seam.

Connectors are IMPURE (network) so they live in the enrichment phase, not the
rating DAG. Each call is captured as an immutable `EnrichmentSnapshot`; rating
consumes the snapshot, keeping the premium pure + replayable (Brief 47 §1).

Testability: `execute` takes an injected `HttpTransport`. Production wires
`httpx_transport`; tests inject a fake that replays a recorded response, so the
suite never touches the network.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

from openrater.connectors.models import (
    ConnectorInfo,
    ConnectorManifest,
    ConnectorSource,
    EnrichmentSnapshot,
    HttpRequest,
    HttpResponse,
)


@dataclass(frozen=True)
class ConnectorSecrets:
    """Secret material to inject at call time, keyed by placement (E05).

    `query` entries merge into the query string; `headers` entries merge into the
    request headers. Either may carry the API key depending on the manifest's
    `secret_in`. NEVER snapshotted — secrets stay out of `HttpRequest`."""

    query: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)


# An injected async HTTP caller. Production = httpx; tests = a fake. The second
# arg is the secret material (the API key) injected at call time — by placement
# (query vs header) — and never snapshotted.
HttpTransport = Callable[[HttpRequest, ConnectorSecrets], Awaitable[HttpResponse]]

_REDACTED = "***redacted***"
_SECRET_PARAMS = frozenset({"key", "api_key", "apikey", "token", "access_token"})


@dataclass(frozen=True)
class ConnectorRun:
    """A connector's execute() result: parsed RAW outputs + the request/response
    (key already excluded) for snapshotting."""

    outputs: dict[str, Any]
    request: HttpRequest
    response: HttpResponse
    vendor_request_id: str | None = None


class Connector(Protocol):
    """The shape every connector implements (P-N2 typed I/O, P-N3 stable id)."""

    @property
    def manifest(self) -> ConnectorManifest: ...

    async def execute(
        self,
        inputs: dict[str, Any],
        *,
        transport: HttpTransport,
        secret_value: str | None = None,
    ) -> ConnectorRun: ...


def connector_info(
    manifest: ConnectorManifest,
    *,
    source: ConnectorSource = "bundled",
    secret_set: bool = False,
) -> ConnectorInfo:
    """Public view of a connector for the UI + a runtime `configured` flag.

    `source` tells the UI whether this connector is code-bundled (read-only) or
    user-authored (editable / deletable via the studio). `secret_set` is whether
    an in-product API key is stored for it in the vault (E06).

    A connector "needs a secret" when it declares where to put one
    (`secret_param`) or names an env var (`secret_env`). It's "configured" when
    no key is needed, OR a vault key is set, OR its env var is present."""
    needs_secret = bool(manifest.secret_param) or bool(manifest.secret_env)
    env_present = bool(manifest.secret_env) and bool(os.environ.get(manifest.secret_env))
    configured = (not needs_secret) or secret_set or env_present
    return ConnectorInfo(
        connector_id=manifest.connector_id,
        display_name=manifest.display_name,
        vendor=manifest.vendor,
        category=manifest.category,
        version=manifest.version,
        inputs=list(manifest.inputs),
        outputs=list(manifest.outputs),
        cost_per_call_usd=manifest.cost_per_call_usd,
        requires_secret=manifest.secret_env,
        needs_secret=needs_secret,
        configured=configured,
        docs_url=manifest.docs_url,
        source=source,
    )


def redact_params(params: dict[str, str]) -> dict[str, str]:
    return {k: (_REDACTED if k.lower() in _SECRET_PARAMS else v) for k, v in params.items()}


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def new_snapshot_id() -> str:
    return f"es_{uuid4().hex[:12]}"


def content_hash(request: HttpRequest, response: HttpResponse) -> str:
    """Deterministic hash of (request, response). Citation key (P-N4)."""
    canonical = json.dumps(
        {"request": request.model_dump(), "response": response.model_dump()},
        separators=(",", ":"),
        sort_keys=True,
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:48]


def make_snapshot(manifest: ConnectorManifest, run: ConnectorRun) -> EnrichmentSnapshot:
    return EnrichmentSnapshot(
        snapshot_id=new_snapshot_id(),
        connector_id=manifest.connector_id,
        connector_version=manifest.version,
        request=run.request,
        response=run.response,
        status_code=run.response.status_code,
        vendor_request_id=run.vendor_request_id,
        fetched_at=_now_iso(),
        content_hash=content_hash(run.request, run.response),
        cost_usd=manifest.cost_per_call_usd,
    )


async def httpx_transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
    """Production transport. The API key is injected at call time — into the query
    or the headers per the manifest's `secret_in` — but NEVER appears in `request`
    (which is snapshotted)."""
    import httpx

    merged = {**request.params, **secrets.query}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.request(
            request.method,
            request.url,
            params=merged,
            json=request.json_body,
            headers=secrets.headers or None,
        )
        try:
            body = resp.json()
        except ValueError:
            body = {"_raw": resp.text}
        return HttpResponse(status_code=resp.status_code, json_body=body)
