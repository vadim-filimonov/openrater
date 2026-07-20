# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for plan snapshots — Brief 43 §4 / PR 43.1.

A snapshot is an immutable freeze of a plan's full authored state at
the moment the user clicks "Freeze version". It captures:

  body = {
    "plan":          { identity + lifecycle metadata },
    "stages":        [ stage rows + I/O ],
    "dimensions":    [ dimension rows ],
    "factor_tables": [ factor tables with inlined cells ],
    "input_mapping": <PlanInputMapping or null>
  }

The body is opaque to the schema; the service layer composes it on
freeze + the route layer returns it verbatim on read. Snapshots
are append-only in v1 (no PUT / no DELETE).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------
# Row shapes
# ---------------------------------------------------------------


class PlanSnapshotSummary(BaseModel):
    """Light shape for the snapshot picker — metadata only, no body
    blob. Drives the dropdown in the Analytics workspace toolbar."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_id: str = Field(..., min_length=1, max_length=80)
    plan_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    created_at: str
    created_by: str = Field(..., min_length=1, max_length=120)
    published_at: str | None = None
    """ISO timestamp this version was published as Current; None otherwise.
    At most one snapshot per plan is non-None (Brief 64 §4)."""
    published_by: str | None = Field(default=None, max_length=120)


class PlanSnapshot(BaseModel):
    """Full snapshot including the body. Returned by GET one; only the
    Analytics workspace re-rates against it so the wire size is fine."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_id: str = Field(..., min_length=1, max_length=80)
    plan_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    body: dict[str, Any]
    """Self-contained snapshot of the plan's full authored state. Shape
    documented in the module docstring above."""
    created_at: str
    created_by: str = Field(..., min_length=1, max_length=120)
    published_at: str | None = None
    published_by: str | None = Field(default=None, max_length=120)


# ---------------------------------------------------------------
# Request / response envelopes
# ---------------------------------------------------------------


class FreezeSnapshotRequest(BaseModel):
    """Payload for POST /plans/{plan_id}/snapshots — freeze the current
    draft into a named snapshot."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    display_name: str = Field(..., min_length=1, max_length=200)
    """Human-readable label (e.g. 'filed_2026_q3'). Must be unique
    within the plan; collision returns 409."""
    notes: str | None = Field(default=None, max_length=2000)
    """Optional changelog — free text the actuary writes to explain
    what changed since the last frozen version."""


class ListSnapshotsResponse(BaseModel):
    """Envelope for GET /plans/{plan_id}/snapshots."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshots: list[PlanSnapshotSummary] = Field(default_factory=list)


class GoLiveRequest(BaseModel):
    """Payload for POST /plans/{plan_id}/publish — the ONE verb
    (Brief 84 D-B): freeze the current draft AND publish it as the
    version callers get. Both fields optional — the default version
    name is the first free `v{N}`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version_name: str | None = Field(default=None, min_length=1, max_length=200)
    """Optional label (defaults to auto `v{N}`). Filing tags like
    'filed_2026_q3' remain possible; collision returns 409."""
    notes: str | None = Field(default=None, max_length=2000)
    """Optional changelog — what's in this version."""


class GoLiveResponse(BaseModel):
    """Envelope for POST /plans/{plan_id}/publish: the version that just
    went live + the plan's resulting publish state (diverged is False by
    construction — the version IS the draft's bytes)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot: PlanSnapshotSummary
    publish_status: "PublishStatus"


class PublishStatus(BaseModel):
    """The plan's publish + divergence state (Brief 76 P4.4, D-C).

    The honest answer to 'which bytes are live, and has my draft drifted?'
    — the audit's §1.3 complaint. `diverged` is True only when a published
    version exists AND its captured content hash differs from the draft's
    (both known). Publishing does NOT lock the draft (D-C ruled: make drift
    VISIBLE, not impossible); the UI offers 'fork to edit' off this signal.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    published: bool
    published_snapshot_id: str | None = None
    published_at: str | None = None
    published_by: str | None = None
    published_content_hash: str | None = None
    draft_content_hash: str | None = None
    diverged: bool = False


class PlanPublishFacts(BaseModel):
    """Publish + connection facts for ONE plan on the plans index
    (Brief 84 D-F) — the substrate the derived headline status
    (Draft / Live / Archived) reads. Fetched in ONE batch for the whole
    list (`publish_overview_for_plans`), never per-row, so the index can
    answer "is this plan live?" without an N+1 fan-out."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    published_snapshot_id: str | None = None
    published_display_name: str | None = None
    published_at: str | None = None
    published_content_hash: str | None = None
    """The draft content hash captured INTO the snapshot body at freeze
    time (Brief 76 P4.4). None for pre-P4.4 snapshots → divergence reads
    as unknown/False, same as `publish_status`."""
    live_integration_count: int = 0
    """How many integrations serve this plan live (ADR-0057
    `integration_exposed_plans.live = 1`)."""
