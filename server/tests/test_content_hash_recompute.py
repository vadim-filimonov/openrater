# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Content_hash recompute test (WA-9 retirement).

Proves that every mutation in `author.py` that changes hashed content
keeps the persisted `content_hash` in sync. Before this PR, the hash
on the plan row went stale after every edit. After: every mutation
recomputes within its own transaction.

This is also the FIRST Python test in the repo — establishes the
pattern. Future backend tests follow this shape (in-memory SQLite,
isolated fixtures, direct exercises of author.py functions).
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from openrater.persistence import Database
from openrater.rates.plans.author import (
    StagePatch,
    add_stage_to_draft,
    create_plan,
    patch_draft_stages,
    remove_stage_from_draft,
    reorder_stage_in_draft,
)
from openrater.rates.plans.models import LineOfBusiness, StageKind
from openrater.rates.plans.repo import get_plan


@pytest.fixture
def db():
    """A fresh SQLite DB per test — no cross-test contamination."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = Path(f.name)
    try:
        db = Database(path)
        # Touch the connection to run migrations.
        with db.connection() as conn:
            conn.execute("SELECT 1")
        yield db
    finally:
        os.unlink(path)


def _make_plan(db: Database):
    return create_plan(
        db=db,
        display_name="Test ISO BOP WI",
        line_of_business=LineOfBusiness.BOP,
        jurisdiction="WI",
        effective_date="2026-06-01",
    )


def _hash_of(db: Database, plan_id: str) -> str | None:
    plan = get_plan(db=db, rating_plan_id=plan_id)
    assert plan is not None
    return plan.content_hash


def _add_input_node(db: Database, plan_id: str, stage_id: str, name: str):
    """Helper — adds a minimal input_node stage."""
    return add_stage_to_draft(
        db=db,
        draft_plan_id=plan_id,
        stage_id=stage_id,
        stage_kind=StageKind.INPUT_NODE,
        display_name=name,
        config_json={
            "name": name,
            "data_type": "string",
            "source": "form_input",
            "source_path": f"submission.{stage_id}",
        },
        insert_after_stage_id="$last",
        inputs=[],
        outputs=[],
    )


def test_initial_create_sets_a_hash(db):
    plan = _make_plan(db)
    h = _hash_of(db, plan.rating_plan_id)
    assert h is not None
    assert len(h) == 16, f"Expected 16-char SHA-256 prefix, got {h!r}"


def test_add_stage_changes_hash(db):
    plan = _make_plan(db)
    h0 = _hash_of(db, plan.rating_plan_id)

    _add_input_node(db, plan.rating_plan_id, "in_a", "Input A")
    h1 = _hash_of(db, plan.rating_plan_id)

    assert h1 != h0, "Adding a stage must change the content_hash"
    assert h1 is not None


def test_multiple_adds_keep_advancing_hash(db):
    plan = _make_plan(db)
    hashes = [_hash_of(db, plan.rating_plan_id)]

    for i in range(3):
        _add_input_node(db, plan.rating_plan_id, f"in_{i}", f"Input {i}")
        hashes.append(_hash_of(db, plan.rating_plan_id))

    # Every step produced a fresh hash
    assert len(set(hashes)) == len(hashes), f"Hashes should all differ, got {hashes}"


def test_patch_draft_stages_changes_hash(db):
    plan = _make_plan(db)
    _add_input_node(db, plan.rating_plan_id, "in_a", "Input A")
    h_before = _hash_of(db, plan.rating_plan_id)

    patch_draft_stages(
        db=db,
        draft_plan_id=plan.rating_plan_id,
        patches=[
            StagePatch(
                stage_id="in_a",
                config_json={
                    "name": "Input A (renamed)",
                    "data_type": "string",
                    "source": "form_input",
                    "source_path": "submission.in_a",
                },
            )
        ],
    )
    h_after = _hash_of(db, plan.rating_plan_id)

    assert h_after != h_before, "Patching config_json must change the content_hash"


def test_patch_carries_display_name(db):
    """Brief 70.1 — renames persist through the stage patch (they used
    to silently drop while the UI announced the new name)."""
    plan = _make_plan(db)
    _add_input_node(db, plan.rating_plan_id, "in_a", "Input A")

    from openrater.rates.plans.repo import get_stages

    patch_draft_stages(
        db=db,
        draft_plan_id=plan.rating_plan_id,
        patches=[
            StagePatch(
                stage_id="in_a",
                config_json={
                    "name": "Input A",
                    "data_type": "string",
                    "source": "form_input",
                    "source_path": "submission.in_a",
                },
                display_name="Renamed input",
            )
        ],
    )
    stage = next(
        s
        for s in get_stages(db=db, rating_plan_id=plan.rating_plan_id)
        if s.stage_id == "in_a"
    )
    assert stage.display_name == "Renamed input"


def test_remove_stage_changes_hash(db):
    plan = _make_plan(db)
    _add_input_node(db, plan.rating_plan_id, "in_a", "Input A")
    _add_input_node(db, plan.rating_plan_id, "in_b", "Input B")
    h_before = _hash_of(db, plan.rating_plan_id)

    remove_stage_from_draft(
        db=db,
        draft_plan_id=plan.rating_plan_id,
        stage_id="in_b",
    )
    h_after = _hash_of(db, plan.rating_plan_id)

    assert h_after != h_before, "Removing a stage must change the content_hash"


def test_reorder_stage_changes_hash(db):
    plan = _make_plan(db)
    _add_input_node(db, plan.rating_plan_id, "in_a", "Input A")
    _add_input_node(db, plan.rating_plan_id, "in_b", "Input B")
    _add_input_node(db, plan.rating_plan_id, "in_c", "Input C")
    h_before = _hash_of(db, plan.rating_plan_id)

    # Move in_c from sequence 3 to sequence 1
    reorder_stage_in_draft(
        db=db,
        draft_plan_id=plan.rating_plan_id,
        stage_id="in_c",
        to_sequence=1,
    )
    h_after = _hash_of(db, plan.rating_plan_id)

    assert h_after != h_before, "Reordering stages must change the content_hash"


def test_hash_is_deterministic_for_same_content(db):
    """Same content (after equivalent operations) → same hash."""
    plan_a = create_plan(
        db=db,
        display_name="Det Test",
        line_of_business=LineOfBusiness.BOP,
        jurisdiction="WI",
        effective_date="2026-06-01",
    )

    # Two separate dbs would give different plan_ids; use the same db
    # and verify that the hash is a deterministic function of content.
    # Specifically: after adding a stage then removing it, the hash
    # returns to where it started.
    h_initial = _hash_of(db, plan_a.rating_plan_id)
    _add_input_node(db, plan_a.rating_plan_id, "in_tmp", "Temporary")
    h_added = _hash_of(db, plan_a.rating_plan_id)
    remove_stage_from_draft(
        db=db, draft_plan_id=plan_a.rating_plan_id, stage_id="in_tmp"
    )
    h_removed = _hash_of(db, plan_a.rating_plan_id)

    assert h_initial != h_added, "Adding changed the hash"
    assert h_added != h_removed, "Removing changed the hash"
    assert h_removed == h_initial, (
        f"After add+remove, hash should return to initial. "
        f"initial={h_initial}, added={h_added}, removed={h_removed}"
    )


def test_shape_validation_refusal_names_the_failing_field(db):
    """FCA fca-2026-07-25 #7 (the other half): a config_json shape
    refusal used to name only an internal stage id + kind — a
    transcriber could not act on it (locating the 120-char cap took
    offline pydantic reproduction). The summary line now carries the
    validator's own field-path detail."""
    from openrater.rates.plans.author import PlanValidationError

    plan = _make_plan(db)
    with pytest.raises(PlanValidationError) as excinfo:
        add_stage_to_draft(
            db=db,
            draft_plan_id=plan.rating_plan_id,
            stage_id="bad_chain",
            stage_kind=StageKind.MULTIPLICATIVE_CHAIN,
            display_name="Bad chain",
            config_json={
                "chains": [
                    {
                        "name": "x" * 200,  # blows FactorLookup-adjacent caps
                        "base_input": "form_input.base",
                        "factor_lookups": [],
                        "lcm": {"value": 1.0},
                        "output_field": "premium",
                    }
                ],
                # missing output_total_field + oversize name → the
                # message must say WHICH fields, not just the stage.
            },
            insert_after_stage_id="$last",
            inputs=[],
            outputs=[],
        )
    msg = str(excinfo.value)
    assert "bad_chain" in msg
    # The validator's field-path detail rides the summary line.
    assert "validation error" in msg
    assert "name" in msg or "output_total_field" in msg
