# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for the integration seam (ADR-0057, L1).

Wire shapes are normative in `docs/specs/integration-contract.md` §§2–3;
field names here match the spec exactly (snake_case, the public surface).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_VERSION = "1.0"

TracePolicy = Literal["none", "summary", "full"]

# Descriptor advertises what the events endpoint (L3) will accept, so the
# integrator can build its outbox against the contract from day one.
ACCEPTED_EVENT_KINDS = ("sent", "quoted", "bound", "declined", "lost", "corrected")


class CatalogField(BaseModel):
    """One field of the peer's canonical vocabulary, uploaded at pairing.
    What the Hub's mapper shows humans (labels), and what auto-match
    consumes (keys, dtypes, units, examples)."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(..., min_length=1, max_length=200)
    label: str | None = None
    dtype: str | None = None
    unit: str | None = None
    example: Any | None = None


class CreateIntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=200)


class IntegrationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    integration_id: str
    name: str
    peer_name: str | None
    paired: bool
    paired_at: str | None
    created_at: str
    plans_exposed: int = 0
    plans_live: int = 0
    # The pairing receipt + the home card's health facts (Brief 77 §2):
    # how many catalog fields the peer synced, and whether the event feed
    # is erroring — the card must be able to show amber without a click.
    catalog_field_count: int = 0
    events_error: int = 0
    last_event_at: str | None = None


class PairingCodeCreated(BaseModel):
    """The one-time code — the `code` field is the ONLY copy the operator
    will ever see (the server keeps a hash). TTL 10 minutes (§2)."""

    model_config = ConfigDict(extra="forbid")

    code_id: str
    code: str
    expires_at: str


class PairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=1)
    peer_name: str = Field(..., min_length=1, max_length=200)
    catalog: list[CatalogField] = Field(default_factory=list)


class DescriptorFieldSpec(BaseModel):
    """A required/optional field in PEER vocabulary — the load-bearing
    derivation of §3: mapping ∘ plan requirements, so the integrator's
    field tracker steers itself."""

    model_config = ConfigDict(extra="forbid")

    key: str
    dtype: str | None = None
    unit: str | None = None


class DescriptorPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    carrier: str
    plan_ref: str
    product: str | None
    state: str | None
    status: Literal["live", "paused", "unmapped"]
    required_fields: list[DescriptorFieldSpec]
    optional_fields: list[DescriptorFieldSpec]
    trace_policy: TracePolicy
    validity_days: int


class Descriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: str = CONTRACT_VERSION
    integration_id: str
    labs: dict[str, str]
    plans: list[DescriptorPlan]
    events: dict[str, list[str]]


class PairResponse(BaseModel):
    """The exchange's answer — `integrator_key` is shown ONCE."""

    model_config = ConfigDict(extra="forbid")

    integration_id: str
    integrator_key: str
    descriptor: Descriptor


class ExposePlanRequest(BaseModel):
    """POST /integrations/{id}/plans — expose one published plan as a
    carrier (Brief 77 step 2). Mapping starts empty: the plan is
    `unmapped` until the mapper (step 3) covers it."""

    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str = Field(..., min_length=1)
    carrier_label: str = Field(..., min_length=1, max_length=128)
    trace_policy: TracePolicy = "summary"
    validity_days: int = Field(default=30, ge=1, le=365)


class PatchExposedPlanRequest(BaseModel):
    """PATCH /integrations/{id}/plans/{exposed_id} — the Hub's edits:
    label, policies, the live switch, and (L5's mapper) the mapping."""

    model_config = ConfigDict(extra="forbid")

    carrier_label: str | None = Field(default=None, min_length=1, max_length=128)
    trace_policy: TracePolicy | None = None
    validity_days: int | None = Field(default=None, ge=1, le=365)
    live: bool | None = None
    mapping: list["MappingEntry"] | None = None


class AllowedValue(BaseModel):
    """One legal value for a consumed input whose lookups are keyed on an
    enumerable dimension — `value` is what the engine accepts (the level
    id / cell key), `label` is the human name the Hub shows beside it."""

    model_config = ConfigDict(extra="forbid")

    value: str
    label: str | None = None


