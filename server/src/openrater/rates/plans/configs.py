# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Per-kind config shapes for RatingPlan stages.

Each `StageKind` has a typed Pydantic config that the Engine validates
at handler dispatch time. The kind-discriminated union is resolved via
`parse_stage_config(stage)` rather than Pydantic's auto-discriminator
because the `stage_kind` tag lives on the parent `Stage` row, not
inside the `config_json` blob.

All configs are immutable (`frozen=True`) and reject extra fields
(`extra='forbid'`). Drift surfaces immediately at deserialization.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from openrater.rates.plans.models import Stage, StageKind

# ===========================================================================
# Building blocks (used by multiplicative_chain + flat_factor)
# ===========================================================================


class DimensionBinding(BaseModel):
    """How a single dimension column resolves at runtime.

    ADR-0044 D5 / ADR-0047 — a 2-D lookup axis can be sourced beyond a
    raw ``form_input`` column: ``literal`` (a constant ``value`` key, e.g.
    the KS building-limit group "group_c"), ``computed`` (``op="sum"``
    over ``fields``, e.g. property total limit = building + BPP, then
    banded), or ``derived`` (the bound dim's own ``derived_from`` — e.g.
    a class attribute; ``path`` names the derived dim). ``value`` / ``op``
    / ``fields`` are additive + optional so legacy ``{source, path}``
    bindings round-trip unchanged; the validator enforces the source-
    shape each ``source`` needs. The runtime projector already reads
    these (``BindingShape``); this models the authoring/persistence side.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: Literal["context", "form_input", "literal", "derived", "computed"]
    path: str | None = Field(default=None, min_length=1, max_length=200)
    value: bool | int | float | str | None = None
    op: Literal["sum"] | None = None
    fields: tuple[str, ...] | None = None
    format: str | None = None

    @model_validator(mode="after")
    def _resolvable(self) -> DimensionBinding:
        if self.source == "literal":
            if self.value is None:
                raise ValueError(
                    "DimensionBinding: source 'literal' requires `value`."
                )
        elif self.source == "computed":
            if self.op is None or not self.fields:
                raise ValueError(
                    "DimensionBinding: source 'computed' requires `op` and a "
                    "non-empty `fields`."
                )
        elif not (self.path and self.path.strip()):
            raise ValueError(
                f"DimensionBinding: source {self.source!r} requires `path`."
            )
        return self


class FactorPredicate(BaseModel):
    """Optional gate on whether a `FactorLookup` is applied."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(..., min_length=1, max_length=200)
    equals: bool | int | float | str


class UnknownKeyPolicy(BaseModel):
    """ADR-0056 — authored disposition for a lookup key that doesn't resolve.

    ``error`` refuses the row (the projector's default when the field is
    absent); ``default`` applies the authored ``value`` visibly (the filed
    "All other classes" row as data); ``refer`` rates 1.0 indicative and
    escalates the row's eligibility to ``submit``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: Literal["error", "default", "refer"]
    value: float | None = None

    @model_validator(mode="after")
    def _default_requires_value(self) -> "UnknownKeyPolicy":
        if self.mode == "default" and self.value is None:
            raise ValueError(
                "UnknownKeyPolicy: mode 'default' requires `value`."
            )
        return self


class FactorLookup(BaseModel):
    """One factor row to look up + apply as a multiplier in a chain."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=120)
    factor_kind: str = Field(..., min_length=1, max_length=80)
    table: Literal["rate_factors"] = "rate_factors"
    lookup_method: Literal["direct", "interpolated", "binned", "bracketed"]
    dimensions: dict[str, DimensionBinding] = Field(default_factory=dict)
    citation_rule: str = Field(default="", max_length=200)
    citation_page: str = Field(default="", max_length=200)
    description_template: str = Field(..., min_length=1, max_length=500)
    predicate: FactorPredicate | None = None
    # ADR-0056 — absent ⇒ error (Law 2's authoring default; the
    # projector stamps it onto the emitted lookup node's `onMiss`).
    unknown_key_policy: UnknownKeyPolicy | None = None


