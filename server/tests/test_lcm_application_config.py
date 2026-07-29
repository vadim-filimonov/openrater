# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Brief 54 — LcmApplication: authored-constant value + overridable escape
hatch + relaxed (optional) input_path.

Mirrors the Zod `lcmApplicationSchema` tests in
`packages/contracts/src/chain-configs.test.ts` so the two contract sides
can't drift.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from openrater.rates.plans.configs import LcmApplication


def test_authored_value_needs_no_input_path() -> None:
    """The carrier LCM scalar lives on the chain; no submission column."""
    lcm = LcmApplication(value=1.401, citation_rule="SERFF BMUT-134648356-4")
    assert lcm.value == 1.401
    assert lcm.input_path is None
    assert lcm.overridable is False


def test_legacy_input_path_only_still_valid() -> None:
    """Pre-Brief-53 plans (input_path-driven) round-trip unchanged."""
    lcm = LcmApplication(input_path="form_input.lcm")
    assert lcm.input_path == "form_input.lcm"
    assert lcm.value is None
    assert lcm.factor_kind == "lcm"
    assert lcm.citation_rule == "(carrier-set)"


def test_overridable_value_plus_input() -> None:
    """D3 escape hatch — a carrier default value AND a per-risk override."""
    lcm = LcmApplication(
        value=1.401, input_path="form_input.lcm", overridable=True
    )
    assert lcm.overridable is True
    assert lcm.value == 1.401


def test_rejects_neither_value_nor_input_path() -> None:
    """An LCM block must resolve to something."""
    with pytest.raises(ValidationError):
        LcmApplication()


def test_rejects_empty_input_path() -> None:
    """Empty string still fails min_length=1 (not a valid input path)."""
    with pytest.raises(ValidationError):
        LcmApplication(input_path="")
