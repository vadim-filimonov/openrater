# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The workbook revision diff — Brief 92.R (D3).

Pure: two `ParsedWorkbook`s in (the base a plan was built from, and
the revision), a `WorkbookDiff` out — construct by construct, in the
actuary's vocabulary, deterministically (same pair in → byte-identical
JSON out, twice).

Adopts ADR-0017 §5's `ImportDiff` five-state vocabulary (added /
changed / removed / unchanged / ignored) and field-change shape; the
engine is new because the constructs are workbook-grammar constructs
(cells, stages, gate rules, test-case expectations), not CSV rows.

Never consulted by the engine or projector — this module exists so a
human can read exactly what a revision does before anything changes
(the review surface, 92R.4) and so the applied report can record what
it did (92R.3).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from openrater.rates.ingest.model import (
    FactorTable,
    ParsedWorkbook,
    Row,
    Table,
)

__all__ = [
    "DiffItem",
    "DiffSection",
    "DiffTotals",
    "FieldChange",
    "WorkbookDiff",
    "diff_workbooks",
]


# ---------------------------------------------------------------------------
# Wire shapes (ADR-0017 vocabulary).
# ---------------------------------------------------------------------------


class FieldChange(BaseModel):
    """One field's move. `from` is a Python keyword — alias handles the
    wire; `pct` rides only numeric moves with a nonzero base."""

    model_config = ConfigDict(populate_by_name=True)

    field: str
    from_: Any = Field(default=None, alias="from")
    to: Any = None
    pct: float | None = None


class DiffItem(BaseModel):
    state: str  # "added" | "changed" | "removed"
    key: str  # stable identity, e.g. "ft.construction_class · frame"
    summary: str  # one actuary-language line
    changes: list[FieldChange] = []


class DiffSection(BaseModel):
    section: str  # spine id, e.g. "factor_tables"
    label: str  # display, e.g. "Factor Tables"
    added: int = 0
    changed: int = 0
    removed: int = 0
    unchanged: int = 0
    items: list[DiffItem] = []


class DiffTotals(BaseModel):
    added: int = 0
    changed: int = 0
    removed: int = 0
    sections_changed: int = 0


class WorkbookDiff(BaseModel):
    totals: DiffTotals
    sections: list[DiffSection] = []
    #: Prose/unrecognized sheets are never diffed (they're never read);
    #: presence differences are noted so nothing vanishes silently.
    ignored: list[str] = []


# ---------------------------------------------------------------------------
# Value plumbing.
# ---------------------------------------------------------------------------