class LcmApplication(BaseModel):
    """The carrier LCM, applied as the last factor in a chain.

    Brief 54 — the LCM scalar is authored ON the chain (``value``) instead
    of being resolved from a ``form_input.<lcm>`` column. ``input_path`` is
    now optional (an authored-constant LCM carries none); ``overridable``
    (D3 escape hatch) re-exposes the mappable input for per-risk override.
    At least one of ``{value, input_path}`` must resolve the LCM. All
    additions are optional → legacy ``input_path``-only configs round-trip
    unchanged.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    factor_kind: str = "lcm"
    value: float | None = None
    input_path: str | None = Field(default=None, min_length=1, max_length=200)
    overridable: bool = False
    citation_rule: str = "(carrier-set)"
    citation_page: str = "(carrier-set)"
    description_template: str = "Loss Cost Multiplier (carrier): {value}"

    @model_validator(mode="after")
    def _resolvable(self) -> LcmApplication:
        if self.value is None and not (self.input_path and self.input_path.strip()):
            raise ValueError(
                "LcmApplication: at least one of { value, input_path } must "
                "resolve the LCM (got value=None, input_path=None)."
            )
        return self


class ExposureWhen(BaseModel):
    """The equality guard selecting one `ExposureOption` (ADR-0044 D9)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str | None = Field(default=None, max_length=200)
    equals: str | float | bool | None = None


class ExposureOption(BaseModel):
    """One branch of a class-conditional exposure base (ADR-0044 D9).

    The exposure base + divisor vary by a derived key (e.g. liability:
    LOI→bpp_limit÷100, sales→annual_gross_sales÷1000, payroll→
    annual_payroll÷1000). The runtime projector computes
    ``exposure = Σ branch(when ? input ÷ divisor : 0)`` over the options.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    when: ExposureWhen | None = None
    input: str | None = Field(default=None, max_length=200)
    divisor: float | None = Field(default=None, gt=0)


class ChainSpec(BaseModel):
    """One multiplicative chain — building, BPP, or liability.

    `coverage_value` (Brief 25.B.2): identifies which value of the
    enclosing config's `rating_dimension` this chain serves
    (e.g., "Bld", "BPP", "BI"). When set, the ASSEMBLE Calculation
    Tower projects one tower per coverage_value and renders a
    segmented control to switch between them. Optional — chains
    authored before this field defaulted to undefined.

    `base_value` (cold-test L30): the chain's base rate as an
    authored literal scalar (e.g., 600.0 for a $600 D&O base). It is
    the first-class, editable base-rate property of the chain — set
    in the ASSEMBLE base node, persisted here, and consumed by the
    runtime projector as a ``constant`` base node. This removes the
    dependency on ``plan.template_id``-keyed runtime defaults: a
    from-scratch plan can set ``base_value = 600`` and score real
    premiums with no template.

    ``base_input`` stays as the wire-format reference path — load-
    bearing for round-trip and the projector's back-compat fallback
    (a column-driven base) when ``base_value`` is unset. When BOTH
    are present, the literal wins. Optional/nullable so plans
    authored before this field round-trip unchanged.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=80)
    base_input: str = Field(..., min_length=1, max_length=200)
    base_value: float | None = None
    factor_lookups: tuple[FactorLookup, ...] = ()
    lcm: LcmApplication
    exposure_input: str = Field(..., min_length=1, max_length=200)
    exposure_unit_divisor: float = Field(..., gt=0)
    # ADR-0044 D3/D9 / ADR-0047 — exposure wiring (authoring side; the runtime
    # projector already reads both).
    # `apply_exposure` opts a tower in/out of scalar exposure scaling: coverage
    # towers (coverage_value set) auto-apply in the projector (PR #325); this
    # flag covers the per-account case AND lets a coverage tower opt out.
    # `exposure_options` (D9) is class-conditional exposure: the projector
    # selects the exposure base ÷ divisor per the matching `when` (takes
    # precedence over the scalar exposure_input/divisor above). Both optional →
    # chains authored before ADR-0044 round-trip unchanged.
    apply_exposure: bool | None = None
    exposure_options: tuple[ExposureOption, ...] | None = None
    output_field: str = Field(..., min_length=1, max_length=80)
    predicate: FactorPredicate | None = None
    coverage_value: str | None = Field(default=None, max_length=80)
    # Brief 95 C4 — the plan marked this coverage electable (spec §4.1
    # `building?`): the projector heads the tower with a
    # coverage.election node — an EXPLICIT 0 exposure elects the tower
    # out (skip + $0 + trace); absence still withholds. Optional →
    # chains authored before this field round-trip unchanged.
    elective: bool | None = None


# ===========================================================================
# Active stage configs (one per StageKind)
# ===========================================================================


