# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The value-transparency derivation (Brief 77 §8.5 erratum 2).

`_allowed_values_by_input` reads a published snapshot body and answers,
per form input: which values will the version's lookups actually accept?
Straight from the factor-table cell keys (where the engine looks), with
labels from the dimensions substrate — including the opaque-dim-id case,
matched by level-set overlap. Banded, classification, and geographic
dimensions stay free-form.
"""

from __future__ import annotations

from openrater.integrations.service import _allowed_values_by_input


def _body() -> dict:
    """A miniature of the Meridian BOP shape: one chain binding four dims to
    form inputs; tables keyed on them; a substrate that names the
    fictional quality-grade levels directly, names construction's under an
    opaque dim id, bands
    building_limit, and marks zip geographic."""
    return {
        "stages": [
            {
                "stage_kind": "multiplicative_chain",
                "config_json": {
                    "chains": [
                        {
                            "factor_lookups": [
                                {
                                    "table": "quality_grade_rel",
                                    "dimensions": {
                                        "quality_grade": {
                                            "path": "quality_grade",
                                            "source": "form_input",
                                        },
                                    },
                                },
                                {
                                    "table": "construction_rel",
                                    "dimensions": {
                                        "construction_class": {
                                            "path": "construction_class",
                                            "source": "form_input",
                                        },
                                    },
                                },
                                {
                                    "table": "bldg_rel",
                                    "dimensions": {
                                        "building_limit": {
                                            "path": "building_limit",
                                            "source": "form_input",
                                        },
                                        "zip": {"path": "zip", "source": "form_input"},
                                    },
                                },
                            ],
                        }
                    ]
                },
            }
        ],
        "factor_tables": [
            {
                "table_id": "quality_grade_rel",
                "key_dimensions": ["quality_grade"],
                "cells": {"q1": 1.0, "q2": 1.05, "q10": 1.34},
            },
            {
                "table_id": "construction_rel",
                "key_dimensions": ["construction_class"],
                "cells": {"frame": 1.2, "masonry": 1.0},
            },
            {
                "table_id": "bldg_rel",
                "key_dimensions": ["building_limit", "zip"],
                "cells": {"bldg_0_75k::67221": 1.0},
            },
        ],
        "dimensions": [
            {
                "dim_id": "quality_grade",
                "dimension_type": "standard",
                "levels": [
                    {"id": "q1", "kind": "categorical", "label": "Quality grade 1"},
                    {"id": "q2", "kind": "categorical", "label": "Quality grade 2"},
                    {"id": "q10", "kind": "categorical", "label": "Quality grade 10"},
                ],
            },
            {
                # Authoring gave construction an opaque id — the derivation
                # must still find its labels via level-set overlap.
                "dim_id": "dim_9",
                "dimension_type": "standard",
                "levels": [
                    {"id": "frame", "kind": "categorical", "label": "Frame"},
                    {"id": "masonry", "kind": "categorical", "label": "Masonry"},
                ],
            },
            {
                "dim_id": "building_limit",
                "dimension_type": "standard",
                "levels": [
                    {"id": "bldg_0_75k", "kind": "banded", "lo": 0, "hi": 75000},
                ],
            },
            {
                "dim_id": "zip",
                "dimension_type": "geographic",
                "levels": [{"id": "67221", "kind": "categorical", "label": "67221"}],
            },
        ],
    }


def test_enumerable_dims_yield_values_with_labels() -> None:
    allowed = _allowed_values_by_input(_body())

    quality_grade = allowed["quality_grade"]
    # Natural order: q2 before q10.
    assert [a.value for a in quality_grade] == ["q1", "q2", "q10"]
    assert quality_grade[0].label == "Quality grade 1"

    construction = allowed["construction_class"]
    assert {a.value: a.label for a in construction} == {
        "frame": "Frame",
        "masonry": "Masonry",
    }


def test_banded_and_geographic_stay_free_form() -> None:
    allowed = _allowed_values_by_input(_body())
    assert "building_limit" not in allowed  # banded — raw numbers band server-side
    assert "zip" not in allowed  # geographic — open value space


def test_cap_keeps_huge_domains_free_form() -> None:
    body = _body()
    body["factor_tables"][0]["cells"] = {f"q{i}": 1.0 for i in range(1, 200)}
    allowed = _allowed_values_by_input(body)
    assert "quality_grade" not in allowed
