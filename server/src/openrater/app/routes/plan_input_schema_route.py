# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""GET /plans/{id}/input-schema — the plan's declared inputs, as a
machine-readable schema (Brief 2 §4 P1).

The agent-facing companion to the quote endpoint: before calling
`quote_risk`, an agent (or any API consumer) asks the plan what it
declares — names, types, required-ness, allowed values, units — instead
of guessing from the spec. DECLARED inputs only (the plan's
`input_node` stages, the Brief 52 dictionary): consumption-derived
requirements stay the client walkers' concern, and the quote path's G5
preflight still names anything missing at rating time, so this schema
is a courtesy, not a gate.

`expected_from_caller` marks which fields a caller actually sends: a
`derived` input (computed expression / class-table attribute) is
produced by the plan, not the caller.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, ConfigDict

from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.dimensions.repo import list_dimensions
from openrater.rates.ingest.reports import get_build_report_for_plan
from openrater.rates.plans.configs import InputNodeConfig
from openrater.rates.plans.repo import get_plan, get_stages

router = APIRouter(tags=["plans"])


def _resolve_db(request: Request) -> Database:
    return request.app.state.db  # type: ignore[no-any-return]


class InputSchemaEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    #: The human name (MVP-012). `name` stays the machine field on this
    #: wire; the display name resolves like every UI surface: an
    #: authored config name that differs from the field key wins, else
    #: the stage-level display_name (the workbook `label`), else None.
    display_name: str | None = None
    data_type: str
    source: str
    #: FCA #12 — what the field IS and how to fill it. Populated from
    #: the workbook's description column for declared inputs, and
    #: composed for synthesized entries (the schedule-rating
    #: application's exact JSON shape, categories, ranges, and cap —
    #: the door the audit found undocumented).
    description: str | None = None
    required: bool
    #: False for `derived` inputs — the plan computes them; a caller
    #: sending them is harmless but unnecessary.
    expected_from_caller: bool
    source_path: str | None = None
    unit: str | None = None
    category: str | None = None
    allowed_values: list[str] | None = None
    #: FCA #29 (finding 14) — when `allowed_values` was capped, the
    #: TRUE size of the closed vocabulary (None = uncapped/complete).
    allowed_values_total: int | None = None
    min: float | None = None
    max: float | None = None
    default_value: bool | int | float | str | None = None
    example_value: bool | int | float | str | None = None
    derived_from: str | None = None
    derived_rule: str | None = None
    citation: str | None = None


class InputSchemaResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    count: int
    inputs: list[InputSchemaEntry]
    #: FCA fca-2026-07-25 #13 — field keys the rating STRUCTURE reads
    #: that carry no dictionary declaration (schedule applications,
    #: gate variables, predicate/branch fields). Book preflights use
    #: this to label such columns truthfully ("read by the rating
    #: structure") instead of "ignored" — the false 'ignored' note
    #: shipped a wrong headline number in the audit.
    consumed_fields: list[str] = []


def _display_name(
    parsed: InputNodeConfig, stage_display_name: str | None
) -> str | None:
    """The human name, resolved by the shared MVP-012 rule: a config
    `name` that differs from the field key was authored by a person;
    the workbook builder writes the slug there and puts the spec's
    `label` on the stage. Mirrors `resolveInputDisplayName` in the UI."""
    field_key = (parsed.source_path or parsed.name).strip()
    cfg_name = parsed.name.strip()
    if cfg_name and cfg_name != field_key:
        return cfg_name
    stage_name = (stage_display_name or "").strip()
    if stage_name and stage_name != field_key:
        return stage_name
    return None


