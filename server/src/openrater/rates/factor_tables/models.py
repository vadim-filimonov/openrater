# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for plan-scoped factor tables + cells.

Wire shape: a factor table is metadata + cells inlined as a dict
`{cellKey: value}`. The storage layer keeps them in separate SQLite
tables for partial-update efficiency, but the API hides that split so
callers can read a complete table in one round trip.

`cells` is a plain `dict[str, float]` — the backend doesn't interpret
the cell-key encoding (e.g. `"ntee_major=A|state=CA"`); the frontend +
Engine own that contract. Storing it as opaque strings lets 1-D, 2-D,
and N-D tables share one shape.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# A factor-table cell value must be a FINITE number. pydantic allows
# `inf`/`nan` on a float by default, and `inf` JSON-serializes to `null`
# — so a non-finite cell was accepted with 200 and served as a corrupt
# `null` rating factor (audit A-2026-07-12 P1-03/P1-07). `allow_inf_nan=
# False` refuses it with a typed 422 at the boundary instead.
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]

# ---------------------------------------------------------------
# Shared shape primitives
# ---------------------------------------------------------------

DraftStatus = Literal["extracted", "reviewed", "committed"]


class FactorTableInterpolation(BaseModel):
    """ADR-0063 — flags one banded numeric key axis of a factor table for
    linear interpolation between adjacent level `lo` bounds at runtime,
    instead of the default stepping. `axis` is the slug of a banded key
    dimension. Absent/NULL = step (the default for every table).

    The backend stores + serves this opaquely; the Engine (via the
    projector's `lookup.multi.interpolateOn`) owns the interpolation math.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: Literal["linear"]
    axis: str = Field(..., min_length=1, max_length=80)


# ---------------------------------------------------------------
# The factor table (storage shape + GET response item)
# ---------------------------------------------------------------


class PlanFactorTable(BaseModel):
    """One factor table scoped to one plan. Mirrors the
    `plan_factor_tables` row + the per-cell sidecar inlined as
    `cells`. Structurally compatible with the frontend's
    `FactorTableRow` plus the cell-map the Parametrize canvas reads.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    table_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)

    key_dimensions: list[str] = Field(default_factory=list)
    """Dim slugs this table is indexed by. 1-D tables: single-element;
    2-D+ tables: full ordered list. Empty list permitted for mid-author
    tables that haven't picked their axes yet."""

    # PDF ingestion reservation (Brief 26 §16 PR 10).
    draft_status: DraftStatus | None = None
    source_pdf_url: str | None = Field(default=None, max_length=2000)
    source_page: int | None = Field(default=None, ge=1)

    # Cells inlined as { cell_key: value }. Empty dict permitted —
    # an FT with no cells is a valid in-progress state.
    cells: dict[str, FiniteFloat] = Field(default_factory=dict)

    # ADR-0063 — linear-interpolation flag. None (the default) = step.
    interpolation: FactorTableInterpolation | None = None

    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)
    content_hash: str | None = Field(default=None, max_length=16)


# ---------------------------------------------------------------
# Request / response envelopes
# ---------------------------------------------------------------


class UpsertFactorTableRequest(BaseModel):
    """POST / PUT body. The path param supplies `rating_plan_id`;
    the body supplies `table_id`. Cells are OPTIONAL on a metadata-
    only update; callers that want to edit just one cell should hit
    `PUT /factor-tables/{table_id}/cells` instead, which patches
    individual cells without touching metadata.

    When `cells` IS present on a PUT, the cell map is replaced
    atomically — same semantics as the dimension `/bulk` endpoint.
    """

    model_config = ConfigDict(extra="forbid")

    table_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    key_dimensions: list[str] = Field(default_factory=list)
    draft_status: DraftStatus | None = None
    source_pdf_url: str | None = Field(default=None, max_length=2000)
    source_page: int | None = Field(default=None, ge=1)
    cells: dict[str, FiniteFloat] | None = None
    # ADR-0063 — full-replace on upsert (like key_dimensions, not the cells
    # tri-state): None writes NULL (step). The FE always round-trips the flag
    # through `factorTableRowToUpsertRequest`, so a metadata edit preserves it.
    interpolation: FactorTableInterpolation | None = None


class UpsertFactorTableCellsRequest(BaseModel):
    """PUT /factor-tables/{table_id}/cells body — replace-all the
    cell map for one FT, atomically. The metadata row is untouched
    (use UpsertFactorTableRequest for that).

    Used by the Parametrize canvas's "Save table" button, which
    materializes the full grid in one shot.
    """

    model_config = ConfigDict(extra="forbid")

    cells: dict[str, FiniteFloat]


class ListFactorTablesResponse(BaseModel):
    """GET /api/v1/plans/{id}/factor-tables response."""

    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    factor_tables: list[PlanFactorTable]
    # v4 G14 — deterministic hash of the whole set (sorted table_id +
    # content_hash pairs; each row's hash covers its cells). Clients echo
    # it back as If-Match on the bulk replace-all.
    collection_hash: str | None = None


class BulkUpsertFactorTablesRequest(BaseModel):
    """POST /api/v1/plans/{id}/factor-tables/bulk — atomic multi-FT upload.

    Used by the localStorage → API one-shot migration on first plan
    open (ADR-0027 §3) and by the future `/from-template` endpoint
    (D6.4). Replaces ALL existing FTs (and their cells) for the
    plan in one transaction; the client must include the full set.

    Each `UpsertFactorTableRequest` MAY include cells; when it does,
    those cells are written for that FT.
    """

    model_config = ConfigDict(extra="forbid")

    factor_tables: list[UpsertFactorTableRequest]
