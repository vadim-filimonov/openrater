# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The build — a clean workbook → a complete draft plan, atomically.

Every write goes through the TYPED domain layer (create_plan, the
substrate bulk upserts, add_stage_to_draft) inside ONE
`Database.transaction()` scope: the plan lands completely or not at
all, never partially (ADR-0065; construct-audit gap 1).

The construct mappings implement docs/architecture/
ingest-construct-audit.md verbatim — the notable seams:

  · a factor table's `__default__` row / `default_value` meta becomes
    `unknown_key_policy {mode:"default", value}` on every chain lookup
    that reads the table (ADR-0056 lives on the consumer);
  · a lookup's `factor_kind` IS the factor-table slug (the projector's
    resolution convention);
  · per-coverage `applies_to` on final adjustments becomes one
    clamp/round stage per coverage, chained through per-coverage
    "current field" tracking; loadings ride `FlatFactorConfig.
    input_paths` (one stage, many targets);
  · the workbook's `outputs` sheet resolves to output FIELDS: a final
    adjustment named as a source adopts the output's field_name; a
    chain-stage source gets an `additive` pass-through; and
    `coverage:total` is an `additive` over the per-coverage finals;
  · round literals ride `literal:<n>` bindings (the fixture-canonical
    encoding);
  · the workbook's `rating_plan_id` cannot become the plan slug
    (auto-generated) — it is captured in the description + the build
    report (gap 7).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel

from openrater.persistence import Database
from openrater.rates.dimensions.models import (
    GeoScopeNational,
    GeoScopeSubset,
    GeoTerritory,
    UpsertDimensionRequest,
)
from openrater.rates.dimensions.repo import bulk_upsert_dimensions
from openrater.rates.factor_tables.models import UpsertFactorTableRequest
from openrater.rates.factor_tables.repo import bulk_upsert_factor_tables
from openrater.rates.ingest.model import (
    CONTEXT_LCM_BINDING,
    DEFAULT_KEY,
    INPUT_BINDING_FORM_PREFIX,
    LITERAL_BINDING_RE,
    ParsedWorkbook,
    Row,
    Table,
)
from openrater.rates.plans.author import add_stage_to_draft, create_plan
from openrater.rates.plans.models import (
    LineOfBusiness,
    ProductCode,
    StageKind,
    StageOutput,
)

__all__ = ["BuildError", "build_plan_from_workbook"]


class BuildError(Exception):
    """A construct the check accepted but the builder cannot express —
    always a bug in one of the two; the message says which construct."""


# Mirrors the route's `_PRODUCT_TO_LOB_SHIM` (ADR-0033 deprecation
# window). The column is deletion-scheduled and never rates; duplicated
# here rather than importing route internals into the domain direction.
_PRODUCT_TO_LOB = {
    "bop": LineOfBusiness.BOP,
    "cgl": LineOfBusiness.CGL,
    "do": LineOfBusiness.CGL,
    "eo": LineOfBusiness.CGL,
    "wc": LineOfBusiness.WC,
    "auto": LineOfBusiness.AUTO,
    "umbrella": LineOfBusiness.UMBRELLA,
    "excess": LineOfBusiness.UMBRELLA,
    "marine": LineOfBusiness.CGL,
    "inland_marine": LineOfBusiness.CGL,
    "homeowners": LineOfBusiness.CGL,
    "dwelling": LineOfBusiness.CGL,
    "other": LineOfBusiness.CGL,
}

_DATA_TYPE_MAP = {
    "currency": "money",
    "number": "float",
    "boolean": "bool",
    "string": "string",
    "enum": "string",  # + validation.enum carries the domain
}

_LOOKUP_METHOD_MAP = {
    # workbook stage_kind / ft lookup_method → FactorLookup.lookup_method
    "direct": "direct",
    "binned": "binned",
    "bracketed": "bracketed",
    "classification": "direct",
}


class BuildResult(BaseModel):
    rating_plan_id: str
    display_name: str


def _iso_date(v: Any) -> str:
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    return str(v)


def _num(v: Any) -> float:
    return float(v)


def _csv(v: Any) -> list[str]:
    if v is None:
        return []
    return [p.strip() for p in str(v).split(",") if p.strip()]


def _rows(table: Table | None) -> list[Row]:
    return table.rows if table is not None else []


def _table_slug(raw: Any) -> str:
    s = str(raw)
    return s[len("ft.") :] if s.startswith("ft.") else s


# ---------------------------------------------------------------------------
# Substrate assembly
# ---------------------------------------------------------------------------


def _level_dicts(wb: ParsedWorkbook, dim_slug: str) -> list[dict[str, Any]]:
    """dimension_levels rows → the engine's level-dict schema (the
    fixture convention: banded {kind,id,label,lo,hi}; categorical
    {kind,id,label,aliases?}; geographic levels are categorical rows
    whose territory grouping lives in geo_territories)."""
    out: list[dict[str, Any]] = []
    for row in _rows(wb.dimension_levels):
        if str(row.get("dimension_slug")) != dim_slug:
            continue
        kind = str(row.get("kind"))
        level_id = str(row.get("level_id"))
        label = str(row.get("label") or level_id)
        if kind == "banded":
            lo = row.get("min")
            hi = row.get("max")
            out.append(
                {
                    "kind": "banded",
                    "id": level_id,
                    "label": label,
                    "lo": float("-inf") if str(lo).lower() in ("-inf",) else _num(lo),
                    "hi": float("inf") if str(hi).lower() in ("+inf", "inf") else _num(hi),
                }
            )
        else:
            level: dict[str, Any] = {
                "kind": "categorical",
                "id": level_id,
                "label": label,
            }
            aliases = _csv(row.get("aliases"))
            if aliases:
                level["aliases"] = aliases
            out.append(level)
    return out