class ClassificationLookupConfig(BaseModel):
    """Projects the matched class-registry row into the cascade context.

    ``output_fields`` is required: which columns a class table carries
    is a property of the plan's class registry — plan data — so the
    platform ships no default column set (genericity invariant,
    ADR-0033 §0).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    class_code_input: str = Field(default="form_input.class_code")
    output_fields: tuple[str, ...] = Field(..., min_length=1)


class EligibilityEvaluatorConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    eligibility_engine_ref: str = Field(default="legacy_v1")
    halt_if_disposition: tuple[str, ...] = ("decline",)


class TerritoryResolverConfig(BaseModel):
    """Resolves (state, ZIP) into a territory code via the plan's mapping.

    ``fallback_territory`` is the plan-authored "all other" territory.
    ``None`` (the default) means an unmapped ZIP is a visible resolution
    error — the absent ⇒ ``error`` grammar of ``UnknownKeyPolicy``
    (ADR-0056). A concrete fallback code is plan data, never a platform
    default (genericity invariant, ADR-0033 §0).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    state_input: str = Field(default="form_input.state_code")
    zip_input: str = Field(default="form_input.location.zip5")
    fallback_territory: str | None = Field(
        default=None, min_length=1, max_length=80
    )


class MultiplicativeChainConfig(BaseModel):
    """Config for a `multiplicative_chain` stage.

    `rating_dimension` (Brief 25.B.2): the id of the dimension this
    config's ChainSpecs split on. When set, the ASSEMBLE workspace
    renders one tower per ChainSpec.coverage_value with a segmented
    control to switch between them. Optional — when unset, the
    workspace renders a single tower (no split).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    chains: tuple[ChainSpec, ...] = Field(..., min_length=1)
    output_total_field: str = Field(..., min_length=1, max_length=80)
    rating_dimension: str | None = Field(default=None, max_length=80)


class AdditiveConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    inputs: tuple[str, ...] = Field(..., min_length=1)
    output_field: str = Field(default="value", min_length=1, max_length=80)


class FlatFactorConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    input_path: str | None = Field(default=None, min_length=1, max_length=200)
    input_paths: tuple[str, ...] | None = Field(default=None, min_length=1)
    factor: float = Field(...)
    factor_unit: str = Field(default="multiplier")
    predicate: FactorPredicate | None = None
    citation_rule: str = ""
    citation_page: str = ""
    description_template: str = "{factor_kind}: ×{value}"
    factor_kind: str = Field(..., min_length=1, max_length=80)
    output_field: str = Field(default="value", min_length=1, max_length=80)

    @model_validator(mode="after")
    def _validate_input_shape(self) -> FlatFactorConfig:
        if (self.input_path is None) == (self.input_paths is None):
            raise ValueError(
                "FlatFactorConfig: exactly one of input_path / input_paths "
                "must be set (got "
                f"input_path={self.input_path!r}, input_paths={self.input_paths!r})."
            )
        return self


class ClampConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    input_path: str = Field(..., min_length=1, max_length=200)
    min_value: float | None = None
    max_value: float | None = None
    max_pct_of_input: str | None = None
    apply_as_multiplier: bool = False
    subtotal_input: str | None = None
    factor_kind: str = Field(default="clamp", min_length=1, max_length=80)
    citation_rule: str = ""
    citation_page: str = ""
    description_template: str = "{factor_kind}: {applied:+.4f}"
    output_field: str = Field(default="value", min_length=1, max_length=80)


class RoundConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    input_path: str = Field(..., min_length=1, max_length=200)
    increment_input: str = Field(..., min_length=1, max_length=200)
    min_value_input: str = Field(..., min_length=1, max_length=200)
    output_field: str = Field(default="final_premium_usd", min_length=1, max_length=80)


class DeferredZeroConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    elected_input: str = Field(..., min_length=1, max_length=200)
    note: str = Field(..., min_length=1, max_length=500)
    factor_kind_template: str = Field(default="{stage_id}_deferred")
    citation_rule: str = ""
    citation_page: str = ""
    output_field: str = Field(default="value", min_length=1, max_length=80)


class IrpmApplyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    subtotal_input: str = Field(..., min_length=1, max_length=200)
    irpm_modifications_input: str = Field(default="form_input.irpm_modifications")
    rate_set_id_input: str = Field(default="form_input.manual_rate_set_id")
    output_field: str = Field(default="subtotal_after_usd", min_length=1, max_length=80)


# ===========================================================================
# Input node (top-of-DAG data declaration)
# ===========================================================================


class InputNodeValidation(BaseModel):
    """Optional input validation rules evaluated at runtime."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    min: float | None = None
    max: float | None = None
    enum: tuple[str, ...] | None = None
    pattern: str | None = Field(default=None, max_length=200)


