# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Sign-off / lock-for-filing — lock read path + revoke.

State machine:

    [draft, not signed]
            │  sign_off()      ← requires filing-readiness == 'ready'
            ▼
    [draft, signed]   ────── edits 409 from author.py ─────
            │  revoke()
            ▼
    [draft, not signed]   (operators can edit again + re-sign)

Slice-2 port note
=================

The `sign_off_plan` path needs `compute_plan_flow_filing_readiness`
from `rates.plans.plan_flow_filing`, which depends on the cascade
engine. That whole chain is out of this slice's scope, so
`sign_off_plan` ships as a `NotImplementedError` stub here and the
route layer doesn't mount the corresponding POST.

The PORTABLE half — `assert_plan_unlocked`, `revoke_signoff`,
`get_active_signoff`, `get_signoff_history` — has no filing-readiness
dependency and ships in full. That's enough for `author.py` to
enforce edit-locks against signed-off plans, and for the read-side of
the sign-off UI (chip, history, revoke) to work end-to-end.

When the engine ports (later slice), `sign_off_plan` becomes a
one-line uncomment + a wire to `compute_plan_flow_filing_readiness`.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict

from openrater.errors import RaterError
from openrater.persistence import Database
from openrater.rates.plans.repo import get_plan

# ===========================================================================
# Typed errors — every subclass extends `RaterError`, so the global FastAPI
# handler in `openrater.errors` converts them to the structured envelope.
# ===========================================================================


class PlanSignoffError(RaterError):
    """Base for sign-off errors. Subclasses carry HTTP-status defaults."""

    code = "plan_signoff_error"
    default_status_code = 409


class PlanNotFoundError(PlanSignoffError):
    """The plan to operate on doesn't exist."""

    code = "plan_not_found"
    default_status_code = 404


class FilingNotReadyError(PlanSignoffError):
    """Sign-off blocked because filing readiness says the plan isn't ready."""

    code = "filing_not_ready"
    default_status_code = 422
    default_hint = (
        "Fix the blocking issues in `details` (and ideally the warnings too) "
        "before signing off."
    )

    def __init__(
        self,
        rating_plan_id: str,
        status: str,
        block_count: int,
        warn_count: int,
    ) -> None:
        self.rating_plan_id = rating_plan_id
        self.status = status
        self.block_count = block_count
        self.warn_count = warn_count
        super().__init__(
            f"Plan {rating_plan_id!r} is {status} ({block_count} blocking "
            f"+ {warn_count} warning issues) — fix them before sign-off",
            details={
                "rating_plan_id": rating_plan_id,
                "status": status,
                "block_count": block_count,
                "warn_count": warn_count,
            },
        )


class AlreadySignedOffError(PlanSignoffError):
    """The plan already has an active (un-revoked) sign-off."""

    code = "already_signed_off"
    default_status_code = 409
    default_hint = "Revoke the active sign-off before signing again."


class NotSignedOffError(PlanSignoffError):
    """No active sign-off to revoke."""

    code = "not_signed_off"
    default_status_code = 409


class PlanLockedError(PlanSignoffError):
    """Mutation attempted against a signed-off plan."""

    code = "plan_locked"
    default_status_code = 409
    default_hint = "Revoke the sign-off before editing (not exposed over the API in the MVP)."


# ===========================================================================
# Typed payloads.
# ===========================================================================