def _dimension_requests(wb: ParsedWorkbook) -> list[UpsertDimensionRequest]:
    reqs: list[UpsertDimensionRequest] = []
    for row in _rows(wb.dimensions):
        slug = str(row.get("slug"))
        shape = str(row.get("shape"))
        dim_type = str(row.get("dimension_type") or "standard")
        is_geo = shape == "geographic" or dim_type == "geographic"
        levels = _level_dicts(wb, slug)

        geo_scope = None
        geo_territories = None
        geo_granularity = None
        if is_geo:
            dim_type = "geographic"
            geo_granularity = str(row.get("geo_granularity"))
            raw_scope = str(row.get("geo_scope") or "national")
            if raw_scope.startswith("subset:"):
                geo_scope = GeoScopeSubset(
                    kind="subset",
                    states=[s.strip() for s in raw_scope[len("subset:") :].split(",") if s.strip()],
                )
            else:
                geo_scope = GeoScopeNational(kind="national")
            # Territory grouping, two shapes (spec §4.4 + §4.15):
            #   · a `geo.<slug>` sheet — ZIP/county detail. The sheet's
            #     keys become the dimension's LEVELS (one categorical
            #     level per ZIP, the fixture convention) and its
            #     territory_code column becomes the grouping; the
            #     workbook's dimension_levels rows contribute labels.
            #   · no geo sheet — dimension_levels rows carry the
            #     grouping themselves (territory_members, or one
            #     territory per level via territory_ref — the
            #     state-granularity case).
            geo_sheet = next((g for g in wb.geo_sheets if g.slug == slug), None)
            territories: list[GeoTerritory] = []
            if geo_sheet is not None and geo_sheet.table is not None:
                # The dimension_levels rows declare the join the check
                # validates (R-082): territory_ref is the spelling the
                # geo sheet's territory_code column uses; level_id is
                # the key every factor table on this dimension rates
                # by. The territory GROUP id must therefore be the
                # LEVEL id — emitting the raw sheet code builds a plan
                # whose lookups can never match when the two spellings
                # differ (found by the transcription eval: refs "T1",
                # levels "t1" → check-clean, rate-dead on every risk).
                level_by_ref: dict[str, str] = {}
                label_by_level: dict[str, str] = {}
                for lrow in _rows(wb.dimension_levels):
                    if str(lrow.get("dimension_slug")) != slug:
                        continue
                    level_id = lrow.get("level_id")
                    if level_id is None:
                        continue
                    if lrow.get("territory_ref") is not None:
                        level_by_ref[str(lrow.get("territory_ref"))] = str(level_id)
                    if lrow.get("label") is not None:
                        label_by_level[str(level_id)] = str(lrow.get("label"))
                members_by_code: dict[str, list[str]] = {}
                zip_levels: list[dict[str, Any]] = []
                for grow in geo_sheet.table.rows:
                    key = grow.get("zip") or grow.get("county")
                    raw_code = str(grow.get("territory_code"))
                    code = level_by_ref.get(raw_code, raw_code)
                    key_id = str(key)
                    members_by_code.setdefault(code, []).append(key_id)
                    zip_levels.append(
                        {"kind": "categorical", "id": key_id, "label": key_id}
                    )
                levels = zip_levels
                territories = [
                    GeoTerritory(
                        id=code,
                        label=label_by_level.get(code, code),
                        members=members,
                    )
                    for code, members in members_by_code.items()
                ]
            else:
                for lrow in _rows(wb.dimension_levels):
                    if str(lrow.get("dimension_slug")) != slug:
                        continue
                    tref = lrow.get("territory_ref")
                    members = _csv(lrow.get("territory_members"))
                    level_id = str(lrow.get("level_id"))
                    if members:
                        territories.append(
                            GeoTerritory(
                                id=str(tref or level_id),
                                label=str(lrow.get("label") or level_id),
                                members=members,
                            )
                        )
                    elif tref is not None:
                        territories.append(
                            GeoTerritory(id=str(tref), label=str(tref), members=[level_id])
                        )
            geo_territories = territories

        data_type = str(row.get("data_type"))
        reqs.append(
            UpsertDimensionRequest(
                dim_id=slug,
                slug=slug,
                display_name=str(row.get("display_name") or slug),
                data_type={
                    "currency": "number",
                    "enum": "string",
                    "boolean": "boolean",
                }.get(data_type, data_type),
                role=str(row.get("role") or "rating-input"),
                dimension_type=dim_type,
                shape=shape,
                description=str(row.get("description")) if row.get("description") else None,
                levels=levels,
                axes=_csv(row.get("axes")) or None,
                geo_granularity=geo_granularity,
                geo_scope=geo_scope,
                geo_territories=geo_territories,
                class_library_id=(
                    str(row.get("class_library_id")) if row.get("class_library_id") else None
                ),
            )
        )
    return reqs