class InputNodeConfig(BaseModel):
    """Top-of-DAG input declaration — the authoring shape of a plan's
    declared input (Brief 52 input dictionary).

    The frozen + `extra='forbid'` config means new dictionary fields are
    additive only and legacy configs keep parsing. The `data_type` and
    `source` Literals are UNIONS: the Brief 52 vocabulary the editor
    writes (data_type aligned to `@openrater/contracts` PrimitiveType per
    risk-inputs Q1; source per Q2 + the Brief 52 `derived` value) PLUS
    the pre-Brief-51 legacy values, kept so existing persisted configs
    deserialize unchanged (config_json is an opaque JSON blob in the DB,
    so there's no migration — only this schema widens)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=120)
    data_type: Literal[
        # Brief 52 — @openrater/contracts PrimitiveType (the editor's vocabulary).
        "money",
        "factor",
        "pct",
        "class_code",
        "string",
        "date",
        "bool",
        "int",
        "float",
        # Legacy (pre-Brief-51). Kept parseable; the editor no longer writes these.
        "number",
        "boolean",
        "enum",
    ]
    source: Literal[
        # Brief 52 / risk-inputs Q2 + D3 (the editor's vocabulary).
        "form",
        "api",
        "lookup",
        "manual",
        "derived",
        # Legacy (pre-Brief-51). Kept parseable.
        "form_input",
        "api_pull",
        "submission_field",
        "literal",
    ]
    source_path: str = Field(default="", max_length=200)
    api_endpoint: str | None = Field(default=None, max_length=200)
    default_value: bool | int | float | str | None = None
    example_value: bool | int | float | str | None = None
    required: bool = True
    validation: InputNodeValidation | None = None
    output_field: str = Field(default="value", min_length=1, max_length=80)

    # ── Brief 52 — input-dictionary fields ──────────────────────
    # `required` (above) + `validation.enum` / `.min` / `.max` already
    # cover required-ness, the closed value set, and numeric ranges, so
    # Brief 52 only ADDS the four below. All optional → legacy configs
    # validate unchanged.
    #: Display + domain hint, e.g. "USD", "sqft", "years", "%". Non-semantic.
    unit: str | None = Field(default=None, max_length=40)
    #: Dictionary grouping label, e.g. "A. Classification" … "J. Derived".
    category: str | None = Field(default=None, max_length=80)
    #: For source="derived": the upstream input/dim this is computed from
    #: (e.g. "zip", "class_code"). V1: documentation + validation only.
    derived_from: str | None = Field(default=None, max_length=120)
    #: For source="derived": human/expression description of the rule.
    derived_rule: str | None = Field(default=None, max_length=200)
    #: For source="derived" (E03 / brief D3): a closed arithmetic expression
    #: (the `ComputedExpr` AST from @openrater/contracts) over other inputs — e.g.
    #: `tiv = building_limit + bpp_limit`. Stored OPAQUELY (the AST is validated
    #: client-side + by the contract's `validateComputedExpr`); the projector
    #: emits a `derive.computed` node from it so the gate + the policy roll-up
    #: can read the result. Optional → legacy configs validate unchanged.
    derived_expr: dict[str, Any] | None = None
    #: Filing citation (e.g. "Sample BOP Rule 22.A"). Held in config_json
    #: (not the stage-level citation_rule) so the dictionary editor can
    #: edit it via the config-patch endpoint, which is the only stage
    #: mutation that round-trips after creation.
    citation: str | None = Field(default=None, max_length=200)
    #: Human-readable description of the field (shown in the inspector +
    #: audit trace). Held in config_json so the dictionary editor can
    #: patch it; mirrors `input.source` params.description.
    description: str | None = Field(default=None, max_length=2000)


# ===========================================================================
# FORMULA — computed-value stage
# ===========================================================================


class FormulaConfig(BaseModel):
    """Computed-value stage.

    The expression is parsed via Python's `ast` module against a
    whitelisted node grammar — no `eval()` ever runs.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=120)
    expression: str = Field(..., min_length=1, max_length=400)
    inputs: dict[str, str] = Field(default_factory=dict)
    data_type: Literal["number", "string", "boolean"] = "number"
    output_field: str = Field(default="value", min_length=1, max_length=80)
    description: str = Field(default="", max_length=200)
    citation_rule: str | None = Field(default=None, max_length=120)
    citation_page: str | None = Field(default=None, max_length=40)


