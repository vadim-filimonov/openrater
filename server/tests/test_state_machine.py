# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Tests for the RatingPlan lifecycle state machine.

Covers:
  · The transition tables (`LEGAL_STATES_FOR_ACTION` + `NEW_STATUS_AFTER`)
    declare every action.
  · `is_legal` is a pure predicate over status × action.
  · `allowed_actions` enumerates actions from a given status.
  · `assert_action_allowed` raises `PlanNotFoundError` on None and
    `IllegalStateTransitionError` (with structured details) on a bad
    state.
  · `new_status_after` reports the post-action status for transitions;
    None for edits + fork.

Also acts as the catalog test: every value of `Action` MUST appear in
`LEGAL_STATES_FOR_ACTION` so a new action can't silently bypass the
state machine.
"""

from __future__ import annotations

import pytest

from openrater.rates.plans.author import IllegalStateTransitionError, PlanNotFoundError
from openrater.rates.plans.models import (
    LineOfBusiness,
    PlanStatus,
    RatingPlan,
)
from openrater.rates.plans.state_machine import (
    LEGAL_STATES_FOR_ACTION,
    NEW_STATUS_AFTER,
    WRITABLE_STATES,
    Action,
    allowed_actions,
    assert_action_allowed,
    assert_plan_writable,
    is_legal,
    is_writable,
    new_status_after,
)


def _plan(status: PlanStatus, rating_plan_id: str = "test-plan") -> RatingPlan:
    """Build a minimal RatingPlan in the given status for testing."""
    return RatingPlan(
        rating_plan_id=rating_plan_id,
        display_name="Test",
        line_of_business=LineOfBusiness.BOP,
        jurisdiction="WI",
        effective_date="2026-01-01",
        description=None,
        parent_plan_id=None,
        status=status,
        source_filing_id=None,
        created_at="2026-05-20T00:00:00Z",
    )


# ---------------------------------------------------------------------------
# Table catalog tests
# ---------------------------------------------------------------------------


class TestTableCatalog:
    """The state machine's two tables MUST cover every Action."""

    def test_every_action_has_legal_states_entry(self) -> None:
        for action in Action:
            assert action in LEGAL_STATES_FOR_ACTION, (
                f"Action {action.value!r} is missing from "
                f"LEGAL_STATES_FOR_ACTION — every new action must "
                f"declare the states it can fire from."
            )

    def test_new_status_after_only_for_transitions(self) -> None:
        """Only PROMOTE/DISCARD/ROLLBACK transition the row in place."""
        transition_actions = {Action.PROMOTE, Action.DISCARD, Action.ROLLBACK}
        for action in Action:
            if action in transition_actions:
                assert action in NEW_STATUS_AFTER
            else:
                assert action not in NEW_STATUS_AFTER

    def test_create_has_no_source_state(self) -> None:
        """CREATE creates a new row — no source row to validate."""
        assert LEGAL_STATES_FOR_ACTION[Action.CREATE] == frozenset()

    def test_edit_actions_all_require_draft(self) -> None:
        """Every edit-style action should be DRAFT-only."""
        edit_actions = (
            Action.PATCH,
            Action.ADD_STAGE,
            Action.REMOVE_STAGE,
            Action.REORDER_STAGE,
            Action.PATCH_STAGE_IO,
            Action.CONNECT_WIRE,
            Action.DISCONNECT_WIRE,
        )
        for action in edit_actions:
            assert LEGAL_STATES_FOR_ACTION[action] == frozenset([PlanStatus.DRAFT])

    def test_fork_requires_active_source(self) -> None:
        assert LEGAL_STATES_FOR_ACTION[Action.FORK] == frozenset([PlanStatus.ACTIVE])

    def test_promote_transitions_to_active(self) -> None:
        assert NEW_STATUS_AFTER[Action.PROMOTE] == PlanStatus.ACTIVE

    def test_discard_transitions_to_archived(self) -> None:
        assert NEW_STATUS_AFTER[Action.DISCARD] == PlanStatus.ARCHIVED

    def test_rollback_transitions_to_archived(self) -> None:
        assert NEW_STATUS_AFTER[Action.ROLLBACK] == PlanStatus.ARCHIVED