def _norm(v: Any) -> Any:
    """Comparison form: numerics as float (1 == 1.0), everything else
    as its string; None stays None."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v)
    return s


def _pct(a: Any, b: Any) -> float | None:
    na, nb = _norm(a), _norm(b)
    if isinstance(na, float) and isinstance(nb, float) and na != 0.0:
        return round((nb - na) / na * 100.0, 1)
    return None


def _change(field: str, a: Any, b: Any, *, rate: bool = False) -> FieldChange:
    """One field move. MVP-022 — `pct` is RATE grammar: it rides factor
    cells and the filing's expected results, never thresholds, orders,
    or other plain numbers (a gate moving 3 → 5 is not '+66.7%')."""
    return FieldChange(field=field, from_=a, to=b, pct=_pct(a, b) if rate else None)


def _row_fields(base: Row | None, new: Row | None) -> list[str]:
    cols: list[str] = []
    for r in (base, new):
        if r is None:
            continue
        for c in r.cells:
            if c not in cols and c != "notes":
                cols.append(c)
    return cols


def _diff_row_pair(base: Row, new: Row) -> list[FieldChange]:
    out: list[FieldChange] = []
    for col in _row_fields(base, new):
        a, b = base.get(col), new.get(col)
        if _norm(a) != _norm(b):
            out.append(_change(col, a, b))
    return out


def _keyed(table: Table | None, key_cols: tuple[str, ...]) -> dict[str, Row]:
    out: dict[str, Row] = {}
    for row in table.rows if table is not None else []:
        key = " · ".join(str(row.get(c)) for c in key_cols if row.get(c) is not None)
        if key:
            out[key] = row
    return out


# ---------------------------------------------------------------------------
# The generic keyed-rows differ (most sheets).
# ---------------------------------------------------------------------------


def _diff_keyed_rows(
    section: str,
    label: str,
    base: Table | None,
    new: Table | None,
    key_cols: tuple[str, ...],
    noun: str,
) -> DiffSection:
    sec = DiffSection(section=section, label=label)
    b, n = _keyed(base, key_cols), _keyed(new, key_cols)
    for key in sorted(b.keys() | n.keys()):
        in_b, in_n = key in b, key in n
        if in_b and not in_n:
            sec.removed += 1
            sec.items.append(
                DiffItem(
                    state="removed",
                    key=key,
                    summary=f"Removes {noun} {key}.",
                )
            )
        elif in_n and not in_b:
            sec.added += 1
            sec.items.append(
                DiffItem(state="added", key=key, summary=f"Adds {noun} {key}.")
            )
        else:
            changes = _diff_row_pair(b[key], n[key])
            if changes:
                sec.changed += 1
                fields = ", ".join(c.field for c in changes)
                sec.items.append(
                    DiffItem(
                        state="changed",
                        key=key,
                        summary=f"{noun.capitalize()} {key}: {fields} changed.",
                        changes=changes,
                    )
                )
            else:
                sec.unchanged += 1
    return sec


# ---------------------------------------------------------------------------
# Specific sheets.
# ---------------------------------------------------------------------------


def _diff_plan(base: ParsedWorkbook, new: ParsedWorkbook) -> DiffSection:
    sec = DiffSection(section="plan", label="Plan")
    fields = sorted(set(base.plan.keys()) | set(new.plan.keys()))
    changes: list[FieldChange] = []
    for f in fields:
        a, b = base.plan_value(f), new.plan_value(f)
        if _norm(a) != _norm(b):
            changes.append(_change(f, a, b))
    if changes:
        sec.changed = 1
        names = ", ".join(c.field for c in changes)
        sec.items.append(
            DiffItem(
                state="changed",
                key="plan",
                summary=f"Plan sheet: {names} changed.",
                changes=changes,
            )
        )
    else:
        sec.unchanged = 1
    return sec


def _level_cell_count(wb: ParsedWorkbook, level_id: str) -> int:
    """The blast radius of removing a level: every factor cell keyed by
    it across the base workbook's tables."""
    count = 0
    for ft in wb.factor_tables:
        if ft.grid:
            count += sum(
                1
                for c in ft.grid
                if str(c.row_key) == level_id or str(c.col_key) == level_id
            )
        else:
            count += sum(1 for r in ft.rows_1d if str(r.get("level_id")) == level_id)
    return count


def _diff_levels(base: ParsedWorkbook, new: ParsedWorkbook) -> DiffSection:
    sec = _diff_keyed_rows(
        "dimensions",
        "Dimensions",
        base.dimension_levels,
        new.dimension_levels,
        ("dimension_slug", "level_id"),
        "level",
    )
    # Dimension-header rows fold into the same section.
    header = _diff_keyed_rows(
        "dimensions", "Dimensions", base.dimensions, new.dimensions, ("slug",), "dimension"
    )
    sec.added += header.added
    sec.changed += header.changed
    sec.removed += header.removed
    sec.unchanged += header.unchanged
    sec.items = sorted(header.items + sec.items, key=lambda i: (i.state, i.key))
    # Blast radius on removed levels (the base knows its cells).
    for item in sec.items:
        if item.state == "removed" and " · " in item.key:
            level_id = item.key.split(" · ")[-1]
            cells = _level_cell_count(base, level_id)
            if cells:
                item.summary = (
                    f"Removes level {item.key} — also removes its "
                    f"{cells} factor cell{'s' if cells != 1 else ''}."
                )
    return sec


def _cells_map(ft: FactorTable) -> dict[str, Any]:
    if ft.grid:
        return {f"{c.row_key} · {c.col_key}": c.factor for c in ft.grid}
    return {str(r.get("level_id")): r.get("factor") for r in ft.rows_1d}


_FT_META_FIELDS = (
    "display_name",
    "dimensionality",
    "row_dimension",
    "col_dimension",
    "lookup_method",
    "interpolation",
    "default_value",
    "citation_rule",
    "citation_page",
)