def _factor_table_requests(
    wb: ParsedWorkbook,
) -> tuple[list[UpsertFactorTableRequest], dict[str, float]]:
    """Returns the upsert requests + the table-level default map
    (slug → default factor) for the unknown_key_policy rewrite."""
    reqs: list[UpsertFactorTableRequest] = []
    defaults: dict[str, float] = {}
    for ft in wb.factor_tables:
        dimensionality = str(ft.meta_value("dimensionality") or "1d")
        row_dim = str(ft.meta_value("row_dimension"))
        key_dimensions = [row_dim]
        cells: dict[str, float] = {}
        if dimensionality == "2d":
            key_dimensions.append(str(ft.meta_value("col_dimension")))
            for gc in ft.grid:
                cells[f"{gc.row_key}::{gc.col_key}"] = _num(gc.factor)
        else:
            for row in ft.rows_1d:
                key = str(row.get("level_id"))
                if key == DEFAULT_KEY:
                    defaults[ft.slug] = _num(row.get("factor"))
                    continue
                cells[key] = _num(row.get("factor"))
        meta_default = ft.meta_value("default_value")
        if meta_default is not None:
            defaults[ft.slug] = _num(meta_default)

        interpolation = None
        if str(ft.meta_value("interpolation") or "stepped") == "linear":
            interpolation = {"mode": "linear", "axis": row_dim}

        #  — the table-level citation rides the table record
        # (source_page + the rule reference), so the editor header and
        # the Exhibits stage foot can answer "where did this number
        # come from" without opening the build report.
        citation_rule = ft.meta_value("citation_rule")
        source_page: int | None = None
        raw_page = ft.meta_value("citation_page")
        if raw_page is not None:
            try:
                source_page = int(float(str(raw_page)))
            except ValueError:
                source_page = None

        reqs.append(
            UpsertFactorTableRequest(
                table_id=ft.slug,
                slug=ft.slug,
                display_name=str(ft.meta_value("display_name") or ft.slug),
                key_dimensions=key_dimensions,
                cells=cells,
                interpolation=interpolation,
                source_page=source_page,
                source_pdf_url=(
                    str(citation_rule) if citation_rule is not None else None
                ),
            )
        )
    return reqs, defaults


# ---------------------------------------------------------------------------
# Stage assembly
# ---------------------------------------------------------------------------


def _input_binding_map(wb: ParsedWorkbook) -> dict[str, str]:
    """dimension slug → the input name that feeds it (inputs sheet
    `maps_to_dimension`; falls back to the dimension slug itself)."""
    out: dict[str, str] = {}
    for row in _rows(wb.inputs):
        target = row.get("maps_to_dimension")
        if target is not None:
            out[str(target)] = str(row.get("name"))
    return out


#: Brief 95 C2 — `derived_from = sum(a,b,…)` on the inputs sheet. The
#: check (R-045/R-046/R-047) validated grammar, operands, and usage; the
#: builder re-parses trustingly here.
_DERIVED_SUM_RE = re.compile(r"^sum\(\s*([a-z0-9_,\s-]+)\)$")


def _derived_input_map(wb: ParsedWorkbook) -> dict[str, list[str]]:
    """input name → sum operands, for every derived input."""
    out: dict[str, list[str]] = {}
    for row in _rows(wb.inputs):
        raw = row.get("derived_from")
        if raw is None:
            continue
        m = _DERIVED_SUM_RE.match(str(raw).strip())
        if m:
            out[str(row.get("name"))] = [
                p.strip() for p in m.group(1).split(",") if p.strip()
            ]
    return out


def _axis_binding(field: str, derived_inputs: dict[str, list[str]]) -> dict[str, Any]:
    """One lookup-axis DimensionBinding: a derived field becomes the
    projector's computed-sum binding (ADR-0047 — `chain.add` over the
    operands, then the bound dim's band/territory derivation); everything
    else stays a plain form_input path."""
    operands = derived_inputs.get(field)
    if operands:
        return {"source": "computed", "op": "sum", "fields": list(operands)}
    return {"source": "form_input", "path": field}