def _entry_from_config(
    config: dict[str, Any], stage_display_name: str | None = None
) -> InputSchemaEntry | None:
    """One schema entry from an `input_node` config_json. A config this
    module can't parse yields None (skipped, never a 500 — the schema
    is a courtesy read over persisted data of many vintages)."""
    try:
        parsed = InputNodeConfig.model_validate(config)
    except Exception:
        return None
    validation = parsed.validation
    enum = list(validation.enum) if validation and validation.enum else None
    return InputSchemaEntry(
        name=parsed.name,
        display_name=_display_name(parsed, stage_display_name),
        data_type=parsed.data_type,
        source=parsed.source,
        description=parsed.description,
        required=parsed.required,
        expected_from_caller=not (
            parsed.source == "derived" or parsed.derived_expr is not None
        ),
        source_path=parsed.source_path or None,
        unit=parsed.unit,
        category=parsed.category,
        allowed_values=enum,
        min=getattr(validation, "min", None) if validation else None,
        max=getattr(validation, "max", None) if validation else None,
        default_value=parsed.default_value,
        example_value=parsed.example_value,
        derived_from=parsed.derived_from,
        derived_rule=parsed.derived_rule,
        citation=parsed.citation,
    )


def _sanitize_field(s: str) -> str:
    """Mirror the projector's `sanitize` (stagesToRuntimePlan.ts) so the
    schedule hook name here equals the runtime's exactly."""
    import re

    out = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return out or "x"


_FORM_PREFIX = "form_input."


def _schedule_entries_of(stages: list[Any]) -> list[InputSchemaEntry]:
    """FCA fca-2026-07-25 #12 — the schedule-rating door, documented.
    The engine consumed `schedule_app_{id}` on every row while no
    documented input accepted the underwriter's judgments ('the way in
    is undocumented and effectively secret'). Each modifier.schedule
    stage now yields a schema entry: the exact JSON envelope, the
    categories with their filed ranges, the cap, and a worked
    example_value. Optional — absence is the filed neutral (all
    categories zero)."""
    entries: list[InputSchemaEntry] = []
    for stage in stages:
        kind = str(getattr(stage, "stage_kind", ""))
        if not ("modifier" in kind and "schedule" in kind):
            continue
        cfg = getattr(stage, "config_json", None)
        if not isinstance(cfg, dict):
            continue
        sched = cfg.get("schedule")
        source = sched if isinstance(sched, dict) else cfg
        sid = source.get("schedule_id")
        if not isinstance(sid, str) or not sid:
            continue
        display = source.get("display_name")
        cap = source.get("total_cap_pct")
        raw_cats = source.get("categories")
        cats = [
            c
            for c in (raw_cats if isinstance(raw_cats, list) else [])
            if isinstance(c, dict) and isinstance(c.get("category_id"), str)
        ]
        cat_lines = ", ".join(
            f"{c['category_id']} ('{c.get('name') or c['category_id']}', "
            f"±{c.get('range_pct')}%)"
            for c in cats
        )
        first_cat = cats[0]["category_id"] if cats else "category_id"
        import json as _json

        example = _json.dumps(
            {
                "schedule_id": sid,
                "values": {first_cat: {"value_pct": 0}},
            }
        )
        entries.append(
            InputSchemaEntry(
                name=f"schedule_app_{_sanitize_field(sid)}",
                display_name=(
                    f"{display} — underwriter judgments"
                    if isinstance(display, str) and display
                    else f"Schedule application ({sid})"
                ),
                data_type="json",
                source="schedule",
                description=(
                    f"The underwriter's schedule-rating judgments for "
                    f"'{display or sid}'. JSON (object, or a JSON string "
                    f"in a CSV cell): "
                    f'{{"schedule_id": "{sid}", "values": '
                    f'{{"<category_id>": {{"value_pct": <signed %>, '
                    f'"reasoning": "<why>"}}}}}}. '
                    f"Categories: {cat_lines or 'none'}. "
                    f"Total capped at ±{cap}%. Omit the field (or a "
                    f"category) for no modification — absence is the "
                    f"filed neutral."
                ),
                required=False,
                expected_from_caller=True,
                example_value=example,
            )
        )
    return entries


