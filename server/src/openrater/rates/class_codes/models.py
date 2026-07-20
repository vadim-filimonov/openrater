# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for the per-plan class-code registry — Brief 51.

These models mirror the frontend's `ClassRecord`
(`packages/contracts/src/class-record-types.ts`) so the round-trip is
loss-less. `eligible_for`, `exposure_bases`, and `attributes` round-trip
as JSON (`*_json` columns) because the backend stores + returns them
verbatim — it doesn't introspect their runtime meaning. The frontend /
Engine does the type-narrowing.

Scope: per-plan (Brief 51 §−1 Q1). One `(rating_plan_id, class_code)` row
per class, exactly like `plan_dimensions`.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Brief 8 Q3 — whether the row came from a filed library or was authored
# by the carrier. Drives the "Custom" badge in the UI.
ClassSource = Literal["iso", "custom"]


# ---------------------------------------------------------------
# The class row (storage shape + GET response item)
# ---------------------------------------------------------------


class PlanClassCode(BaseModel):
    """One class scoped to one plan. Mirrors `plan_class_codes` row.

    Structurally identical to the frontend `ClassRecord` so write/read is
    loss-less. `attributes` carries the DERIVED rating attributes (opaque
    keys, ADR-0033 precedent): prop_rate_number / liab_class_group /
    liab_exposure_base / … — read by the `derive.class_attribute` kind.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    class_code: str = Field(..., min_length=1, max_length=40)
    display_name: str = Field(..., min_length=1, max_length=200)
    family: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    naics_code: str | None = Field(default=None, max_length=20)
    sic_code: str | None = Field(default=None, max_length=20)
    eligible_for: list[str] = Field(default_factory=list)
    """Opaque product/coverage tags (ADR-0033). e.g. ['bop', 'property']."""

    exposure_bases: list[dict[str, Any]] = Field(default_factory=list)
    """ExposureBaseDeclaration[], stored + returned verbatim (Brief 16)."""

    attributes: dict[str, str] = Field(default_factory=dict)
    """Derived rating attributes — opaque string keys (ADR-0035).
    e.g. {'prop_rate_number': '09', 'liab_class_group': 'cg_40',
    'liab_exposure_base': 'sales'}."""

    source: ClassSource = "custom"
    note: str | None = Field(default=None, max_length=2000)
    citation_rule: str | None = Field(default=None, max_length=400)
    citation_page: str | None = Field(default=None, max_length=80)

    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)
    content_hash: str | None = Field(default=None, max_length=16)


# ---------------------------------------------------------------
# Request / response envelopes
# ---------------------------------------------------------------


class UpsertClassCodeRequest(BaseModel):
    """POST / PUT body. The path param supplies `rating_plan_id`; the body
    supplies `class_code` (a PUT to /class-codes/{class_code} validates the
    body matches the URL). The backend rejects mismatches with 400.
    """

    model_config = ConfigDict(extra="forbid")

    class_code: str = Field(..., min_length=1, max_length=40)
    display_name: str = Field(..., min_length=1, max_length=200)
    family: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    naics_code: str | None = Field(default=None, max_length=20)
    sic_code: str | None = Field(default=None, max_length=20)
    eligible_for: list[str] = Field(default_factory=list)
    exposure_bases: list[dict[str, Any]] = Field(default_factory=list)
    attributes: dict[str, str] = Field(default_factory=dict)
    source: ClassSource = "custom"
    note: str | None = Field(default=None, max_length=2000)
    citation_rule: str | None = Field(default=None, max_length=400)
    citation_page: str | None = Field(default=None, max_length=80)


class ListClassCodesResponse(BaseModel):
    """GET /api/v1/plans/{id}/class-codes response."""

    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    class_codes: list[PlanClassCode]


class BulkImportClassCodesRequest(BaseModel):
    """POST /api/v1/plans/{id}/class-codes/bulk — import a class table.

    The acceptance path for loading a real filing's class table (Brief 51
    §−1 Q3). Header-keyed CSV is parsed client-side into `classes[]`.

    `mode='merge'` (default) upserts each provided class, preserving any
    others already in the plan — the natural "import a class table" verb.
    `mode='replace'` deletes ALL existing classes for the plan first
    (a clean re-import).
    """

    model_config = ConfigDict(extra="forbid")

    classes: list[UpsertClassCodeRequest] = Field(default_factory=list)
    mode: Literal["merge", "replace"] = "merge"


class BulkImportClassCodesResponse(BaseModel):
    """Response for the bulk import — the count + the full materialized list."""

    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    imported: int
    mode: Literal["merge", "replace"]
    class_codes: list[PlanClassCode]