# ---------------------------------------------------------------------------
# Pure predicates
# ---------------------------------------------------------------------------


class TestIsLegal:
    """`is_legal` is a pure predicate; safe for UI affordance checks."""

    def test_patch_legal_on_draft(self) -> None:
        assert is_legal(status=PlanStatus.DRAFT, action=Action.PATCH) is True

    def test_patch_illegal_on_active(self) -> None:
        assert is_legal(status=PlanStatus.ACTIVE, action=Action.PATCH) is False

    def test_fork_legal_on_active(self) -> None:
        assert is_legal(status=PlanStatus.ACTIVE, action=Action.FORK) is True

    def test_fork_illegal_on_draft(self) -> None:
        assert is_legal(status=PlanStatus.DRAFT, action=Action.FORK) is False

    def test_fork_illegal_on_archived(self) -> None:
        assert is_legal(status=PlanStatus.ARCHIVED, action=Action.FORK) is False

    def test_rollback_legal_only_on_active(self) -> None:
        for status in PlanStatus:
            expected = status == PlanStatus.ACTIVE
            assert is_legal(status=status, action=Action.ROLLBACK) is expected


class TestAllowedActions:
    """`allowed_actions` enumerates valid actions for UI affordances."""

    def test_draft_has_edit_actions(self) -> None:
        actions = set(allowed_actions(status=PlanStatus.DRAFT))
        assert Action.PATCH in actions
        assert Action.ADD_STAGE in actions
        assert Action.REMOVE_STAGE in actions
        assert Action.PROMOTE in actions
        assert Action.DISCARD in actions

    def test_draft_does_NOT_allow_fork_or_rollback(self) -> None:
        actions = set(allowed_actions(status=PlanStatus.DRAFT))
        assert Action.FORK not in actions
        assert Action.ROLLBACK not in actions

    def test_active_allows_only_fork_rollback_and_positions(self) -> None:
        actions = set(allowed_actions(status=PlanStatus.ACTIVE))
        assert actions == {Action.FORK, Action.ROLLBACK, Action.PATCH_POSITIONS}

    def test_archived_allows_nothing(self) -> None:
        actions = set(allowed_actions(status=PlanStatus.ARCHIVED))
        assert actions == set()

    def test_result_is_sorted_for_determinism(self) -> None:
        actions = allowed_actions(status=PlanStatus.DRAFT)
        values = [a.value for a in actions]
        assert values == sorted(values)


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------


class TestAssertActionAllowed:
    def test_returns_plan_on_legal(self) -> None:
        plan = _plan(PlanStatus.DRAFT)
        result = assert_action_allowed(plan, action=Action.PATCH)
        assert result is plan

    def test_raises_plan_not_found_on_none(self) -> None:
        with pytest.raises(PlanNotFoundError) as exc_info:
            assert_action_allowed(None, action=Action.PATCH)
        assert exc_info.value.code == "plan_not_found"
        assert exc_info.value.status_code == 404
        assert exc_info.value.param == "rating_plan_id"

    def test_raises_illegal_state_on_wrong_status(self) -> None:
        plan = _plan(PlanStatus.ACTIVE, rating_plan_id="active-1")
        with pytest.raises(IllegalStateTransitionError) as exc_info:
            assert_action_allowed(plan, action=Action.PATCH)
        assert exc_info.value.code == "illegal_state_transition"
        assert exc_info.value.status_code == 409

    def test_error_carries_structured_details(self) -> None:
        plan = _plan(PlanStatus.ACTIVE, rating_plan_id="my-plan-id")
        with pytest.raises(IllegalStateTransitionError) as exc_info:
            assert_action_allowed(plan, action=Action.PATCH)
        details = exc_info.value.details
        assert details is not None
        assert details["rating_plan_id"] == "my-plan-id"
        assert details["current_status"] == "active"
        assert details["attempted_action"] == "patch"
        assert details["allowed_statuses"] == ["draft"]
        assert "allowed_actions_from_current_status" in details

    def test_error_lists_allowed_actions_from_current_status(self) -> None:
        plan = _plan(PlanStatus.DRAFT)
        with pytest.raises(IllegalStateTransitionError) as exc_info:
            assert_action_allowed(plan, action=Action.FORK)
        allowed = exc_info.value.details["allowed_actions_from_current_status"]
        assert "patch" in allowed
        assert "promote" in allowed
        assert "discard" in allowed
        assert "fork" not in allowed  # Fork wasn't legal from DRAFT


