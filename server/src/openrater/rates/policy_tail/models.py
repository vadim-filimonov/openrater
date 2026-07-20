# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for the plan-scoped policy tail (ADR-0055).

One tail per plan. The `tail` is the full ordered `PolicyAdjustment[]`
from the frontend/Engine — each item a discriminated union on `kind`
(schedule_rating | package_factor | endorsement | minimum_premium),
applied per policy on the rolled premium after roll-up.

We store + return verbatim — the backend doesn't introspect item shape.
The frontend / Engine narrow at the consumption site, which keeps this
substrate compatible with future adjustment kinds without a Pydantic
version bump (same contract-opacity convention as `InputMappingEnvelope`).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PolicyTailEnvelope(BaseModel):
    """One policy tail scoped to one plan. Mirrors a `plan_policy_tail`
    row. Lifecycle columns are returned alongside the opaque `tail`
    payload so callers can render "last updated" + drive cache busting.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    tail: list[dict[str, Any]]
    """The full ordered PolicyAdjustment[]. Backend treats as opaque."""

    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)
    content_hash: str | None = Field(default=None, max_length=16)


class UpsertPolicyTailRequest(BaseModel):
    """PUT body — the full ordered tail. The backend does no structural
    validation beyond requiring a JSON array of objects; the frontend's
    contract guard enforces the per-item discriminated union.
    """

    model_config = ConfigDict(extra="forbid")

    tail: list[dict[str, Any]]
