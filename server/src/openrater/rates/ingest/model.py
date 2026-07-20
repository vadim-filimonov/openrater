# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Parsed-workbook model + the Issue shape.

Every parsed value that lint may complain about carries its cell
reference (`sheet` + `cell` like ``ft.limits!B9``) so issues cite the
exact place to fix — the spec's whole error-UX contract.

The model is deliberately dumb: plain dataclasses mirroring the
sheet grammar of filing-transcription-spec.md §4. Validation lives in
`lint.py`; writing lives in Phase 92.3's builder. Pydantic models
here are only the wire shapes the check endpoint returns.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel

Severity = Literal["error", "warning", "notice"]

SPEC_VERSION = "1.0"

#: Sheets the reader recognizes (spec §3). `ft.` / `geo.` are prefixes.
REQUIRED_SHEETS = (
    "plan",
    "inputs",
    "dimensions",
    "chains",
    "outputs",
    "test_cases",
    "gaps_and_assumptions",
)
OPTIONAL_SHEETS = (
    "dimension_levels",
    "gates",
    "modifiers",
    "endorsements",
    "loadings",
    "final_adjustments",
)
SHEET_PREFIXES = ("ft.", "geo.")

#: R-020..R-026 in required-sheet order (spec §8).
MISSING_SHEET_RULE = {
    "inputs": "R-020",
    "plan": "R-021",
    "dimensions": "R-022",
    "chains": "R-023",
    "outputs": "R-024",
    "test_cases": "R-025",
    "gaps_and_assumptions": "R-026",
}

SLUG_RE = r"^[a-z0-9][a-z0-9_-]{0,79}$"

# §4.6 `input_binding` grammar for `base`/`exposure`/`lcm` chain rows.
# Three forms only — a per-risk input read, a filed number in a path
# position (the capture group is the number), and the plan sheet's
# `lcm` value (lcm rows only; the builder resolves it at build time).
# R-127 enforces this check-side; the builder trusts a clean check.
INPUT_BINDING_FORM_PREFIX = "form_input."
LITERAL_BINDING_RE = r"^literal:(-?\d+(?:\.\d+)?)$"
CONTEXT_LCM_BINDING = "context.lcm"

PRODUCT_CODES = (
    "bop",
    "cgl",
    "do",
    "eo",
    "wc",
    "auto",
    "umbrella",
    "excess",
    "marine",
    "inland_marine",
    "homeowners",
    "dwelling",
    "other",
)

DEFAULT_KEY = "__default__"


class CheckIssue(BaseModel):
    """One check finding — the wire shape AND the internal shape."""

    rule: str
    severity: Severity
    sheet: str | None = None
    cell: str | None = None
    message: str


def issue(
    rule: str,
    severity: Severity,
    message: str,
    *,
    sheet: str | None = None,
    cell: str | None = None,
) -> CheckIssue:
    return CheckIssue(
        rule=rule, severity=severity, sheet=sheet, cell=cell, message=message
    )


@dataclass
class Cellv:
    """A raw cell value + where it came from."""

    value: Any
    cell: str  # e.g. "B9"


@dataclass
class Row:
    """One data row: header-name → Cellv, plus the row index."""

    index: int
    cells: dict[str, Cellv]

    def get(self, col: str) -> Any:
        cv = self.cells.get(col)
        return None if cv is None else cv.value

    def ref(self, col: str) -> str | None:
        cv = self.cells.get(col)
        return None if cv is None else cv.cell


@dataclass
class Table:
    """A parsed data sheet: header-mapped rows."""

    sheet: str
    rows: list[Row] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)


@dataclass
class FactorGridCell:
    row_key: Any
    col_key: Any
    factor: Any
    cell: str


@dataclass
class FactorTable:
    sheet: str
    slug: str  # sheet-name suffix after "ft."
    meta: dict[str, Cellv] = field(default_factory=dict)
    # 1-D grid rows (level_id, factor, refs); populated when dimensionality=1d
    rows_1d: list[Row] = field(default_factory=list)
    # 2-D: column labels (with refs) + cells
    col_labels: list[Cellv] = field(default_factory=list)
    row_labels: list[Cellv] = field(default_factory=list)
    grid: list[FactorGridCell] = field(default_factory=list)

    def meta_value(self, key: str) -> Any:
        cv = self.meta.get(key)
        return None if cv is None else cv.value

    def meta_ref(self, key: str) -> str | None:
        cv = self.meta.get(key)
        return None if cv is None else cv.cell


