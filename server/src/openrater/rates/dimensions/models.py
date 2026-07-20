# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for plan-scoped dimensions.

These models mirror the frontend's `DimensionRow` shape so the round-
trip is loss-less. `levels` is the union of categorical / banded /
geographic / composite-axis-id; the discriminator is the `kind` field
on each level. Levels round-trip as a list[dict[str, Any]] because
the backend doesn't need to introspect them — it stores + returns
verbatim. The frontend / Engine does the type-narrowing per ADR-0025
+ ADR-0026.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ---------------------------------------------------------------
# Shared shape primitives
# ---------------------------------------------------------------

# `data_type` mirrors the frontend's `DimensionRow.data_type` enum.
# The backend validates the set but doesn't introspect the runtime meaning.
DimDataType = Literal["string", "number", "boolean", "date"]

# `shape` is the ADR-0025 + ADR-0026 dimension shape discriminator.
# When NULL, the frontend defaults to "categorical" (Brief 26 P0).
DimShape = Literal["categorical", "banded", "geographic", "composite"]

# `dimension_type` is the user-facing UI category (separate from shape).
DimensionType = Literal["standard", "geographic", "classification"]

# Brief 44 §3.1 — geographic granularity. NOT NULL when
# `dimension_type='geographic'`, NULL otherwise.
GeoGranularity = Literal["state", "county", "zip"]


# ---------------------------------------------------------------
# Brief 44 — Geographic shape primitives
# ---------------------------------------------------------------


class GeoScopeNational(BaseModel):
    """Whole-country scope. Selects all 51 areas (50 states + DC)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["national"]


class GeoScopeSubset(BaseModel):
    """Explicit subset of states. USPS 2-letter codes, unique + non-empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["subset"]
    states: list[str] = Field(..., min_length=1)


# Discriminated union per Brief 44 §3.1.
GeoScope = GeoScopeNational | GeoScopeSubset


class GeoTerritory(BaseModel):
    """One named bucket grouping levels of a geographic dim.

    `members` is a list of level ids belonging to this territory. The
    runtime resolves a risk's level (e.g., a Wisconsin county) → its
    territory id → the factor table row keyed on territory.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(..., min_length=1, max_length=80)
    label: str = Field(..., min_length=1, max_length=200)
    members: list[str] = Field(default_factory=list)


class DerivedFrom(BaseModel):
    """ADR-0035 (Brief 51) — marks a `structural` dim as DERIVED from a
    classification dim's class attribute. `source_dim` is the slug of the
    classification dim (e.g. 'class_code'); `attribute` is the key into
    each class's `attributes` map (e.g. 'prop_rate_number'). The projector
    inserts a `derive.class_attribute` node from this.

    `override_field` (Brief 83 / TV-19) — optional DECLARED override: the
    submission field whose non-empty value supersedes the class-derived
    attribute (Meridian BOP's `liab_exposure_basis_override` lets an
    occupant-class insured elect the lessors basis). The projector wires
    it onto the derive node's `override` port; absent = unwired = legacy
    graphs unchanged."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source_dim: str = Field(..., min_length=1, max_length=80)
    attribute: str = Field(..., min_length=1, max_length=80)
    override_field: str | None = Field(default=None, min_length=1, max_length=120)


# ---------------------------------------------------------------
# The dimension row (storage shape + GET response item)
# ---------------------------------------------------------------


class ClassificationMappingRule(BaseModel):
    """One proprietary-input → canonical-class mapping rule (Brief 66
    §3.2; mirrors the frontend DimensionRow.classification_mapping
    entry shape). Stored as JSON in classification_mapping_json."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input_pattern: str = Field(..., min_length=1, max_length=200)
    canonical_class_code: str = Field(..., min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)


class PlanDimension(BaseModel):
    """One dimension scoped to one plan. Mirrors `plan_dimensions` row.

    The shape is structurally identical to the frontend's `DimensionRow`
    so write/read is loss-less. `levels` is the polymorphic level array;
    `axes` is the composite-dim axis list (ADR-0025).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    dim_id: str = Field(..., min_length=1, max_length=80)
    """Stable per-plan id. Usually equals `slug`, but the substrate
    permits them to differ for renames-without-id-churn."""

    display_name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=80)
    data_type: DimDataType
    role: str = Field(..., min_length=1, max_length=80)
    """e.g., 'rating-input', 'exposure', 'context'. Free-form; the
    frontend's role taxonomy lives in @openrater/contracts."""

    dimension_type: DimensionType | None = None
    shape: DimShape | None = None
    """Per ADR-0026, NULL falls back to 'categorical'."""

    description: str | None = Field(default=None, max_length=2000)
    levels: list[dict[str, Any]] = Field(default_factory=list)
    """Polymorphic level array. The backend stores it as JSON +
    returns it verbatim; the frontend / Engine discriminates via
    `kind` on each entry per ADR-0026 §1."""

    axes: list[str] | None = None
    """ADR-0025 composite dims only. List of source dim slugs."""

    source_field: str | None = Field(default=None, max_length=200)
    """Optional hint for the raw column that maps to this dim — drives
    auto-binning detection (PR D3.3)."""

    # Brief 44 §3.1 — geographic substrate. The three columns are NULL
    # for non-geographic dims and set for geographic ones. The DB CHECK
    # constraint in 011_plan_dimensions_geographic.sql enforces the
    # coupling (granularity set IFF dimension_type='geographic').
    geo_granularity: GeoGranularity | None = None
    """Granularity of a geographic dim (NULL when dimension_type !=
    'geographic'). Locked at creation per Brief 44 Q1."""

    geo_scope: GeoScope | None = None
    """Scope of a geographic dim — either `{kind: national}` or
    `{kind: subset, states: [...]}`. NULL for non-geo dims."""

    geo_territories: list[GeoTerritory] | None = None
    """Optional grouping layer on top of the geographic levels.
    Empty list = no grouping; NULL = not a geographic dim."""

    # Brief 51 / ADR-0035 — classification + class-derived fields. Both
    # were silently dropped before; the round-trip is restored in
    # migration 020 + repo + this model.
    class_library_id: str | None = Field(default=None, max_length=80)
    """For dimension_type='classification', the class registry this dim
    binds to (per-plan: the plan's own class table)."""

    derived_from: DerivedFrom | None = None
    """For a structural dim whose value is DERIVED from a classification
    dim's class attribute (ADR-0035). NULL for non-derived dims."""

    # Brief 66 §3.2 — the last two round-trip gaps (migration 025).
    classification_mapping: list[ClassificationMappingRule] | None = None
    """For dimension_type='classification', the proprietary input →
    canonical class-code mapping rules. NULL when unused."""

    options: list[str] | None = None
    """For enum-typed dims, the valid options. NULL when unused."""

    monotonicity_expected: str | bool | None = None
    """Banded factor-direction expectation ('increasing' |
    'decreasing' | bool). The frontend warns when a table's factors
    violate it. NULL = no check."""

    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)
    content_hash: str | None = Field(default=None, max_length=16)


