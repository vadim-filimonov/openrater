# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for per-plan API keys (Brief 76, v4 P4.2).

A key gates the quote endpoint for external callers (D-D). The SECRET is
returned exactly once — at mint — and stored only as a SHA-256 hash;
every read after that is metadata (a recognizable prefix, never the
secret). The gate is optional (`RATER_QUOTE_REQUIRE_KEY`), so OpenRater
Labs ships open and a carrier locks it down without forking.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ApiKeySummary(BaseModel):
    """A key's metadata — everything but the secret (unrecoverable)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    key_id: str
    rating_plan_id: str
    secret_prefix: str
    label: str | None = None
    created_at: str
    created_by: str | None = None
    last_used_at: str | None = None
    revoked_at: str | None = None

    @property
    def active(self) -> bool:
        return self.revoked_at is None


class ApiKeyCreated(ApiKeySummary):
    """The mint response — the ONLY time the secret is ever returned.
    The client must store it now; the server keeps only its hash."""

    secret: str


class CreateApiKeyRequest(BaseModel):
    """Mint a key. `label` is a human tag ('prod integration', 'sandbox')."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=120)


class ApiKeyList(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    keys: list[ApiKeySummary]
