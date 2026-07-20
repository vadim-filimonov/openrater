"""Brief 81 (finding E8) — EligibilityRuleParams' two shapes.

Pins the discriminated rule schema: the V1 single comparator persists
verbatim; the compound ``conditions[]`` shape validates; exactly one of
the two is allowed (the FlatFactorConfig input_path/input_paths
grammar); and both shapes ride one ``eligibility.gate`` config through
the real stage-add API.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from openrater.rates.plans.configs import (
    EligibilityConditionParams,
    EligibilityGateConfig,
    EligibilityRuleParams,
)

from ._helpers import add_stage, create_plan

V1_RULE = {
    "rule_id": "new_venture",
    "variable": "years_in_business",
    "op": "lt",
    "value": 1,
    "tier": "decline",
    "reasoning": "New ventures excluded.",
}

COMPOUND_RULE = {
    "rule_id": "contractor_receipts_payroll",
    "conditions": [
        {"variable": "contractor_receipts", "op": "gt", "value": 300000},
        {"variable": "liab_exposure_base", "op": "eq", "value": "payroll"},
    ],
    "tier": "decline",
    "reasoning": "Receipts over $300k on a payroll-rated class.",
}


class TestRuleShapes:
    def test_v1_single_comparator_validates(self) -> None:
        rule = EligibilityRuleParams(**V1_RULE)
        assert rule.variable == "years_in_business"
        assert rule.conditions is None

    def test_compound_validates(self) -> None:
        rule = EligibilityRuleParams(**COMPOUND_RULE)
        assert rule.variable is None
        assert rule.conditions is not None
        assert len(rule.conditions) == 2
        assert isinstance(rule.conditions[0], EligibilityConditionParams)

    def test_both_shapes_rejected(self) -> None:
        with pytest.raises(ValidationError, match="exactly one shape"):
            EligibilityRuleParams(
                **{**V1_RULE, "conditions": COMPOUND_RULE["conditions"]}
            )

    def test_neither_shape_rejected(self) -> None:
        with pytest.raises(ValidationError, match="needs either"):
            EligibilityRuleParams(rule_id="r", tier="decline")

    def test_empty_conditions_rejected(self) -> None:
        with pytest.raises(ValidationError):
            EligibilityRuleParams(rule_id="r", conditions=[], tier="decline")

    def test_condition_needs_variable(self) -> None:
        with pytest.raises(ValidationError):
            EligibilityRuleParams(
                rule_id="r",
                conditions=[{"variable": "", "op": "eq", "value": 1}],
                tier="decline",
            )

    def test_gate_config_mixes_both_shapes(self) -> None:
        cfg = EligibilityGateConfig(
            rules=[V1_RULE, COMPOUND_RULE], default_tier="standard"
        )
        assert len(cfg.rules) == 2


class TestGateStageRoundTrip:
    def test_compound_rule_persists_through_the_stage_api(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client, display_name="Brief 81 shapes")
        plan_id = plan["rating_plan_id"]

        added = add_stage(
            client,
            plan_id,
            stage_id="appetite_location",
            stage_kind="eligibility.gate",
            display_name="Location appetite",
            config_json={
                "rules": [V1_RULE, COMPOUND_RULE],
                "default_tier": "standard",
                "default_reasoning": "Standard appetite.",
            },
            outputs=[
                {
                    "output_name": "tier",
                    "data_type": "string",
                    "description": None,
                }
            ],
        )
        rules = added["added_stage"]["config_json"]["rules"]
        assert rules[0]["variable"] == "years_in_business"
        # The compound rule persists its conditions verbatim — no
        # flattening, no shape rewrite.
        assert rules[1]["conditions"] == COMPOUND_RULE["conditions"]
        assert rules[1].get("variable") is None

    def test_both_shapes_on_one_rule_422s(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Brief 81 reject")
        plan_id = plan["rating_plan_id"]
        bad = client.post(
            f"/api/v1/drafts/{plan_id}/stages",
            json={
                "stage_id": "appetite_location",
                "stage_kind": "eligibility.gate",
                "display_name": "Location appetite",
                "config_json": {
                    "rules": [
                        {**V1_RULE, "conditions": COMPOUND_RULE["conditions"]}
                    ],
                    "default_tier": "standard",
                    "default_reasoning": "Standard appetite.",
                },
                "insert_after_stage_id": None,
                "inputs": [],
                "outputs": [],
            },
        )
        assert bad.status_code == 422, bad.text
