# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Typed shapes for API Lab connectors (Brief 47).

The model is generic by design (the whole point of the refactor):

  · A `ConnectorManifest` describes an external API as DATA — endpoint, auth,
    how to build the request from inputs, and how to extract output ports.
    Adding a vendor is a new manifest, not new Python.
  · A connector returns RAW facts only. It does NOT interpret them for rating
    (ZIP→territory etc. is the Plan's geographic dimension's job).
  · An `EnrichmentSnapshot` immutably captures each call (reproducibility seam).
  · A `FieldMapping` binds a connector output port → a Plan input key. Mapping
    is configuration, persisted, generic across connectors and plans.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ConnectorCategory = Literal[
    "address_geo", "identity", "property_peril", "iso_verisk", "wages", "llm", "custom"
]
DataType = Literal["string", "number", "boolean", "object", "array"]
# Where a connector came from: a code-bundled manifest (read-only in the UI) or
# one a user authored through the studio (editable, persisted in the DB).
ConnectorSource = Literal["bundled", "user"]


class InputParam(BaseModel):
    """A value a connector needs to run (a `{{name}}` slot in its request)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=80)
    data_type: DataType = "string"
    required: bool = True
    default: str | None = Field(default=None, max_length=200)
    example: str | None = Field(default=None, max_length=200)
    description: str = Field(default="", max_length=400)


class OutputPort(BaseModel):
    """A RAW fact a connector produces, extracted from the response via a dotted
    `json_path` (e.g. `result.address.postalAddress.postalCode`)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=80)
    data_type: DataType = "string"
    json_path: str = Field(..., min_length=1, max_length=400)
    description: str = Field(default="", max_length=400)
    # Brief 50 — name of an INPUT param this output echoes back (e.g. a
    # `matched_name` that should resemble the `query` searched). When set, the
    # Route test-run UI shows a name-similarity confidence badge so the user can
    # catch a wrong match (the fuzzy-lookup-found-the-wrong-org bug) before
    # pushing. Vendor-agnostic: any connector can declare it.
    echo_of: str | None = Field(default=None, max_length=80)


class ConnectorManifest(BaseModel):
    """A connector declared as data. The generic `RestConnector` runs any
    manifest; only odd APIs need bespoke code."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    connector_id: str = Field(..., pattern=r"^[a-z0-9][a-z0-9_-]{0,79}$")
    display_name: str = Field(..., min_length=1, max_length=200)
    vendor: str = Field(..., min_length=1, max_length=80)
    category: ConnectorCategory = "custom"
    kind: Literal["rest"] = "rest"
    version: str = Field(default="v1", max_length=40)
    method: Literal["GET", "POST"] = "POST"
    endpoint: str = Field(..., min_length=1, max_length=600)
    # Auth: the secret VALUE lives in an env var (never in the manifest); it's
    # injected at call time and never snapshotted. `secret_param` names WHERE it
    # goes — a query-param name when `secret_in="query"` (the default, e.g.
    # `key`), or a request-HEADER name when `secret_in="header"` (e.g.
    # `Authorization`, `X-API-Key`). `secret_prefix` is prepended to the value,
    # so a Bearer scheme is `secret_in="header"`, `secret_param="Authorization"`,
    # `secret_prefix="Bearer "`. E05.
    secret_env: str | None = Field(default=None, max_length=120)
    secret_param: str | None = Field(default=None, max_length=80)
    secret_in: Literal["query", "header"] = "query"
    secret_prefix: str | None = Field(default=None, max_length=40)
    # Request templates with `{{input}}` placeholders.
    request_json: dict[str, Any] | None = None
    request_query: dict[str, str] = Field(default_factory=dict)
    inputs: list[InputParam] = Field(default_factory=list)
    outputs: list[OutputPort] = Field(default_factory=list)
    cost_per_call_usd: float = Field(default=0.0, ge=0.0)
    ttl_seconds: int = Field(default=0, ge=0)
    docs_url: str | None = Field(default=None, max_length=400)


class ConnectorInfo(BaseModel):
    """The public view of a connector for the UI — the manifest minus internals,
    plus a runtime `configured` flag (is its secret present?)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    connector_id: str
    display_name: str
    vendor: str
    category: ConnectorCategory
    version: str
    inputs: list[InputParam]
    outputs: list[OutputPort]
    cost_per_call_usd: float
    requires_secret: str | None
    # E06 — whether this connector requires an API key at all (declares
    # `secret_param`/`secret_env`). The UI uses `needs_secret` + `configured` to
    # render "Add key" vs "Key set ✓".
    needs_secret: bool = False
    configured: bool
    docs_url: str | None
    source: ConnectorSource = "bundled"


class ConnectorListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    connectors: list[ConnectorInfo] = Field(default_factory=list)
    # E06 — whether the server can store in-product API keys (RATER_SECRETS_KEY is
    # set). When false, the studio guides the operator to configure the vault
    # instead of letting a key be typed and then failing on save.
    vault_available: bool = False


# --- HTTP capture + snapshot (the reproducibility seam) ----------------------


class HttpRequest(BaseModel):
    """The outbound request we keep. Secrets are NEVER in here."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    method: str = "POST"
    url: str
    params: dict[str, str] = Field(default_factory=dict)
    json_body: dict[str, Any] | None = None


class HttpResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status_code: int
    json_body: dict[str, Any] = Field(default_factory=dict)


class EnrichmentSnapshot(BaseModel):
    """Immutable capture of one connector call (Brief 47 §4.4)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_id: str = Field(..., min_length=1, max_length=80)
    connector_id: str
    connector_version: str
    request: HttpRequest
    response: HttpResponse
    status_code: int
    vendor_request_id: str | None = None
    fetched_at: str
    content_hash: str = Field(..., min_length=16, max_length=80)
    cost_usd: float = Field(default=0.0, ge=0.0)


# --- generic invoke envelopes ------------------------------------------------


class ConnectorInvokeRequest(BaseModel):
    """Body for POST /connectors/{id}/invoke."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    inputs: dict[str, Any] = Field(default_factory=dict)


class ConnectorInvokeResponse(BaseModel):
    """The raw outputs of one connector run + its snapshot. No interpretation."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    connector_id: str
    outputs: dict[str, Any]
    snapshot_id: str
    status_code: int
    cost_usd: float
    vendor_request_id: str | None = None


# --- connector authoring (the no-code studio) --------------------------------


class TestConnectorRequest(BaseModel):
    """Body for POST /connectors/test — run a DRAFT (unsaved) manifest against
    example inputs so the studio can show the raw response to click-extract from.
    No snapshot is persisted (the draft has no id yet)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    manifest: ConnectorManifest
    inputs: dict[str, Any] = Field(default_factory=dict)
    # E06 — the just-typed API key (before the connector is saved), so the
    # studio's "Run test call" can authenticate without first persisting it.
    # Write-only: never logged or echoed back.
    secret_value: str | None = None


class TestConnectorResponse(BaseModel):
    """The raw response of a draft test + any outputs the declared ports extract.
    `error` is set (instead of raising) for configuration/upstream failures so the
    studio can show an inline hint without a thrown request."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    status_code: int | None = None
    response_json: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class SetSecretRequest(BaseModel):
    """Body for PUT /connectors/{id}/secret — the actual API key to encrypt + store
    in the vault (E06). Write-only: the value is never returned by any endpoint."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    value: str = Field(..., min_length=1, max_length=4096)


# --- Routes (Brief 48): plan input vars → a Connection → push outputs back ----


class RouteBinding(BaseModel):
    """A connection parameter ← one of the plan's input variables (drag result)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    param_name: str = Field(..., min_length=1, max_length=80)
    plan_input_key: str = Field(..., min_length=1, max_length=120)


class RoutePush(BaseModel):
    """A connection output → a plan input variable to fill (push-back)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    output_port: str = Field(..., min_length=1, max_length=80)
    plan_input_key: str = Field(..., min_length=1, max_length=120)


class Route(BaseModel):
    """A plan-scoped route: bind the plan's inputs to a connection, push outputs
    back. Many routes can share one connection."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    route_id: str
    plan_id: str
    connection_id: str
    name: str = Field(..., min_length=1, max_length=160)
    bindings: list[RouteBinding] = Field(default_factory=list)
    pushes: list[RoutePush] = Field(default_factory=list)
    created_at: str
    created_by: str
    updated_at: str


class CreateRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    connection_id: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=160)
    bindings: list[RouteBinding] = Field(default_factory=list)
    pushes: list[RoutePush] = Field(default_factory=list)


class ListRoutesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routes: list[Route] = Field(default_factory=list)


class ApplyRouteRequest(BaseModel):
    """Run a saved route. `values` (plan_input_key → value) override the plan's
    stored input values for this run; unbound params fall back to stored values."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    values: dict[str, Any] = Field(default_factory=dict)
    persist: bool = True


class ResolvedPush(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    plan_input_key: str
    output_port: str
    value: str | float | bool | None


class ApplyRouteResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    route_id: str
    status_code: int | None = None
    resolved: list[ResolvedPush] = Field(default_factory=list)
    snapshot_id: str | None = None
    cost_usd: float = 0.0
    error: str | None = None


class PlanInputValue(BaseModel):
    """A filled plan input — what the Inputs screen shows, with provenance."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    plan_id: str
    input_key: str
    value: str | float | bool | None
    source: str
    snapshot_id: str | None = None
    updated_at: str


class ListInputValuesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    values: list[PlanInputValue] = Field(default_factory=list)