def _chain_config(
    wb: ParsedWorkbook,
    table_defaults: dict[str, float],
    ft_methods: dict[str, str],
    field_for_source: dict[str, str],
) -> dict[str, Any]:
    dim_inputs = _input_binding_map(wb)
    derived_inputs = _derived_input_map(wb)
    elective_coverages = wb.elective_coverages()
    blocks: dict[tuple[str, str], list[Row]] = {}
    for row in _rows(wb.chains):
        key = (str(row.get("coverage")), str(row.get("coverage_value") or ""))
        blocks.setdefault(key, []).append(row)

    chains: list[dict[str, Any]] = []
    for (coverage, cov_value), rows in blocks.items():
        rows.sort(key=lambda r: _num(r.get("order")))
        label = coverage if not cov_value else f"{coverage}_{cov_value}"
        # An outputs row that names any stage of this block renames the
        # tower's output field — the projector exposes chain output
        # fields directly in RunResult.outputs, so the rename IS the
        # output declaration (no pass-through stage exists to project).
        out_field = f"{label}_chain"
        for row in rows:
            declared = field_for_source.get(str(row.get("stage_id")))
            if declared is not None:
                out_field = declared
                break
        spec: dict[str, Any] = {
            "name": f"{label} premium",
            "base_input": "literal.base_value",
            "base_value": None,
            "factor_lookups": [],
            "lcm": None,
            "exposure_input": "literal:1",
            "exposure_unit_divisor": 1.0,
            "apply_exposure": False,
            "output_field": out_field,
            "coverage_value": coverage,
        }
        # Brief 95 C4 — the plan marked this coverage electable
        # (spec §4.1 `building?`): the projector heads the tower with
        # a coverage.election node (explicit 0 exposure → the tower
        # skips and contributes $0; absence still withholds).
        if coverage in elective_coverages:
            spec["elective"] = True
        for row in rows:
            kind = str(row.get("stage_kind"))
            if kind == "base":
                # R-124 accepts a binding-only base (§4.6: value OR
                # input_binding), so resolve the binding when the value
                # cell is empty: a literal is the base rate; a form
                # binding rates from a per-risk column (`base_input`).
                # (`float(None)` on a binding-only row was a 500.)
                if row.get("value") is not None:
                    spec["base_value"] = _num(row.get("value"))
                else:
                    binding = str(row.get("input_binding") or "")
                    lit = re.match(LITERAL_BINDING_RE, binding)
                    if lit:
                        spec["base_value"] = float(lit.group(1))
                    elif binding.startswith(INPUT_BINDING_FORM_PREFIX):
                        spec["base_input"] = binding
            elif kind == "lcm":
                value = _num(row.get("value")) if row.get("value") is not None else None
                binding = str(row.get("input_binding")) if row.get("input_binding") else None
                input_path = binding
                # Resolve the two non-input binding forms at build time
                # (the value cell wins when both are present): a literal
                # IS the multiplier; `context.lcm` points at the plan
                # sheet's `lcm` value — one plan-level number the block
                # cites without copying (it can't drift from its source).
                if value is None and binding is not None:
                    if binding == CONTEXT_LCM_BINDING:
                        plan_lcm = wb.plan_value("lcm")
                        if plan_lcm is None:
                            raise BuildError(
                                f"Chain stage '{row.get('stage_id')}' binds "
                                "context.lcm, but the plan sheet has no `lcm` "
                                "field to resolve it from. Add `lcm` to the "
                                "plan sheet, or put the multiplier in this "
                                "row's value column."
                            )
                        value = float(plan_lcm)
                        input_path = None
                    else:
                        lit = re.match(LITERAL_BINDING_RE, binding)
                        if lit:
                            value = float(lit.group(1))
                            input_path = None
                spec["lcm"] = {
                    "value": value,
                    "input_path": input_path,
                    "citation_rule": str(row.get("citation_rule") or "(carrier-set)"),
                    "citation_page": str(row.get("citation_page") or "(carrier-set)"),
                }
            elif kind == "exposure":
                spec["exposure_input"] = str(row.get("input_binding"))
                spec["exposure_unit_divisor"] = _num(row.get("exposure_divisor"))
                spec["apply_exposure"] = True
            elif kind == "flat_factor":
                # A chain-level constant factor projects to a lookup with
                # no dimension binding — which the projector SKIPS as
                # unkeyable (a silent premium change). Refuse loudly; a
                # 1-D table over a declared dimension is the expressible
                # form (registry r3: chain_flat_factor).
                raise BuildError(
                    f"Chain stage '{row.get('stage_id')}' is a flat_factor — "
                    "the engine cannot key a constant chain factor. Express "
                    "it as a 1-D factor table over a declared dimension "
                    "(a two-level yes/no dimension for conditional factors), "
                    "or as a loading."
                )
            elif kind.startswith("lookup."):
                table_slug = _table_slug(row.get("factor_table"))
                dim = str(row.get("dimension"))
                dims: dict[str, Any] = {
                    dim: _axis_binding(dim_inputs.get(dim, dim), derived_inputs)
                }
                # 2-D tables key on BOTH declared dimensions.
                for extra_dim in _second_axis(wb, table_slug, dim):
                    dims[extra_dim] = _axis_binding(
                        dim_inputs.get(extra_dim, extra_dim), derived_inputs
                    )
                lookup: dict[str, Any] = {
                    "name": str(row.get("description") or table_slug),
                    "factor_kind": table_slug,
                    "lookup_method": _LOOKUP_METHOD_MAP.get(
                        ft_methods.get(table_slug, "direct"), "direct"
                    ),
                    "dimensions": dims,
                    "citation_rule": str(row.get("citation_rule") or ""),
                    "citation_page": str(row.get("citation_page") or ""),
                    "description_template": (
                        f"{row.get('description') or table_slug}: x{{value}}"
                    ),
                }
                if table_slug in table_defaults:
                    lookup["unknown_key_policy"] = {
                        "mode": "default",
                        "value": table_defaults[table_slug],
                    }
                pred = row.get("predicate")
                if pred is not None:
                    lookup["predicate"] = _equality_predicate(str(pred))
                spec["factor_lookups"].append(lookup)
        if spec["base_value"] is None and not str(spec["base_input"]).startswith(
            INPUT_BINDING_FORM_PREFIX
        ):
            raise BuildError(
                f"Coverage block '{label}' has no usable base — no value, no "
                "literal binding, no form_input binding."
            )
        if spec["lcm"] is None:
            plan_lcm = wb.plan_value("lcm")
            spec["lcm"] = {"value": float(plan_lcm) if plan_lcm is not None else 1.0}
        chains.append(spec)

    return {
        "chains": chains,
        "output_total_field": "all_coverages_subtotal",
        "rating_dimension": None,
    }