class ConsumedInput(BaseModel):
    """One input the published plan declares (an `input_node` stage with
    `source: "form"`) — the mapper's LEFT column. Connector-sourced
    inputs are filled by Routes (Brief 48), never by the peer, so they
    don't appear here."""

    model_config = ConfigDict(extra="forbid")

    key: str
    label: str | None = None
    dtype: str | None = None
    required: bool = False
    mapped_from: str | None = None  # the peer key covering it, when mapped
    # The value transparency seam (Brief 77 §8.5 erratum 2): when the
    # input feeds enumerable lookups, these are the ONLY values the
    # published version will accept — the Test form offers them as a
    # picker and the mapper warns when the peer's example isn't one.
    # None = free-form (banded numerics, classification, geo, text).
    allowed_values: list[AllowedValue] | None = None


class TestQuoteRequest(BaseModel):
    """POST …/plans/{exposed_id}/test-quote — the Hub's in-app try-it
    (operator session, Brief 77 step 5). PEER-vocabulary facts, exactly
    what the peer would send; the same composer path answers."""

    model_config = ConfigDict(extra="forbid")

    facts: dict[str, Any] = Field(default_factory=dict)


class ExposedPlanOut(BaseModel):
    """One exposed plan as the Hub renders it — the internal read model
    plus the plan's display facts and the derived journey status."""

    model_config = ConfigDict(extra="forbid")

    exposed_id: str
    rating_plan_id: str
    plan_display_name: str | None
    product: str | None
    state: str | None
    published: bool
    # The CURRENT published version — what the test receipt is compared
    # against (the republish tripwire). The version NAME is for operator
    # copy; the snapshot id is payload-only audit data (Brief 77 §1).
    published_snapshot_id: str | None = None
    published_version_name: str | None = None
    plan_ref: str
    carrier_label: str
    mapping: list["MappingEntry"]
    required_mapped: int
    optional_mapped: int
    consumed_required: int  # required form inputs the published plan declares
    consumed_missing: int  # …of those, how many the mapping doesn't cover yet
    trace_policy: TracePolicy
    validity_days: int
    live: bool
    # The Hub's journey vocabulary (Brief 77 step 2). The DESCRIPTOR wire
    # keeps the spec §3 triad (live | paused | unmapped) — this richer
    # ladder is the operator-facing read model only. Coverage gaps demote
    # BOTH to `unmapped` (one derivation, two vocabularies).
    status: Literal["unmapped", "mapped", "tested", "live"]
    # Republish-drift signal (audit 2026-07-11 gap #3): the live toggle is
    # ON but the currently-published version is not the one that passed its
    # Hub mapping test, so the seam has DEMOTED it from serving until a
    # re-test. `status` still reads `live` (the toggle); this flag is why it
    # isn't serving. On the descriptor wire the same drift reads as `paused`.
    live_version_untested: bool = False
    last_test_at: str | None = None
    last_test_premium_cents: int | None = None
    last_test_snapshot_id: str | None = None
    last_test_version_name: str | None = None
    created_at: str


class PlanConnectionOut(BaseModel):
    """One integration's view of ONE plan — a row on the Ship tab's
    Connect card (Brief 84 D-D). Wraps the Hub's own read model so the
    two surfaces can never disagree about the journey."""

    model_config = ConfigDict(extra="forbid")

    integration_id: str
    integration_name: str
    paired: bool
    exposed: ExposedPlanOut


class PlanConnectionsOut(BaseModel):
    """Brief 84 D-D — the plan-side view of the seam: which apps serve
    this plan, and how far along each journey is. Read-only; the Hub
    stays the write surface. `any_integration` / `any_paired` feed the
    card's empty states (and Home's don't-nag gate): an API-only shop
    with no integrations is never told to connect one."""

    model_config = ConfigDict(extra="forbid")

    any_integration: bool
    any_paired: bool
    connections: list[PlanConnectionOut] = Field(default_factory=list)