# ===========================================================================
# CASE_NODE — N-way conditional dispatch
# ===========================================================================


class CasePredicate(BaseModel):
    """One predicate clause inside a `CaseClause.when` map."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    equals: bool | int | float | str | None = None
    not_equals: bool | int | float | str | None = None
    in_: tuple[bool | int | float | str, ...] | None = Field(default=None, alias="in")
    not_in: tuple[bool | int | float | str, ...] | None = None
    lt: float | None = None
    lte: float | None = None
    gt: float | None = None
    gte: float | None = None
    between: tuple[float, float] | None = None

    def is_empty(self) -> bool:
        return (
            self.equals is None
            and self.not_equals is None
            and self.in_ is None
            and self.not_in is None
            and self.lt is None
            and self.lte is None
            and self.gt is None
            and self.gte is None
            and self.between is None
        )


class CaseClause(BaseModel):
    """One `when → then` row inside a CaseConfig.cases list."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    when: dict[str, CasePredicate] = Field(default_factory=dict)
    then: bool | int | float | str
    description: str = Field(default="", max_length=200)


class CaseConfig(BaseModel):
    """N-way conditional dispatch stage."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., min_length=1, max_length=120)
    inputs: dict[str, str] = Field(default_factory=dict)
    cases: tuple[CaseClause, ...] = Field(default_factory=tuple)
    default: bool | int | float | str | None = None
    data_type: Literal["number", "string", "boolean"] = "number"
    output_field: str = Field(default="value", min_length=1, max_length=80)
    citation_rule: str | None = Field(default=None, max_length=120)
    citation_page: str | None = Field(default=None, max_length=40)


# ===========================================================================
# Phase G G1 — Gate workspace substrate (eligibility / modifier / endorsement)
#
# Mirrors @openrater/contracts/src/kinds/{eligibility-gate,modifier-schedule,
# endorsement}.ts. The frontend runtime (V17 conformance) already executes
# these kinds; persistence here lets the GateCanvas's authoring surface
# round-trip through the API instead of leaking into localStorage.
# ===========================================================================


_ELIGIBILITY_OPS = Literal["eq", "ne", "lt", "le", "gt", "ge", "in", "nin"]
_ELIGIBILITY_TIERS = Literal["preferred", "standard", "submit", "decline"]


class EligibilityConditionParams(BaseModel):
    """One condition inside a compound eligibility rule (Brief 81)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    variable: str = Field(..., min_length=1, max_length=200)
    op: _ELIGIBILITY_OPS
    # `value` is unknown — Pydantic accepts any JSON-serializable scalar
    # or array (array is the natural encoding for `in`/`nin`).
    value: Any


