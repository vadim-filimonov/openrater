# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Service layer for plan snapshots — Brief 43 §4 / PR 43.1.

Three operations bound to the route layer:
  · freeze_current_draft     — read every substrate + serialize a body + insert
  · list_snapshots_for_plan  — pass-through to the repo
  · get_snapshot_with_body   — pass-through to the repo

freeze_current_draft is the only nontrivial one — it composes the
body from the existing per-substrate repos rather than re-reading
SQL directly. That keeps the snapshot module decoupled from the
substrate schemas; if a substrate adds a column, its repo's
serialization changes, the snapshot composer follows for free.
"""

from __future__ import annotations

from typing import Any

from openrater.persistence.db import Database
from openrater.rates.class_codes.repo import list_class_codes
from openrater.rates.dimensions.repo import list_dimensions
from openrater.rates.factor_tables.repo import list_factor_tables
from openrater.rates.inputs_mapping.repo import get_input_mapping
from openrater.rates.plans.repo import get_plan, get_stage_io, get_stages
from openrater.rates.policy_tail.repo import get_policy_tail
from openrater.rates.snapshots.models import (
    PlanPublishFacts,
    PlanSnapshot,
    PlanSnapshotSummary,
    PublishStatus,
)
from openrater.rates.snapshots.repo import (
    SnapshotNameCollisionError,
    get_published_snapshot,
    get_published_snapshot_id,
    get_snapshot,
    insert_snapshot,
    list_snapshots,
    publish_snapshot,
)
from openrater.rates.snapshots.repo import (
    publish_overview_for_plans as repo_publish_overview_for_plans,
)


class PlanNotFoundError(Exception):
    """Raised when the caller asks to freeze a plan that doesn't exist."""

    def __init__(self, plan_id: str) -> None:
        super().__init__(f"plan {plan_id} not found")
        self.plan_id = plan_id


class SnapshotNotFoundError(Exception):
    """Raised when publishing a snapshot that doesn't exist on the plan."""

    def __init__(self, plan_id: str, snapshot_id: str) -> None:
        super().__init__(f"snapshot {snapshot_id} not found on plan {plan_id}")
        self.plan_id = plan_id
        self.snapshot_id = snapshot_id


# Re-exported here so the route layer can catch it under the
# `service.SnapshotNameCollisionError` qualified name.
__all__ = [
    "PlanNotFoundError",
    "SnapshotNameCollisionError",
    "SnapshotNotFoundError",
    "freeze_current_draft",
    "list_snapshots_for_plan",
    "get_snapshot_with_body",
    "publish_snapshot_for_plan",
]


# ---------------------------------------------------------------
# Body composer
# ---------------------------------------------------------------


