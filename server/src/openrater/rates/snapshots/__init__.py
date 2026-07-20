# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan snapshots — Brief 43 §4 / PR 43.1.

A snapshot is an immutable freeze of a plan's full authored state, used
by the Analytics workspace to re-rate a scored dataset against any
historical version. Three endpoints (registered in main.py):

  POST   /api/v1/plans/{plan_id}/snapshots                — freeze
  GET    /api/v1/plans/{plan_id}/snapshots                — list summaries
  GET    /api/v1/plans/{plan_id}/snapshots/{snapshot_id}  — get one + body

Append-only in v1. No DELETE / no UPDATE.
"""

from openrater.rates.snapshots.models import (
    FreezeSnapshotRequest,
    GoLiveRequest,
    GoLiveResponse,
    ListSnapshotsResponse,
    PlanSnapshot,
    PlanSnapshotSummary,
    PublishStatus,
)
from openrater.rates.snapshots.service import (
    PlanNotFoundError,
    SnapshotNameCollisionError,
    SnapshotNotFoundError,
    freeze_current_draft,
    get_snapshot_with_body,
    go_live,
    list_snapshots_for_plan,
    publish_snapshot_for_plan,
    publish_status,
)

__all__ = [
    "FreezeSnapshotRequest",
    "GoLiveRequest",
    "GoLiveResponse",
    "ListSnapshotsResponse",
    "PlanNotFoundError",
    "PlanSnapshot",
    "PlanSnapshotSummary",
    "PublishStatus",
    "SnapshotNameCollisionError",
    "SnapshotNotFoundError",
    "freeze_current_draft",
    "get_snapshot_with_body",
    "go_live",
    "list_snapshots_for_plan",
    "publish_snapshot_for_plan",
    "publish_status",
]