def _second_axis(wb: ParsedWorkbook, table_slug: str, first_dim: str) -> list[str]:
    for ft in wb.factor_tables:
        if ft.slug != table_slug:
            continue
        if str(ft.meta_value("dimensionality") or "1d") != "2d":
            return []
        axes = [str(ft.meta_value("row_dimension")), str(ft.meta_value("col_dimension"))]
        return [a for a in axes if a != first_dim]
    return []


def _predicate_scalar(raw: str) -> Any:
    """One §4.6.1 value token: booleans and numbers coerce, everything
    else stays the unquoted string (level ids/literals)."""
    if raw in ("true", "false"):
        return raw == "true"
    try:
        return float(raw) if "." in raw else int(raw)
    except ValueError:
        return raw


def _equality_predicate(pred: str) -> dict[str, Any]:
    """The domain's FactorPredicate is equality-only; the check refuses
    the rest of the §4.6.1 grammar on chains/loadings ahead of the
    build (R-190 predicate_beyond_equality). This raise is the
    check=build backstop — reaching it means the check missed one."""
    parts = pred.split(None, 2)
    if len(parts) != 3 or parts[1] != "==":
        raise BuildError(
            f"Chain/loading predicate {pred!r} uses an operator the platform's "
            "factor gate cannot express (equality only) — record the condition "
            "in gaps_and_assumptions or restructure per the registry's "
            "predicate_beyond_equality guidance."
        )
    path, _, raw = parts
    return {"path": path, "equals": _predicate_scalar(raw)}


def _gate_config(wb: ParsedWorkbook) -> dict[str, Any] | None:
    rows = _rows(wb.gates)
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: _num(r.get("order")))
    rules: list[dict[str, Any]] = []
    default_tier = "standard"
    default_reasoning = ""
    default_citation: str | None = None
    for row in rows:
        rule_id = str(row.get("rule_id"))
        if rule_id == DEFAULT_KEY:
            default_tier = str(row.get("tier"))
            default_reasoning = str(row.get("reasoning") or "")
            # Brief 94.5 (T5) — the default row's citation lands like
            # any rule's (it was silently dropped; construct-audit gap).
            if row.get("citation_rule") is not None:
                default_citation = str(row.get("citation_rule"))
            continue
        conditions: list[dict[str, Any]] = []
        for suffix in ("", "_2", "_3"):
            var = row.get(f"variable{suffix}")
            if var is None:
                continue
            conditions.append(
                {
                    "variable": str(var),
                    "op": str(row.get(f"op{suffix}")),
                    "value": _gate_value(row.get(f"op{suffix}"), row.get(f"value{suffix}")),
                }
            )
        rule: dict[str, Any] = {
            "rule_id": rule_id,
            "tier": str(row.get("tier")),
            "reasoning": str(row.get("reasoning") or ""),
        }
        if row.get("citation_rule") is not None:
            rule["citation"] = str(row.get("citation_rule"))
        if len(conditions) == 1:
            rule.update(conditions[0])
        else:
            rule["conditions"] = conditions
        rules.append(rule)
    if not rules:
        return None
    return {
        "rules": rules,
        "default_tier": default_tier,
        "default_reasoning": default_reasoning,
        **({"default_citation": default_citation} if default_citation else {}),
        "scope": "row",
    }


def _gate_value(op: Any, value: Any) -> Any:
    if str(op) in ("in", "nin"):
        return [p.strip() for p in str(value).split(",") if p.strip()]
    return value


# ---------------------------------------------------------------------------
# The build
# ---------------------------------------------------------------------------


