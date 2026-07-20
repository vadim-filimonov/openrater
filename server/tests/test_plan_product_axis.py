# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Product axis persistence (ADR-0033 gate 2).

Proves the additive backend foundation for the line/coverage/product
split:

  · `create_plan` populates `product` (transitionally from
    line_of_business until the frontend cutover sends a real product),
  · `product` round-trips through persistence,
  · `product` JOINS the content_hash (two plans differing only in
    product hash differently) — the whole point of the axis cleanup is
    that the real structure becomes durable + hashed,
  · the migration's backfill SQL is lossless (NULL product → LOB value),
  · the SQL CHECK rejects an out-of-vocabulary product.

GENERICITY (ADR-0033 §0): `product` is an opaque tag — no backend logic
branches on its value; these tests treat `do`/`eo`/`bop` interchangeably.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from openrater.persistence import Database
from openrater.rates.plans.author import create_plan
from openrater.rates.plans.hashing import hash_plan
from openrater.rates.plans.models import LineOfBusiness, ProductCode, RatingPlan
from openrater.rates.plans.repo import _build_content_dict, get_plan


@pytest.fixture
def db():
    """A fresh SQLite DB per test (runs migrations, incl. 013)."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = Path(f.name)
    try:
        database = Database(path)
        with database.connection() as conn:
            conn.execute("SELECT 1")
        yield database
    finally:
        os.unlink(path)


def _make_plan(db: Database, lob: LineOfBusiness):
    return create_plan(
        db=db,
        display_name=f"Test {lob.value}",
        line_of_business=lob,
        jurisdiction="WI",
        effective_date="2026-06-01",
    )


def test_create_plan_populates_product_from_lob(db):
    # Transitional default (ADR-0033): the 5 legacy LOB values are valid
    # ProductCodes, so create_plan backfills product from line_of_business
    # until the frontend cutover (gate 3) sends a real product.
    bop = _make_plan(db, LineOfBusiness.BOP)
    assert bop.product == ProductCode.BOP

    cgl = _make_plan(db, LineOfBusiness.CGL)
    assert cgl.product == ProductCode.CGL


def test_product_round_trips_through_persistence(db):
    plan = _make_plan(db, LineOfBusiness.WC)
    reloaded = get_plan(db=db, rating_plan_id=plan.rating_plan_id)
    assert reloaded is not None
    assert reloaded.product == ProductCode.WC


def _plan_with_product(product: ProductCode | None) -> RatingPlan:
    return RatingPlan(
        rating_plan_id="p1",
        display_name="P",
        line_of_business=LineOfBusiness.CGL,
        product=product,
        effective_date="2026-01-01",
        created_at="2026-01-01T00:00:00Z",
    )


def test_product_joins_the_content_hash():
    # Two plans identical EXCEPT product must hash differently — the real
    # structure now lives in the hash (ADR-0033), not in localStorage.
    do_hash = hash_plan(_build_content_dict(_plan_with_product(ProductCode.DO), []))
    eo_hash = hash_plan(_build_content_dict(_plan_with_product(ProductCode.EO), []))
    assert do_hash != eo_hash

    # And it's deterministic: same product → same hash.
    again = hash_plan(_build_content_dict(_plan_with_product(ProductCode.DO), []))
    assert do_hash == again


def test_migration_backfill_sql_is_lossless(db):
    # Simulate a pre-migration row (product NULL), then run the migration's
    # backfill UPDATE — product must come from line_of_business losslessly.
    plan = _make_plan(db, LineOfBusiness.AUTO)
    with db.connection() as conn:
        conn.execute(
            "UPDATE rating_plans SET product = NULL WHERE rating_plan_id = ?",
            (plan.rating_plan_id,),
        )
        # The exact backfill from migration 013.
        conn.execute(
            "UPDATE rating_plans SET product = line_of_business WHERE product IS NULL"
        )
    reloaded = get_plan(db=db, rating_plan_id=plan.rating_plan_id)
    assert reloaded is not None
    assert reloaded.product == ProductCode.AUTO


def test_check_constraint_rejects_unknown_product(db):
    # Defense-in-depth: the SQL CHECK rejects an out-of-vocabulary value
    # even if app-layer validation were bypassed.
    plan = _make_plan(db, LineOfBusiness.BOP)
    with pytest.raises(sqlite3.IntegrityError):
        with db.connection() as conn:
            conn.execute(
                "UPDATE rating_plans SET product = 'not_a_product' WHERE rating_plan_id = ?",
                (plan.rating_plan_id,),
            )


# ---------------------------------------------------------------------------
# Gate 3 — create with a real product (slug derives from it; N2 fix)
# ---------------------------------------------------------------------------


def test_create_plan_with_product_slugs_from_product(db):
    # A D&O plan: product=do drives the slug (do_…), not the collapsed
    # line_of_business shim (cgl). This is the N2 fix at the create layer.
    plan = create_plan(
        db=db,
        display_name="Nonprofit D&O",
        line_of_business=LineOfBusiness.CGL,  # the deprecated shim
        product=ProductCode.DO,  # the truth
        jurisdiction="WI",
        effective_date="2026-06-01",
    )
    assert plan.product == ProductCode.DO
    assert plan.rating_plan_id.startswith("do_"), plan.rating_plan_id


def test_route_create_with_product_only_derives_lob_and_slug(client: TestClient):
    # The frontend cutover sends ONLY `product` (lineCodeToApiLob deleted).
    # The route derives the line_of_business shim + slugs from product.
    resp = client.post(
        "/api/v1/plans",
        json={
            "display_name": "D&O book",
            "product": "do",
            "jurisdiction": "WI",
            "effective_date": "2026-07-01",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["product"] == "do"
    assert body["line_of_business"] == "cgl"  # deprecation-window shim
    assert body["rating_plan_id"].startswith("do_"), body["rating_plan_id"]


def test_route_create_with_legacy_lob_only_still_works(client: TestClient):
    # Back-compat: a legacy client sending only line_of_business gets
    # product derived (the 5 LOB values are valid ProductCodes).
    resp = client.post(
        "/api/v1/plans",
        json={
            "display_name": "BOP book",
            "line_of_business": "bop",
            "jurisdiction": "WI",
            "effective_date": "2026-07-01",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["product"] == "bop"
    assert body["rating_plan_id"].startswith("bop_")


def test_route_create_requires_product_or_lob(client: TestClient):
    resp = client.post(
        "/api/v1/plans",
        json={
            "display_name": "No axis",
            "jurisdiction": "WI",
            "effective_date": "2026-07-01",
        },
    )
    assert resp.status_code == 400, resp.text