class EligibilityRuleParams(BaseModel):
    """One first-match-wins rule inside an `eligibility.gate` stage.

    Mirrors `EligibilityRule` from @openrater/contracts. Two shapes (Brief
    81 D-B, exactly one per rule — the FlatFactorConfig
    input_path/input_paths grammar):

      · V1 single comparator — `variable` + `op` + `value`;
      · compound — `conditions[]`, every condition ANDs.

    NOTE the corrected semantics (the old docstring here was wrong):
    multiple rules with the same tier are OR-joined (first-match-wins),
    so AND cannot be authored as sibling rules — it needs `conditions`.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_id: str = Field(..., min_length=1, max_length=80)
    variable: str | None = Field(default=None, min_length=1, max_length=200)
    op: _ELIGIBILITY_OPS | None = None
    # `value` is unknown — Pydantic accepts any JSON-serializable scalar
    # or array (array is the natural encoding for `in`/`nin`).
    value: Any = None
    # Brief 81 — the compound shape: implicit AND, flat, non-empty.
    conditions: tuple[EligibilityConditionParams, ...] | None = Field(
        default=None, min_length=1
    )
    tier: _ELIGIBILITY_TIERS
    reasoning: str = Field(default="", max_length=500)
    citation: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _validate_rule_shape(self) -> "EligibilityRuleParams":
        single = self.variable is not None or self.op is not None
        compound = self.conditions is not None
        if single and compound:
            raise ValueError(
                f"EligibilityRuleParams {self.rule_id!r}: carries BOTH a "
                "single comparator and conditions[] — exactly one shape "
                "is allowed."
            )
        if not compound and (self.variable is None or self.op is None):
            raise ValueError(
                f"EligibilityRuleParams {self.rule_id!r}: needs either "
                "variable+op(+value) or conditions[]."
            )
        return self


class EligibilityGateConfig(BaseModel):
    """Config for an `eligibility.gate` stage.

    Mirrors `EligibilityGateParams` from @openrater/contracts. Authored by
    the FilterRuleEditor (one stage per filter rule by default; the
    GateCanvas adapter is free to colocate multiple rules into one
    stage when they share a disposition).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rules: tuple[EligibilityRuleParams, ...] = Field(..., min_length=1)
    default_tier: _ELIGIBILITY_TIERS = "preferred"
    default_reasoning: str = Field(default="", max_length=500)
    # Brief 94.5 (T5) — the filed `__default__` row's citation ("all
    # other risks: Standard, per Rule 1.C") finally has a field to land
    # in; the workbook builder was silently dropping it. Additive +
    # default None → existing gate stages validate + score unchanged.
    default_citation: str | None = Field(default=None, max_length=500)
    # E03 / brief D4 — pipeline phase: "row" (per-location, default) or
    # "policy" (evaluated AFTER the multi-location roll-up against the policy
    # totals; ADR-016). Additive + default "row" → existing gate stages
    # validate + score unchanged.
    scope: Literal["row", "policy"] = "row"
    # Brief 87 P5 (ADR-0062-B) — optional per-variable source arms. A listed
    # variable resolves BEFORE the gate walks: {from:"model", model_id,
    # version} scores the risk through the pinned registry artifact (the
    # scoring service's pre-pass; glm_coeff only, P-N6). Additive + default
    # None → existing gates validate + score unchanged. Values are kept as
    # loose dicts here — the contracts resolver is the semantic validator.
    variable_sources: dict[str, dict] | None = None


class ScheduleCategoryParams(BaseModel):
    """One category in a `modifier.schedule` stage's filed structure.

    Mirrors `ScheduleCategory` from @openrater/contracts/schedule-types.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    category_id: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=120)
    # `range_pct` is ±N% — the applied value must satisfy
    # abs(value_pct) <= range_pct (validated at evaluation, not here).
    range_pct: float = Field(..., ge=0)
    tier_filter: tuple[_ELIGIBILITY_TIERS, ...] | None = None
    reasoning_required: bool = True
    display_order: int | None = None


class ScheduleParams(BaseModel):
    """The filed structure inside `modifier.schedule.schedule`.

    Mirrors `Schedule` from @openrater/contracts/schedule-types.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    schedule_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=120)
    scope: Literal["per_coverage", "package"] = "package"
    coverages: tuple[str, ...] | None = None
    total_cap_pct: float = Field(..., gt=0)
    categories: tuple[ScheduleCategoryParams, ...] = Field(..., min_length=1)
    citation: str | None = Field(default=None, max_length=200)
    reasoning: str | None = Field(default=None, max_length=500)
    lob_tags: tuple[str, ...] | None = None
    display_order: int | None = None


class ModifierScheduleConfig(BaseModel):
    """Config for a `modifier.schedule` stage.

    Mirrors `ModifierScheduleParams` from @openrater/contracts. The schedule
    is filed (carrier-level); per-risk applications are wire inputs the
    runtime applies at evaluation.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    schedule: ScheduleParams


class EndorsementTriggerParams(BaseModel):
    """Auto-attach predicate for an endorsement stage.

    Mirrors `EndorsementTrigger` from @openrater/contracts. When `null` (or
    omitted), the endorsement always attaches.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    variable: str = Field(..., min_length=1, max_length=200)
    op: _ELIGIBILITY_OPS
    value: Any


class EndorsementFactorConfig(BaseModel):
    """Config for an `endorsement.factor` stage.

    Mirrors `EndorsementFactorParams` from @openrater/contracts. When the
    trigger fires (or trigger is null = always attach), the endorsement
    multiplies the premium by `factor`.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    form_number: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=120)
    trigger: EndorsementTriggerParams | None = None
    factor: float = Field(..., gt=0)
    citation: str | None = Field(default=None, max_length=200)


class EndorsementAdditiveConfig(BaseModel):
    """Config for an `endorsement.additive` stage.

    Mirrors `EndorsementAdditiveParams` from @openrater/contracts. When the
    trigger fires, adds a flat `amount` to the premium.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    form_number: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=120)
    trigger: EndorsementTriggerParams | None = None
    amount: float
    citation: str | None = Field(default=None, max_length=200)


