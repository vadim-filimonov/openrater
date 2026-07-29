# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Stage-kind taxonomy registry.

Self-describing catalog of every cascade stage kind the rating engine
supports. Powers the operator-visible browser at
`/plan-builder/stage-kinds` and is the foundation the "compose new
stages from primitives" stage builder will read from.

Cross-reference:
  · openrater.rates.plans.models (StageKind enum)
  · openrater.rates.plans.configs (per-kind Pydantic configs)
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from openrater.rates.plans.models import StageKind


class StageKindCategory:
    """Coarse taxonomy used to group cards in the UI."""

    CONTEXT_BUILDER = "context_builder"
    MATH = "math"
    SPECIAL = "special"
    IRPM = "irpm"
    RESERVED = "reserved"


class StageKindSpec(BaseModel):
    """One entry in the stage-kinds catalog."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    label: str
    category: str
    status: str
    purpose: str
    cascade_role: str
    config_keys: list[str]
    example_config: dict[str, Any]
    adr_ref: str | None = None


# ===========================================================================
# Registry — the canonical list. Order controls UI display order.
# ===========================================================================


STAGE_KIND_SPECS: list[StageKindSpec] = [
    # ---- Context builders ----
    StageKindSpec(
        id=StageKind.CLASSIFICATION_LOOKUP.value,
        label="Classification lookup",
        category=StageKindCategory.CONTEXT_BUILDER,
        status="active",
        purpose=(
            "Reads the operator-supplied class code and looks it up in "
            "the class table to populate the cascade context with the "
            "matched class definition — whichever columns the plan's "
            "class registry carries (rate groups, exposure bases, "
            "eligibility attributes)."
        ),
        cascade_role=(
            "Typically the first context-builder stage, so downstream "
            "math stages can read class_code metadata."
        ),
        config_keys=["class_code_input", "output_fields"],
        example_config={
            "class_code_input": "form_input.classification.class_code",
            "output_fields": [
                "class_code",
                "rate_group",
                "exposure_base",
            ],
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.ELIGIBILITY_EVALUATOR.value,
        label="Eligibility evaluator",
        category=StageKindCategory.CONTEXT_BUILDER,
        status="active",
        purpose=(
            "Runs the plan's eligibility predicate engine against the "
            "cascade context. Can halt the cascade with a decline "
            "disposition before any premium is computed."
        ),
        cascade_role=(
            "Stage 2 — runs after classification, before any pricing. "
            "Halts the cascade for risks the plan's filed rules "
            "declare ineligible."
        ),
        config_keys=["eligibility_engine_ref", "halt_if_disposition"],
        example_config={
            "eligibility_engine_ref": "legacy_v1",
            "halt_if_disposition": ["decline"],
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.TERRITORY_RESOLVER.value,
        label="Territory resolver",
        category=StageKindCategory.CONTEXT_BUILDER,
        status="active",
        purpose=(
            "Maps (state, ZIP) into the carrier's territory_code, the "
            "key used by every state-specific factor lookup downstream. "
            "When the ZIP isn't in the seeded mapping, applies the "
            "plan-authored fallback territory if one is set; with no "
            "fallback the miss is a visible resolution error."
        ),
        cascade_role=(
            "Stage 3 — runs after eligibility, before the premium "
            "chains read territory-keyed factors."
        ),
        config_keys=["state_input", "zip_input", "fallback_territory"],
        example_config={
            "state_input": "form_input.location.state_code",
            "zip_input": "form_input.location.zip5",
            "fallback_territory": None,
        },
        adr_ref="ADR-008",
    ),
    # ---- Math primitives ----
    StageKindSpec(
        id=StageKind.MULTIPLICATIVE_CHAIN.value,
        label="Multiplicative chain",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "N parallel chains, each starting from a base rate, "
            "applying an exposure multiplier (LOI / sales / payroll), "
            "and then multiplying through a sequence of factor lookups. "
            "The workhorse of every premium stage."
        ),
        cascade_role=(
            "The per-coverage premium stages — one chain per coverage "
            "the plan rates. Most rating math goes here."
        ),
        config_keys=["chains", "output_total_field"],
        example_config={
            "chains": [
                {
                    "chain_id": "building",
                    "base_input": "stage_3.territory.building_per_100",
                    "exposure_input": "form_input.coverages.building_limit_usd",
                    "factor_lookups": [
                        {
                            "factor_kind": "construction_class_factor",
                            "dimension_inputs": ["form_input.location.construction_class"],
                        },
                        {
                            "factor_kind": "ppc_factor",
                            "dimension_inputs": ["form_input.location.ppc_class"],
                        },
                    ],
                    "output_field": "building_premium_usd",
                }
            ],
            "output_total_field": "property_premium_usd",
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.ADDITIVE.value,
        label="Additive",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Sums upstream stage outputs into a single subtotal field. "
            "Used to roll property + liability + optional + endorsements "
            "into the pre-IRPM subtotal."
        ),
        cascade_role=(
            "Stage 10 — produces 'subtotal_before_schedule' from the "
            "outputs of stages 4-9 so schedule mod and IRPM can apply."
        ),
        config_keys=["inputs", "output_field"],
        example_config={
            "inputs": [
                "stage_4.property_premium_usd",
                "stage_5.liability_premium_usd",
                "stage_9.terrorism_premium_usd",
            ],
            "output_field": "subtotal_before_schedule_usd",
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.FLAT_FACTOR.value,
        label="Flat factor",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Multiplies one or more upstream values by a constant — "
            "with optional predicate gating. Used for terrorism, ARD, "
            "and any 'always-applies' charge that doesn't need a "
            "factor table."
        ),
        cascade_role=(
            "Stage 9 (terrorism — predicate-gated by state). Carriers "
            "use this for fixed expense fees and policy-level surcharges."
        ),
        config_keys=[
            "input_path",
            "factor",
            "factor_kind",
            "predicate",
            "output_field",
        ],
        example_config={
            "input_paths": [
                "stage_4.property_premium_usd",
                "stage_5.liability_premium_usd",
            ],
            "factor": 0.00001,
            "factor_kind": "terrorism_factor",
            "predicate": {"state_in": ["WI", "IL"]},
            "citation_rule": "TRIA",
            "output_field": "terrorism_premium_usd",
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.CLAMP.value,
        label="Clamp",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Bounds an upstream value within [min, max], optionally as "
            "a percentage of another input. Powers schedule rating mod "
            "(±25% cap) and any 'limit the swing' rule."
        ),
        cascade_role=(
            "Stage 11 (schedule mod — bounded per the plan's filed "
            "schedule-rating rule)."
        ),
        config_keys=[
            "input_path",
            "min_value",
            "max_value",
            "max_pct_of_input",
            "apply_as_multiplier",
        ],
        example_config={
            "input_path": "form_input.schedule_modifications",
            "min_value": -0.25,
            "max_value": 0.25,
            "apply_as_multiplier": True,
            "subtotal_input": "stage_10.subtotal_before_schedule_usd",
            "factor_kind": "schedule_mod_factor",
            "output_field": "schedule_mod_premium_usd",
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.ROUND.value,
        label="Round",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Rounds the final premium to a configurable increment and "
            "enforces a minimum policy premium. Always the last stage "
            "in any cascade."
        ),
        cascade_role=(
            "Stage 13 — runs last to produce the final rounded premium "
            "(e.g. round to nearest $1, floor at $250 minimum)."
        ),
        config_keys=["input_path", "increment_input", "min_value_input"],
        example_config={
            "input_path": "stage_12.irpm_adjusted_premium_usd",
            "increment_input": "literal.1",
            "min_value_input": "literal.250",
            "output_field": "final_premium_usd",
        },
        adr_ref="ADR-008",
    ),
    # ---- Input/Formula/Case (Sprint 12) ----
    StageKindSpec(
        id=StageKind.INPUT_NODE.value,
        label="Input node",
        category=StageKindCategory.SPECIAL,
        status="active",
        purpose=(
            "Top-of-DAG data declaration. Marks where a value enters "
            "the plan from a form, an API pull, an intake submission, "
            "or a literal. Downstream stages reference its output via "
            "stage_output input paths."
        ),
        cascade_role=(
            "Leftmost column on the canvas. Existing seeded plans wire "
            "form_input direct paths instead; blank-canvas plans use "
            "INPUT_NODE per declared input."
        ),
        config_keys=["name", "data_type", "source", "source_path"],
        example_config={
            "name": "Class code",
            "data_type": "string",
            "source": "form_input",
            "source_path": "classification.class_code",
            "example_value": "09341",
            "required": True,
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.FORMULA.value,
        label="Formula",
        category=StageKindCategory.SPECIAL,
        status="active",
        purpose=(
            "Evaluates a small expression DSL against upstream values "
            "and writes the result to its output dict. The expression "
            "is parsed via Python's `ast` module against a whitelisted "
            "node grammar — no `eval()` ever runs."
        ),
        cascade_role=(
            "Inline computation between named stages. Canonical "
            "example: `building_limit * 0.001` for an exposure rate."
        ),
        config_keys=["name", "expression", "inputs", "output_field"],
        example_config={
            "name": "Building exposure",
            "expression": "limit * 0.001",
            "inputs": {"limit": "form_input.coverages.building_limit_usd"},
            "data_type": "number",
            "output_field": "value",
        },
        adr_ref="ADR-008",
    ),
    StageKindSpec(
        id=StageKind.CASE_NODE.value,
        label="Case node",
        category=StageKindCategory.SPECIAL,
        status="active",
        purpose=(
            "N-way conditional dispatch. Resolves every declared input, "
            "then walks `cases` in order; the FIRST clause whose "
            "predicate-map matches wins. If no clause matches, "
            "`default` is returned (or `CaseNoMatchError` if default "
            "is None)."
        ),
        cascade_role=(
            "Discrete dispatch tables (territory tier → factor, class "
            "family → markup, eligibility decision → tier)."
        ),
        config_keys=["name", "inputs", "cases", "default", "output_field"],
        example_config={
            "name": "Territory tier",
            "inputs": {"territory": "stages.territory_resolver.territory_code"},
            "cases": [
                {"when": {"territory": {"in": ["001", "002"]}}, "then": "tier_1"},
                {"when": {"territory": {"in": ["003", "004"]}}, "then": "tier_2"},
            ],
            "default": "tier_3",
            "data_type": "string",
            "output_field": "tier",
        },
        adr_ref="ADR-008",
    ),
    # ---- Special ----
    StageKindSpec(
        id=StageKind.DEFERRED_ZERO.value,
        label="Deferred zero",
        category=StageKindCategory.SPECIAL,
        status="active",
        purpose=(
            "Explicit 'not yet priced' stub that produces 0.0 plus a "
            "deferred marker in the trace. Used as a placeholder for "
            "phases not yet implemented (optional coverages, "
            "endorsements, class-specific) so the cascade shape is "
            "complete and downstream sums work without special-casing."
        ),
        cascade_role=(
            "Stages 6-8 (optional coverages, endorsements, class-specific) "
            "until real handlers ship."
        ),
        config_keys=["elected_input", "note", "factor_kind_template"],
        example_config={
            "elected_input": "form_input.optional_coverages.elected",
            "note": "Optional coverages will be priced in a later phase.",
            "factor_kind_template": "optional_coverage_{coverage_code}",
            "output_field": "optional_coverages_premium_usd",
        },
        adr_ref="ADR-008",
    ),
    # ---- IRPM ----
    StageKindSpec(
        id=StageKind.IRPM_APPLY.value,
        label="IRPM apply",
        category=StageKindCategory.IRPM,
        status="active",
        purpose=(
            "Applies the operator's IRPM credit/debit modifications "
            "with the carrier's per-category and aggregate caps "
            "(typically ±25% aggregate). Wraps the legacy IRPM helper "
            "so existing carrier caps continue to apply."
        ),
        cascade_role=("Stage 12 — runs after schedule mod, before final rounding."),
        config_keys=[
            "subtotal_input",
            "irpm_modifications_input",
            "rate_set_id_input",
        ],
        example_config={
            "subtotal_input": "stage_11.schedule_mod_premium_usd",
            "irpm_modifications_input": "form_input.irpm_modifications",
            "rate_set_id_input": "literal.manual_rates_v1",
            "output_field": "irpm_adjusted_premium_usd",
        },
        adr_ref="ADR-008",
    ),
    # ---- Phase G G1 — Gate workspace kinds ----
    StageKindSpec(
        id=StageKind.ELIGIBILITY_GATE.value,
        label="Eligibility gate (filter)",
        category=StageKindCategory.CONTEXT_BUILDER,
        status="active",
        purpose=(
            "First-match-wins rule list authored in the GateCanvas. Each "
            "rule compares one input variable against a value and emits "
            "an eligibility tier (preferred / standard / submit / decline). "
            "Decline short-circuits the rest of scoring."
        ),
        cascade_role=(
            "Runs early — typically before the chain. The tier output "
            "feeds downstream modifier.schedule tier_filter checks + the "
            "UnifiedErrorPanel disposition surface."
        ),
        config_keys=["rules", "default_tier", "default_reasoning"],
        example_config={
            "rules": [
                {
                    "rule_id": "no_appetite_classes",
                    "variable": "class_code",
                    "op": "in",
                    "value": ["5813", "5921"],
                    "tier": "decline",
                    "reasoning": "Out of carrier appetite.",
                },
            ],
            "default_tier": "preferred",
            "default_reasoning": "No filter rule matched.",
        },
        adr_ref="Brief-39",
    ),
    StageKindSpec(
        id=StageKind.MODIFIER_SCHEDULE.value,
        label="Modifier schedule (IRPM)",
        category=StageKindCategory.IRPM,
        status="active",
        purpose=(
            "IRPM-style filed schedule. The plan author declares the "
            "category structure (name, ±range, optional tier filter) + a "
            "total cap; per-risk applications happen at evaluation time."
        ),
        cascade_role=(
            "Runs after the base chain. Aggregates underwriter-authored "
            "category values into a single factor that multiplies the "
            "subtotal, clamped to total_cap_pct."
        ),
        config_keys=["schedule"],
        example_config={
            "schedule": {
                "schedule_id": "irpm_schedule_v1",
                "display_name": "IRPM",
                "total_cap_pct": 25.0,
                "categories": [
                    {
                        "category_id": "management",
                        "name": "Management experience",
                        "range_pct": 10.0,
                        "reasoning_required": True,
                    },
                ],
            },
        },
        adr_ref="Brief-39",
    ),
    StageKindSpec(
        id=StageKind.ENDORSEMENT_FACTOR.value,
        label="Endorsement (factor)",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Auto-attaching endorsement that multiplies the premium when "
            "its trigger fires. The trigger compares one input field; "
            "trigger=null means always-attach."
        ),
        cascade_role=(
            "Runs after the base chain. Stacks with sibling endorsements "
            "in declaration order."
        ),
        config_keys=["form_number", "display_name", "trigger", "factor"],
        example_config={
            "form_number": "CG-2147",
            "display_name": "Liquor liability",
            "trigger": {"variable": "class_code", "op": "eq", "value": "5813"},
            "factor": 1.15,
        },
        adr_ref="Brief-39",
    ),
    StageKindSpec(
        id=StageKind.ENDORSEMENT_ADDITIVE.value,
        label="Endorsement (additive)",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Auto-attaching endorsement that adds a flat amount to the "
            "premium when its trigger fires. Useful for filed fees that "
            "don't scale with TIV."
        ),
        cascade_role=(
            "Runs after the base chain. Stacks with sibling endorsements."
        ),
        config_keys=["form_number", "display_name", "trigger", "amount"],
        example_config={
            "form_number": "FORM-9001",
            "display_name": "Water back-up provision",
            "trigger": None,
            "amount": 250.0,
        },
        adr_ref="Brief-39",
    ),
    StageKindSpec(
        id=StageKind.ENDORSEMENT_SUBLIMIT.value,
        label="Endorsement (sublimit)",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Auto-attaching endorsement that caps a coverage at a "
            "sublimit when its trigger fires. Premium passes through "
            "unchanged; sublimit metadata emits for the trace + binder."
        ),
        cascade_role=(
            "Runs after the base chain. Emits sublimit_out metadata that "
            "the binder rendering picks up."
        ),
        config_keys=[
            "form_number",
            "display_name",
            "trigger",
            "coverage",
            "sublimit",
        ],
        example_config={
            "form_number": "PEAK-100",
            "display_name": "Peak season limit",
            "trigger": {"variable": "tiv", "op": "gt", "value": 1000000},
            "coverage": "peak_items",
            "sublimit": 100000.0,
        },
        adr_ref="Brief-39",
    ),
    # ---- Phase G G4 + G5 — endorsement-branching + model-wrapped IRPM ----
    StageKindSpec(
        id=StageKind.ENDORSEMENT_RATE_BRANCH.value,
        label="Endorsement (rate branch)",
        category=StageKindCategory.MATH,
        status="active",
        purpose=(
            "Auto-attaching endorsement that runs its own mini rating "
            "chain when the trigger fires. The chain's output is added "
            "to the policy premium (post-base-chain, pre-modifier per "
            "Brief 40 §−1 Q6)."
        ),
        cascade_role=(
            "Runs after the base chain, before modifiers. Stacks "
            "independently with sibling endorsements."
        ),
        config_keys=[
            "form_number",
            "display_name",
            "trigger",
            "branch_chain",
        ],
        example_config={
            "form_number": "CG-2147",
            "display_name": "Liquor Liability",
            "trigger": {
                "variable": "has_liquor_sales",
                "op": "eq",
                "value": True,
            },
            "branch_chain": {
                "name": "liquor_premium",
                "base_input": "form_input.liquor_receipts",
                "factor_lookups": [],
                "lcm": {
                    "input_path": "form_input.lcm",
                },
                "exposure_input": "form_input.liquor_receipts",
                "exposure_unit_divisor": 1000,
                "output_field": "liquor_premium",
            },
        },
        adr_ref="Brief-40",
    ),
    StageKindSpec(
        id=StageKind.MODIFIER_MODEL.value,
        label="Modifier (model-wrapped)",
        category=StageKindCategory.IRPM,
        status="active",
        purpose=(
            "A schedule modifier whose factor is the output of an ML "
            "model handle, clamped to a filed [min, max] envelope. "
            "Until Model Lab ships, runtime returns 1.0 from the "
            "model.rating stub; the clamp + fallback semantics still "
            "execute deterministically."
        ),
        cascade_role=(
            "Runs as a modifier (post-chain). The clamped model factor "
            "multiplies the accumulated premium. When the model is "
            "unreachable, the authored fallback_factor is used."
        ),
        config_keys=[
            "model_id",
            "version",
            "declared_inputs",
            "clamp",
            "rationale",
            "fallback_factor",
        ],
        example_config={
            "model_id": "rater_pricing_v2",
            "version": "2026.05",
            "declared_inputs": [
                {"variable": "class_code", "source": "input"},
                {"variable": "building_age", "source": "input"},
                {"variable": "credit_score", "source": "input"},
            ],
            "clamp": {"min_factor": 0.85, "max_factor": 1.25},
            "rationale": (
                "Filed cap envelope per actuarial memo: model output "
                "bounded to ±25% to align with regulatory expectations."
            ),
            "fallback_factor": 1.0,
        },
        adr_ref="Brief-41",
    ),
    # ---- Reserved ----
    StageKindSpec(
        id=StageKind.ML_MODEL.value,
        label="ML model",
        category=StageKindCategory.RESERVED,
        status="reserved",
        purpose=(
            "Calls a Model Lab artifact and applies its score as "
            "a premium adjustment factor. Reserved until ADR-011 lands."
        ),
        cascade_role=(
            "Future: an opt-in stage between IRPM and rounding that lets "
            "carriers blend predictive-model output with their manual rate."
        ),
        config_keys=["model_id", "feature_inputs", "score_to_factor"],
        example_config={
            "model_id": "rater_pricing_v2",
            "feature_inputs": ["form_input.account.years_in_business"],
            "score_to_factor": {"min": 0.85, "max": 1.15},
            "output_field": "ml_model_factor",
        },
        adr_ref="ADR-011",
    ),
    StageKindSpec(
        id=StageKind.API_ENRICHMENT.value,
        label="API enrichment",
        category=StageKindCategory.RESERVED,
        status="reserved",
        purpose=(
            "Calls an API Lab connector to enrich the cascade "
            "context with external data (loss history, building "
            "footprint, weather risk). Reserved until ADR-012 lands."
        ),
        cascade_role=(
            "Future: a context-builder stage that augments form-input "
            "with real-world data before pricing math runs."
        ),
        config_keys=["connector_id", "input_mapping", "output_fields"],
        example_config={
            "connector_id": "iso_loss_history_v1",
            "input_mapping": {"named_insured": "form_input.account.named_insured"},
            "output_fields": ["loss_count_5y", "incurred_5y_usd"],
        },
        adr_ref="ADR-012",
    ),
]


# Sanity check: every StageKind enum value MUST appear in the registry.
_REGISTERED_IDS = {s.id for s in STAGE_KIND_SPECS}
_ENUM_IDS = {k.value for k in StageKind}
assert _ENUM_IDS == _REGISTERED_IDS, (
    f"stage_kind_specs.py registry drifted from StageKind enum: "
    f"missing={_ENUM_IDS - _REGISTERED_IDS}, "
    f"extra={_REGISTERED_IDS - _ENUM_IDS}"
)


def list_stage_kind_specs(
    *,
    status: str | None = None,
    category: str | None = None,
) -> list[StageKindSpec]:
    """Filtered view of the registry."""
    out = STAGE_KIND_SPECS
    if status is not None:
        out = [s for s in out if s.status == status]
    if category is not None:
        out = [s for s in out if s.category == category]
    return out


def category_counts() -> list[tuple[str, int]]:
    """Distribution of (category, count) across the catalog."""
    counts: dict[str, int] = {}
    for s in STAGE_KIND_SPECS:
        counts[s.category] = counts.get(s.category, 0) + 1
    order = [
        StageKindCategory.CONTEXT_BUILDER,
        StageKindCategory.MATH,
        StageKindCategory.SPECIAL,
        StageKindCategory.IRPM,
        StageKindCategory.RESERVED,
    ]
    return [(c, counts[c]) for c in order if c in counts]


__all__ = [
    "STAGE_KIND_SPECS",
    "StageKindCategory",
    "StageKindSpec",
    "category_counts",
    "list_stage_kind_specs",
]
