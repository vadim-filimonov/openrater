# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""ADR-0047 — DimensionBinding axis sources (literal / computed / derived)
+ ChainSpec.apply_exposure.

Mirrors the Zod `dimensionBindingSchema` + `chainSpecSchema` tests in
`packages/contracts/src/chain-configs.test.ts` so the two contract sides
can't drift (the LCM half already has `test_lcm_application_config.py`).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from openrater.rates.plans.configs import ChainSpec, DimensionBinding, LcmApplication

# ---------------------------------------------------------------------------
# DimensionBinding — axis sources
# ---------------------------------------------------------------------------


def test_form_input_binding_round_trips() -> None:
    """Legacy `{source, path}` bindings parse unchanged."""
    b = DimensionBinding(source="form_input", path="class_code")
    assert b.source == "form_input"
    assert b.path == "class_code"
    assert b.value is None


def test_literal_binding_carries_a_constant_key() -> None:
    """A 2-D axis pinned to a constant (e.g. KS group 'group_c')."""
    b = DimensionBinding(source="literal", value="group_c")
    assert b.value == "group_c"
    assert b.path is None


def test_computed_sum_binding() -> None:
    """A 2-D axis derived as op='sum' over input fields."""
    b = DimensionBinding(
        source="computed", op="sum", fields=("building_limit", "bpp_limit")
    )
    assert b.op == "sum"
    assert b.fields == ("building_limit", "bpp_limit")


def test_derived_binding_path_names_the_derived_dim() -> None:
    """A class-attribute axis references the bound dim's derived output."""
    b = DimensionBinding(source="derived", path="prop_rate_number")
    assert b.source == "derived"
    assert b.path == "prop_rate_number"


def test_rejects_literal_without_value() -> None:
    with pytest.raises(ValidationError):
        DimensionBinding(source="literal")


def test_rejects_computed_without_op_and_fields() -> None:
    with pytest.raises(ValidationError):
        DimensionBinding(source="computed", op="sum")  # no fields


def test_rejects_form_input_without_path() -> None:
    with pytest.raises(ValidationError):
        DimensionBinding(source="form_input")


def test_rejects_unsupported_computed_op() -> None:
    with pytest.raises(ValidationError):
        DimensionBinding(source="computed", op="product", fields=("a",))


# ---------------------------------------------------------------------------
# ChainSpec.apply_exposure
# ---------------------------------------------------------------------------


def test_chain_spec_apply_exposure_opt_in() -> None:
    """A per-account exposure-rated tower carries the explicit flag."""
    chain = ChainSpec(
        name="nonprofit tower",
        base_input="literal.base_value",
        base_value=1.0,
        lcm=LcmApplication(value=1.0),
        exposure_input="form_input.annual_revenue",
        exposure_unit_divisor=1000.0,
        apply_exposure=True,
        output_field="premium",
    )
    assert chain.apply_exposure is True


def test_chain_spec_apply_exposure_defaults_none() -> None:
    """Legacy chains omit it → None (no exposure unless coverage-driven)."""
    chain = ChainSpec(
        name="legacy chain",
        base_input="stages.rate_number.value",
        lcm=LcmApplication(input_path="form_input.lcm"),
        exposure_input="form_input.tiv",
        exposure_unit_divisor=100.0,
        output_field="premium",
    )
    assert chain.apply_exposure is None