# ---------------------------------------------------------------------------
# new_status_after
# ---------------------------------------------------------------------------


class TestNewStatusAfter:
    def test_promote_returns_active(self) -> None:
        assert new_status_after(Action.PROMOTE) == PlanStatus.ACTIVE

    def test_discard_returns_archived(self) -> None:
        assert new_status_after(Action.DISCARD) == PlanStatus.ARCHIVED

    def test_rollback_returns_archived(self) -> None:
        assert new_status_after(Action.ROLLBACK) == PlanStatus.ARCHIVED

    def test_edits_return_none(self) -> None:
        for action in (
            Action.PATCH,
            Action.ADD_STAGE,
            Action.REMOVE_STAGE,
            Action.REORDER_STAGE,
            Action.PATCH_STAGE_IO,
            Action.CONNECT_WIRE,
            Action.DISCONNECT_WIRE,
        ):
            assert new_status_after(action) is None, (
                f"{action.value!r} should not transition the row"
            )

    def test_fork_returns_none(self) -> None:
        """Fork creates a new row; source row's status unchanged."""
        assert new_status_after(Action.FORK) is None


# ---------------------------------------------------------------------------
# Child-resource writability (dimensions / factor tables / input mapping)
# ---------------------------------------------------------------------------


class TestIsWritable:
    """`is_writable` is a pure predicate — DRAFT only, mirroring the
    edit-action rule. Used by the route layer (`_require_writable_plan`)
    + UI affordance checks."""

    def test_draft_is_writable(self) -> None:
        assert is_writable(status=PlanStatus.DRAFT) is True

    def test_non_draft_states_are_read_only(self) -> None:
        for status in (
            PlanStatus.PROPOSED,
            PlanStatus.ACTIVE,
            PlanStatus.ARCHIVED,
        ):
            assert is_writable(status=status) is False, (
                f"{status.value!r} must be read-only for child resources"
            )

    def test_writable_states_matches_edit_action_states(self) -> None:
        """The child-resource rule MUST track the stage-edit rule — a plan
        you can't add a stage to is a plan you can't add a dimension to."""
        assert WRITABLE_STATES == LEGAL_STATES_FOR_ACTION[Action.ADD_STAGE]


class TestAssertPlanWritable:
    def test_returns_plan_on_draft(self) -> None:
        plan = _plan(PlanStatus.DRAFT)
        result = assert_plan_writable(plan, resource="dimensions")
        assert result is plan

    @pytest.mark.parametrize(
        "status",
        [PlanStatus.PROPOSED, PlanStatus.ACTIVE, PlanStatus.ARCHIVED],
    )
    def test_raises_409_on_non_draft(self, status: PlanStatus) -> None:
        plan = _plan(status, rating_plan_id="frozen-1")
        with pytest.raises(IllegalStateTransitionError) as exc_info:
            assert_plan_writable(plan, resource="factor_tables")
        assert exc_info.value.code == "illegal_state_transition"
        assert exc_info.value.status_code == 409

    def test_error_carries_structured_details(self) -> None:
        plan = _plan(PlanStatus.ARCHIVED, rating_plan_id="frozen-plan")
        with pytest.raises(IllegalStateTransitionError) as exc_info:
            assert_plan_writable(plan, resource="input_mapping")
        details = exc_info.value.details
        assert details is not None
        assert details["rating_plan_id"] == "frozen-plan"
        assert details["current_status"] == "archived"
        assert details["attempted_resource"] == "input_mapping"
        assert details["allowed_statuses"] == ["draft"]