def _populate_substrate(
    tx: Database,
    parsed: ParsedWorkbook,
    plan_id: str,
    operator_id: str | None,
    ft_methods: dict[str, str],
) -> None:
    """The construct population — everything a workbook writes onto a
    plan after the row itself exists. Shared verbatim by the build
    (fresh plan) and the re-ingest apply (Brief 92.R D4: the build,
    replayed onto the same plan id). Runs inside the caller's
    transaction scope."""
    dim_reqs = _dimension_requests(parsed)
    if dim_reqs:
        bulk_upsert_dimensions(db=tx, rating_plan_id=plan_id, reqs=dim_reqs)
    ft_reqs, table_defaults = _factor_table_requests(parsed)
    if ft_reqs:
        bulk_upsert_factor_tables(db=tx, rating_plan_id=plan_id, reqs=ft_reqs)
    derived_inputs = _derived_input_map(parsed)

    def add(
        stage_id: str,
        kind: StageKind,
        display: str,
        config: dict[str, Any],
        outputs: list[StageOutput] | None = None,
        citation_rule: str | None = None,
        citation_page: str | None = None,
    ) -> None:
        add_stage_to_draft(
            db=tx,
            draft_plan_id=plan_id,
            stage_id=stage_id,
            stage_kind=kind,
            display_name=display,
            config_json=config,
            insert_after_stage_id="$last",
            citation_rule=citation_rule,
            citation_page=citation_page,
            outputs=outputs,
            operator_id=operator_id,
        )

    # 1 — risk inputs.
    for row in _rows(parsed.inputs):
        name = str(row.get("name"))
        data_type = _DATA_TYPE_MAP.get(str(row.get("data_type")), "string")
        validation: dict[str, Any] = {}
        allowed = _csv(row.get("allowed_values"))
        if allowed:
            validation["enum"] = allowed
        if row.get("min") is not None:
            validation["min"] = _num(row.get("min"))
        if row.get("max") is not None:
            validation["max"] = _num(row.get("max"))
        derived_operands = derived_inputs.get(name)
        config: dict[str, Any] = {
            "name": name,
            "data_type": data_type,
            # Brief 95 C2 — a derived input is computed, never row-supplied:
            # source "derived" + the ComputedExpr AST (the shape the input
            # dictionary edits and the policy-book orchestrator derives from).
            "source": "derived" if derived_operands else "form",
            "source_path": name,
            "required": (
                False
                if derived_operands
                else str(row.get("required")).strip().lower() == "true"
                or row.get("required") is True
            ),
            "output_field": "value",
        }
        if derived_operands:
            expr: dict[str, Any] = {"kind": "input", "name": derived_operands[0]}
            for operand in derived_operands[1:]:
                expr = {
                    "kind": "op",
                    "op": "+",
                    "left": expr,
                    "right": {"kind": "input", "name": operand},
                }
            config["derived_expr"] = expr
            config["derived_rule"] = str(row.get("derived_from"))
        if row.get("default_value") is not None:
            config["default_value"] = row.get("default_value")
        if validation:
            config["validation"] = validation
        if row.get("unit") is not None:
            config["unit"] = str(row.get("unit"))
        if row.get("citation_rule") is not None:
            config["citation"] = str(row.get("citation_rule"))
        if row.get("description") is not None:
            config["description"] = str(row.get("description"))
        add(
            f"input_{name}",
            StageKind.INPUT_NODE,
            str(row.get("label") or name),
            config,
            outputs=[
                StageOutput(
                    output_name="value",
                    data_type="number" if data_type in ("money", "float", "int") else "string",
                )
            ],
        )

    # 2 — the rating tower(s): one multiplicative_chain stage. The
    # outputs sheet's chain-stage sources rename tower output fields
    # here (the projector exposes them in RunResult.outputs).
    output_rows = _rows(parsed.outputs)
    field_for_source = {
        str(r.get("source")): str(r.get("field_name")) for r in output_rows
    }
    chain_cfg = _chain_config(parsed, table_defaults, ft_methods, field_for_source)
    add("rating_chains", StageKind.MULTIPLICATIVE_CHAIN, "Rating chains", chain_cfg)
    chain_fields = {
        spec["coverage_value"]: spec["output_field"] for spec in chain_cfg["chains"]
    }

    # 3 — eligibility.
    gate_cfg = _gate_config(parsed)
    if gate_cfg is not None:
        add("eligibility_gate", StageKind.ELIGIBILITY_GATE, "Eligibility", gate_cfg)

    # 4 — modifier schedules (structure only).
    schedules: dict[str, dict[str, Any]] = {}
    for row in _rows(parsed.modifiers):
        sid = str(row.get("schedule_id"))
        sched = schedules.setdefault(
            sid,
            {
                "schedule_id": sid,
                "display_name": str(row.get("schedule_name") or sid),
                "scope": str(row.get("scope") or "package"),
                "total_cap_pct": _num(row.get("total_cap_pct")),
                "categories": [],
            },
        )
        category: dict[str, Any] = {
            "category_id": str(row.get("category_id")),
            "name": str(row.get("category_name") or row.get("category_id")),
            "range_pct": _num(row.get("range_pct")),
        }
        tiers = _csv(row.get("tier_filter"))
        if tiers:
            category["tier_filter"] = tiers
        sched["categories"].append(category)
    for sid, sched in schedules.items():
        add(f"schedule_{sid}", StageKind.MODIFIER_SCHEDULE, sched["display_name"], {"schedule": sched})

    # 5 — endorsements.
    for row in _rows(parsed.endorsements):
        eid = str(row.get("endorsement_id"))
        kind = str(row.get("kind"))
        base: dict[str, Any] = {
            "form_number": str(row.get("form_number")),
            "display_name": str(row.get("display_name") or eid),
        }
        if row.get("trigger") is not None:
            base["trigger"] = _endorsement_trigger(str(row.get("trigger")))
        if row.get("citation_rule") is not None:
            base["citation"] = str(row.get("citation_rule"))
        if kind == "factor":
            base["factor"] = _num(row.get("factor"))
            stage_kind = StageKind.ENDORSEMENT_FACTOR
        elif kind == "additive":
            base["amount"] = _num(row.get("amount"))
            stage_kind = StageKind.ENDORSEMENT_ADDITIVE
        else:
            base["coverage"] = str(row.get("coverage"))
            base["sublimit"] = _num(row.get("sublimit"))
            stage_kind = StageKind.ENDORSEMENT_SUBLIMIT
        add(f"endorsement_{eid}", stage_kind, base["display_name"], base)

    # 6 — loadings (flat factors; per-coverage via input_paths — the
    # sidecar pass rewires each targeted tower's output tip in place).
    for row in _rows(parsed.loadings):
        lid = str(row.get("loading_id"))
        targets = _csv(row.get("applies_to")) or list(chain_fields.keys())
        config = {
            "input_paths": [f"chain.{chain_fields[c]}" for c in targets],
            "factor": _num(row.get("factor")),
            "factor_kind": str(row.get("factor_kind") or lid),
            "description_template": f"{row.get('display_name') or lid}: x{{value}}",
            "citation_rule": str(row.get("citation_rule") or ""),
            "citation_page": str(row.get("citation_page") or ""),
        }
        pred = row.get("predicate")
        if pred is not None:
            config["predicate"] = _equality_predicate(str(pred))
        add(f"loading_{lid}", StageKind.FLAT_FACTOR, str(row.get("display_name") or lid), config)

    # 7 — final adjustments. The engine's `round` is the plan-tail
    # total-rounder (it sums the money outputs, floors, rounds ONCE —
    # registry r2 per_coverage_rounding; the check rejects anything
    # else). Clamps are sidecars: per-coverage clamps target tower
    # fields, package clamps target the total (the projector's
    # post-round sweep attaches those).
    adjustments = sorted(
        _rows(parsed.final_adjustments), key=lambda r: _num(r.get("order"))
    )
    total_field = field_for_source.get("coverage:total", "total_premium")
    for row in adjustments:
        aid = str(row.get("adjustment_id"))
        if str(row.get("kind")) == "round":
            out_field = field_for_source.get(aid, total_field)
            add(
                aid,
                StageKind.ROUND,
                aid,
                _adjustment_config(row, "chain.total", out_field),
                citation_rule=(
                    str(row.get("citation_rule")) if row.get("citation_rule") else None
                ),
            )
            total_field = out_field
            continue
        targets = _csv(row.get("applies_to"))
        if targets:
            for coverage in targets:
                stage_id = aid if len(targets) == 1 else f"{aid}_{coverage}"
                add(
                    stage_id,
                    StageKind.CLAMP,
                    aid,
                    _adjustment_config(row, f"chain.{chain_fields[coverage]}", "value"),
                )
        else:
            add(
                aid,
                StageKind.CLAMP,
                aid,
                _adjustment_config(row, f"chain.{total_field}", "value"),
            )

    # 8 — outputs whose source has no producing stage to rename.
    chain_stage_ids = {str(r.get("stage_id")) for r in _rows(parsed.chains)}
    adjustment_ids = {str(r.get("adjustment_id")) for r in adjustments}
    for row in output_rows:
        source = str(row.get("source"))
        if source in chain_stage_ids or source in adjustment_ids:
            continue  # renamed at the producer above.
        if source == "coverage:total":
            # Check-refused as R-146; this raise is the check=build
            # backstop — reaching it means the check missed one.
            if not any(str(r.get("kind")) == "round" for r in adjustments):
                raise BuildError(
                    "The outputs sheet asks for coverage:total but the "
                    "workbook has no round row — the package total is "
                    "produced by the plan-tail round. Add a package-level "
                    "round in final_adjustments."
                )
            continue
        raise BuildError(
            f"Output source {source!r} names no chain stage, adjustment, "
            "or coverage:total."
        )


