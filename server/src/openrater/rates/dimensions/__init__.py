# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped dimensions registry — D6.2 / ADR-0027.

Promotes the `openrater:dimensions:v1:<planId>` localStorage cache to a
first-class API resource. The frontend's `DimensionRow` shape round-trips
verbatim through `PlanDimension`; the `levels` array is JSON-serialized
into the `levels_json` column.

See ADR-0027 §1.1 for the endpoint contract + table layout.
"""

from openrater.rates.dimensions.models import (
    ListDimensionsResponse,
    PlanDimension,
    UpsertDimensionRequest,
)
from openrater.rates.dimensions.repo import (
    bulk_upsert_dimensions,
    delete_dimension,
    dimensions_collection_hash,
    list_dimensions,
    upsert_dimension,
)

__all__ = [
    "PlanDimension",
    "UpsertDimensionRequest",
    "ListDimensionsResponse",
    "list_dimensions",
    "upsert_dimension",
    "delete_dimension",
    "bulk_upsert_dimensions",
    "dimensions_collection_hash",
]
