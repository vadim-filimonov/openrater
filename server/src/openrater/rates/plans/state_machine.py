# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""RatingPlan lifecycle state machine — declared as data.

A plan moves through four lifecycle states (`DRAFT → ACTIVE → ARCHIVED`,
with `PROPOSED` reserved for filing-readiness work in M4). The service
layer performs typed actions against a row in one of those states.
Some actions only make sense in some states — e.g., you can only
`promote` a `DRAFT`; you can only `fork` an `ACTIVE`.

## Why data, not inline checks

Before this module landed, each action in `author.py` carried its own
`if plan.status != "draft": raise IllegalStateTransitionError(...)`
check. That spread the state-machine rules across ~12 call sites; a new
state or a new action meant grepping for the right `if`.

This module **centralizes** the state-machine in two tables:

  · `LEGAL_STATES_FOR_ACTION` — which states an action can fire from.
  · `NEW_STATUS_AFTER`        — which state the row ends up in (for
                                actions that transition the row in place).

Each action's entrypoint calls `assert_action_allowed(plan, action=...)`
which enforces both tables. Adding a new state or action is a one-line
edit to the table; the existing call sites pick it up automatically.

## What's modeled

  · State-machine for the PRIMARY row each action operates on.
  · Source vs target row semantics for FORK/PROMOTE/ROLLBACK (which
    affect multiple rows) are handled by the action's atomic logic;
    the table only describes the SOURCE row's state requirements.