class EndorsementSublimitConfig(BaseModel):
    """Config for an `endorsement.sublimit` stage.

    Mirrors `EndorsementSublimitParams` from @openrater/contracts. When the
    trigger fires, declares a sublimit on the named coverage (premium
    passes through unchanged + sublimit metadata emits).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    form_number: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=120)
    trigger: EndorsementTriggerParams | None = None
    coverage: str = Field(..., min_length=1, max_length=120)
    sublimit: float = Field(..., gt=0)
    citation: str | None = Field(default=None, max_length=200)


# ===========================================================================
# Phase G G4 — endorsement.rate_branch (Brief 40 lock 2026-05-26)
#
# An auto-attached endorsement whose trigger fires runs an embedded
# mini ChainSpec. The chain output is added to the policy premium
# post-base-chain, pre-modifier (Brief 40 §−1 Q6). Reuses the existing
# `ChainSpec` building blocks (DimensionBinding, FactorLookup,
# LcmApplication, ChainSpec) — same shape as a multiplicative_chain
# sub-chain (Brief 40 §−1 Q2).
# ===========================================================================


class EndorsementRateBranchConfig(BaseModel):
    """Config for an `endorsement.rate_branch` stage.

    When `trigger` evaluates true on `ctx.externalInputs` (or trigger
    is null = always attach), the `branch_chain` runs as if it were
    a standalone `multiplicative_chain`. The chain's `output_field`
    value is then added to the policy's accumulated premium.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    form_number: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=120)
    trigger: EndorsementTriggerParams | None = None
    branch_chain: ChainSpec
    citation: str | None = Field(default=None, max_length=200)


# ===========================================================================
# Phase G G5 — modifier.model (Brief 41 lock 2026-05-26)
#
# A schedule modifier whose factor is the output of an ML model handle
# (resolved by Model Lab post-OSS-launch — until then the runtime
# returns 1.0 from the model.rating stub). The factor is CLAMPED to the
# filed [min_factor, max_factor] envelope before applying to the
# premium. When the model is unreachable, `fallback_factor` is used.
# All three (model output, clamp, fallback) are surfaced in the trace.
# ===========================================================================


class ModelInputDeclaration(BaseModel):
    """One declared input the model reads at scoring time.

    Mirrors the Phase G G2 `<VariableRefPicker>` shape: each input
    declares whether it's a mapped CSV/webhook column (`"input"`) or
    a dim slug from the plan catalog (`"dimension"`). Strict
    validation (Brief 41 §−1 Q3) fires when an entry doesn't match
    `plan.input_mapping.column_map` AND isn't a dim slug.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    variable: str = Field(..., min_length=1, max_length=200)
    source: Literal["input", "dimension"] = "input"


class ModelClampEnvelope(BaseModel):
    """Filed clamp on the model's output factor.

    Both bounds are REQUIRED (Brief 41 §−1 Q4) + ordered + positive.
    The runtime applies `clamp(model_output, min_factor, max_factor)`
    before the factor multiplies the premium.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    min_factor: float = Field(..., gt=0)
    max_factor: float = Field(..., gt=0)

    @model_validator(mode="after")
    def _ordered(self) -> ModelClampEnvelope:
        if self.min_factor > self.max_factor:
            raise ValueError(
                "ModelClampEnvelope: min_factor must be <= max_factor",
            )
        return self


