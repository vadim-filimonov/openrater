# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""v4 G14 — If-Match preconditions on the four replace-all writes.

Every child-resource sync is a debounced bulk REPLACE-ALL; without a
precondition, two tabs silently destroy each other's work (observed
live on the dev DB during G22 verification: a stale mount's dims sync
wiped the seeded plan's 17 dims). The contract under test:

  · GET/list responses expose the hash to echo back (`collection_hash`
    for dims + factor tables; the envelope `content_hash` for the
    input-mapping + policy-tail singletons).
  · A write carrying `If-Match` == current hash succeeds and returns
    the NEW hash.
  · A write carrying a stale `If-Match` is 412 `stale_write` and
    writes NOTHING.
  · A write with no `If-Match` stays unconditional (scripts / seeds /
    first writes).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests._helpers import create_plan

_DIM = {
    "dim_id": "construction",
    "display_name": "Construction",
    "slug": "construction",
    "data_type": "string",
    "role": "rating-input",
    "shape": "categorical",
    "levels": [{"kind": "categorical", "id": "frame", "label": "Frame"}],
}
_DIM_B = {
    **_DIM,
    "dim_id": "occupancy",
    "display_name": "Occupancy",
    "slug": "occupancy",
    "levels": [{"kind": "categorical", "id": "office", "label": "Office"}],
}
_FT = {
    "table_id": "ft1",
    "display_name": "FT1",
    "slug": "ft1",
    "key_dimensions": ["construction"],
    "cells": {"frame": 1.1},
}


class TestDimensionsIfMatch:
    def test_list_exposes_collection_hash_even_when_empty(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        body = client.get(f"/api/v1/plans/{pid}/dimensions").json()
        assert isinstance(body["collection_hash"], str)
        assert len(body["collection_hash"]) == 16

    def test_fresh_if_match_succeeds_and_hash_rotates(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        h0 = client.get(f"/api/v1/plans/{pid}/dimensions").json()[
            "collection_hash"
        ]
        r = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [_DIM]},
            headers={"If-Match": h0},
        )
        assert r.status_code == 200, r.text
        h1 = r.json()["collection_hash"]
        assert h1 != h0
        # The returned hash is immediately usable for the next write.
        r2 = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [_DIM, _DIM_B]},
            headers={"If-Match": h1},
        )
        assert r2.status_code == 200, r2.text

    def test_stale_if_match_is_412_and_writes_nothing(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        h0 = client.get(f"/api/v1/plans/{pid}/dimensions").json()[
            "collection_hash"
        ]
        # A second writer lands first (tab B, unconditional).
        client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [_DIM]},
        )
        # Tab A still holds h0 — its replace-all (which would WIPE tab
        # B's dim) must be refused.
        r = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": []},
            headers={"If-Match": h0},
        )
        assert r.status_code == 412, r.text
        err = r.json()["error"]
        assert err["code"] == "stale_write"
        assert err["details"]["supplied_hash"] == h0
        # Nothing was written — tab B's dim survives.
        dims = client.get(f"/api/v1/plans/{pid}/dimensions").json()[
            "dimensions"
        ]
        assert [d["dim_id"] for d in dims] == ["construction"]

    def test_no_if_match_stays_unconditional(self, client: TestClient) -> None:
        pid = create_plan(client)["rating_plan_id"]
        r = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [_DIM]},
        )
        assert r.status_code == 200, r.text


class TestFactorTablesIfMatch:
    def test_stale_if_match_is_412_and_writes_nothing(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        h0 = client.get(f"/api/v1/plans/{pid}/factor-tables").json()[
            "collection_hash"
        ]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": [_FT]},
        )
        r = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": []},
            headers={"If-Match": h0},
        )
        assert r.status_code == 412, r.text
        assert r.json()["error"]["code"] == "stale_write"
        fts = client.get(f"/api/v1/plans/{pid}/factor-tables").json()[
            "factor_tables"
        ]
        assert [t["table_id"] for t in fts] == ["ft1"]

    def test_cell_edits_rotate_the_collection_hash(
        self, client: TestClient
    ) -> None:
        # Cells ride each row's content_hash (the bulk write recomputes
        # it), so a pure cell change must invalidate a stale If-Match.
        pid = create_plan(client)["rating_plan_id"]
        r1 = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": [_FT]},
        )
        h1 = r1.json()["collection_hash"]
        r2 = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": [{**_FT, "cells": {"frame": 1.2}}]},
            headers={"If-Match": h1},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["collection_hash"] != h1


class TestInputMappingIfMatch:
    def test_fresh_then_stale(self, client: TestClient) -> None:
        pid = create_plan(client)["rating_plan_id"]
        first = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": {"source": {"kind": "csv", "columns": ["a"]}, "column_map": {}}},
        )
        assert first.status_code in (200, 201), first.text
        h1 = first.json()["content_hash"]
        # Conditioned write with the fresh hash succeeds…
        second = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": {"source": {"kind": "csv", "columns": ["a", "b"]}, "column_map": {}}},
            headers={"If-Match": h1},
        )
        assert second.status_code in (200, 201), second.text
        # …and the ORIGINAL hash is now stale.
        stale = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": {"source": {"kind": "csv", "columns": []}, "column_map": {}}},
            headers={"If-Match": h1},
        )
        assert stale.status_code == 412, stale.text
        assert stale.json()["error"]["code"] == "stale_write"
        # Tab B's columns survive.
        mapping = client.get(f"/api/v1/plans/{pid}/inputs-mapping").json()
        assert mapping["mapping"]["source"]["columns"] == ["a", "b"]

    def test_if_match_against_absent_record_is_412(
        self, client: TestClient
    ) -> None:
        # The caller saw a record that has since been deleted — refuse.
        pid = create_plan(client)["rating_plan_id"]
        r = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": {"source": {"kind": "csv", "columns": []}, "column_map": {}}},
            headers={"If-Match": "deadbeefdeadbeef"},
        )
        assert r.status_code == 412, r.text


class TestPolicyTailIfMatch:
    def test_fresh_then_stale(self, client: TestClient) -> None:
        pid = create_plan(client)["rating_plan_id"]
        first = client.put(
            f"/api/v1/plans/{pid}/policy-tail",
            json={"tail": [{"kind": "minimum_premium", "id": "min", "floor": 500}]},
        )
        assert first.status_code in (200, 201), first.text
        h1 = first.json()["content_hash"]
        second = client.put(
            f"/api/v1/plans/{pid}/policy-tail",
            json={"tail": [{"kind": "minimum_premium", "id": "min", "floor": 750}]},
            headers={"If-Match": h1},
        )
        assert second.status_code in (200, 201), second.text
        stale = client.put(
            f"/api/v1/plans/{pid}/policy-tail",
            json={"tail": []},
            headers={"If-Match": h1},
        )
        assert stale.status_code == 412, stale.text
        assert stale.json()["error"]["code"] == "stale_write"
        tail = client.get(f"/api/v1/plans/{pid}/policy-tail").json()
        assert tail["tail"][0]["floor"] == 750