def _consumed_fields_of(
    stages: list[Any], declared: set[str]
) -> list[str]:
    """FCA #13 — walk the stage configs for field keys the rating
    structure reads at runtime beyond the declared dictionary: chain
    bindings and lookup axes, lookup/loading predicates, gate rule
    variables, and the modifier-schedule application hook. Tolerant
    over persisted configs of many vintages (unparseable shapes are
    skipped, never a 500 — same posture as the entries walk)."""
    consumed: set[str] = set()

    def add_path(p: Any) -> None:
        if isinstance(p, str) and p.startswith(_FORM_PREFIX):
            field = p[len(_FORM_PREFIX) :]
            if field:
                consumed.add(field)

    def add_predicate(obj: Any) -> None:
        if isinstance(obj, dict):
            add_path(obj.get("path"))

    for stage in stages:
        kind = str(getattr(stage, "stage_kind", ""))
        cfg = getattr(stage, "config_json", None)
        if not isinstance(cfg, dict):
            continue
        if "multiplicative_chain" in kind:
            chains = cfg.get("chains")
            for chain in chains if isinstance(chains, list) else []:
                if not isinstance(chain, dict):
                    continue
                add_path(chain.get("base_input"))
                add_path(chain.get("exposure_input"))
                lcm = chain.get("lcm")
                if isinstance(lcm, dict):
                    add_path(lcm.get("input_path"))
                lookups = chain.get("factor_lookups")
                for lk in lookups if isinstance(lookups, list) else []:
                    if not isinstance(lk, dict):
                        continue
                    dims = lk.get("dimensions")
                    if isinstance(dims, dict):
                        for binding in dims.values():
                            if isinstance(binding, dict):
                                add_path(binding.get("path"))
                                # ADR-0025 / FCA #21 — a composite axis
                                # consumes its MEMBERS' fields.
                                axes = binding.get("axes")
                                if isinstance(axes, dict):
                                    for member in axes.values():
                                        if isinstance(member, dict):
                                            add_path(member.get("path"))
                    add_predicate(lk.get("predicate"))
        elif "eligibility" in kind and "gate" in kind.lower():
            rules = cfg.get("rules")
            for rule in rules if isinstance(rules, list) else []:
                if not isinstance(rule, dict):
                    continue
                v = rule.get("variable")
                if isinstance(v, str) and v:
                    consumed.add(v)
                conditions = rule.get("conditions")
                for c in conditions if isinstance(conditions, list) else []:
                    if isinstance(c, dict) and isinstance(
                        c.get("variable"), str
                    ):
                        consumed.add(c["variable"])
        elif "modifier" in kind and "schedule" in kind:
            # The persisted shape nests under `schedule`; tolerate a
            # flat vintage too.
            sched = cfg.get("schedule")
            source = sched if isinstance(sched, dict) else cfg
            sid = source.get("schedule_id")
            if isinstance(sid, str) and sid:
                consumed.add(f"schedule_app_{_sanitize_field(sid)}")
        else:
            add_predicate(cfg.get("predicate"))
    return sorted(consumed - declared)


#: FCA #29 — enumeration cap: the list stays chat-sized; the TOTAL is
#: always disclosed via `allowed_values_total`.
_ALLOWED_VALUES_CAP = 60


def _dim_links_of(stages: list[Any]) -> dict[str, str]:
    """input field → dimension slug, from the chain lookups' bindings
    (the same walk `_consumed_fields_of` runs). Composite axes link
    each MEMBER's field to the member dim."""
    links: dict[str, str] = {}

    def link(binding: Any, dim_slug: str) -> None:
        if not isinstance(binding, dict):
            return
        p = binding.get("path")
        if isinstance(p, str) and p.startswith(_FORM_PREFIX):
            field = p[len(_FORM_PREFIX) :]
            if field:
                links.setdefault(field, dim_slug)
        axes = binding.get("axes")
        if isinstance(axes, dict):
            for member_slug, member in axes.items():
                link(member, str(member_slug))

    for stage in stages:
        if "multiplicative_chain" not in str(getattr(stage, "stage_kind", "")):
            continue
        cfg = getattr(stage, "config_json", None)
        if not isinstance(cfg, dict):
            continue
        chains = cfg.get("chains")
        for chain in chains if isinstance(chains, list) else []:
            if not isinstance(chain, dict):
                continue
            lookups = chain.get("factor_lookups")
            for lk in lookups if isinstance(lookups, list) else []:
                if not isinstance(lk, dict):
                    continue
                dims = lk.get("dimensions")
                if isinstance(dims, dict):
                    for dim_slug, binding in dims.items():
                        link(binding, str(dim_slug))
    return links