class IntegrationPulse(BaseModel):
    """Step 6's strip — health, not analytics (the ADR-0049 fence).
    Quote counts deliberately absent: quoting writes nothing (D-A), so
    OpenRater has no quote log to count. Events are the durable feed."""

    model_config = ConfigDict(extra="forbid")

    plans_exposed: int
    plans_live: int
    events_applied: int
    events_duplicate: int
    events_error: int
    last_event_at: str | None


class RequestPins(BaseModel):
    """§4.6 (ADR-0060 rule 8) — the pinned re-rate: quote ONE exposed plan
    at a NAMED frozen version instead of the live fan-out. The PAS's
    canonical use: a mid-term endorsement re-rated at the version in force
    at inception — the snapshot the placement's `quote_pins` recorded."""

    model_config = ConfigDict(extra="forbid")

    plan_ref: str = Field(..., min_length=1, max_length=128)
    snapshot_id: str = Field(..., min_length=1, max_length=128)


class QuoteSetRequest(BaseModel):
    """§4.1 — one pseudonymous risk, quoted across exposed plans. `facts`
    speak PEER vocabulary; the composer applies each plan's mapping.
    `locations` is reserved (ADR-0057 resolution 5 — policy quotes are
    v1.1); a non-null value is refused honestly. `pins` (§4.6) narrows the
    fan-out to one plan at one frozen version — the pinned re-rate."""

    model_config = ConfigDict(extra="forbid")

    risk_ref: str = Field(..., min_length=1, max_length=200)
    request_hash: str | None = None
    effective_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    as_of: str | None = None
    carriers: list[str] | None = None
    trace: TracePolicy = "summary"
    facts: dict[str, Any] = Field(default_factory=dict)
    locations: None = None
    pins: RequestPins | None = None


class QuoteSetVersion(BaseModel):
    """The member's replay pins (§4.2 rule 5). `content_hash` is the
    published body's own hash — the premium is reproducible forever."""

    model_config = ConfigDict(extra="forbid")

    kind: str
    snapshot_id: str | None = None
    content_hash: str | None = None


class QuoteSetMember(BaseModel):
    """One carrier's answer — the Brief-76 body plus the seam's pins.
    Law 2 all the way through: premium is null on refusal or named gaps,
    never $0, never fabricated."""

    model_config = ConfigDict(extra="forbid")

    carrier: str
    plan_ref: str
    version: QuoteSetVersion | None = None
    row_status: Literal["ok", "error"]
    premium: float | None = None
    tier: str | None = None
    outputs: dict[str, Any] = Field(default_factory=dict)
    composed: dict[str, Any] | None = None
    row_issues: list[dict[str, Any]] | None = None
    plan_issues: list[dict[str, Any]] | None = None
    input_issues: dict[str, Any] | None = None
    trace: dict[str, Any] | None = None
    trace_granted: TracePolicy | None = None
    valid_until: str | None = None


class QuoteSetResponse(BaseModel):
    """§4.2 — `quotes` ordered by carrier label ascending (normative);
    `issues` carries integration-level notes (unknown carrier, paused
    plan, nothing published) so partial failure stays honest."""

    model_config = ConfigDict(extra="forbid")

    risk_ref: str
    request_hash: str | None = None
    as_of: str
    contract_version: str = CONTRACT_VERSION
    quotes: list[QuoteSetMember] = Field(default_factory=list)
    issues: list[dict[str, Any]] = Field(default_factory=list)


class MappingEntry(BaseModel):
    """One key-to-key mapping row (ADR-0057 D3 — no transforms).
    `required` mirrors whether the plan input it feeds is required;
    the descriptor's required_fields derive from it."""

    model_config = ConfigDict(extra="forbid")

    peer_key: str
    plan_input_key: str
    dtype: str | None = None
    unit: str | None = None
    required: bool = False


class ExposedPlan(BaseModel):
    """Internal read model of one exposed plan (not a wire shape)."""

    model_config = ConfigDict(extra="forbid")

    exposed_id: str
    integration_id: str
    rating_plan_id: str
    plan_ref: str
    carrier_label: str
    mapping: list[MappingEntry]
    trace_policy: TracePolicy
    validity_days: int
    live: bool
    last_test_at: str | None = None
    last_test_premium_cents: int | None = None
    last_test_snapshot_id: str | None = None
    created_at: str