def build_plan_from_workbook(
    *,
    db: Database,
    parsed: ParsedWorkbook,
    operator_id: str | None = None,
) -> BuildResult:
    """Write the parsed (already-checked) workbook as a draft plan.

    One `db.transaction()` scope end to end. Raises BuildError on the
    rare construct the check passed but the domain can't hold; any
    raise leaves the database untouched.
    """
    product_code = str(parsed.plan_value("product"))
    product = ProductCode(product_code)
    state = parsed.plan_value("state")
    workbook_plan_id = str(parsed.plan_value("rating_plan_id"))
    display_name = str(parsed.plan_value("display_name"))
    carrier = str(parsed.plan_value("carrier"))
    description_parts = [
        f"Built from workbook (spec {parsed.plan_value('spec_version')}):"
        f" {workbook_plan_id}",
        f"Carrier: {carrier}",
    ]
    if parsed.plan_value("serff_tracking_number"):
        description_parts.append(f"SERFF: {parsed.plan_value('serff_tracking_number')}")
    if parsed.plan_value("description"):
        description_parts.append(str(parsed.plan_value("description")))

    ft_methods = {
        ft.slug: str(ft.meta_value("lookup_method") or "direct")
        for ft in parsed.factor_tables
    }

    with db.transaction() as tx:
        plan = create_plan(
            db=tx,
            display_name=display_name,
            line_of_business=_PRODUCT_TO_LOB[product_code],
            jurisdiction=str(state) if state not in (None, "") else None,
            effective_date=_iso_date(parsed.plan_value("effective_date")),
            product=product,
            description=" | ".join(description_parts),
            operator_id=operator_id,
            coverages_override=tuple(parsed.coverages()),
            # Brief 95 A2 — the workbook's declared rating_plan_id IS the
            # plan id (same workbook → same plan id on any box). The
            # service refused a taken id before this transaction opened.
            plan_id_override=workbook_plan_id,
        )
        plan_id = plan.rating_plan_id

        _populate_substrate(tx, parsed, plan_id, operator_id, ft_methods)

    return BuildResult(rating_plan_id=plan_id, display_name=display_name)


def _adjustment_config(row: Row, input_path: str, output_field: str) -> dict[str, Any]:
    if str(row.get("kind")) == "round":
        min_value = row.get("round_min")
        return {
            "input_path": input_path,
            "increment_input": f"literal:{_num(row.get('round_increment'))}",
            "min_value_input": f"literal:{_num(min_value) if min_value is not None else 0}",
            "output_field": output_field,
        }
    cfg: dict[str, Any] = {"input_path": input_path, "output_field": output_field}
    if row.get("min_value") is not None:
        cfg["min_value"] = _num(row.get("min_value"))
    if row.get("max_value") is not None:
        cfg["max_value"] = _num(row.get("max_value"))
    return cfg