def _enrich_entries(
    *,
    db: Database,
    rating_plan_id: str,
    entries: list[InputSchemaEntry],
    stages: list[Any],
) -> None:
    """FCA #29 (findings 14 + 51) — the schema stops shrugging.

    · `allowed_values` for CLOSED vocabularies the plan already knows:
      an input feeding a categorical/classification dimension
      enumerates that dim's level ids (capped at
      `_ALLOWED_VALUES_CAP`, total always disclosed). 'Is there a
      code for that?' was unanswerable from chat while the app held
      all 30 class codes.
    · `example_value` from the newest build report's first VERIFIED
      test case — a real filed example, not a guess. Only fills
      blanks; an authored example wins.
    Best-effort: any failure leaves the plain schema (a courtesy read
    must never 500)."""
    try:
        dims_by_slug = {
            d.slug: d
            for d in list_dimensions(db=db, rating_plan_id=rating_plan_id)
        }
    except Exception:
        dims_by_slug = {}
    links = _dim_links_of(stages)

    case_inputs: dict[str, Any] = {}
    try:
        report = get_build_report_for_plan(
            db=db, rating_plan_id=rating_plan_id
        )
        cases = report.vectors.cases if report is not None else []
        if cases:
            raw = cases[0].inputs
            if isinstance(raw, dict):
                case_inputs = raw
    except Exception:
        case_inputs = {}

    for i, entry in enumerate(entries):
        field = entry.source_path or entry.name
        dim = dims_by_slug.get(links.get(field, "")) or dims_by_slug.get(field)
        updates: dict[str, Any] = {}
        if (
            entry.allowed_values is None
            and dim is not None
            and (dim.shape in ("categorical", "classification") or dim.shape is None)
        ):
            ids = [
                str(lvl.get("id"))
                for lvl in (dim.levels or [])
                if isinstance(lvl, dict) and lvl.get("id") is not None
            ]
            if ids:
                updates["allowed_values"] = ids[:_ALLOWED_VALUES_CAP]
                if len(ids) > _ALLOWED_VALUES_CAP:
                    updates["allowed_values_total"] = len(ids)
        if entry.example_value is None and field in case_inputs:
            v = case_inputs[field]
            if isinstance(v, (bool, int, float, str)):
                updates["example_value"] = v
        if updates:
            entries[i] = entry.model_copy(update=updates)


@router.get(
    "/plans/{rating_plan_id}/input-schema",
    response_model=InputSchemaResponse,
)
async def get_plan_input_schema(
    request: Request,
    rating_plan_id: str = Path(..., min_length=1),
) -> InputSchemaResponse:
    """The plan's declared inputs (its `input_node` dictionary), ordered
    as authored."""
    db = _resolve_db(request)
    if get_plan(db=db, rating_plan_id=rating_plan_id) is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    entries: list[InputSchemaEntry] = []
    for stage in stages:
        if str(getattr(stage, "stage_kind", "")) not in {
            "input_node",
            "StageKind.INPUT_NODE",
        }:
            continue
        config = getattr(stage, "config_json", None)
        if not isinstance(config, dict):
            continue
        entry = _entry_from_config(
            config, getattr(stage, "display_name", None)
        )
        if entry is not None:
            entries.append(entry)
    # FCA #12 — schedule-rating applications join the schema as
    # documented optional inputs (they were consumed-but-secret).
    entries.extend(_schedule_entries_of(list(stages)))
    # FCA #29 — closed vocabularies enumerate; examples come from the
    # first verified test case.
    _enrich_entries(
        db=db,
        rating_plan_id=rating_plan_id,
        entries=entries,
        stages=list(stages),
    )
    declared = {e.name for e in entries} | {
        e.source_path for e in entries if e.source_path
    }
    return InputSchemaResponse(
        rating_plan_id=rating_plan_id,
        count=len(entries),
        inputs=entries,
        consumed_fields=_consumed_fields_of(list(stages), declared),
    )
