# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped input mapping registry — D6.1 / ADR-0027.

Promotes the `openrater:inputs-mapping:v1:<planId>` localStorage cache
to a first-class API resource. One mapping per plan (singleton, not a
collection), so the substrate keeps the envelope simple.
"""

from openrater.rates.inputs_mapping.models import (
    InputMappingEnvelope,
    UpsertInputMappingRequest,
)
from openrater.rates.inputs_mapping.repo import (
    delete_input_mapping,
    get_input_mapping,
    upsert_input_mapping,
)

__all__ = [
    "InputMappingEnvelope",
    "UpsertInputMappingRequest",
    "get_input_mapping",
    "upsert_input_mapping",
    "delete_input_mapping",
]