class ModifierModelConfig(BaseModel):
    """Config for a `modifier.model` stage.

    The user authors the modifier as a model handle + declared inputs
    + clamp envelope + cap rationale + fallback. The model itself is
    resolved by Model Lab (post-OSS-launch) — runtime uses the
    model.rating stub until then.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model_id: str = Field(..., min_length=1, max_length=120)
    version: str | None = Field(default=None, max_length=80)
    declared_inputs: tuple[ModelInputDeclaration, ...] = Field(
        ..., min_length=1
    )
    clamp: ModelClampEnvelope
    # Brief 41 §−1 Q5 — cap rationale must be ≥30 chars.
    rationale: str = Field(..., min_length=30, max_length=1000)
    fallback_factor: float = Field(..., gt=0)
    citation: str | None = Field(default=None, max_length=200)


# ===========================================================================
# Discriminated dispatch
# ===========================================================================


StageConfig = Annotated[
    InputNodeConfig
    | FormulaConfig
    | CaseConfig
    | ClassificationLookupConfig
    | EligibilityEvaluatorConfig
    | TerritoryResolverConfig
    | MultiplicativeChainConfig
    | AdditiveConfig
    | FlatFactorConfig
    | ClampConfig
    | RoundConfig
    | DeferredZeroConfig
    | IrpmApplyConfig
    | EligibilityGateConfig
    | ModifierScheduleConfig
    | EndorsementFactorConfig
    | EndorsementAdditiveConfig
    | EndorsementSublimitConfig
    | EndorsementRateBranchConfig
    | ModifierModelConfig,
    Field(discriminator=None),
]


_CONFIG_BY_KIND: dict[StageKind, type[BaseModel]] = {
    StageKind.INPUT_NODE: InputNodeConfig,
    StageKind.FORMULA: FormulaConfig,
    StageKind.CASE_NODE: CaseConfig,
    StageKind.CLASSIFICATION_LOOKUP: ClassificationLookupConfig,
    StageKind.ELIGIBILITY_EVALUATOR: EligibilityEvaluatorConfig,
    StageKind.TERRITORY_RESOLVER: TerritoryResolverConfig,
    StageKind.MULTIPLICATIVE_CHAIN: MultiplicativeChainConfig,
    StageKind.ADDITIVE: AdditiveConfig,
    StageKind.FLAT_FACTOR: FlatFactorConfig,
    StageKind.CLAMP: ClampConfig,
    StageKind.ROUND: RoundConfig,
    StageKind.DEFERRED_ZERO: DeferredZeroConfig,
    StageKind.IRPM_APPLY: IrpmApplyConfig,
    # Phase G G1 — gate workspace kinds (dotted names mirror @openrater/contracts).
    StageKind.ELIGIBILITY_GATE: EligibilityGateConfig,
    StageKind.MODIFIER_SCHEDULE: ModifierScheduleConfig,
    StageKind.ENDORSEMENT_FACTOR: EndorsementFactorConfig,
    StageKind.ENDORSEMENT_ADDITIVE: EndorsementAdditiveConfig,
    StageKind.ENDORSEMENT_SUBLIMIT: EndorsementSublimitConfig,
    # Phase G G4 + G5 — endorsement-branching + model-wrapped IRPM
    # (Briefs 40 + 41, locked 2026-05-26).
    StageKind.ENDORSEMENT_RATE_BRANCH: EndorsementRateBranchConfig,
    StageKind.MODIFIER_MODEL: ModifierModelConfig,
    # Reserved kinds raise at parse time.
}


def parse_stage_config(stage: Stage) -> Any:
    """Validate and return the typed config for a stage.

    Raises:
        NotImplementedError: for reserved kinds (ml_model, api_enrichment).
        pydantic.ValidationError: when the `config_json` doesn't satisfy
            the kind's schema.
    """
    if stage.stage_kind == StageKind.ML_MODEL:
        raise NotImplementedError(
            f"stage_kind=ml_model reserved (stage_id={stage.stage_id})"
        )
    if stage.stage_kind == StageKind.API_ENRICHMENT:
        raise NotImplementedError(
            f"stage_kind=api_enrichment reserved (stage_id={stage.stage_id})"
        )
    config_cls = _CONFIG_BY_KIND[stage.stage_kind]
    return config_cls.model_validate(stage.config_json)


__all__ = [
    "AdditiveConfig",
    "CaseClause",
    "CaseConfig",
    "CasePredicate",
    "ChainSpec",
    "ClampConfig",
    "ClassificationLookupConfig",
    "DeferredZeroConfig",
    "DimensionBinding",
    "EligibilityEvaluatorConfig",
    # Phase G G1 — gate workspace configs.
    "EligibilityGateConfig",
    "EligibilityRuleParams",
    "EndorsementAdditiveConfig",
    "EndorsementFactorConfig",
    "EndorsementRateBranchConfig",
    "EndorsementSublimitConfig",
    "EndorsementTriggerParams",
    "FactorLookup",
    "FactorPredicate",
    "FlatFactorConfig",
    "FormulaConfig",
    "InputNodeConfig",
    "InputNodeValidation",
    "IrpmApplyConfig",
    "LcmApplication",
    "ModelClampEnvelope",
    "ModelInputDeclaration",
    "ModifierModelConfig",
    "ModifierScheduleConfig",
    "MultiplicativeChainConfig",
    "RoundConfig",
    "ScheduleCategoryParams",
    "ScheduleParams",
    "StageConfig",
    "TerritoryResolverConfig",
    "parse_stage_config",
]