def _compose_body(*, db: Database, plan_id: str) -> dict[str, Any]:
    """Read every substrate + serialize the full plan body. Raises
    PlanNotFoundError if the plan doesn't exist."""
    plan = get_plan(db=db, rating_plan_id=plan_id)
    if plan is None:
        raise PlanNotFoundError(plan_id)

    # ── Plan identity ─────────────────────────────────────────
    plan_dict = plan.model_dump(mode="json")

    # ── Stages + their I/O ────────────────────────────────────
    stages = get_stages(db=db, rating_plan_id=plan_id)
    stages_serialized: list[dict[str, Any]] = []
    for stage in stages:
        s = stage.model_dump(mode="json")
        inputs, outputs = get_stage_io(
            db=db, rating_plan_id=plan_id, stage_id=stage.stage_id
        )
        s["inputs"] = [i.model_dump(mode="json") for i in inputs]
        s["outputs"] = [o.model_dump(mode="json") for o in outputs]
        stages_serialized.append(s)

    # ── Dimensions ────────────────────────────────────────────
    dims = list_dimensions(db=db, rating_plan_id=plan_id)
    dims_serialized = [d.model_dump(mode="json") for d in dims]

    # ── Factor tables (cells inlined) ─────────────────────────
    fts = list_factor_tables(db=db, rating_plan_id=plan_id)
    fts_serialized = [ft.model_dump(mode="json") for ft in fts]

    # ── Input mapping ─────────────────────────────────────────
    mapping = get_input_mapping(db=db, rating_plan_id=plan_id)
    mapping_serialized = mapping.model_dump(mode="json") if mapping else None

    # ── Policy tail (ADR-0055) ────────────────────────────────
    # The post-rollup adjustments (IRPM/schedule, package factors,
    # endorsements, minimum premium) that turn a rolled subtotal into the
    # filed premium. Captured here so a frozen version re-scores to the
    # filed number — without it, snapshot re-rate + the API path score the
    # PRE-tail premium. `null` when the plan authored no tail.
    tail = get_policy_tail(db=db, rating_plan_id=plan_id)
    tail_serialized = tail.model_dump(mode="json") if tail else None

    # ── Class registry (ADR-0055 open question — resolved: fold in) ──
    # A classification dim resolves class codes → attributes → derived
    # dims at score time; a frozen version without its registry can't
    # reproduce those resolutions. Same reproducibility class as the
    # tail. `[]` when the plan has no classes.
    classes = list_class_codes(db=db, rating_plan_id=plan_id)
    classes_serialized = [c.model_dump(mode="json") for c in classes]

    return {
        "plan": plan_dict,
        "stages": stages_serialized,
        "dimensions": dims_serialized,
        "factor_tables": fts_serialized,
        "input_mapping": mapping_serialized,
        "policy_tail": tail_serialized,
        "class_codes": classes_serialized,
    }


# ---------------------------------------------------------------
# Public API
# ---------------------------------------------------------------


# Brief 75 (P3) — the Run zone composes the SAME body a freeze would,
# to ship a draft's substrate to the scoring service (one composition,
# zero drift between "what a snapshot captures" and "what a run ran").
compose_plan_body = _compose_body


def freeze_current_draft(
    *,
    db: Database,
    plan_id: str,
    display_name: str,
    notes: str | None,
    created_by: str,
) -> PlanSnapshot:
    """Compose the current plan body + persist as an immutable snapshot.
    Raises:
      · PlanNotFoundError if plan_id is unknown
      · SnapshotNameCollisionError if (plan_id, display_name) collides
    """
    body = _compose_body(db=db, plan_id=plan_id)
    # Brief 76 P4.4 — capture the draft's content hash INTO the snapshot so
    # the divergence signal can later tell, apples-to-apples, whether the
    # working draft has drifted from THIS published version. (An extra body
    # key is inert to the projector, which reads only stages/dims/tables/
    # tail.) Pre-P4.4 snapshots lack it → divergence reads as "unknown".
    plan = get_plan(db=db, rating_plan_id=plan_id)
    if plan is not None and plan.content_hash is not None:
        body = {**body, "plan_content_hash": plan.content_hash}
    return insert_snapshot(
        db=db,
        plan_id=plan_id,
        display_name=display_name,
        notes=notes,
        body=body,
        created_by=created_by,
    )


def list_snapshots_for_plan(
    *, db: Database, plan_id: str
) -> list[PlanSnapshotSummary]:
    """Pass-through to repo — kept here for symmetry + future hooks
    (e.g. permission filtering)."""
    return list_snapshots(db=db, plan_id=plan_id)


def get_snapshot_with_body(
    *, db: Database, plan_id: str, snapshot_id: str
) -> PlanSnapshot | None:
    """Pass-through to repo. None when missing."""
    return get_snapshot(db=db, plan_id=plan_id, snapshot_id=snapshot_id)


def get_published_snapshot_with_body(
    *, db: Database, plan_id: str
) -> PlanSnapshot | None:
    """The plan's CURRENT published version (body included), or None when
    nothing is published. The quote endpoint (Brief 76) resolves this as
    the default 'what's live' version of record."""
    return get_published_snapshot(db=db, plan_id=plan_id)


