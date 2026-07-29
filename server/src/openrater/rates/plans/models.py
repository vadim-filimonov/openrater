# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Top-level typed contracts for the RatingPlan substrate.

These are the kind-agnostic shapes the Engine and the repository operate
on. Per-kind config shapes live in `configs.py` and are discriminated
by `Stage.stage_kind` via Pydantic's discriminated-union pattern.

Naming:

    RatingPlan          — the data (one row in `rating_plans`)
    Stage               — one step in a plan (one row in `rating_plan_stages`)
    StageKind           — closed enum of the 13 active + 2 reserved kinds
    StageInput          — declared upstream read (one row in `..._inputs`)
    StageOutput         — declared downstream-readable value (one row in `..._outputs`)
    StageTrace          — per-stage trace fragment produced by a handler
    FactorApplication   — one factor multiplied during a multiplicative chain
    CascadeRun          — the top-level Engine output

Design notes:
  · All shapes are immutable (`frozen=True`). The Engine never mutates.
  · `extra='forbid'` everywhere — drift surfaces at deserialization time.
  · Timestamps use ISO8601 strings to match SQLite's storage format.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ===========================================================================
# Closed enums
# ===========================================================================


class StageKind(StrEnum):
    """Stage kinds the cascade engine handles."""

    # Top-of-DAG input declaration.
    INPUT_NODE = "input_node"

    # Operator-authorable computation primitives.
    FORMULA = "formula"
    CASE_NODE = "case_node"

    # Context-builder kinds (3) — wrap the legacy stage_1/2/3 functions.
    CLASSIFICATION_LOOKUP = "classification_lookup"
    ELIGIBILITY_EVALUATOR = "eligibility_evaluator"
    TERRITORY_RESOLVER = "territory_resolver"

    # Math primitives (5) — generic, composable.
    MULTIPLICATIVE_CHAIN = "multiplicative_chain"
    ADDITIVE = "additive"
    FLAT_FACTOR = "flat_factor"
    CLAMP = "clamp"
    ROUND = "round"

    # Special (1) — explicit "not yet priced" stub.
    DEFERRED_ZERO = "deferred_zero"

    # IRPM (1) — kind-specific wrapper around legacy IRPM helper.
    IRPM_APPLY = "irpm_apply"

    # Phase G G1 — Gate workspace substrate. Five dotted kinds mirror
    # the @openrater/contracts shapes (eligibility-gate.ts /
    # modifier-schedule.ts / endorsement.ts). Each is executed by the
    # frontend runtime today (V17 conformance proves the endorsement
    # chain); persistence here lets the GateCanvas's authoring surface
    # round-trip through the API instead of leaking into localStorage.
    #
    # The legacy `eligibility_evaluator` kind above stays for backward
    # compat (its config is a different shape — it points at a legacy
    # engine ref + a halt-disposition list, not the rule-list shape the
    # GateCanvas authors).
    ELIGIBILITY_GATE = "eligibility.gate"
    MODIFIER_SCHEDULE = "modifier.schedule"
    ENDORSEMENT_FACTOR = "endorsement.factor"
    ENDORSEMENT_ADDITIVE = "endorsement.additive"
    ENDORSEMENT_SUBLIMIT = "endorsement.sublimit"

    # Phase G G4 — endorsement-branching (Brief 40, locked 2026-05-26).
    # An auto-attached endorsement whose trigger fires runs an embedded
    # mini rating chain. The chain's output is added to the policy
    # premium post-base-chain, pre-modifier. See Brief 40 §1.
    ENDORSEMENT_RATE_BRANCH = "endorsement.rate_branch"
    # Phase G G5 — model-wrapped IRPM (Brief 41, locked 2026-05-26).
    # A schedule modifier whose factor is the (clamped) output of an
    # ML model. Until Model Lab ships, runtime stays the model.rating
    # stub returning 1.0 + the clamp passes through. See Brief 41 §1.
    MODIFIER_MODEL = "modifier.model"

    # Reserved — handlers raise NotImplementedError until their ADR lands.
    ML_MODEL = "ml_model"
    API_ENRICHMENT = "api_enrichment"