def _diff_factor_tables(base: ParsedWorkbook, new: ParsedWorkbook) -> DiffSection:
    sec = DiffSection(section="factor_tables", label="Factor Tables")
    b = {ft.slug: ft for ft in base.factor_tables}
    n = {ft.slug: ft for ft in new.factor_tables}
    for slug in sorted(b.keys() | n.keys()):
        key = f"ft.{slug}"
        if slug in b and slug not in n:
            cells = len(_cells_map(b[slug]))
            sec.removed += 1
            sec.items.append(
                DiffItem(
                    state="removed",
                    key=key,
                    summary=f"Removes table {key} and its {cells} "
                    f"cell{'s' if cells != 1 else ''}.",
                )
            )
            continue
        if slug in n and slug not in b:
            cells = len(_cells_map(n[slug]))
            sec.added += 1
            sec.items.append(
                DiffItem(
                    state="added",
                    key=key,
                    summary=f"Adds table {key} ({cells} "
                    f"cell{'s' if cells != 1 else ''}).",
                )
            )
            continue
        changes: list[FieldChange] = []
        for f in _FT_META_FIELDS:
            a, c = b[slug].meta_value(f), n[slug].meta_value(f)
            if _norm(a) != _norm(c):
                changes.append(_change(f, a, c))
        bc, nc = _cells_map(b[slug]), _cells_map(n[slug])
        for cell_key in sorted(bc.keys() | nc.keys()):
            a, c = bc.get(cell_key), nc.get(cell_key)
            if _norm(a) != _norm(c):
                changes.append(_change(cell_key, a, c, rate=True))
        if changes:
            cell_moves = sum(1 for ch in changes if ch.field not in _FT_META_FIELDS)
            total = len(bc)
            sec.changed += 1
            summary = (
                f"{key} — {cell_moves} of {total} factors changed."
                if cell_moves
                else f"{key} — table metadata changed."
            )
            sec.items.append(
                DiffItem(state="changed", key=key, summary=summary, changes=changes)
            )
        else:
            sec.unchanged += 1
    return sec


def _diff_test_cases(base: ParsedWorkbook, new: ParsedWorkbook) -> DiffSection:
    sec = _diff_keyed_rows(
        "test_cases",
        "Rate Against Sample",
        base.test_cases,
        new.test_cases,
        ("case_id",),
        "test case",
    )
    # The filing revising its own examples is the strongest rate-change
    # signal — say it in those words. Expected results are RATE grammar
    # (MVP-022): they keep their pct where plain fields lost it.
    for item in sec.items:
        if item.state == "changed":
            expected = [
                _change(c.field, c.from_, c.to, rate=True)
                for c in item.changes
                if c.field.startswith("expected_")
            ]
            if expected:
                item.changes = [
                    next((e for e in expected if e.field == c.field), c)
                    for c in item.changes
                ]
                moves = "; ".join(
                    f"{c.field} {c.from_} → {c.to}"
                    + (f" ({c.pct:+.1f}%)" if c.pct is not None else "")
                    for c in expected
                )
                item.summary = f"The filing revised {item.key}: {moves}."
    return sec


_GATE_CLAUSE_SUFFIXES = ("", "_2", "_3")


def _gate_phrase(row: Row | None, ch: FieldChange) -> str:
    """One gate move in the plan's own words (MVP-022): a clause column
    resolves to its VARIABLE — "years_in_business threshold 3 → 5",
    never "value_2 changed"."""
    for sfx in _GATE_CLAUSE_SUFFIXES:
        raw_var = row.get(f"variable{sfx}") if row is not None else None
        var = str(raw_var) if raw_var is not None else f"condition {sfx.lstrip('_') or 1}"
        if ch.field == f"value{sfx}":
            if ch.from_ is None:
                return f"adds the {var} condition ({ch.to})"
            if ch.to is None:
                return f"drops the {var} condition"
            word = (
                "threshold"
                if isinstance(_norm(ch.from_), float)
                or isinstance(_norm(ch.to), float)
                else "value"
            )
            return f"{var} {word} {ch.from_} → {ch.to}"
        if ch.field == f"op{sfx}":
            return f"{var} comparison {ch.from_} → {ch.to}"
        if ch.field == f"variable{sfx}":
            if ch.from_ is None:
                return f"adds a condition on {ch.to}"
            if ch.to is None:
                return f"drops the condition on {ch.from_}"
            return f"condition now tests {ch.to} (was {ch.from_})"
    if ch.field == "tier":
        return f"tier {ch.from_} → {ch.to}"
    if ch.field == "reasoning":
        return "reasoning updated"
    return f"{ch.field} {ch.from_} → {ch.to}"