## What's NOT modeled

  · Cross-row invariants (e.g., "exactly one ACTIVE plan per
    LOB+jurisdiction at a time"). Those live in repository-level
    constraints (SQL UNIQUE partial index) or atomic action logic.
  · Sign-off lock (PlanLockedError). Sign-off is a separate concern
    layered on top of the lifecycle (a signed-off draft can't be
    edited even though its status permits edits). Enforced separately
    by `assert_plan_unlocked` in `plan_signoff.py`.
"""

from __future__ import annotations

from enum import StrEnum

from openrater.rates.plans.models import PlanStatus, RatingPlan


class Action(StrEnum):
    """Every typed action the service layer can perform on a RatingPlan.

    Values are stable identifiers — they appear in error envelopes
    (`details.attempted_action`) and audit log entries. Changing a value
    is a breaking change.
    """

    # Row-creating (no source state to validate)
    CREATE = "create"

    # Source-reading (creates a new row; source unchanged)
    FORK = "fork"

    # Edit actions (require DRAFT; row stays DRAFT)
    PATCH = "patch"
    ADD_STAGE = "add_stage"
    REMOVE_STAGE = "remove_stage"
    REORDER_STAGE = "reorder_stage"
    PATCH_STAGE_IO = "patch_stage_io"
    CONNECT_WIRE = "connect_wire"
    DISCONNECT_WIRE = "disconnect_wire"

    # Position nudges work on DRAFT + ACTIVE (operators reposition the
    # canvas on plans they're reviewing too)
    PATCH_POSITIONS = "patch_positions"

    # Lifecycle (transition row in place)
    PROMOTE = "promote"
    DISCARD = "discard"
    ROLLBACK = "rollback"


# Which states each action is legal from. The PRIMARY ROW the action
# operates on must be in one of these states; otherwise the action is
# rejected with IllegalStateTransitionError.
#
# CREATE has no source row, so it's an empty set; the validator
# short-circuits.
LEGAL_STATES_FOR_ACTION: dict[Action, frozenset[PlanStatus]] = {
    Action.CREATE: frozenset(),
    Action.FORK: frozenset([PlanStatus.ACTIVE]),
    Action.PATCH: frozenset([PlanStatus.DRAFT]),
    Action.ADD_STAGE: frozenset([PlanStatus.DRAFT]),
    Action.REMOVE_STAGE: frozenset([PlanStatus.DRAFT]),
    Action.REORDER_STAGE: frozenset([PlanStatus.DRAFT]),
    Action.PATCH_STAGE_IO: frozenset([PlanStatus.DRAFT]),
    Action.CONNECT_WIRE: frozenset([PlanStatus.DRAFT]),
    Action.DISCONNECT_WIRE: frozenset([PlanStatus.DRAFT]),
    Action.PATCH_POSITIONS: frozenset([PlanStatus.DRAFT, PlanStatus.ACTIVE]),
    Action.PROMOTE: frozenset([PlanStatus.DRAFT]),
    Action.DISCARD: frozenset([PlanStatus.DRAFT]),
    Action.ROLLBACK: frozenset([PlanStatus.ACTIVE]),
}


# When an action TRANSITIONS the row's status in place, the resulting
# state. Edits and FORK don't transition the row, so they're absent.
NEW_STATUS_AFTER: dict[Action, PlanStatus] = {
    Action.PROMOTE: PlanStatus.ACTIVE,
    Action.DISCARD: PlanStatus.ARCHIVED,
    Action.ROLLBACK: PlanStatus.ARCHIVED,
}


def is_legal(*, status: PlanStatus, action: Action) -> bool:
    """Pure predicate — does the state machine allow this action from
    this status? Returns True/False without raising.

    For testing + UI hint generation (e.g., greying out a Discard button
    on an ACTIVE plan).
    """
    return status in LEGAL_STATES_FOR_ACTION.get(action, frozenset())


def allowed_actions(*, status: PlanStatus) -> list[Action]:
    """List actions that can fire from the given status.

    Useful for UI affordance generation and for the error envelope's
    `details.allowed_actions_from_current_status`.
    """
    return sorted(
        (
            action
            for action, states in LEGAL_STATES_FOR_ACTION.items()
            if status in states
        ),
        key=lambda a: a.value,
    )


def assert_action_allowed(
    plan: RatingPlan | None,
    *,
    action: Action,
) -> RatingPlan:
    """Validate the action is allowed against the plan's current state.

    Raises:
      · `PlanNotFoundError` (404) if `plan` is None.
      · `IllegalStateTransitionError` (409) if the action isn't legal
        from the current status. Error includes `details.allowed_actions`
        so the UI can render the right affordances.

    Returns the (non-None) plan so callers can chain:

        plan = assert_action_allowed(get_plan(...), action=Action.PROMOTE)
    """
    # Late import to avoid a circular dependency: state_machine.py is
    # imported by author.py; author.py defines PlanNotFoundError +
    # IllegalStateTransitionError.
    from openrater.rates.plans.author import (
        IllegalStateTransitionError,
        PlanNotFoundError,
    )

    if plan is None:
        raise PlanNotFoundError(
            f"Plan not found; cannot perform action {action.value!r}.",
            param="rating_plan_id",
        )

    legal_states = LEGAL_STATES_FOR_ACTION[action]
    if plan.status not in legal_states:
        raise IllegalStateTransitionError(
            (
                f"Action {action.value!r} is not allowed on plan "
                f"{plan.rating_plan_id!r} (current status: "
                f"{plan.status.value!r})."
            ),
            param="status",
            details={
                "rating_plan_id": plan.rating_plan_id,
                "current_status": plan.status.value,
                "attempted_action": action.value,
                "allowed_statuses": sorted(s.value for s in legal_states),
                "allowed_actions_from_current_status": [
                    a.value for a in allowed_actions(status=plan.status)
                ],
            },
        )
    return plan


def new_status_after(action: Action) -> PlanStatus | None:
    """The resulting status when this action transitions the row in place.

    Returns None for actions that don't transition the row (edits + fork).
    Use as `new = new_status_after(Action.PROMOTE); assert new == PlanStatus.ACTIVE`.
    """
    return NEW_STATUS_AFTER.get(action)


# ---------------------------------------------------------------
# Child-resource writability
# ---------------------------------------------------------------

# States from which a plan's CHILD RESOURCES — dimensions, factor tables,
# input mapping — may be mutated. Same DRAFT-only rule as the edit actions
# above: a non-draft plan's rating definition is immutable whether you edit a
# stage, a dimension, or a factor table. The projector reads all three at
# score time, so they are as load-bearing as the chain stages.
#
# Modeled separately from `Action` / `LEGAL_STATES_FOR_ACTION` because those
# describe transitions of the PRIMARY plan row; child-resource writes don't
# transition the plan row, they only require it to be editable. Keeping this
# a distinct (single-element) set documents the rule in one place and leaves
# room to relax it per-resource later without touching the action table.
WRITABLE_STATES: frozenset[PlanStatus] = frozenset([PlanStatus.DRAFT])


def is_writable(*, status: PlanStatus) -> bool:
    """Pure predicate — may a plan in this status accept child-resource
    writes? Returns True/False without raising (for UI hints + tests)."""
    return status in WRITABLE_STATES


def assert_plan_writable(plan: RatingPlan, *, resource: str) -> RatingPlan:
    """Validate that the plan can accept a write to a child resource
    (dimensions / factor tables / input mapping).

    Raises `IllegalStateTransitionError` (409) if the plan's status is not
    in `WRITABLE_STATES`. Mirrors `assert_action_allowed`'s envelope so the
    UI + audit log get a consistent shape; `resource` (e.g. "dimensions")
    rides in `details.attempted_resource`.

    Assumes a non-None plan — the route's existence check fires first so the
    `plan_not_found` 404 envelope is preserved. Returns the plan for chaining.
    """
    # Late import to avoid a circular dependency (mirrors
    # assert_action_allowed): author.py imports this module.
    from openrater.rates.plans.author import IllegalStateTransitionError

    if plan.status not in WRITABLE_STATES:
        raise IllegalStateTransitionError(
            (
                f"Cannot modify {resource} on plan {plan.rating_plan_id!r} "
                f"(current status: {plan.status.value!r}); a plan's rating "
                f"definition is immutable once it leaves DRAFT."
            ),
            param="status",
            details={
                "rating_plan_id": plan.rating_plan_id,
                "current_status": plan.status.value,
                "attempted_resource": resource,
                "allowed_statuses": sorted(s.value for s in WRITABLE_STATES),
            },
        )
    return plan


__all__ = [
    "Action",
    "LEGAL_STATES_FOR_ACTION",
    "NEW_STATUS_AFTER",
    "WRITABLE_STATES",
    "allowed_actions",
    "assert_action_allowed",
    "assert_plan_writable",
    "is_legal",
    "is_writable",
    "new_status_after",
]
