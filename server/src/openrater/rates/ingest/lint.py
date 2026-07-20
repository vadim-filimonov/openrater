# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Content lint — the spec §8 rule table, executed.

Every issue carries its `R-###` id and cites `sheet` + `cell`. The
messages speak actuary first ("key 5000 isn't a level of dimension
limit"), rule-id second — the same voice the Brief 92 mockup locked.

The capability registry (`capability_registry.json`, the packaged
runtime copy of docs/specs/transcription-capability-registry.json — a
test keeps the two byte-identical) drives R-111/R-190/R-191 so the
boundary can move without touching this module.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from importlib import resources
from typing import Any

from openrater.rates.ingest.geo_universe import load_geo_universe
from openrater.rates.ingest.model import (
    CONTEXT_LCM_BINDING,
    DEFAULT_KEY,
    INPUT_BINDING_FORM_PREFIX,
    LITERAL_BINDING_RE,
    PRODUCT_CODES,
    SLUG_RE,
    CheckIssue,
    FactorTable,
    ParsedWorkbook,
    Row,
    issue,
)

_SLUG = re.compile(SLUG_RE)
_LITERAL_BINDING = re.compile(LITERAL_BINDING_RE)
_STATE = re.compile(r"^[A-Z]{2}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PREDICATE = re.compile(
    r"^(form_input|dim)\.([a-z0-9][a-z0-9_-]*)\s+"
    r"(==|!=|<=|>=|<|>|in|not-in)\s+(.+)$"
)

INPUT_DATA_TYPES = {"string", "number", "currency", "boolean", "enum"}
DIM_SHAPES = {"categorical", "banded", "geographic", "composite"}
DIM_ROLES = {"rating-input", "structural", "both"}
DIM_TYPES = {"standard", "geographic", "classification"}
GEO_GRANULARITIES = {"state", "county", "zip"}
LOOKUP_METHODS = {"direct", "binned", "bracketed", "classification"}
INTERPOLATIONS = {"stepped", "linear"}
STAGE_KINDS = {
    "base",
    "lookup.classification",
    "lookup.direct",
    "lookup.range",
    "lookup.multi",
    "lookup.territory",
    "flat_factor",
    "exposure",
    "lcm",
}
LOOKUP_KINDS = {k for k in STAGE_KINDS if k.startswith("lookup.")}
GATE_OPS = {"eq", "ne", "lt", "le", "gt", "ge", "in", "nin"}
TIERS = {"preferred", "standard", "submit", "decline"}
GAP_KINDS = {"gap", "assumption", "unsupported"}
ENDORSEMENT_KINDS = {"factor", "additive", "sublimit"}
ADJUSTMENT_KINDS = {"clamp", "round"}
MODIFIER_SCOPES = {"per_coverage", "package"}


def load_registry() -> dict[str, Any]:
    """The packaged capability registry (runtime copy; CI keeps it in
    sync with docs/specs/transcription-capability-registry.json)."""
    raw = (
        resources.files("openrater.rates.ingest")
        .joinpath("capability_registry.json")
        .read_text(encoding="utf-8")
    )
    return json.loads(raw)


def _registry_message(registry: dict[str, Any], construct_id: str) -> str:
    for c in registry.get("constructs", []):
        if c.get("id") == construct_id:
            return str(c.get("message", construct_id))
    return construct_id


def _num(v: Any) -> float | None:
    """A numeric cell value, or None when it isn't one. Strings are
    NOT coerced (R-005 — numbers must be numbers)."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _num_or_inf(v: Any) -> float | None:
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("-inf", "-infinity"):
            return float("-inf")
        if s in ("+inf", "inf", "+infinity"):
            return float("inf")
        return None
    return _num(v)


def _bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        s = v.strip().lower()
        if s == "true":
            return True
        if s == "false":
            return False
    return None


def _csv(v: Any) -> list[str]:
    if v is None:
        return []
    return [p.strip() for p in str(v).split(",") if p.strip()]


class _Lint:
    def __init__(self, wb: ParsedWorkbook, registry: dict[str, Any]) -> None:
        self.wb = wb
        self.registry = registry
        self.issues: list[CheckIssue] = []
        # Cross-sheet lookups built as we go.
        self.input_names: set[str] = set()
        self.required_inputs_without_default: set[str] = set()
        # Brief 95 C2 — validated derived inputs: slug -> sum operands.
        self.derived_inputs: dict[str, list[str]] = {}
        self.dim_shapes: dict[str, str] = {}
        self.dim_levels: dict[str, set[str]] = {}
        self.dim_level_kinds: dict[str, set[str]] = {}
        self.territory_refs: dict[str, set[str]] = {}
        # Geographic dims: slug -> (granularity, scope) once R-064
        # passes; dims whose levels carry territory_members. Feed the
        # R-083…R-086 universe checks.
        self.dim_geo: dict[str, tuple[str, str]] = {}
        self.dims_with_members: set[str] = set()
        self.table_slugs: set[str] = set()
        self.stage_ids: set[str] = set()
        self.adjustment_ids: set[str] = set()
        self.output_fields: set[str] = set()

    # -- plumbing -----------------------------------------------------------

    def add(self, rule: str, severity: str, message: str, *, sheet: str | None = None,
            cell: str | None = None) -> None:
        self.issues.append(issue(rule, severity, message, sheet=sheet, cell=cell))  # type: ignore[arg-type]

    def require_cell(self, row: Row, col: str, sheet: str) -> Any:
        """Per-row required cell — absent ⇒ R-003 at the row."""
        v = row.get(col)
        if v is None:
            self.add(
                "R-003",
                "error",
                f"Row {row.index}: required column '{col}' is empty.",
                sheet=sheet,
                cell=f"A{row.index}",
            )
        return v

    def check_slug(self, v: Any, sheet: str, cell: str | None, what: str) -> str | None:
        if v is None:
            return None
        s = str(v)
        if not _SLUG.match(s):
            self.add(
                "R-006",
                "error",
                f"{what} '{s}' isn't a valid slug — lowercase snake_case, "
                "a-z 0-9 _ -, max 80 chars.",
                sheet=sheet,
                cell=cell,
            )
            return None
        return s

    def check_number(self, v: Any, sheet: str, cell: str | None, what: str) -> float | None:
        n = _num(v)
        if n is None and v is not None:
            self.add(
                "R-005",
                "error",
                f"{what} must be a number cell (no text, currency symbols, or "
                f"thousands separators) — got {v!r}.",
                sheet=sheet,
                cell=cell,
            )
        return n

    # -- plan ---------------------------------------------------------------

    REQUIRED_PLAN_FIELDS = (
        "spec_version",
        "rating_plan_id",
        "display_name",
        "version",
        "carrier",
        "product",
        "jurisdiction_country",
        "effective_date",
        "coverages",
    )

    def lint_plan(self) -> None:
        wb = self.wb
        if not wb.plan_sheet_present:
            return
        for f in self.REQUIRED_PLAN_FIELDS:
            if wb.plan_value(f) in (None, ""):
                self.add(
                    "R-027",
                    "error",
                    f"The plan sheet is missing required field '{f}'.",
                    sheet="plan",
                )

        sv = wb.plan_value("spec_version")
        if sv is not None:
            sv_s = f"{sv:.1f}" if isinstance(sv, float) else str(sv)
            if isinstance(sv, int):
                sv_s = f"{sv}.0"
            if sv_s != "1.0":
                self.add(
                    "R-032",
                    "error",
                    f"spec_version {sv_s!r} isn't known to this reader "
                    "(it reads spec 1.x; this workbook must declare 1.0).",
                    sheet="plan",
                    cell=wb.plan.get("spec_version").cell if "spec_version" in wb.plan else None,
                )

        self.check_slug(wb.plan_value("rating_plan_id"), "plan",
                        wb.plan["rating_plan_id"].cell if "rating_plan_id" in wb.plan else None,
                        "rating_plan_id")

        product = wb.plan_value("product")
        if product is not None and str(product) not in PRODUCT_CODES:
            self.add(
                "R-028",
                "error",
                f"product {product!r} isn't a platform product code "
                f"({', '.join(PRODUCT_CODES)}).",
                sheet="plan",
                cell=wb.plan["product"].cell,
            )

        state = wb.plan_value("state")
        if state not in (None, "") and not _STATE.match(str(state)):
            self.add(
                "R-029",
                "error",
                f"state {state!r} must be a 2-letter code (or empty for multistate).",
                sheet="plan",
                cell=wb.plan["state"].cell,
            )

        eff = wb.plan_value("effective_date")
        if eff is not None:
            ok = isinstance(eff, (datetime, date)) or (
                isinstance(eff, str) and _DATE.match(eff)
            )
            if not ok:
                self.add(
                    "R-030",
                    "error",
                    f"effective_date {eff!r} must be YYYY-MM-DD.",
                    sheet="plan",
                    cell=wb.plan["effective_date"].cell,
                )

        if "coverages" in wb.plan and not wb.coverages():
            self.add(
                "R-031",
                "error",
                "coverages must list at least one coverage id.",
                sheet="plan",
                cell=wb.plan["coverages"].cell,
            )
        for cov in wb.coverages():
            self.check_slug(cov, "plan", wb.plan["coverages"].cell, f"coverage '{cov}'")
        # Brief 95 C4 (R-048) — election markers: at least one coverage
        # must stay REQUIRED (a policy that can elect out of everything
        # has nothing to rate).
        electives = wb.elective_coverages()
        if wb.coverages() and electives and not (set(wb.coverages()) - electives):
            self.add(
                "R-048",
                "error",
                "Every coverage is marked electable (`?`) — at least one "
                "must stay required.",
                sheet="plan",
                cell=wb.plan["coverages"].cell,
            )

    # -- inputs ---------------------------------------------------------------

    #: Brief 95 C2 — the derived-input grammar (spec §4.2). `sum(a,b,…)`
    #: is supported; `div(a,<const>)` is recognized and named-deferred to
    #: class-conditional exposure (Brief 95 C3).
    _DERIVED_SUM_RE = re.compile(r"^sum\(\s*([a-z0-9_,\s-]+)\)$")
    _DERIVED_DIV_RE = re.compile(r"^div\(")
    _NUMERIC_INPUT_TYPES = frozenset({"number", "currency"})

    def lint_inputs(self) -> None:
        t = self.wb.inputs
        if t is None:
            return
        seen: dict[str, int] = {}
        derived_rows: list[tuple[str, Any, str]] = []  # (slug, row, raw expr)
        data_types: dict[str, str] = {}
        for row in t.rows:
            name = self.require_cell(row, "name", t.sheet)
            slug = self.check_slug(name, t.sheet, row.ref("name"), "Input name")
            if slug:
                if slug in seen:
                    self.add(
                        "R-040",
                        "error",
                        f"Input '{slug}' is declared twice (rows {seen[slug]} and {row.index}).",
                        sheet=t.sheet,
                        cell=row.ref("name"),
                    )
                seen[slug] = row.index
                self.input_names.add(slug)

            dt = self.require_cell(row, "data_type", t.sheet)
            if dt is not None and str(dt) not in INPUT_DATA_TYPES:
                self.add(
                    "R-041",
                    "error",
                    f"data_type {dt!r} isn't one of {sorted(INPUT_DATA_TYPES)}.",
                    sheet=t.sheet,
                    cell=row.ref("data_type"),
                )
            if slug and dt is not None:
                data_types[slug] = str(dt)
            if slug and row.get("derived_from") is not None:
                derived_rows.append((slug, row, str(row.get("derived_from")).strip()))

            required = _bool(self.require_cell(row, "required", t.sheet))
            allowed = _csv(row.get("allowed_values"))
            default = row.get("default_value")

            if str(dt) == "enum" and not allowed:
                self.add(
                    "R-042",
                    "error",
                    f"Input '{slug or name}' is an enum but declares no allowed_values.",
                    sheet=t.sheet,
                    cell=row.ref("data_type"),
                )
            if default is not None and allowed and str(default) not in allowed:
                self.add(
                    "R-043",
                    "error",
                    f"default_value {default!r} isn't among allowed_values.",
                    sheet=t.sheet,
                    cell=row.ref("default_value"),
                )
            if default is not None:
                lo, hi = _num(row.get("min")), _num(row.get("max"))
                dn = _num(default)
                if dn is not None and (
                    (lo is not None and dn < lo) or (hi is not None and dn > hi)
                ):
                    self.add(
                        "R-043",
                        "error",
                        f"default_value {default!r} is outside min..max.",
                        sheet=t.sheet,
                        cell=row.ref("default_value"),
                    )

            if slug and required is True and default is None:
                self.required_inputs_without_default.add(slug)

        # ── Brief 95 C2 — derived inputs (post-pass: operands may be
        # declared later in the sheet than their consumer) ───────────────
        derived_slugs = {slug for slug, _row, _raw in derived_rows}
        for slug, row, raw in derived_rows:
            cell = row.ref("derived_from")
            if self._DERIVED_DIV_RE.match(raw):
                self.add(
                    "R-045",
                    "error",
                    f"Input '{slug}': div(…) is named-deferred to "
                    "class-conditional exposure (Brief 95 C3) — today the "
                    "derived-input grammar is sum(<input>,<input>,…). "
                    "Until then, supply the divided value as a plain input "
                    "and record the convention in gaps_and_assumptions.",
                    sheet=t.sheet,
                    cell=cell,
                )
                continue
            m = self._DERIVED_SUM_RE.match(raw)
            if not m:
                self.add(
                    "R-045",
                    "error",
                    f"Input '{slug}': derived_from {raw!r} doesn't parse — "
                    "the grammar is sum(<input>,<input>,…) over declared "
                    "input names.",
                    sheet=t.sheet,
                    cell=cell,
                )
                continue
            operands = [p.strip() for p in m.group(1).split(",") if p.strip()]
            if len(operands) < 2:
                self.add(
                    "R-045",
                    "error",
                    f"Input '{slug}': sum(…) needs at least two operands "
                    f"(got {len(operands)}).",
                    sheet=t.sheet,
                    cell=cell,
                )
                continue
            bad = False
            for op in operands:
                if op not in self.input_names:
                    self.add(
                        "R-045",
                        "error",
                        f"Input '{slug}': operand '{op}' is not a declared "
                        "input.",
                        sheet=t.sheet,
                        cell=cell,
                    )
                    bad = True
                elif op in derived_slugs:
                    self.add(
                        "R-045",
                        "error",
                        f"Input '{slug}': operand '{op}' is itself derived — "
                        "operands must be plain (non-derived) inputs.",
                        sheet=t.sheet,
                        cell=cell,
                    )
                    bad = True
                elif data_types.get(op) not in self._NUMERIC_INPUT_TYPES:
                    self.add(
                        "R-045",
                        "error",
                        f"Input '{slug}': operand '{op}' has data_type "
                        f"{data_types.get(op)!r} — sum(…) operands must be "
                        "number or currency.",
                        sheet=t.sheet,
                        cell=cell,
                    )
                    bad = True
            if data_types.get(slug) not in self._NUMERIC_INPUT_TYPES:
                self.add(
                    "R-045",
                    "error",
                    f"Input '{slug}' is derived, so its data_type must be "
                    f"number or currency (got {data_types.get(slug)!r}).",
                    sheet=t.sheet,
                    cell=cell,
                )
                bad = True
            required = _bool(row.get("required"))
            if required is True or row.get("default_value") is not None:
                self.add(
                    "R-046",
                    "error",
                    f"Input '{slug}' is derived — the platform computes it "
                    "from its operands, so it is never row-supplied: declare "
                    "required=false and no default_value.",
                    sheet=t.sheet,
                    cell=row.ref("required"),
                )
            if not bad:
                self.derived_inputs[slug] = operands

    # -- dimensions + levels --------------------------------------------------

    def lint_dimensions(self) -> None:
        t = self.wb.dimensions
        if t is None:
            return
        seen: dict[str, int] = {}
        composites: list[tuple[Row, list[str]]] = []
        for row in t.rows:
            slug = self.check_slug(
                self.require_cell(row, "slug", t.sheet), t.sheet, row.ref("slug"), "Dimension slug"
            )
            shape = self.require_cell(row, "shape", t.sheet)
            role = self.require_cell(row, "role", t.sheet)
            dt = self.require_cell(row, "data_type", t.sheet)
            for value, domain, label in (
                (shape, DIM_SHAPES, "shape"),
                (role, DIM_ROLES, "role"),
                (dt, INPUT_DATA_TYPES, "data_type"),
                (row.get("dimension_type"), DIM_TYPES, "dimension_type"),
            ):
                if value is not None and str(value) not in domain:
                    self.add(
                        "R-061",
                        "error",
                        f"{label} {value!r} isn't one of {sorted(domain)}.",
                        sheet=t.sheet,
                        cell=row.ref(label) or row.ref("slug"),
                    )
            if slug:
                if slug in seen:
                    self.add(
                        "R-060",
                        "error",
                        f"Dimension '{slug}' is declared twice (rows {seen[slug]} and {row.index}).",
                        sheet=t.sheet,
                        cell=row.ref("slug"),
                    )
                seen[slug] = row.index
                self.dim_shapes[slug] = str(shape) if shape else ""

            if str(shape) == "geographic":
                gran = row.get("geo_granularity")
                scope = row.get("geo_scope")
                if gran is None or scope is None or str(gran) not in GEO_GRANULARITIES:
                    self.add(
                        "R-064",
                        "error",
                        f"Geographic dimension '{slug}' needs geo_granularity "
                        f"({'/'.join(sorted(GEO_GRANULARITIES))}) and geo_scope.",
                        sheet=t.sheet,
                        cell=row.ref("slug"),
                    )
                else:
                    self.dim_geo[str(slug)] = (str(gran), str(scope))
            if str(shape) == "composite":
                composites.append((row, _csv(row.get("axes"))))

        for row, axes in composites:
            bad = (
                len(axes) < 2
                or len(axes) > 3
                or len(set(axes)) != len(axes)
                or any(a not in seen for a in axes)
                or any(self.dim_shapes.get(a) == "composite" for a in axes)
            )
            if bad:
                self.add(
                    "R-065",
                    "error",
                    f"Composite axes {axes!r} must be 2-3 distinct, existing, "
                    "non-composite dimensions.",
                    sheet=t.sheet,
                    cell=row.ref("axes") or row.ref("slug"),
                )

    def lint_levels(self) -> None:
        t = self.wb.dimension_levels
        if t is not None:
            banded: dict[str, list[tuple[float, float, Row]]] = {}
            seen: dict[tuple[str, str], int] = {}
            for row in t.rows:
                dim = self.require_cell(row, "dimension_slug", t.sheet)
                kind = self.require_cell(row, "kind", t.sheet)
                raw_level = self.require_cell(row, "level_id", t.sheet)
                if raw_level is not None and str(raw_level) == DEFAULT_KEY:
                    self.add(
                        "R-008",
                        "error",
                        "'__default__' is reserved — never a real level id. "
                        "(Filed 'all other' rows belong in the factor table's "
                        "__default__ row, not in dimension_levels.)",
                        sheet=t.sheet,
                        cell=row.ref("level_id"),
                    )
                    continue
                level = self.check_slug(
                    raw_level, t.sheet, row.ref("level_id"), "Level id"
                )
                if dim is not None and str(dim) not in self.dim_shapes:
                    self.add(
                        "R-068",
                        "error",
                        f"dimension_slug '{dim}' isn't declared on the dimensions sheet.",
                        sheet=t.sheet,
                        cell=row.ref("dimension_slug"),
                    )
                    continue
                if dim is None or level is None:
                    continue
                dim_s = str(dim)
                key = (dim_s, level)
                if key in seen:
                    self.add(
                        "R-067",
                        "error",
                        f"Level '{level}' of '{dim_s}' is declared twice "
                        f"(rows {seen[key]} and {row.index}).",
                        sheet=t.sheet,
                        cell=row.ref("level_id"),
                    )
                seen[key] = row.index
                self.dim_levels.setdefault(dim_s, set()).add(level)
                self.dim_level_kinds.setdefault(dim_s, set()).add(str(kind))
                tref = row.get("territory_ref")
                if tref is not None:
                    self.territory_refs.setdefault(dim_s, set()).add(str(tref))
                if _csv(row.get("territory_members")):
                    self.dims_with_members.add(dim_s)

                if str(kind) == "banded":
                    lo = _num_or_inf(row.get("min"))
                    hi = _num_or_inf(row.get("max"))
                    if row.get("min") is not None and lo is None:
                        self.check_number(row.get("min"), t.sheet, row.ref("min"), "min")
                    if row.get("max") is not None and hi is None:
                        self.check_number(row.get("max"), t.sheet, row.ref("max"), "max")
                    if lo is None or hi is None:
                        self.add(
                            "R-003",
                            "error",
                            f"Banded level '{level}' needs both min and max "
                            "(use -inf/+inf for open ends).",
                            sheet=t.sheet,
                            cell=row.ref("level_id"),
                        )
                        continue
                    if not lo < hi:
                        self.add(
                            "R-069",
                            "error",
                            f"Band '{level}' has non-positive width ({lo} .. {hi}).",
                            sheet=t.sheet,
                            cell=row.ref("min") or row.ref("level_id"),
                        )
                    banded.setdefault(dim_s, []).append((lo, hi, row))

            for dim_s, bands in banded.items():
                bands.sort(key=lambda b: b[0])
                for i, (lo, hi, row) in enumerate(bands):
                    if lo == float("-inf") and i != 0:
                        self.add(
                            "R-063", "error",
                            f"'{dim_s}': only the first band may open at -inf.",
                            sheet=t.sheet, cell=row.ref("min"),
                        )
                    if hi == float("inf") and i != len(bands) - 1:
                        self.add(
                            "R-063", "error",
                            f"'{dim_s}': only the last band may close at +inf.",
                            sheet=t.sheet, cell=row.ref("max"),
                        )
                    if i > 0:
                        prev_hi = bands[i - 1][1]
                        if lo != prev_hi:
                            kind = "overlaps" if lo < prev_hi else "leaves a gap after"
                            self.add(
                                "R-062",
                                "error",
                                f"Band {lo}–{hi} {kind} the previous band of "
                                f"'{dim_s}'. Bands must not overlap — every value "
                                "should land in exactly one band.",
                                sheet=t.sheet,
                                cell=row.ref("min") or row.ref("level_id"),
                            )

        # R-066 — dims that require levels.
        dims = self.wb.dimensions
        if dims is not None:
            for row in dims.rows:
                slug = row.get("slug")
                if slug is None:
                    continue
                slug_s = str(slug)
                shape = str(row.get("shape") or "")
                dt = str(row.get("data_type") or "")
                kinds = self.dim_level_kinds.get(slug_s, set())
                if shape == "banded" and "banded" not in kinds:
                    self.add(
                        "R-066", "error",
                        f"Banded dimension '{slug_s}' has no banded levels in dimension_levels.",
                        sheet=dims.sheet, cell=row.ref("slug"),
                    )
                if dt == "enum" and shape != "composite" and not self.dim_levels.get(slug_s):
                    self.add(
                        "R-066", "error",
                        f"Enum dimension '{slug_s}' has no levels in dimension_levels.",
                        sheet=dims.sheet, cell=row.ref("slug"),
                    )

    # -- geo sheets -------------------------------------------------------------

    def lint_geo(self) -> None:
        sheet_slugs = {g.slug for g in self.wb.geo_sheets}
        for geo in self.wb.geo_sheets:
            if self.dim_shapes.get(geo.slug) != "geographic":
                self.add(
                    "R-080",
                    "error",
                    f"Sheet '{geo.sheet}' has no matching geographic dimension "
                    f"'{geo.slug}'.",
                    sheet=geo.sheet,
                )
                continue
            refs = self.territory_refs.get(geo.slug, set())
            seen: dict[str, int] = {}
            for row in geo.table.rows:
                key = row.get("zip") or row.get("county")
                if key is not None:
                    k = str(key)
                    if k in seen:
                        self.add(
                            "R-081", "error",
                            f"Duplicate key {k!r} (rows {seen[k]} and {row.index}).",
                            sheet=geo.sheet, cell=row.ref("zip") or row.ref("county"),
                        )
                    seen[k] = row.index
                code = self.require_cell(row, "territory_code", geo.sheet)
                if code is not None and str(code) not in refs:
                    self.add(
                        "R-082",
                        "error",
                        f"territory_code {code!r} doesn't match any level's "
                        f"territory_ref on dimension '{geo.slug}'.",
                        sheet=geo.sheet,
                        cell=row.ref("territory_code"),
                    )
            self._lint_geo_universe(geo.slug, geo.sheet, set(seen))

        # R-086 — geographic declared, but no geographic indicator
        # anywhere. Geography engages only with ZIP/county detail; a
        # bare territory list is a plain categorical dimension.
        for slug, (gran, _scope) in self.dim_geo.items():
            if (
                gran in ("zip", "county")
                and slug not in sheet_slugs
                and slug not in self.dims_with_members
            ):
                self.add(
                    "R-086",
                    "warning",
                    f"Dimension '{slug}' is declared geographic ({gran}) but "
                    f"carries no geographic indicator — no 'geo.{slug}' sheet "
                    "and no territory_members. If the filing defines "
                    "territories only as codes, transcribe a plain "
                    "categorical dimension instead.",
                    sheet="dimensions",
                )

    def _lint_geo_universe(
        self, slug: str, sheet: str, keys: set[str]
    ) -> None:
        """R-083…R-085 — the geo sheet against the Census universe.

        Coverage holes surface HERE, at validate time, instead of as
        quote-time refusals: in-scope keys never mapped (R-083,
        notice — a consequence, not a defect: a program may write
        only part of its state, and unmapped keys refuse honestly),
        keys outside the declared scope (R-084, warning — typos or a
        wrong scope), and keys the Census universe doesn't know at
        all (R-085, notice — PO-box ZIPs have no ZCTA; typos look
        like this too).
        """
        meta = self.dim_geo.get(slug)
        if meta is None:
            return
        gran, scope = meta
        universe = load_geo_universe().get(gran)
        if universe is None:  # state grain carries no geo-sheet detail
            return
        states: list[str] | None = None
        if scope.startswith("subset:"):
            states = [
                s.strip() for s in scope[len("subset:") :].split(",") if s.strip()
            ]
        in_scope = universe.in_states(states)
        noun = "ZCTA" if gran == "zip" else "county"

        unknown = sorted(k for k in keys if k not in universe.state_of)
        if unknown:
            sample = ", ".join(unknown[:5]) + ("…" if len(unknown) > 5 else "")
            self.add(
                "R-085",
                "notice",
                f"{len(unknown)} key(s) in 'geo.{slug}' aren't in the Census "
                f"{noun} universe: {sample}. PO-box ZIPs have no ZCTA; typos "
                "look like this too.",
                sheet=sheet,
            )

        if states is not None:
            stray = sorted(
                (k, universe.state_of[k])
                for k in keys
                if k in universe.state_of and universe.state_of[k] not in states
            )
            if stray:
                sample = ", ".join(f"{k} ({s})" for k, s in stray[:5]) + (
                    "…" if len(stray) > 5 else ""
                )
                self.add(
                    "R-084",
                    "warning",
                    f"{len(stray)} key(s) in 'geo.{slug}' sit outside the "
                    f"declared scope ({scope}): {sample}.",
                    sheet=sheet,
                )

        unmapped = sorted(in_scope - keys)
        if unmapped:
            mapped = len(keys & in_scope)
            sample = ", ".join(unmapped[:5]) + ("…" if len(unmapped) > 5 else "")
            self.add(
                "R-083",
                "notice",
                f"'geo.{slug}' maps {mapped} of {len(in_scope)} {noun}s in "
                f"the declared scope ({scope}); {len(unmapped)} unmapped — an "
                f"unmapped {noun} refuses at rating time. Unmapped: {sample}",
                sheet=sheet,
            )

    # -- factor tables ------------------------------------------------------------

    def _keys_of(self, dim: str) -> set[str]:
        return self.dim_levels.get(dim, set())

    def lint_factor_table(self, ft: FactorTable) -> None:
        sheet = ft.sheet
        self.table_slugs.add(ft.slug)

        table_id = ft.meta_value("table_id")
        if table_id is not None and str(table_id) != ft.slug:
            self.add(
                "R-101",
                "error",
                f"table_id {table_id!r} must equal the sheet-name suffix '{ft.slug}'.",
                sheet=sheet,
                cell=ft.meta_ref("table_id"),
            )

        dimensionality = str(ft.meta_value("dimensionality") or "1d")
        for value, domain, label in (
            (ft.meta_value("dimensionality"), {"1d", "2d"}, "dimensionality"),
            (ft.meta_value("lookup_method"), LOOKUP_METHODS, "lookup_method"),
            (ft.meta_value("interpolation"), INTERPOLATIONS, "interpolation"),
        ):
            if value is not None and str(value) not in domain:
                self.add(
                    "R-102",
                    "error",
                    f"{label} {value!r} isn't one of {sorted(domain)}.",
                    sheet=sheet,
                    cell=ft.meta_ref(label),
                )

        row_dim = ft.meta_value("row_dimension")
        col_dim = ft.meta_value("col_dimension")
        if row_dim is not None and str(row_dim) not in self.dim_shapes:
            self.add(
                "R-103",
                "error",
                f"row_dimension '{row_dim}' isn't a declared dimension.",
                sheet=sheet,
                cell=ft.meta_ref("row_dimension"),
            )
        if dimensionality == "2d":
            if col_dim is None:
                self.add(
                    "R-100",
                    "error",
                    "A 2d table needs col_dimension in its metadata block.",
                    sheet=sheet,
                    cell="A1",
                )
            elif str(col_dim) not in self.dim_shapes:
                self.add(
                    "R-103",
                    "error",
                    f"col_dimension '{col_dim}' isn't a declared dimension.",
                    sheet=sheet,
                    cell=ft.meta_ref("col_dimension"),
                )

        # Brief 95 C5 (registry r9) — linear interpolation is SUPPORTED
        # on both table shapes now; R-111 downgrades to a notice naming
        # each interpolating table (an FYI, never a caveat).  —
        # the notice is ONE user sentence; ADR/Brief provenance lives in
        # the spec and the registry, never in user output.
        if str(ft.meta_value("interpolation") or "stepped") == "linear":
            self.add(
                "R-111",
                "notice",
                f"Table '{ft.slug}' interpolates linearly between band "
                "lower bounds; the ends clamp. Tables without the flag "
                "step.",
                sheet=sheet,
                cell=ft.meta_ref("interpolation"),
            )

        row_keys = self._keys_of(str(row_dim)) if row_dim is not None else set()
        col_keys = self._keys_of(str(col_dim)) if col_dim is not None else set()

        if dimensionality == "2d":
            if not ft.grid:
                self.add("R-109", "error", "The matrix has no factor cells.", sheet=sheet)
            seen_rows: dict[str, str] = {}
            for cv in ft.row_labels:
                label = str(cv.value)
                if label == DEFAULT_KEY or (row_keys and label not in row_keys):
                    self.add(
                        "R-104",
                        "error",
                        f"Row label {label!r} isn't a level of dimension '{row_dim}'.",
                        sheet=sheet,
                        cell=cv.cell,
                    )
                if label in seen_rows:
                    self.add(
                        "R-106", "error",
                        f"Row label {label!r} appears twice.",
                        sheet=sheet, cell=cv.cell,
                    )
                seen_rows[label] = cv.cell
            seen_cols: dict[str, str] = {}
            for cv in ft.col_labels:
                label = str(cv.value)
                if col_keys and label not in col_keys:
                    self.add(
                        "R-105",
                        "error",
                        f"Column label {label!r} isn't a level of dimension '{col_dim}'.",
                        sheet=sheet,
                        cell=cv.cell,
                    )
                if label in seen_cols:
                    self.add(
                        "R-106", "error",
                        f"Column label {label!r} appears twice.",
                        sheet=sheet, cell=cv.cell,
                    )
                seen_cols[label] = cv.cell
            for gc in ft.grid:
                n = self.check_number(gc.factor, sheet, gc.cell, "Factor")
                if n is not None and not (n > 0 and n != float("inf")):
                    self.add(
                        "R-107",
                        "error",
                        f"Factor {n} must be finite and > 0.",
                        sheet=sheet,
                        cell=gc.cell,
                    )
            if ft.meta_value("citation_rule") is None:
                self.add(
                    "R-201",
                    "warning",
                    f"No citation_rule — where in the filing does table "
                    f"'{ft.slug}' come from?",
                    sheet=sheet,
                )
            return

        # 1-D
        if not ft.rows_1d:
            self.add("R-109", "error", "The grid has no factor rows.", sheet=sheet)
        seen: dict[str, int] = {}
        defaults = 0
        rows_missing_citation = 0
        for row in ft.rows_1d:
            key = self.require_cell(row, "level_id", sheet)
            factor = self.require_cell(row, "factor", sheet)
            if key is not None:
                k = str(key)
                if k in seen:
                    self.add(
                        "R-106",
                        "error",
                        f"Key {k!r} appears twice (rows {seen[k]} and {row.index}).",
                        sheet=sheet,
                        cell=row.ref("level_id"),
                    )
                seen[k] = row.index
                if k == DEFAULT_KEY:
                    defaults += 1
                elif row_keys and k not in row_keys:
                    self.add(
                        "R-104",
                        "error",
                        f"Row key {k!r} isn't a level of dimension '{row_dim}'. "
                        "Every row key must match a declared level.",
                        sheet=sheet,
                        cell=row.ref("level_id"),
                    )
            n = self.check_number(factor, sheet, row.ref("factor"), "Factor")
            if n is not None and not (n > 0 and n != float("inf")):
                self.add(
                    "R-107",
                    "error",
                    f"Factor {n} must be finite and > 0.",
                    sheet=sheet,
                    cell=row.ref("factor"),
                )
            if row.get("citation_rule") is None:
                rows_missing_citation += 1
        if defaults > 1:
            self.add(
                "R-108",
                "error",
                f"'{DEFAULT_KEY}' appears {defaults} times — at most once per table.",
                sheet=sheet,
            )
        if rows_missing_citation and ft.meta_value("citation_rule") is None:
            self.add(
                "R-201",
                "warning",
                f"{rows_missing_citation} row(s) carry no citation_rule and the "
                "table has no table-level citation — where in the filing does "
                f"'{ft.slug}' come from?",
                sheet=sheet,
            )

    # -- chains ------------------------------------------------------------------

    def lint_chains(self) -> None:
        t = self.wb.chains
        if t is None:
            return
        coverages = set(self.wb.coverages())
        blocks: dict[tuple[str, str], list[tuple[float, str, Row]]] = {}
        seen_ids: dict[tuple[str, str], int] = {}
        for row in t.rows:
            coverage = self.require_cell(row, "coverage", t.sheet)
            order = self.require_cell(row, "order", t.sheet)
            kind = self.require_cell(row, "stage_kind", t.sheet)
            stage_id = self.check_slug(
                self.require_cell(row, "stage_id", t.sheet),
                t.sheet,
                row.ref("stage_id"),
                "Stage id",
            )
            order_n = self.check_number(order, t.sheet, row.ref("order"), "order")

            if coverage is not None and coverages and str(coverage) not in coverages:
                self.add(
                    "R-120",
                    "error",
                    f"coverage {coverage!r} isn't in plan.coverages "
                    f"({', '.join(sorted(coverages))}).",
                    sheet=t.sheet,
                    cell=row.ref("coverage"),
                )
            kind_s = str(kind) if kind is not None else ""
            if kind is not None and kind_s not in STAGE_KINDS:
                self.add(
                    "R-125",
                    "error",
                    f"stage_kind {kind!r} isn't one of {sorted(STAGE_KINDS)}.",
                    sheet=t.sheet,
                    cell=row.ref("stage_kind"),
                )
            if kind_s == "flat_factor":
                # Use one user-facing sentence; the registry keeps
                # the engineering provenance.
                self.add(
                    "R-190",
                    "error",
                    "Constant chain factor — a chain step can't key a "
                    "lookup on a constant, and an unkeyable step would "
                    "silently change the premium, so the check refuses "
                    "it.",
                    sheet=t.sheet,
                    cell=row.ref("stage_kind"),
                )

            if stage_id and coverage is not None:
                key = (str(coverage), stage_id)
                if key in seen_ids:
                    self.add(
                        "R-126",
                        "error",
                        f"Stage id '{stage_id}' appears twice in coverage "
                        f"'{coverage}' (rows {seen_ids[key]} and {row.index}).",
                        sheet=t.sheet,
                        cell=row.ref("stage_id"),
                    )
                seen_ids[key] = row.index
                self.stage_ids.add(stage_id)

            if kind_s in LOOKUP_KINDS:
                table = row.get("factor_table")
                dim = row.get("dimension")
                if table is None or dim is None:
                    self.add(
                        "R-003",
                        "error",
                        f"Row {row.index}: a {kind_s} stage needs both factor_table "
                        "and dimension.",
                        sheet=t.sheet,
                        cell=f"A{row.index}",
                    )
                if table is not None:
                    slug = str(table)
                    slug = slug[len("ft.") :] if slug.startswith("ft.") else slug
                    if slug not in self.table_slugs:
                        self.add(
                            "R-121",
                            "error",
                            f"Stage references factor table 'ft.{slug}', but no such "
                            "sheet exists. Add the sheet, or point the stage at a "
                            "table that exists.",
                            sheet=t.sheet,
                            cell=row.ref("factor_table"),
                        )
                if dim is not None and str(dim) not in self.dim_shapes:
                    self.add(
                        "R-122",
                        "error",
                        f"dimension '{dim}' isn't a declared dimension.",
                        sheet=t.sheet,
                        cell=row.ref("dimension"),
                    )
            elif kind_s == "base" and row.get("value") is None and row.get("input_binding") is None:
                self.add(
                    "R-124", "error",
                    "A base stage needs value or input_binding.",
                    sheet=t.sheet, cell=f"A{row.index}",
                )
            elif kind_s == "lcm" and row.get("value") is None and row.get("input_binding") is None:
                self.add(
                    "R-124", "error",
                    "An lcm stage needs value or input_binding.",
                    sheet=t.sheet, cell=f"A{row.index}",
                )
            elif kind_s == "exposure" and (
                row.get("input_binding") is None or row.get("exposure_divisor") is None
            ):
                self.add(
                    "R-124", "error",
                    "An exposure stage needs input_binding and exposure_divisor.",
                    sheet=t.sheet, cell=f"A{row.index}",
                )
            elif kind_s == "flat_factor" and row.get("value") is None:
                self.add(
                    "R-124", "error",
                    "A flat_factor stage needs value.",
                    sheet=t.sheet, cell=f"A{row.index}",
                )

            for col in ("value", "exposure_divisor"):
                if row.get(col) is not None:
                    self.check_number(row.get(col), t.sheet, row.ref(col), col)

            self._check_predicate(
                row.get("predicate"), t.sheet, row.ref("predicate"),
                equality_only=True,
            )
            self._check_input_binding(kind_s, row, t.sheet)
            self._consume_binding(row.get("input_binding"), t.sheet, row.ref("input_binding"))

            if coverage is not None and order_n is not None:
                blk = (str(coverage), str(row.get("coverage_value") or ""))
                blocks.setdefault(blk, []).append((order_n, kind_s, row))

        for (coverage, cov_value), stages in blocks.items():
            stages.sort(key=lambda s: s[0])
            label = coverage if not cov_value else f"{coverage}/{cov_value}"
            if not any(k == "base" for _o, k, _r in stages):
                self.add(
                    "R-123",
                    "error",
                    f"Coverage block '{label}' has no base stage.",
                    sheet=t.sheet,
                    cell=f"A{stages[0][2].index}",
                )
            elif stages[0][1] != "base":
                self.add(
                    "R-123",
                    "error",
                    f"Coverage block '{label}' must start with its base stage "
                    f"(lowest order), found '{stages[0][1]}'.",
                    sheet=t.sheet,
                    cell=f"A{stages[0][2].index}",
                )

        # Brief 95 C4 (R-048) — an electable coverage needs an exposure
        # stage: election reads the exposure (an explicit 0 elects out).
        # A marker on a coverage with no exposure row — or no chain at
        # all — has no signal to read.
        electives = self.wb.elective_coverages()
        chain_kinds: dict[str, set[str]] = {}
        for (coverage, _cv), stages in blocks.items():
            chain_kinds.setdefault(coverage, set()).update(
                k for _o, k, _r in stages
            )
        for cov in sorted(electives):
            kinds = chain_kinds.get(cov)
            if kinds is None or "exposure" not in kinds:
                self.add(
                    "R-048",
                    "error",
                    f"Coverage '{cov}' is marked electable (`{cov}?`) but "
                    + (
                        "has no chain block"
                        if kinds is None
                        else "its chain has no exposure stage"
                    )
                    + " — election reads the exposure (an explicit 0 "
                    "elects out). Add the exposure row, or drop the `?`.",
                    sheet=t.sheet,
                )

    def _check_input_binding(self, kind: str, row: Row, sheet: str) -> None:
        """R-127 — the §4.6 `input_binding` grammar. Three forms:
        `form_input.<name>` (R-044 checks it is declared),
        `literal:<number>`, and `context.lcm` — the last on `lcm` rows
        only, and only when the plan sheet carries an `lcm` value to
        resolve it from. Enforced check-side so a clean workbook never
        builds a plan whose engine run refuses on a path-shaped ghost
        input (`externalInputs["literal:250"]`), and never hits the
        builder's context.lcm refusal."""
        binding = row.get("input_binding")
        if binding is None:
            return
        s = str(binding).strip()
        cell = row.ref("input_binding")
        if s.startswith(INPUT_BINDING_FORM_PREFIX):
            if len(s) > len(INPUT_BINDING_FORM_PREFIX):
                return
            self.add(
                "R-127",
                "error",
                "input_binding 'form_input.' names no field — write "
                "form_input.<name> for a declared input.",
                sheet=sheet,
                cell=cell,
            )
            return
        if _LITERAL_BINDING.match(s):
            return
        if s == CONTEXT_LCM_BINDING:
            if kind != "lcm":
                self.add(
                    "R-127",
                    "error",
                    f"context.lcm binds only lcm stages — this is a "
                    f"'{kind or '?'}' stage. Bind a form_input.<name> or a "
                    "literal:<number> here.",
                    sheet=sheet,
                    cell=cell,
                )
            elif self.wb.plan_value("lcm") is None:
                self.add(
                    "R-127",
                    "error",
                    "context.lcm points at the plan sheet's `lcm` value, but "
                    "the plan sheet has no `lcm` field. Add one, or put the "
                    "multiplier in this row's value column.",
                    sheet=sheet,
                    cell=cell,
                )
            else:
                # The builder resolves this reference with float(); a
                # text cell would turn a clean check into a build crash.
                self.check_number(
                    self.wb.plan_value("lcm"),
                    "plan",
                    None,
                    "plan.lcm (bound by context.lcm)",
                )
            return
        self.add(
            "R-127",
            "error",
            f"input_binding {s!r} doesn't parse — the grammar is "
            "form_input.<name>, literal:<number>, or context.lcm "
            "(lcm rows only).",
            sheet=sheet,
            cell=cell,
        )

    def _consume_binding(self, binding: Any, sheet: str, cell: str | None) -> None:
        if binding is None:
            return
        s = str(binding)
        if s.startswith("form_input."):
            name = s[len("form_input.") :]
            self._consume_input(name, sheet, cell)
            self._refuse_derived(
                name, "a base/exposure/lcm input_binding", sheet, cell
            )

    def _refuse_derived(
        self, name: str, where: str, sheet: str, cell: str | None
    ) -> None:
        """Brief 95 C2 (R-047) — a derived input exists only inside the
        rating graph (lookup axes); gates, predicates, and chain value
        bindings read row inputs directly and would see nothing."""
        if name in self.derived_inputs:
            self.add(
                "R-047",
                "error",
                f"'{name}' is a derived input — it can key factor-table "
                f"lookups, but it cannot drive {where} (the value is "
                "computed inside the rating graph, not supplied on the "
                "row). Use its operands directly, or a plain input.",
                sheet=sheet,
                cell=cell,
            )

    def _consume_input(self, name: str, sheet: str, cell: str | None) -> None:
        if self.wb.inputs is not None and name not in self.input_names:
            self.add(
                "R-044",
                "error",
                f"Field '{name}' is consumed here but not declared on the inputs "
                "sheet. Declare every field the plan reads.",
                sheet=sheet,
                cell=cell,
            )

    def _check_predicate(
        self,
        pred: Any,
        sheet: str,
        cell: str | None,
        *,
        equality_only: bool = False,
    ) -> None:
        """§4.6.1 grammar (R-128) — plus, on chains/loadings, the
        expressibility boundary: the platform's factor gate
        (FactorPredicate) tests equality only, so operators beyond
        `==` are registry-refused there (r4 predicate_beyond_equality,
        R-190). Endorsement triggers execute the full grammar."""
        if pred is None:
            return
        m = _PREDICATE.match(str(pred).strip())
        if not m:
            self.add(
                "R-128",
                "error",
                f"Predicate {pred!r} doesn't parse — the grammar is "
                "'path op value' with ops == != < <= > >= in not-in and "
                "paths form_input.<name> or dim.<slug>.",
                sheet=sheet,
                cell=cell,
            )
            return
        namespace, name, op, value = m.groups()
        if equality_only and op != "==":
            self.add(
                "R-190",
                "error",
                f"Predicate operator '{op}' — "
                + _registry_message(self.registry, "predicate_beyond_equality"),
                sheet=sheet,
                cell=cell,
            )
        if op in ("in", "not-in") and not (
            value.strip().startswith("[") and value.strip().endswith("]")
        ):
            self.add(
                "R-128",
                "error",
                f"Predicate {pred!r}: '{op}' needs a list value like [a, b, c].",
                sheet=sheet,
                cell=cell,
            )
        if namespace == "form_input":
            self._consume_input(name, sheet, cell)
            self._refuse_derived(name, "a predicate", sheet, cell)

    # -- gates ---------------------------------------------------------------------

    def lint_gates(self) -> None:
        t = self.wb.gates
        if t is None:
            return
        defaults = 0
        seen: dict[str, int] = {}
        for row in t.rows:
            raw_rule_id = self.require_cell(row, "rule_id", t.sheet)
            is_default = raw_rule_id is not None and str(raw_rule_id) == DEFAULT_KEY
            rule_id = (
                DEFAULT_KEY
                if is_default
                else self.check_slug(
                    raw_rule_id, t.sheet, row.ref("rule_id"), "Rule id"
                )
            )
            tier = self.require_cell(row, "tier", t.sheet)
            self.require_cell(row, "reasoning", t.sheet)
            if tier is not None and str(tier) not in TIERS:
                self.add(
                    "R-162",
                    "error",
                    f"tier {tier!r} isn't one of {sorted(TIERS)}.",
                    sheet=t.sheet,
                    cell=row.ref("tier"),
                )
            if rule_id:
                if rule_id in seen:
                    self.add(
                        "R-163",
                        "error",
                        f"Rule id '{rule_id}' appears twice (rows {seen[rule_id]} "
                        f"and {row.index}).",
                        sheet=t.sheet,
                        cell=row.ref("rule_id"),
                    )
                seen[rule_id] = row.index
            if is_default:
                defaults += 1
                continue  # the default row's conditions are ignored.

            for suffix in ("", "_2", "_3"):
                var = row.get(f"variable{suffix}")
                op = row.get(f"op{suffix}")
                val = row.get(f"value{suffix}")
                present = [v is not None for v in (var, op, val)]
                if suffix == "" and not all(present):
                    self.add(
                        "R-003",
                        "error",
                        f"Row {row.index}: a rule needs variable, op, and value.",
                        sheet=t.sheet,
                        cell=f"A{row.index}",
                    )
                    continue
                if suffix != "" and any(present) and not all(present):
                    self.add(
                        "R-169",
                        "error",
                        f"Row {row.index}: condition{suffix} must be a complete "
                        f"triple (variable{suffix} + op{suffix} + value{suffix}) "
                        "or absent.",
                        sheet=t.sheet,
                        cell=f"A{row.index}",
                    )
                    continue
                if var is not None:
                    self._consume_input(str(var), t.sheet, row.ref(f"variable{suffix}"))
                    self._refuse_derived(
                        str(var), "a gates variable", t.sheet,
                        row.ref(f"variable{suffix}"),
                    )
                if op is not None and str(op) not in GATE_OPS:
                    self.add(
                        "R-161",
                        "error",
                        f"op {op!r} isn't one of {sorted(GATE_OPS)}.",
                        sheet=t.sheet,
                        cell=row.ref(f"op{suffix}"),
                    )
        if defaults != 1:
            self.add(
                "R-160",
                "error",
                f"The gates sheet needs exactly one '{DEFAULT_KEY}' row "
                f"(found {defaults}).",
                sheet=t.sheet,
            )

    # -- modifiers / endorsements / loadings / adjustments ---------------------------

    def lint_modifiers(self) -> None:
        t = self.wb.modifiers
        if t is None:
            return
        seen: dict[tuple[str, str], int] = {}
        for row in t.rows:
            schedule = self.require_cell(row, "schedule_id", t.sheet)
            category = self.require_cell(row, "category_id", t.sheet)
            scope = row.get("scope")
            if scope is not None and str(scope) not in MODIFIER_SCOPES:
                self.add(
                    "R-164",
                    "error",
                    f"scope {scope!r} isn't one of {sorted(MODIFIER_SCOPES)}.",
                    sheet=t.sheet,
                    cell=row.ref("scope"),
                )
            if schedule is not None and category is not None:
                key = (str(schedule), str(category))
                if key in seen:
                    self.add(
                        "R-164",
                        "error",
                        f"category_id '{category}' appears twice in schedule "
                        f"'{schedule}'.",
                        sheet=t.sheet,
                        cell=row.ref("category_id"),
                    )
                seen[key] = row.index
            rng = self.check_number(row.get("range_pct"), t.sheet, row.ref("range_pct"), "range_pct")
            cap = self.check_number(
                row.get("total_cap_pct"), t.sheet, row.ref("total_cap_pct"), "total_cap_pct"
            )
            if rng is not None and rng < 0:
                self.add("R-165", "error", "range_pct must be >= 0.", sheet=t.sheet,
                         cell=row.ref("range_pct"))
            if cap is not None and cap <= 0:
                self.add("R-165", "error", "total_cap_pct must be > 0.", sheet=t.sheet,
                         cell=row.ref("total_cap_pct"))

    def lint_endorsements(self) -> None:
        t = self.wb.endorsements
        if t is None:
            return
        coverages = set(self.wb.coverages())
        seen: dict[str, int] = {}
        for row in t.rows:
            if (
                str(row.get("kind")) == "additive"
                and len(self.wb.coverages()) > 1
            ):
                self.add(
                    "R-190",
                    "error",
                    "Additive endorsement on a multi-coverage plan — "
                    + _registry_message(
                        self.registry, "endorsement_additive_multi_coverage"
                    ),
                    sheet=t.sheet,
                    cell=row.ref("kind"),
                )
            eid = self.check_slug(
                self.require_cell(row, "endorsement_id", t.sheet),
                t.sheet,
                row.ref("endorsement_id"),
                "Endorsement id",
            )
            if eid:
                if eid in seen:
                    self.add("R-007", "error", f"Endorsement id '{eid}' appears twice.",
                             sheet=t.sheet, cell=row.ref("endorsement_id"))
                seen[eid] = row.index
            kind = self.require_cell(row, "kind", t.sheet)
            kind_s = str(kind) if kind is not None else ""
            if kind is not None and kind_s not in ENDORSEMENT_KINDS:
                self.add(
                    "R-166", "error",
                    f"kind {kind!r} isn't one of {sorted(ENDORSEMENT_KINDS)}.",
                    sheet=t.sheet, cell=row.ref("kind"),
                )
            if kind_s == "factor":
                n = self.check_number(row.get("factor"), t.sheet, row.ref("factor"), "factor")
                if n is None or not n > 0:
                    self.add("R-166", "error", "A factor endorsement needs factor > 0.",
                             sheet=t.sheet, cell=row.ref("factor") or f"A{row.index}")
            elif kind_s == "additive":
                if self.check_number(row.get("amount"), t.sheet, row.ref("amount"), "amount") is None:
                    self.add("R-166", "error", "An additive endorsement needs amount.",
                             sheet=t.sheet, cell=row.ref("amount") or f"A{row.index}")
            elif kind_s == "sublimit":
                cov = row.get("coverage")
                sub = self.check_number(row.get("sublimit"), t.sheet, row.ref("sublimit"), "sublimit")
                if cov is None or sub is None or not sub > 0:
                    self.add(
                        "R-166", "error",
                        "A sublimit endorsement needs coverage and sublimit > 0.",
                        sheet=t.sheet, cell=f"A{row.index}",
                    )
                elif coverages and str(cov) not in coverages:
                    self.add(
                        "R-166", "error",
                        f"coverage {cov!r} isn't in plan.coverages.",
                        sheet=t.sheet, cell=row.ref("coverage"),
                    )
            self._check_predicate(row.get("trigger"), t.sheet, row.ref("trigger"))

    def lint_loadings(self) -> None:
        t = self.wb.loadings
        if t is None:
            return
        coverages = set(self.wb.coverages())
        seen: dict[str, int] = {}
        for row in t.rows:
            lid = self.check_slug(
                self.require_cell(row, "loading_id", t.sheet),
                t.sheet,
                row.ref("loading_id"),
                "Loading id",
            )
            if lid:
                if lid in seen:
                    self.add("R-007", "error", f"Loading id '{lid}' appears twice.",
                             sheet=t.sheet, cell=row.ref("loading_id"))
                seen[lid] = row.index
            n = self.check_number(
                self.require_cell(row, "factor", t.sheet), t.sheet, row.ref("factor"), "Factor"
            )
            if n is not None and not n > 0:
                self.add("R-107", "error", f"Factor {n} must be finite and > 0.",
                         sheet=t.sheet, cell=row.ref("factor"))
            for cov in _csv(row.get("applies_to")):
                if coverages and cov not in coverages:
                    self.add(
                        "R-167",
                        "error",
                        f"applies_to names '{cov}', which isn't in plan.coverages.",
                        sheet=t.sheet,
                        cell=row.ref("applies_to"),
                    )
            self._check_predicate(
                row.get("predicate"), t.sheet, row.ref("predicate"),
                equality_only=True,
            )

    def lint_adjustments(self) -> None:
        t = self.wb.final_adjustments
        if t is None:
            return
        coverages = set(self.wb.coverages())
        seen: dict[str, int] = {}
        round_rows = [r for r in t.rows if str(r.get("kind")) == "round"]
        for row in round_rows:
            if _csv(row.get("applies_to")):
                self.add(
                    "R-190",
                    "error",
                    "Per-coverage rounding — "
                    + _registry_message(self.registry, "per_coverage_rounding"),
                    sheet=t.sheet,
                    cell=row.ref("applies_to"),
                )
        if len(round_rows) > 1:
            self.add(
                "R-190",
                "error",
                "Multiple round rows — "
                + _registry_message(self.registry, "per_coverage_rounding"),
                sheet=t.sheet,
                cell=f"A{round_rows[1].index}",
            )
        for row in t.rows:
            aid = self.check_slug(
                self.require_cell(row, "adjustment_id", t.sheet),
                t.sheet,
                row.ref("adjustment_id"),
                "Adjustment id",
            )
            if aid:
                if aid in seen:
                    self.add("R-007", "error", f"Adjustment id '{aid}' appears twice.",
                             sheet=t.sheet, cell=row.ref("adjustment_id"))
                seen[aid] = row.index
                self.adjustment_ids.add(aid)
            kind = self.require_cell(row, "kind", t.sheet)
            kind_s = str(kind) if kind is not None else ""
            if kind is not None and kind_s not in ADJUSTMENT_KINDS:
                self.add(
                    "R-168", "error",
                    f"kind {kind!r} isn't one of {sorted(ADJUSTMENT_KINDS)}.",
                    sheet=t.sheet, cell=row.ref("kind"),
                )
            if kind_s == "clamp" and row.get("min_value") is None and row.get("max_value") is None:
                self.add(
                    "R-168", "error",
                    "A clamp needs min_value and/or max_value.",
                    sheet=t.sheet, cell=f"A{row.index}",
                )
            if kind_s == "round" and row.get("round_increment") is None:
                self.add(
                    "R-168", "error",
                    "A round needs round_increment.",
                    sheet=t.sheet, cell=f"A{row.index}",
                )
            for col in ("min_value", "max_value", "round_increment", "round_min"):
                if row.get(col) is not None:
                    self.check_number(row.get(col), t.sheet, row.ref(col), col)
            for cov in _csv(row.get("applies_to")):
                if coverages and cov not in coverages:
                    self.add(
                        "R-170",
                        "error",
                        f"applies_to names '{cov}', which isn't in plan.coverages.",
                        sheet=t.sheet,
                        cell=row.ref("applies_to"),
                    )

    # -- outputs + test cases -----------------------------------------------------

    def lint_outputs(self) -> None:
        t = self.wb.outputs
        if t is None:
            return
        seen_id: dict[str, int] = {}
        seen_field: dict[str, int] = {}
        # Same row predicate as builder.py's outputs pass (check=build
        # parity): ANY round row satisfies coverage:total — a per-coverage
        # round is R-190's to refuse.
        fa = self.wb.final_adjustments
        has_round_row = fa is not None and any(
            str(r.get("kind")) == "round" for r in fa.rows
        )
        for row in t.rows:
            oid = self.check_slug(
                self.require_cell(row, "output_id", t.sheet),
                t.sheet,
                row.ref("output_id"),
                "Output id",
            )
            fname = self.check_slug(
                self.require_cell(row, "field_name", t.sheet),
                t.sheet,
                row.ref("field_name"),
                "field_name",
            )
            source = self.require_cell(row, "source", t.sheet)
            for value, seen in ((oid, seen_id), (fname, seen_field)):
                if value:
                    if value in seen:
                        self.add(
                            "R-142",
                            "error",
                            f"'{value}' appears twice (rows {seen[value]} and {row.index}).",
                            sheet=t.sheet,
                            cell=row.ref("output_id"),
                        )
                    seen[value] = row.index
            if fname:
                self.output_fields.add(fname)
            if source is not None:
                s = str(source)
                known = self.stage_ids | self.adjustment_ids
                if s == "coverage:total":
                    if not has_round_row:
                        self.add(
                            "R-146",
                            "error",
                            "source 'coverage:total' reads the package total, "
                            "but the workbook has no round row — the plan-tail "
                            "round is what produces it. Add a package-level "
                            "round in final_adjustments.",
                            sheet=t.sheet,
                            cell=row.ref("source"),
                        )
                elif s not in known:
                    self.add(
                        "R-141",
                        "error",
                        f"source {s!r} doesn't reference any chain stage or final "
                        "adjustment (or 'coverage:total').",
                        sheet=t.sheet,
                        cell=row.ref("source"),
                    )

    def lint_test_cases(self) -> None:
        t = self.wb.test_cases
        if t is None:
            return
        if not t.rows:
            self.add(
                "R-145",
                "error",
                "test_cases needs at least one row — use the filing's own worked "
                "examples.",
                sheet=t.sheet,
            )
        reserved = {"case_id", "name", "notes"}
        expected_cols = [c for c in t.columns if c.startswith("expected_")]
        tolerance_cols = [c for c in t.columns if c.startswith("tolerance_")]
        input_cols = [
            c
            for c in t.columns
            if c not in reserved and not c.startswith(("expected_", "tolerance_"))
        ]

        gates_present = self.wb.gates is not None
        for col in expected_cols:
            field = col[len("expected_") :]
            if field == "tier":
                if not gates_present:
                    self.add(
                        "R-144",
                        "error",
                        "expected_tier needs a gates sheet to check against.",
                        sheet=t.sheet,
                    )
                continue
            if self.output_fields and field not in self.output_fields:
                self.add(
                    "R-144",
                    "error",
                    f"Column '{col}' names '{field}', which isn't a declared output.",
                    sheet=t.sheet,
                )

        for col in input_cols:
            self._consume_input(col, t.sheet, None)
            if col in self.derived_inputs:
                self.add(
                    "R-047",
                    "warning",
                    f"test_cases column '{col}' supplies a derived input — "
                    "the platform computes it from its operands, so the "
                    "supplied values are ignored. Drop the column.",
                    sheet=t.sheet,
                )

        for row in t.rows:
            self.require_cell(row, "case_id", t.sheet)
            for col in expected_cols:
                v = row.get(col)
                if col == "expected_tier":
                    if v is not None and str(v) not in TIERS:
                        self.add(
                            "R-162",
                            "error",
                            f"expected_tier {v!r} isn't one of {sorted(TIERS)}.",
                            sheet=t.sheet,
                            cell=row.ref(col),
                        )
                    continue
                if v is not None and _num(v) is None:
                    self.add(
                        "R-140",
                        "error",
                        f"{col} must be a number — got {v!r}.",
                        sheet=t.sheet,
                        cell=row.ref(col),
                    )
            for col in tolerance_cols:
                v = row.get(col)
                if v is not None and _num(v) is None:
                    self.add(
                        "R-140",
                        "error",
                        f"{col} must be a number — got {v!r}.",
                        sheet=t.sheet,
                        cell=row.ref(col),
                    )
            for name in self.required_inputs_without_default:
                if name in input_cols and row.get(name) is None:
                    self.add(
                        "R-143",
                        "error",
                        f"Case '{row.get('case_id')}' leaves required input "
                        f"'{name}' empty (and it has no default).",
                        sheet=t.sheet,
                        cell=f"A{row.index}",
                    )
        for name in self.required_inputs_without_default:
            if t.rows and name not in input_cols:
                self.add(
                    "R-143",
                    "error",
                    f"Required input '{name}' (no default) has no column in "
                    "test_cases.",
                    sheet=t.sheet,
                )

    # -- gaps -----------------------------------------------------------------------

    def lint_gaps(self) -> None:
        t = self.wb.gaps
        if t is None:
            return
        for row in t.rows:
            kind = self.require_cell(row, "kind", t.sheet)
            if kind is not None and str(kind) not in GAP_KINDS:
                self.add(
                    "R-180",
                    "error",
                    f"kind {kind!r} isn't one of {sorted(GAP_KINDS)}.",
                    sheet=t.sheet,
                    cell=row.ref("kind"),
                )
            self.require_cell(row, "description", t.sheet)
            self.require_cell(row, "impact", t.sheet)

    # -- run ------------------------------------------------------------------------

    def run(self) -> list[CheckIssue]:
        self.lint_plan()
        self.lint_inputs()
        self.lint_dimensions()
        self.lint_levels()
        self.lint_geo()
        for ft in self.wb.factor_tables:
            self.lint_factor_table(ft)
        self.lint_chains()
        self.lint_gates()
        self.lint_modifiers()
        self.lint_endorsements()
        self.lint_loadings()
        self.lint_adjustments()
        self.lint_outputs()
        self.lint_test_cases()
        self.lint_gaps()
        return self.issues


def lint_workbook(wb: ParsedWorkbook, registry: dict[str, Any] | None = None) -> list[CheckIssue]:
    return _Lint(wb, registry or load_registry()).run()
