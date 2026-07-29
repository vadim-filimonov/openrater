# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The two-run compare — FCA fca-2026-07-25 #28 (finding 78).

"Book impact requires hand-joining two runs": rerate_book returned one
totals block per plan, run detail had no diff, and the audit persona
computed its −2.4% headline OUTSIDE the product. This module is the
rate-committee arithmetic, server-side so the app drawer and the chat
tool read the SAME numbers (Law 1 — one code path).

Joining: rows match by the caller's own identifier — the first source
column present in both runs whose values are unique within each run
(PolicyNbr-style). Without one, rows pair by position and the compare
says so. Totals cover matched rows rated on BOTH sides; everything
excluded (refused on a side, unmatched) is counted and named, never
silently dropped into a misleading grand total.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from openrater.persistence import Database

from .service import collect_run_rows, get_run

#: Example identifiers shown per bucket — enough to recognize, not a dump.
_EXAMPLES_CAP = 5
#: Top movers returned (the drawer + chat both render this list).
_MOVERS_CAP = 10
#: Premium deltas at or below half a cent are display noise, not change.
_EPSILON = 0.005


class RunRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str
    run_id: str
    kind: str
    created_at: str
    book_content_hash: str | None = None


class KeyedCount(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    count: int
    examples: list[str] = Field(default_factory=list)


class CompareCounts(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rows_a: int
    rows_b: int
    matched: int
    only_a: KeyedCount
    only_b: KeyedCount
    rated_both: int
    changed: int
    unchanged: int


class CompareTotals(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    premium_a: float
    premium_b: float
    delta: float
    pct: float | None = None


class StatusChanges(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rated_to_refused: KeyedCount
    refused_to_rated: KeyedCount
    tier_changed: KeyedCount


class CompareMover(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    premium_a: float
    premium_b: float
    delta: float
    pct: float | None = None
    tier_a: str | None = None
    tier_b: str | None = None


class RunCompare(BaseModel):
    """The wire shape GET …/compare returns (app drawer + MCP relay)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    a: RunRef
    b: RunRef
    #: The identifier column rows joined on; None = row position.
    joined_by_column: str | None = None
    counts: CompareCounts
    totals: CompareTotals
    status_changes: StatusChanges
    movers: list[CompareMover] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


def _premium_of(row: dict[str, Any]) -> float | None:
    views = row.get("views")
    v = views.get("premium") if isinstance(views, dict) else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _tier_of(row: dict[str, Any]) -> str | None:
    views = row.get("views")
    t = views.get("tier") if isinstance(views, dict) else None
    return str(t) if t is not None else None


def _join_column(
    rows_a: list[dict[str, Any]], rows_b: list[dict[str, Any]]
) -> str | None:
    """The first source column present in BOTH runs whose values are
    unique within each — the caller's own row identity."""

    def columns(rows: list[dict[str, Any]]) -> list[str]:
        seen: dict[str, None] = {}
        for r in rows:
            src = r.get("source")
            if isinstance(src, dict):
                for k in src:
                    seen.setdefault(str(k), None)
        return list(seen)

    def unique_values(rows: list[dict[str, Any]], col: str) -> bool:
        vals = [
            str((r.get("source") or {}).get(col))
            for r in rows
            if isinstance(r.get("source"), dict)
            and (r.get("source") or {}).get(col) not in (None, "")
        ]
        return len(vals) == len(rows) and len(set(vals)) == len(vals)

    cols_b = set(columns(rows_b))
    for col in columns(rows_a):
        if col in cols_b and unique_values(rows_a, col) and unique_values(rows_b, col):
            return col
    return None


def _keyed(
    rows: list[dict[str, Any]], column: str | None
) -> dict[str, dict[str, Any]]:
    if column is None:
        return {f"row {i + 1}": r for i, r in enumerate(rows)}
    return {str((r.get("source") or {}).get(column)): r for r in rows}


def compare_runs(
    *,
    db: Database,
    rating_plan_id: str,
    run_id: str,
    with_plan_id: str,
    with_run_id: str,
    scoring_base_url: str | None = None,
) -> RunCompare:
    """Join two DONE book/probe runs row-by-row and report the deltas.
    Refusals (not a book run, not done, run missing) propagate from
    `collect_run_rows` with their own honest names."""
    run_a = get_run(db=db, rating_plan_id=rating_plan_id, run_id=run_id)
    run_b = get_run(db=db, rating_plan_id=with_plan_id, run_id=with_run_id)
    rows_a = collect_run_rows(
        db=db,
        rating_plan_id=rating_plan_id,
        run_id=run_id,
        scoring_base_url=scoring_base_url,
    )
    rows_b = collect_run_rows(
        db=db,
        rating_plan_id=with_plan_id,
        run_id=with_run_id,
        scoring_base_url=scoring_base_url,
    )
    assert run_a is not None and run_b is not None  # collect_run_rows 404s first

    column = _join_column(rows_a, rows_b)
    keyed_a = _keyed(rows_a, column)
    keyed_b = _keyed(rows_b, column)

    matched_keys = [k for k in keyed_a if k in keyed_b]
    only_a_keys = [k for k in keyed_a if k not in keyed_b]
    only_b_keys = [k for k in keyed_b if k not in keyed_a]

    rated_to_refused: list[str] = []
    refused_to_rated: list[str] = []
    tier_changed: list[str] = []
    movers: list[CompareMover] = []
    sum_a = 0.0
    sum_b = 0.0
    rated_both = 0
    changed = 0
    for key in matched_keys:
        pa = _premium_of(keyed_a[key])
        pb = _premium_of(keyed_b[key])
        if pa is not None and pb is None:
            rated_to_refused.append(key)
            continue
        if pa is None and pb is not None:
            refused_to_rated.append(key)
            continue
        if pa is None or pb is None:
            continue  # refused on both sides — no delta to report
        rated_both += 1
        sum_a += pa
        sum_b += pb
        delta = pb - pa
        ta = _tier_of(keyed_a[key])
        tb = _tier_of(keyed_b[key])
        if ta != tb:
            tier_changed.append(key)
        if abs(delta) > _EPSILON:
            changed += 1
            movers.append(
                CompareMover(
                    key=key,
                    premium_a=round(pa, 2),
                    premium_b=round(pb, 2),
                    delta=round(delta, 2),
                    pct=round(delta / pa * 100, 1) if pa else None,
                    tier_a=ta,
                    tier_b=tb,
                )
            )
    movers.sort(key=lambda m: abs(m.delta), reverse=True)

    caveats: list[str] = []
    excluded = (
        len(only_a_keys)
        + len(only_b_keys)
        + len(rated_to_refused)
        + len(refused_to_rated)
        + (len(matched_keys) - rated_both - len(rated_to_refused) - len(refused_to_rated))
    )
    if excluded:
        row_word = "row is" if excluded == 1 else "rows are"
        caveats.append(
            f"Totals cover the {rated_both} matched rows rated on both "
            f"sides; {excluded} {row_word} excluded (refused on a side "
            "or unmatched) and counted above instead."
        )
    if column is None:
        caveats.append(
            "No shared unique identifier column — rows paired by "
            "position (row ordinal). Reordering the book between runs "
            "would mispair them."
        )
    hash_a = run_a.book_content_hash
    hash_b = run_b.book_content_hash
    if hash_a and hash_b and hash_a != hash_b:
        caveats.append(
            "The two runs scored different books (content hashes "
            "differ) — this is a row-by-row pairing, not a same-book "
            "impact study."
        )

    delta_total = round(sum_b - sum_a, 2)
    return RunCompare(
        a=RunRef(
            rating_plan_id=run_a.rating_plan_id,
            run_id=run_a.run_id,
            kind=run_a.kind,
            created_at=run_a.created_at,
            book_content_hash=hash_a,
        ),
        b=RunRef(
            rating_plan_id=run_b.rating_plan_id,
            run_id=run_b.run_id,
            kind=run_b.kind,
            created_at=run_b.created_at,
            book_content_hash=hash_b,
        ),
        joined_by_column=column,
        counts=CompareCounts(
            rows_a=len(rows_a),
            rows_b=len(rows_b),
            matched=len(matched_keys),
            only_a=KeyedCount(
                count=len(only_a_keys), examples=only_a_keys[:_EXAMPLES_CAP]
            ),
            only_b=KeyedCount(
                count=len(only_b_keys), examples=only_b_keys[:_EXAMPLES_CAP]
            ),
            rated_both=rated_both,
            changed=changed,
            unchanged=rated_both - changed,
        ),
        totals=CompareTotals(
            premium_a=round(sum_a, 2),
            premium_b=round(sum_b, 2),
            delta=delta_total,
            pct=round(delta_total / sum_a * 100, 1) if sum_a else None,
        ),
        status_changes=StatusChanges(
            rated_to_refused=KeyedCount(
                count=len(rated_to_refused),
                examples=rated_to_refused[:_EXAMPLES_CAP],
            ),
            refused_to_rated=KeyedCount(
                count=len(refused_to_rated),
                examples=refused_to_rated[:_EXAMPLES_CAP],
            ),
            tier_changed=KeyedCount(
                count=len(tier_changed), examples=tier_changed[:_EXAMPLES_CAP]
            ),
        ),
        movers=movers[:_MOVERS_CAP],
        caveats=caveats,
    )