class LineOfBusiness(StrEnum):
    """The closed LOB enum. Mirrors the SQL CHECK constraint.

    @deprecated (ADR-0033) — conflated with the product axis. Being
    superseded by `ProductCode` below; kept as a read-only shim for one
    release while the frontend cutover (gates 3-5) lands. New code should
    read/write `RatingPlan.product`.
    """

    BOP = "bop"
    CGL = "cgl"
    WC = "wc"
    AUTO = "auto"
    UMBRELLA = "umbrella"


class ProductCode(StrEnum):
    """The PRODUCT axis (ADR-0033 §1). Mirrors `@openrater/contracts`
    `ProductCode` + the SQL CHECK constraint in migration 013.

    De-conflates the legacy `LineOfBusiness`/`LineCode`: splits
    `professional` into `do` + `eo`, drops the `liability`/`property`
    *coverages* (those move to the Coverage entity). `do`/`eo` are simply
    catalog entries — `bop`/`cgl`/`wc`/`auto` are equal first-class peers.

    GENERICITY (ADR-0033 §0): an opaque tag. No backend logic branches on
    a specific product — adding a line of business is one entry here +
    one SQL CHECK value, never a pipeline patch.
    """

    BOP = "bop"
    CGL = "cgl"
    DO = "do"
    EO = "eo"
    WC = "wc"
    AUTO = "auto"
    UMBRELLA = "umbrella"
    EXCESS = "excess"
    MARINE = "marine"
    INLAND_MARINE = "inland_marine"
    # Brief 94.6 (owner-gated, confirmed 2026-07-16) — personal lines:
    # an HO-3 / DP-3 filing lands as itself, not `other`.
    HOMEOWNERS = "homeowners"
    DWELLING = "dwelling"
    OTHER = "other"


class PlanStatus(StrEnum):
    """RatingPlan lifecycle. Mirrors the SQL CHECK constraint."""

    DRAFT = "draft"
    PROPOSED = "proposed"
    ACTIVE = "active"
    ARCHIVED = "archived"


class InputSource(StrEnum):
    """How a stage's declared input is resolved at runtime."""

    CONTEXT = "context"
    """Output of a context-builder stage (1-3) on this plan."""

    STAGE_OUTPUT = "stage_output"
    """Output of a math stage upstream of this one."""

    FORM_INPUT = "form_input"
    """Operator-supplied scalar / location field."""

    LITERAL = "literal"
    """A constant baked into the plan. Rare; usually inline in config."""


# `data_type` is shared between StageInput and StageOutput.
DataType = Literal["number", "string", "bool", "enum", "array", "object"]


# ===========================================================================
# Stage IO declarations
# ===========================================================================


class StageInput(BaseModel):
    """One declared upstream read for a stage.

    Mirrors `rating_plan_stage_inputs` rows. Every stage MUST declare
    every value it reads from the cascade context — the Engine does not
    permit implicit lookups.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    input_name: str = Field(..., min_length=1, max_length=80)
    """Local name within the stage's config_json."""

    input_source: InputSource
    input_path: str = Field(..., min_length=1, max_length=200)

    data_type: DataType
    required: bool = True
    default_value: str | None = None
    """JSON-encoded default if `required=False` and the upstream is absent."""


class StageOutput(BaseModel):
    """One declared downstream-readable value produced by a stage.

    Mirrors `rating_plan_stage_outputs` rows.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    output_name: str = Field(..., min_length=1, max_length=80)
    data_type: DataType
    description: str | None = None


# ===========================================================================
# Stage row (one position in a plan)
# ===========================================================================


class Stage(BaseModel):
    """One stage in a rating plan. Mirrors `rating_plan_stages`.

    `config_json` is the per-kind Pydantic configuration as a dict; the
    Engine validates it against the right config shape (per `kind`) at
    handler-dispatch time.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    stage_id: str = Field(..., min_length=1, max_length=80)
    """Short slug. Stable across plan revisions; position in the DAG is `sequence`."""

    sequence: int = Field(..., ge=1)
    """1-indexed, dense within the plan."""

    stage_kind: StageKind
    """One of the active or reserved kinds."""

    display_name: str = Field(..., min_length=1, max_length=120)
    config_json: dict[str, Any] = Field(default_factory=dict)
    """Per-kind config blob. Validated at handler-dispatch time."""

    citation_rule: str | None = None
    citation_page: str | None = None
    source_filing_id: str | None = None
    """Top-level citation. Per-factor citations live inside `config_json`."""

    # Operator-driven canvas coordinates. None means "use dagre auto-layout."
    x_position: float | None = None
    y_position: float | None = None


