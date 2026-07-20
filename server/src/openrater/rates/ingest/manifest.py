# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The dry-run manifest — what a build would create.

Computed only when the check is clean (Brief 92 scene 4: "Here's
everything this workbook will create — nothing is written until you
build"). Pure counting over the parsed model; no validation here.
"""

from __future__ import annotations

from datetime import date, datetime

from openrater.rates.ingest.model import (
    Manifest,
    ManifestCounts,
    ManifestProvenance,
    ParsedWorkbook,
)


def _rows(table) -> int:  # noqa: ANN001 — Table | None
    return len(table.rows) if table is not None else 0


def build_manifest(wb: ParsedWorkbook) -> Manifest:
    counts = ManifestCounts()
    counts.inputs = _rows(wb.inputs)
    if wb.inputs is not None:
        counts.inputs_with_defaults = sum(
            1 for r in wb.inputs.rows if r.get("default_value") is not None
        )
    counts.dimensions = _rows(wb.dimensions)
    counts.dimension_levels = _rows(wb.dimension_levels)
    counts.factor_tables = len(wb.factor_tables)
    for ft in wb.factor_tables:
        counts.factor_cells += len(ft.grid) if ft.grid else len(ft.rows_1d)
        # Brief 94 (U5) — same coverage rule R-201 warns on: table-level
        # citation covers the table; a 1-D row may cite for itself.
        table_cited = ft.meta_value("citation_rule") is not None
        if ft.grid:
            counts.factor_cells_cited += len(ft.grid) if table_cited else 0
        else:
            counts.factor_cells_cited += sum(
                1
                for r in ft.rows_1d
                if table_cited or r.get("citation_rule") is not None
            )
    if wb.chains is not None:
        counts.chain_stages = len(wb.chains.rows)
        counts.chains = len(
            {
                (str(r.get("coverage")), str(r.get("coverage_value") or ""))
                for r in wb.chains.rows
                if r.get("coverage") is not None
            }
        )
    counts.gates = _rows(wb.gates)
    counts.modifier_categories = _rows(wb.modifiers)
    counts.endorsements = _rows(wb.endorsements)
    counts.loadings = _rows(wb.loadings)
    counts.final_adjustments = _rows(wb.final_adjustments)
    counts.outputs = _rows(wb.outputs)
    counts.test_cases = _rows(wb.test_cases)
    counts.geo_rows = sum(len(g.table.rows) for g in wb.geo_sheets)
    counts.declared_gaps = _rows(wb.gaps)

    gap_kinds: dict[str, int] = {}
    if wb.gaps is not None:
        for r in wb.gaps.rows:
            kind = str(r.get("kind") or "?")
            gap_kinds[kind] = gap_kinds.get(kind, 0) + 1

    eff = wb.plan_value("effective_date")
    if isinstance(eff, (datetime, date)):
        eff = eff.strftime("%Y-%m-%d")

    provenance = ManifestProvenance(
        carrier=_opt_str(wb.plan_value("carrier")),
        product=_opt_str(wb.plan_value("product")),
        state=_opt_str(wb.plan_value("state")),
        effective_date=_opt_str(eff),
        serff_tracking_number=_opt_str(wb.plan_value("serff_tracking_number")),
        display_name=_opt_str(wb.plan_value("display_name")),
        rating_plan_id=_opt_str(wb.plan_value("rating_plan_id")),
        version=_opt_str(wb.plan_value("version")),
    )
    return Manifest(provenance=provenance, counts=counts, gap_kinds=gap_kinds)


def _opt_str(v) -> str | None:  # noqa: ANN001
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    return str(v)
