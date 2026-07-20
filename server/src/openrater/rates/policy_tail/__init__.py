# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped policy tail registry — ADR-0055 (v4.0 P1).

Promotes the `openrater:policy-tail:v1:<planId>` localStorage store to a
first-class API resource so the policy tail is versioned, snapshot-
captured, read-only-gated, and reproducible server-side. One tail per
plan (singleton), so the substrate keeps the envelope simple.
"""

from openrater.rates.policy_tail.models import (
    PolicyTailEnvelope,
    UpsertPolicyTailRequest,
)
from openrater.rates.policy_tail.repo import (
    delete_policy_tail,
    get_policy_tail,
    upsert_policy_tail,
)

__all__ = [
    "PolicyTailEnvelope",
    "UpsertPolicyTailRequest",
    "get_policy_tail",
    "upsert_policy_tail",
    "delete_policy_tail",
]