def _diff_gates(base: ParsedWorkbook, new: ParsedWorkbook) -> DiffSection:
    """Eligibility rules, spoken in variables — the generic keyed-rows
    voice ("Rule x: value_2 changed") stops one hop short of the
    culprit; this names it."""
    sec = _diff_keyed_rows(
        "gates", "Eligibility", base.gates, new.gates, ("rule_id",), "rule"
    )
    rows_b = _keyed(base.gates, ("rule_id",))
    rows_n = _keyed(new.gates, ("rule_id",))
    for item in sec.items:
        if item.state != "changed" or not item.changes:
            continue
        row = rows_n.get(item.key) or rows_b.get(item.key)
        phrases = "; ".join(_gate_phrase(row, ch) for ch in item.changes)
        item.summary = f"Rule {item.key}: {phrases}."
    return sec


def _diff_geo(base: ParsedWorkbook, new: ParsedWorkbook) -> DiffSection:
    sec = DiffSection(section="geo", label="Territories (geo detail)")
    b = {g.slug: g for g in base.geo_sheets}
    n = {g.slug: g for g in new.geo_sheets}
    for slug in sorted(b.keys() | n.keys()):
        base_t = b[slug].table if slug in b else None
        new_t = n[slug].table if slug in n else None
        key_cols = ("zip",) if (new_t or base_t) and any(
            "zip" in r.cells for t in (base_t, new_t) if t for r in t.rows[:1]
        ) else ("county",)
        inner = _diff_keyed_rows(
            "geo", "geo", base_t, new_t, key_cols, f"geo.{slug} row"
        )
        sec.added += inner.added
        sec.changed += inner.changed
        sec.removed += inner.removed
        sec.unchanged += inner.unchanged
        sec.items.extend(inner.items)
    return sec


# ---------------------------------------------------------------------------
# The entry point.
# ---------------------------------------------------------------------------


def diff_workbooks(base: ParsedWorkbook, new: ParsedWorkbook) -> WorkbookDiff:
    sections = [
        _diff_plan(base, new),
        _diff_keyed_rows(
            "inputs", "Risk Inputs", base.inputs, new.inputs, ("name",), "input"
        ),
        _diff_levels(base, new),
        _diff_factor_tables(base, new),
        _diff_keyed_rows(
            "chains",
            "Rating Chains",
            base.chains,
            new.chains,
            ("coverage", "coverage_value", "stage_id"),
            "stage",
        ),
        _diff_gates(base, new),
        _diff_keyed_rows(
            "modifiers",
            "Modifiers",
            base.modifiers,
            new.modifiers,
            ("schedule_id", "category_id"),
            "category",
        ),
        _diff_keyed_rows(
            "endorsements",
            "Endorsements",
            base.endorsements,
            new.endorsements,
            ("endorsement_id",),
            "endorsement",
        ),
        _diff_keyed_rows(
            "loadings", "Loadings", base.loadings, new.loadings, ("loading_id",), "loading"
        ),
        _diff_keyed_rows(
            "final_adjustments",
            "Final Adjustments",
            base.final_adjustments,
            new.final_adjustments,
            ("adjustment_id",),
            "adjustment",
        ),
        _diff_keyed_rows(
            "outputs", "Outputs", base.outputs, new.outputs, ("output_id",), "output"
        ),
        _diff_test_cases(base, new),
        _diff_geo(base, new),
    ]
    # Endorsement removals carry their trigger as the blast radius.
    for sec in sections:
        if sec.section != "endorsements":
            continue
        base_rows = _keyed(base.endorsements, ("endorsement_id",))
        for item in sec.items:
            if item.state == "removed" and item.key in base_rows:
                row = base_rows[item.key]
                form = row.get("form_number")
                trigger = row.get("trigger")
                bits = [f"form {form}" if form else None, f"trigger {trigger}" if trigger else "always attached"]
                detail = ", ".join(x for x in bits if x)
                item.summary = f"Removes endorsement {item.key} ({detail})."

    # Keep only sections that exist on either side (all-empty sections
    # with zero unchanged rows vanish — a workbook without gates isn't
    # "Eligibility unchanged", it's silent).
    kept = [
        s
        for s in sections
        if s.items or s.unchanged > 0
    ]
    totals = DiffTotals(
        added=sum(s.added for s in kept),
        changed=sum(s.changed for s in kept),
        removed=sum(s.removed for s in kept),
        sections_changed=sum(1 for s in kept if s.items),
    )
    ignored: list[str] = []
    b_extra, n_extra = set(base.unknown_sheets), set(new.unknown_sheets)
    for name in sorted(b_extra | n_extra):
        if name not in n_extra:
            ignored.append(f"Prose sheet '{name}' no longer present (never diffed).")
        elif name not in b_extra:
            ignored.append(f"Prose sheet '{name}' added (never diffed).")
    return WorkbookDiff(totals=totals, sections=kept, ignored=ignored)
