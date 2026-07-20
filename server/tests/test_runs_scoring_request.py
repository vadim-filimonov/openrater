# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Unit tests for the Run-zone scoring request builders (scoring.py).

Pure functions: a composed plan body (`_compose_body` output) → the
`/score` request the scoring service consumes. The ADR-0063 interpolation
flag must ride through to the projector; dropping it here would silently
step a flagged factor table server-side while the cold test interpolates.
"""

from __future__ import annotations

from typing import Any

from openrater.rates.runs.scoring import (
    plan_stages_request,
    plan_stages_source_fields,
)

_INTERP = {"mode": "linear", "axis": "building_limit"}


def _body(*, interpolation: dict[str, Any] | None) -> dict[str, Any]:
    ft: dict[str, Any] = {
        "table_id": "building_limit_of_insurance_factors",
        "slug": "building_limit_of_insurance_factors",
        "display_name": "Building Limit relativities",
        "key_dimensions": ["building_limit", "building_limit_group"],
        "cells": {"band_a=b1|group=group_c": 1.0},
        "interpolation": interpolation,
    }
    return {"factor_tables": [ft], "stages": [], "dimensions": []}


def _entry(request: dict[str, Any]) -> dict[str, Any]:
    tables = request["factorTables"]
    assert len(tables) == 1
    return tables[0]


class TestInterpolationRidesToScoring:
    def test_flag_present_reaches_catalog_entry(self) -> None:
        entry = _entry(
            plan_stages_source_fields(_body(interpolation=_INTERP))
        )
        assert entry["interpolation"] == _INTERP

    def test_flag_absent_is_omitted_not_null(self) -> None:
        # None → the key is dropped from the catalog entry (the projector
        # treats a missing flag as "step"), never serialized as an explicit
        # null the scoring schema would have to special-case.
        entry = _entry(
            plan_stages_source_fields(_body(interpolation=None))
        )
        assert "interpolation" not in entry

    def test_plan_stages_request_also_carries_it(self) -> None:
        # The /score-specific builder shares the same substrate.
        request = plan_stages_request(
            body=_body(interpolation=_INTERP), inputs={}, as_of=None
        )
        assert _entry(request)["interpolation"] == _INTERP