@dataclass
class GeoSheet:
    sheet: str
    slug: str  # suffix after "geo."
    table: Table = field(default_factory=lambda: Table(sheet=""))


@dataclass
class ParsedWorkbook:
    """Everything the reader extracted, location-tagged, unvalidated."""

    sheet_names: list[str] = field(default_factory=list)
    plan: dict[str, Cellv] = field(default_factory=dict)  # field -> value
    plan_sheet_present: bool = False
    inputs: Table | None = None
    dimensions: Table | None = None
    dimension_levels: Table | None = None
    chains: Table | None = None
    gates: Table | None = None
    modifiers: Table | None = None
    endorsements: Table | None = None
    loadings: Table | None = None
    final_adjustments: Table | None = None
    outputs: Table | None = None
    test_cases: Table | None = None
    gaps: Table | None = None
    factor_tables: list[FactorTable] = field(default_factory=list)
    geo_sheets: list[GeoSheet] = field(default_factory=list)
    unknown_sheets: list[str] = field(default_factory=list)

    def plan_value(self, key: str) -> Any:
        cv = self.plan.get(key)
        return None if cv is None else cv.value

    def coverages(self) -> list[str]:
        """Coverage ids, election markers stripped — spec §4.1 (Brief 95
        C4): a trailing `?` marks the coverage electable; every consumer
        of coverage NAMES (chains grouping, endorsements, applies_to)
        sees the clean id."""
        raw = self.plan_value("coverages")
        if raw is None:
            return []
        out: list[str] = []
        for c in str(raw).split(","):
            c = c.strip()
            if not c:
                continue
            out.append(c[:-1].strip() if c.endswith("?") else c)
        return [c for c in out if c]

    def elective_coverages(self) -> set[str]:
        """The coverages marked electable (`building?` — spec §4.1)."""
        raw = self.plan_value("coverages")
        if raw is None:
            return set()
        out: set[str] = set()
        for c in str(raw).split(","):
            c = c.strip()
            if c.endswith("?") and c[:-1].strip():
                out.add(c[:-1].strip())
        return out


class ManifestCounts(BaseModel):
    dimensions: int = 0
    dimension_levels: int = 0
    factor_tables: int = 0
    factor_cells: int = 0
    # Brief 94 (U5) — citation coverage at the factor-cell grain,
    # mirroring R-201: a table-level citation covers its whole table;
    # a 1-D row may carry its own. Denominator = factor_cells.
    factor_cells_cited: int = 0
    chains: int = 0
    chain_stages: int = 0
    gates: int = 0
    modifier_categories: int = 0
    endorsements: int = 0
    loadings: int = 0
    final_adjustments: int = 0
    outputs: int = 0
    inputs: int = 0
    inputs_with_defaults: int = 0
    test_cases: int = 0
    geo_rows: int = 0
    declared_gaps: int = 0


class ManifestProvenance(BaseModel):
    carrier: str | None = None
    product: str | None = None
    state: str | None = None
    effective_date: str | None = None
    serff_tracking_number: str | None = None
    display_name: str | None = None
    # Brief 92.R (D2) — the workbook's own identity + re-issue signal
    # (spec §4.1), so revision discovery reads the manifest, not the
    # sheet again.
    rating_plan_id: str | None = None
    version: str | None = None


class Manifest(BaseModel):
    """The dry-run answer: what a build would create (spec §2.1 of
    Brief 92 — 'nothing is written until you build')."""

    provenance: ManifestProvenance
    counts: ManifestCounts
    gap_kinds: dict[str, int] = {}
    # Drift tracking: the plan's
    # content_hash captured right after the build committed. The hash
    # covers metadata + stages, so live ≠ this catches gate/chain
    # edits; factor-cell edits are itemized directly against the
    # stored workbook. Absent on dry-runs and on reports written
    # before this field existed.
    plan_content_hash_at_build: str | None = None
