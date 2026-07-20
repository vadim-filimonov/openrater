# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Per-plan class-code registry — Brief 51.

The writable class library a plan rates against. Promotes the read-only
10-row frontend fixture (`SAMPLE_BOP_STARTER_CLASSES`) to a first-class,
per-plan API resource. The frontend `ClassRecord` round-trips verbatim
through `PlanClassCode`; `attributes` carries the derived rating
attributes the `derive.class_attribute` kind (ADR-0035) reads.
"""

from openrater.rates.class_codes.models import (
    BulkImportClassCodesRequest,
    BulkImportClassCodesResponse,
    ListClassCodesResponse,
    PlanClassCode,
    UpsertClassCodeRequest,
)
from openrater.rates.class_codes.repo import (
    bulk_import_class_codes,
    delete_class_code,
    get_class_code,
    list_class_codes,
    upsert_class_code,
)

__all__ = [
    "PlanClassCode",
    "UpsertClassCodeRequest",
    "ListClassCodesResponse",
    "BulkImportClassCodesRequest",
    "BulkImportClassCodesResponse",
    "list_class_codes",
    "get_class_code",
    "upsert_class_code",
    "delete_class_code",
    "bulk_import_class_codes",
]
