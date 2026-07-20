# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Genericity invariant (ADR-0033 §0) — stage configs ship no program data.

Owner directive 2026-07-14: "this rating platform has to be plan
agnostic." Two shipped Pydantic defaults used to freeze BOP/Kansas
knowledge into the platform: `ClassificationLookupConfig.output_fields`
(a BOP column list) and `TerritoryResolverConfig.fallback_territory`
(the Kansas territory code "704"). These tests pin the corrected
contract: column sets and fallback codes are PLAN data, supplied per
plan, never platform defaults. The CI-side twin is the backend section
of `scripts/check-rating-lob-agnostic.mjs`.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from openrater.rates.plans.configs import (
    ClassificationLookupConfig,
    TerritoryResolverConfig,
)

# ---------------------------------------------------------------------------
# ClassificationLookupConfig.output_fields — required, plan-supplied
# ---------------------------------------------------------------------------


def test_classification_output_fields_is_required() -> None:
    """An empty config no longer inherits a platform column list."""
    with pytest.raises(ValidationError):
        ClassificationLookupConfig.model_validate({})


def test_classification_output_fields_rejects_empty() -> None:
    """A declared-but-empty projection is meaningless — refuse it."""
    with pytest.raises(ValidationError):
        ClassificationLookupConfig.model_validate({"output_fields": []})


def test_classification_output_fields_round_trips_plan_data() -> None:
    """Whatever columns the plan's class registry carries flow through."""
    cfg = ClassificationLookupConfig.model_validate(
        {"output_fields": ["class_code", "rate_group", "exposure_base"]}
    )
    assert cfg.output_fields == ("class_code", "rate_group", "exposure_base")
    assert cfg.class_code_input == "form_input.class_code"


# ---------------------------------------------------------------------------
# TerritoryResolverConfig.fallback_territory — optional, absent ⇒ error
# ---------------------------------------------------------------------------


def test_territory_fallback_defaults_to_none() -> None:
    """No authored fallback ⇒ an unmapped ZIP is a visible error
    (the absent ⇒ `error` grammar of UnknownKeyPolicy, ADR-0056)."""
    cfg = TerritoryResolverConfig.model_validate({})
    assert cfg.fallback_territory is None


def test_territory_fallback_accepts_plan_authored_code() -> None:
    """A filed "all other" territory arrives as plan data."""
    cfg = TerritoryResolverConfig.model_validate({"fallback_territory": "704"})
    assert cfg.fallback_territory == "704"


def test_territory_fallback_rejects_empty_string() -> None:
    with pytest.raises(ValidationError):
        TerritoryResolverConfig.model_validate({"fallback_territory": ""})
