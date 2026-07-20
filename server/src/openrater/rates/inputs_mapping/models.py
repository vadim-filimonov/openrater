# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for plan-scoped input mapping.

One mapping per plan. The `mapping` envelope is the full
`PlanInputMapping` from the frontend — a discriminated union on
`source.kind` (csv | webhook) plus `column_map` and optional
`alias_overrides` / `product_mode` fields.

We store + return verbatim — the backend doesn't introspect the
mapping shape. The frontend / Engine narrow at the consumption site,
which keeps this substrate compatible with future source kinds
without a Pydantic version bump.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class InputMappingEnvelope(BaseModel):
    """One input mapping scoped to one plan. Mirrors
    `plan_input_mappings` row. Lifecycle columns are returned
    alongside the opaque `mapping` payload so callers can render
    "last updated" + drive cache busting.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str = Field(..., min_length=1, max_length=80)
    mapping: dict[str, Any]
    """The full PlanInputMapping envelope. Backend treats as opaque."""

    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)
    content_hash: str | None = Field(default=None, max_length=16)


class UpsertInputMappingRequest(BaseModel):
    """PUT body — the full mapping envelope. The backend does no
    structural validation beyond requiring a JSON object; the
    frontend's zod schema enforces the discriminated union.
    """

    model_config = ConfigDict(extra="forbid")

    mapping: dict[str, Any]
