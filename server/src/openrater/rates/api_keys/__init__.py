# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Per-plan API keys + the optional quote gate (Brief 76, v4 P4.2)."""

from openrater.rates.api_keys.models import (
    ApiKeyCreated,
    ApiKeyList,
    ApiKeySummary,
    CreateApiKeyRequest,
)
from openrater.rates.api_keys.service import (
    authorize_quote,
    list_keys,
    mint_api_key,
    quote_key_required,
    revoke_key,
    verify_key,
)

__all__ = [
    "ApiKeyCreated",
    "ApiKeyList",
    "ApiKeySummary",
    "CreateApiKeyRequest",
    "authorize_quote",
    "list_keys",
    "mint_api_key",
    "quote_key_required",
    "revoke_key",
    "verify_key",
]