def publish_overview_for_plans(
    *, db: Database, plan_ids: list[str]
) -> dict[str, PlanPublishFacts]:
    """Batch publish + live-connection facts for the plans index
    (Brief 84 D-F). Pass-through to the repo — kept here for symmetry with
    the other reads. Two queries total; a missing key means "nothing
    published, nothing live" (a plain draft)."""
    return repo_publish_overview_for_plans(db=db, plan_ids=plan_ids)


def get_published_snapshot_id_for_plan(*, db: Database, plan_id: str) -> str | None:
    """The CURRENT published snapshot's id (body-free), or None. The seam's
    drift gate compares this to the exposed plan's last-tested snapshot
    without paying for the full body (`repo.get_published_snapshot_id`)."""
    return get_published_snapshot_id(db=db, plan_id=plan_id)


def publish_status(*, db: Database, plan_id: str) -> PublishStatus:
    """The plan's publish + divergence state (Brief 76 P4.4). Compares the
    working draft's content hash to the hash captured on the published
    version — the honest 'has my draft drifted from what's live?' signal."""
    plan = get_plan(db=db, rating_plan_id=plan_id)
    draft_hash = plan.content_hash if plan is not None else None
    published = get_published_snapshot(db=db, plan_id=plan_id)
    if published is None:
        return PublishStatus(published=False, draft_content_hash=draft_hash)
    body = published.body if isinstance(published.body, dict) else {}
    pub_hash = body.get("plan_content_hash")
    pub_hash = pub_hash if isinstance(pub_hash, str) else None
    diverged = bool(pub_hash and draft_hash and pub_hash != draft_hash)
    return PublishStatus(
        published=True,
        published_snapshot_id=published.snapshot_id,
        published_at=published.published_at,
        published_by=published.published_by,
        published_content_hash=pub_hash,
        draft_content_hash=draft_hash,
        diverged=diverged,
    )


def go_live(
    *, db: Database, plan_id: str, version_name: str | None, notes: str | None, operator: str
) -> tuple[PlanSnapshotSummary, PublishStatus]:
    """Brief 84 D-B — the ONE verb: freeze the current draft AND publish
    it as the version callers get, in one call.

    Version naming: when the caller passes none, auto-name the first free
    `v{N}` (N starts at snapshot-count + 1 and walks past user-named
    collisions like a hand-made "v3") — filing tags remain possible via
    an explicit `version_name`, and an explicit collision still 409s.

    Effectively atomic: publish is a two-row UPDATE that follows the
    freeze insert; if it ever failed independently, the leftover is an
    UNPUBLISHED checkpoint in the timeline (exactly a "Save a version…"
    outcome — no caller-visible state changes until publish lands).
    Auditability: the publish transaction writes an append-only
    `publish` audit event (migration 040) recording the demoted and
    promoted versions — the durable go-live record, since the demote
    NULLs the prior row's published_at.
    """
    name = version_name.strip() if version_name else ""
    if not name:
        existing = {s.display_name for s in list_snapshots(db=db, plan_id=plan_id)}
        n = len(existing) + 1
        while f"v{n}" in existing:
            n += 1
        name = f"v{n}"
    snap = freeze_current_draft(
        db=db, plan_id=plan_id, display_name=name, notes=notes, created_by=operator
    )
    summary = publish_snapshot_for_plan(
        db=db, plan_id=plan_id, snapshot_id=snap.snapshot_id, published_by=operator
    )
    return summary, publish_status(db=db, plan_id=plan_id)


def publish_snapshot_for_plan(
    *, db: Database, plan_id: str, snapshot_id: str, published_by: str
) -> PlanSnapshotSummary:
    """Publish a frozen version as the plan's Current version of record.
    Clears the prior current (exactly one per plan). Plan editing is
    unaffected — this only points at a version.
    Raises SnapshotNotFoundError if the snapshot doesn't exist on the plan."""
    result = publish_snapshot(
        db=db, plan_id=plan_id, snapshot_id=snapshot_id, published_by=published_by
    )
    if result is None:
        raise SnapshotNotFoundError(plan_id, snapshot_id)
    return result