# ===========================================================================
# Plan row (top-level identity)
# ===========================================================================


class RatingPlan(BaseModel):
    """One rating plan. Mirrors `rating_plans`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    """Slug identifier (e.g., 'sample_bop_wi_2025_baseline')."""

    display_name: str = Field(..., min_length=1, max_length=200)
    line_of_business: LineOfBusiness
    """@deprecated (ADR-0033) — use `product`. Kept required for one
    release as the read-only shim; the migration backfills `product`
    from it."""

    product: ProductCode | None = None
    """The product axis (ADR-0033 §1). Nullable during the additive
    migration window: backfilled from `line_of_business` for existing
    plans (migration 013) and set explicitly by create-plan once the
    frontend cutover (gate 3) lands. Joins the content_hash."""

    jurisdiction: str | None = Field(default=None, min_length=2, max_length=2)
    """Two-letter state code, or None for multistate plans."""

    effective_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    """ISO8601 'YYYY-MM-DD'."""

    @field_validator("effective_date")
    @classmethod
    def _effective_date_is_a_real_calendar_date(cls, v: str) -> str:
        """The pattern only checks digit shape, so an impossible date like
        `2025-13-99` (month 13, day 99) passed and persisted (audit
        A-2026-07-12 P1-16). Validate it's an actual calendar date."""
        try:
            date.fromisoformat(v)
        except ValueError as exc:
            raise ValueError(
                f"{v!r} is not a real calendar date (YYYY-MM-DD)."
            ) from exc
        return v

    description: str | None = None
    parent_plan_id: str | None = None
    """When set, inherits stages from parent + applies overrides."""

    status: PlanStatus = PlanStatus.DRAFT
    source_filing_id: str | None = None
    """The filing this plan implements (None for synthetic plans)."""

    created_at: str = Field(..., min_length=1)
    """ISO8601 timestamp."""

    # -------------------------------------------------------------
    # v4 V.1 — entity-native plan persistence
    # -------------------------------------------------------------

    template_id: str | None = None
    """Stable id of the PlanTemplate this plan was created from."""

    coverages: tuple[str, ...] | None = None
    """Coverage ids declared by the template at create time."""

    section_layout: dict[str, list[str]] | None = None
    """Per-section component bindings: {section_id: [component_ids]}."""

    last_edited_at: str | None = None
    """ISO8601 timestamp of the most recent mutation."""

    # -------------------------------------------------------------
    # v4 V.1 — content-addressable hash (ADR-0015)
    # -------------------------------------------------------------

    content_hash: str | None = Field(default=None, max_length=16)
    """16-char SHA-256 hex prefix of the plan's canonical JSON."""


# ===========================================================================
# Trace + run output (what the Engine produces)
# ===========================================================================


class FactorApplication(BaseModel):
    """One factor multiplied during a multiplicative chain."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    factor_kind: str
    factor_value: float
    factor_unit: str
    """'multiplier' | 'usd' | 'usd_per_100' | 'pct' | etc."""

    running_total_before: float
    running_total_after: float
    citation_rule: str
    citation_page: str
    description: str


class StageTrace(BaseModel):
    """Per-stage trace fragment. The Engine concatenates these into
    `CascadeRun.stages[]`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage_id: str
    stage_kind: StageKind
    display_name: str
    summary: str
    factor_applications: tuple[FactorApplication, ...] = ()
    notes: tuple[str, ...] = ()
    running_total_after: float | None = None
    output: Mapping[str, Any] = Field(default_factory=dict)


class CascadeRun(BaseModel):
    """Top-level Engine output."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str
    stages: tuple[StageTrace, ...]
    final_premium_usd: float = 0.0
    halted: bool = False
    halt_reason: str | None = None
    metadata: Mapping[str, Any] = Field(default_factory=dict)


__all__ = [
    "CascadeRun",
    "DataType",
    "FactorApplication",
    "InputSource",
    "LineOfBusiness",
    "PlanStatus",
    "RatingPlan",
    "Stage",
    "StageInput",
    "StageKind",
    "StageOutput",
    "StageTrace",
]