class PlanSignoff(BaseModel):
    """One sign-off row. Active iff `revoked_at is None`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    signoff_id: str
    rating_plan_id: str
    signed_off_by: str
    signed_off_at: str
    note: str
    revoked_at: str | None
    revoked_by: str | None
    revoke_reason: str


# ===========================================================================
# DB helpers.
# ===========================================================================


def _row_to_signoff(row: sqlite3.Row) -> PlanSignoff:
    return PlanSignoff(
        signoff_id=row["signoff_id"],
        rating_plan_id=row["rating_plan_id"],
        signed_off_by=row["signed_off_by"],
        signed_off_at=row["signed_off_at"],
        note=row["note"] or "",
        revoked_at=row["revoked_at"],
        revoked_by=row["revoked_by"],
        revoke_reason=row["revoke_reason"] or "",
    )


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def get_active_signoff(*, db: Database, rating_plan_id: str) -> PlanSignoff | None:
    """Return the active (un-revoked) sign-off for a plan, if any."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT * FROM rating_plan_signoffs
            WHERE rating_plan_id = ? AND revoked_at IS NULL
            ORDER BY signed_off_at DESC
            LIMIT 1
            """,
            (rating_plan_id,),
        ).fetchone()
    return _row_to_signoff(row) if row else None


def get_signoff_history(*, db: Database, rating_plan_id: str) -> list[PlanSignoff]:
    """Return all sign-off rows (active + revoked) for a plan, newest first."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM rating_plan_signoffs
            WHERE rating_plan_id = ?
            ORDER BY signed_off_at DESC
            """,
            (rating_plan_id,),
        ).fetchall()
    return [_row_to_signoff(r) for r in rows]


# ===========================================================================
# Public API.
# ===========================================================================


def assert_plan_unlocked(*, db: Database, rating_plan_id: str) -> None:
    """Raise `PlanLockedError` when the plan has an active sign-off.

    Call this at the top of every mutation entrypoint in `author.py`
    so a signed-off plan can't be silently changed.
    """
    active = get_active_signoff(db=db, rating_plan_id=rating_plan_id)
    if active is not None:
        raise PlanLockedError(
            f"Plan {rating_plan_id!r} is signed off by "
            f"{active.signed_off_by} at {active.signed_off_at} — "
            "revoke before editing"
        )


def sign_off_plan(
    *,
    db: Database,
    rating_plan_id: str,
    operator_id: str,
    note: str = "",
) -> PlanSignoff:
    """Sign off a plan for filing.

    SLICE-2 PORT NOTE: this requires `compute_plan_flow_filing_readiness`
    from `rates.plans.plan_flow_filing`, which depends on the cascade
    engine. Both port in a later slice; until then this raises
    NotImplementedError. The route layer should not mount this endpoint.
    """
    raise NotImplementedError(
        "sign_off_plan is deferred to a later slice — filing-readiness "
        "computation depends on the cascade engine, which hasn't ported "
        "yet. The lock READ path (assert_plan_unlocked) and the REVOKE "
        "path (revoke_signoff) are functional in this slice; only the "
        "CREATE path is stubbed."
    )


def revoke_signoff(
    *,
    db: Database,
    rating_plan_id: str,
    operator_id: str,
    reason: str = "",
) -> PlanSignoff:
    """Revoke the active sign-off on a plan, re-enabling edits.

    Raises:
      · PlanNotFoundError    (404)
      · NotSignedOffError    (409)
    """
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise PlanNotFoundError(f"Plan {rating_plan_id!r} not found")

    active = get_active_signoff(db=db, rating_plan_id=rating_plan_id)
    if active is None:
        raise NotSignedOffError(f"Plan {rating_plan_id!r} has no active sign-off to revoke")

    now = _now_iso()
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE rating_plan_signoffs
            SET revoked_at = ?, revoked_by = ?, revoke_reason = ?
            WHERE signoff_id = ?
            """,
            (now, operator_id, reason or "", active.signoff_id),
        )
        conn.commit()
    return PlanSignoff(
        signoff_id=active.signoff_id,
        rating_plan_id=active.rating_plan_id,
        signed_off_by=active.signed_off_by,
        signed_off_at=active.signed_off_at,
        note=active.note,
        revoked_at=now,
        revoked_by=operator_id,
        revoke_reason=reason or "",
    )


# Standalone uuid generator stub — kept here so author.py's idempotency
# helper can call into this module without introducing a different uuid
# usage pattern. NOT exported.
def _new_signoff_id() -> str:
    return str(uuid.uuid4())


__all__ = [
    "AlreadySignedOffError",
    "FilingNotReadyError",
    "NotSignedOffError",
    "PlanLockedError",
    "PlanNotFoundError",
    "PlanSignoff",
    "PlanSignoffError",
    "assert_plan_unlocked",
    "get_active_signoff",
    "get_signoff_history",
    "revoke_signoff",
    "sign_off_plan",
]