# ---------------------------------------------------------------
# Request / response envelopes
# ---------------------------------------------------------------


class UpsertDimensionRequest(BaseModel):
    """POST / PUT body. The path param supplies `rating_plan_id`; the
    body supplies `dim_id` (so a PUT to /dimensions/{dim_id} validates
    the body matches the URL). The backend rejects mismatches with
    400 Bad Request.
    """

    model_config = ConfigDict(extra="forbid")

    dim_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=80)
    data_type: DimDataType
    role: str = Field(..., min_length=1, max_length=80)
    dimension_type: DimensionType | None = None
    shape: DimShape | None = None
    description: str | None = Field(default=None, max_length=2000)
    levels: list[dict[str, Any]] = Field(default_factory=list)
    axes: list[str] | None = None
    source_field: str | None = Field(default=None, max_length=200)
    # Brief 44 — geographic substrate. Same shape + constraints as
    # PlanDimension; see GeoGranularity / GeoScope / GeoTerritory jsdoc.
    geo_granularity: GeoGranularity | None = None
    geo_scope: GeoScope | None = None
    geo_territories: list[GeoTerritory] | None = None
    # Brief 51 / ADR-0035 — classification + class-derived fields.
    class_library_id: str | None = Field(default=None, max_length=80)
    derived_from: DerivedFrom | None = None
    # Brief 66 §3.2 — the last round-trip gaps (migration 025).
    classification_mapping: list[ClassificationMappingRule] | None = None
    options: list[str] | None = None
    monotonicity_expected: str | bool | None = None

    @model_validator(mode="after")
    def _validate_geo_coupling(self) -> "UpsertDimensionRequest":
        """Brief 44 §3.1 lock 2 — geo_granularity is set IFF
        dimension_type='geographic'. Pydantic-layer enforcement so bad
        payloads surface as 422 instead of a server-side IntegrityError.
        The DB CHECK in 011_*.sql remains as a defense-in-depth backstop."""
        is_geo = self.dimension_type == "geographic"
        has_grain = self.geo_granularity is not None
        if is_geo and not has_grain:
            raise ValueError(
                "geo_granularity is required when dimension_type='geographic'"
            )
        if not is_geo and has_grain:
            raise ValueError(
                "geo_granularity must be null when dimension_type != 'geographic'"
            )
        # Brief 44 §3.1 — geo_scope + geo_territories follow the same rule
        # (both are geo-only fields). Empty list for territories is fine;
        # null is the "non-geographic dim" signal.
        if not is_geo and self.geo_scope is not None:
            raise ValueError(
                "geo_scope must be null when dimension_type != 'geographic'"
            )
        if not is_geo and self.geo_territories is not None:
            raise ValueError(
                "geo_territories must be null when dimension_type != 'geographic'"
            )
        if is_geo and self.geo_scope is None:
            raise ValueError(
                "geo_scope is required when dimension_type='geographic'"
            )
        return self


class ListDimensionsResponse(BaseModel):
    """GET /api/v1/plans/{id}/dimensions response."""

    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    dimensions: list[PlanDimension]
    # v4 G14 — deterministic hash of the whole set (sorted dim_id +
    # content_hash pairs). Clients echo it back as If-Match on the bulk
    # replace-all so a second writer's changes are never silently
    # clobbered.
    collection_hash: str | None = None


class BulkUpsertDimensionsRequest(BaseModel):
    """POST /api/v1/plans/{id}/dimensions/bulk — atomic multi-dim upload.

    Used by the localStorage → API one-shot migration on first plan
    open (ADR-0027 §3). Replaces ALL existing dims for the plan in
    one transaction; the client must include the full set, not just
    a diff.
    """

    model_config = ConfigDict(extra="forbid")

    dimensions: list[UpsertDimensionRequest]
