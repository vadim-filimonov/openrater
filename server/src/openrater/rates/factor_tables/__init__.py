# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped factor tables + cells registry — D6.3 / ADR-0027.

Promotes the `openrater:factor-tables:v1:<planId>` localStorage cache
+ the per-FT cell-value sidecar to first-class API resources.

Cells live in a separate SQLite table (cardinality + partial-update
flexibility) but ride along on the parent FT object in API responses.
See `repo.py` for the merge logic and `models.py` for the wire shape.
"""

from openrater.rates.factor_tables.models import (
    BulkUpsertFactorTablesRequest,
    ListFactorTablesResponse,
    PlanFactorTable,
    UpsertFactorTableCellsRequest,
    UpsertFactorTableRequest,
)
from openrater.rates.factor_tables.repo import (
    bulk_upsert_factor_tables,
    delete_factor_table,
    factor_tables_collection_hash,
    list_factor_tables,
    upsert_factor_table,
    upsert_factor_table_cells,
)

__all__ = [
    "PlanFactorTable",
    "UpsertFactorTableRequest",
    "UpsertFactorTableCellsRequest",
    "ListFactorTablesResponse",
    "BulkUpsertFactorTablesRequest",
    "list_factor_tables",
    "upsert_factor_table",
    "upsert_factor_table_cells",
    "delete_factor_table",
    "bulk_upsert_factor_tables",
    "factor_tables_collection_hash",
]