_TRIGGER_OP_MAP = {
    # §4.6.1 op → EndorsementTriggerParams.op. The full grammar is
    # expressible here (unlike chains/loadings): the domain + engine
    # comparator execute all eight, with a list RHS for in/nin.
    "==": "eq",
    "!=": "ne",
    "<": "lt",
    "<=": "le",
    ">": "gt",
    ">=": "ge",
    "in": "in",
    "not-in": "nin",
}


def _endorsement_trigger(trigger: str) -> dict[str, Any]:
    parts = trigger.split(None, 2)
    if len(parts) != 3:
        raise BuildError(f"Endorsement trigger {trigger!r} doesn't parse.")
    path, op, raw = parts
    if op not in _TRIGGER_OP_MAP:
        # Never rewrite an operator we can't express — attaching an
        # endorsement on the wrong condition is silent wrong premium.
        raise BuildError(
            f"Endorsement trigger {trigger!r} uses operator {op!r}, which "
            "the platform's trigger cannot express — refused rather than "
            "silently rewritten. Record the condition in "
            "gaps_and_assumptions."
        )
    variable = path.split(".", 1)[1] if "." in path else path
    value: Any
    if op in ("in", "not-in"):
        inner = raw.strip()
        if not (inner.startswith("[") and inner.endswith("]")):
            raise BuildError(
                f"Endorsement trigger {trigger!r}: '{op}' needs a list "
                "value like [a, b]."
            )
        value = [
            _predicate_scalar(part.strip())
            for part in inner[1:-1].split(",")
            if part.strip()
        ]
    else:
        value = _predicate_scalar(raw)
    return {"variable": variable, "op": _TRIGGER_OP_MAP[op], "value": value}


def apply_workbook_to_plan(
    *,
    db: Database,
    parsed: ParsedWorkbook,
    rating_plan_id: str,
    operator_id: str | None = None,
) -> BuildResult:
    """Brief 92.R (D4) — the build, replayed onto the SAME plan id.

    One `db.transaction()` scope: the plan row's provenance fields
    update in place, every existing stage is removed through the domain
    layer (state-machine guarded — a non-draft plan refuses exactly as
    hand-editing would), the substrate bulk upserts REPLACE dimensions
    and factor tables wholesale (their repo semantics — deletions come
    free), and the population core runs verbatim. Any raise leaves the
    plan untouched.
    """
    from openrater.rates.plans.author import remove_stage_from_draft
    from openrater.rates.plans.repo import (
        get_plan,
        get_stages,
        recompute_content_hash,
        update_plan_provenance,
    )
    from openrater.rates.plans.state_machine import Action, assert_action_allowed

    product_code = str(parsed.plan_value("product"))
    state = parsed.plan_value("state")
    workbook_plan_id = str(parsed.plan_value("rating_plan_id"))
    display_name = str(parsed.plan_value("display_name"))
    carrier = str(parsed.plan_value("carrier"))
    description_parts = [
        f"Built from workbook (spec {parsed.plan_value('spec_version')}):"
        f" {workbook_plan_id}",
        f"Carrier: {carrier}",
    ]
    if parsed.plan_value("serff_tracking_number"):
        description_parts.append(f"SERFF: {parsed.plan_value('serff_tracking_number')}")
    if parsed.plan_value("description"):
        description_parts.append(str(parsed.plan_value("description")))

    ft_methods = {
        ft.slug: str(ft.meta_value("lookup_method") or "direct")
        for ft in parsed.factor_tables
    }

    with db.transaction() as tx:
        plan = get_plan(db=tx, rating_plan_id=rating_plan_id)
        if plan is None:
            raise BuildError(f"Plan {rating_plan_id!r} not found.")
        # The state machine is the single source of truth: applying a
        # revision IS editing the plan (PATCH posture, draft-only).
        assert_action_allowed(plan, action=Action.PATCH)

        update_plan_provenance(
            db=tx,
            rating_plan_id=rating_plan_id,
            display_name=display_name,
            line_of_business=_PRODUCT_TO_LOB[product_code].value,
            product=product_code,
            jurisdiction=str(state) if state not in (None, "") else None,
            effective_date=_iso_date(parsed.plan_value("effective_date")),
            description=" | ".join(description_parts),
            coverages=tuple(parsed.coverages()),
        )

        # Replace ALL stages (the plan is workbook-born; D5's hand-edit
        # warning fired on the review). Reverse order keeps the
        # sequence-shift bookkeeping trivial.
        for stage in reversed(get_stages(db=tx, rating_plan_id=rating_plan_id)):
            remove_stage_from_draft(
                db=tx,
                draft_plan_id=rating_plan_id,
                stage_id=stage.stage_id,
                operator_id=operator_id,
                note="reingest: replaced by the revised workbook",
            )

        _populate_substrate(tx, parsed, rating_plan_id, operator_id, ft_methods)
        recompute_content_hash(conn=tx.connection(), rating_plan_id=rating_plan_id)

    return BuildResult(rating_plan_id=rating_plan_id, display_name=display_name)
