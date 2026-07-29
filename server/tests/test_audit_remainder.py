# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The 2026-07-11 production-audit remainder, pinned.

Five behaviors landed together after the audit's chip PRs (#411/#413/#414
/#416) and Brief 84 (#410); each gets its regression pin here:

  · Active-slot re-key (migration 039): promotes evict same-PRODUCT
    siblings only — never a different product that shims to the same LOB.
  · GET /plans?product= filter (the 013 index finally has a read path).
  · Pinned-version policy quotes read the FROZEN input_mapping's
    rollup_fields — draft edits can't move a published quote.
  · The republish tripwire: coverage gaps demote hub+wire status to
    `unmapped`, the live flip refuses on gaps (`mapping_gaps`), and a
    test receipt older than the published version reads
    `live_version_untested` (the §4.5 drift flag, unified with PR #417).
  · Publish history (migration 040): every repoint writes an append-only
    `publish` audit event; archive writes `unpublish`.
  · The hard-delete guard: exposures / portfolio pins block deletion
    without `force=true`.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan, promote

# ---------------------------------------------------------------------------
# Local world-builders
# ---------------------------------------------------------------------------


def _freeze(client: TestClient, plan_id: str, name: str) -> str:
    r = client.post(
        f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": name}
    )
    assert r.status_code == 201, r.text
    return r.json()["snapshot_id"]


def _publish(client: TestClient, plan_id: str, snapshot_id: str) -> dict[str, Any]:
    r = client.patch(f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}/publish")
    assert r.status_code == 200, r.text
    return r.json()


def _integration(client: TestClient, name: str = "Audit world") -> str:
    r = client.post("/api/v1/integrations", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["integration_id"]


def _expose(
    client: TestClient,
    integration_id: str,
    plan_id: str,
    carrier: str = "acme-mutual",
) -> dict[str, Any]:
    r = client.post(
        f"/api/v1/integrations/{integration_id}/plans",
        json={
            "rating_plan_id": plan_id,
            "carrier_label": carrier,
            "trace_policy": "summary",
            "validity_days": 30,
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


def _plan_with_form_inputs(
    client: TestClient, keys: list[str], *, display_name: str = "Tripwire plan"
) -> str:
    """A draft whose input_node stages are PEER-consumable (`source:
    "form"` — the filter `plan_consumed_inputs` applies), one per key,
    all required."""
    plan = create_plan(client, display_name=display_name)
    plan_id: str = plan["rating_plan_id"]
    for key in keys:
        add_stage(
            client,
            plan_id,
            stage_id=f"form_{key}",
            stage_kind="input_node",
            display_name=key,
            config_json={
                "name": key,
                "data_type": "number",
                "source": "form",
                "source_path": key,
                "required": True,
            },
            outputs=[
                {"output_name": "value", "data_type": "number", "description": None}
            ],
        )
    return plan_id


def _map_exposure(
    client: TestClient,
    integration_id: str,
    exposed_id: str,
    keys: list[str],
    *,
    carrier: str = "acme-mutual",
    live: bool = False,
) -> dict[str, Any]:
    r = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}",
        json={
            "carrier_label": carrier,
            "mapping": [
                {
                    "peer_key": f"peer.{k}",
                    "plan_input_key": k,
                    "dtype": "number",
                    "required": True,
                }
                for k in keys
            ],
            "trace_policy": "summary",
            "validity_days": 30,
            "live": live,
        },
    )
    return r


def _exposure_row(
    client: TestClient, integration_id: str, exposed_id: str
) -> dict[str, Any]:
    r = client.get(f"/api/v1/integrations/{integration_id}/plans")
    assert r.status_code == 200, r.text
    rows = [e for e in r.json() if e["exposed_id"] == exposed_id]
    assert rows, f"exposure {exposed_id} missing from {r.text}"
    return rows[0]


def _stamp_receipt(client: TestClient, exposed_id: str, snapshot_id: str) -> None:
    """Plant a green test receipt directly (the Hub's test-quote path is
    engine-backed; these tests pin the RECEIPT-vs-PUBLISH comparison, not
    the quote)."""
    db = client.app.state.db
    with db.connection() as conn:
        conn.execute(
            "UPDATE integration_exposed_plans SET last_test_at = ?,"
            " last_test_snapshot_id = ?, last_test_premium_cents = ?"
            " WHERE exposed_id = ?",
            ("2026-07-11T12:00:00Z", snapshot_id, 180700, exposed_id),
        )
        conn.commit()


def _audit_events(client: TestClient, plan_id: str) -> list[dict[str, Any]]:
    r = client.get(f"/api/v1/plans/{plan_id}/audit")
    assert r.status_code == 200, r.text
    body = r.json()
    return body if isinstance(body, list) else body.get("events", [])


def _payload(event: dict[str, Any], key: str) -> dict[str, Any]:
    """`before`/`after` tolerant of parsed-dict vs raw-JSON serialization."""
    value = event.get(key)
    if value is None:
        raw = event.get(f"{key}_json")
        value = json.loads(raw) if isinstance(raw, str) else raw
    return value or {}


# ---------------------------------------------------------------------------
# 1 · Active slot keyed on product (migration 039)
# ---------------------------------------------------------------------------


class TestActiveSlotProduct:
    def test_promote_does_not_evict_other_product_same_state(
        self, client: TestClient
    ) -> None:
        """D&O KS active + E&O KS promoted → BOTH active. Under the old
        (LOB, jurisdiction) key both shimmed to cgl and the promote
        silently archived the live sibling."""
        do_plan = create_plan(
            client, display_name="DO KS", product="do", jurisdiction="KS"
        )
        promote(client, do_plan["rating_plan_id"])
        eo_plan = create_plan(
            client, display_name="EO KS", product="eo", jurisdiction="KS"
        )
        result = promote(client, eo_plan["rating_plan_id"])
        assert result["archived_plan_id"] is None, result

        listed = client.get("/api/v1/plans", params={"status": "all"}).json()
        by_id = {p["rating_plan_id"]: p for p in listed}
        assert by_id[do_plan["rating_plan_id"]]["status"] == "active"
        assert by_id[eo_plan["rating_plan_id"]]["status"] == "active"

    def test_promote_archives_same_product_sibling(self, client: TestClient) -> None:
        first = create_plan(
            client, display_name="EO KS 2025", product="eo", jurisdiction="KS"
        )
        promote(client, first["rating_plan_id"])
        second = create_plan(
            client, display_name="EO KS 2026", product="eo", jurisdiction="KS"
        )
        result = promote(client, second["rating_plan_id"])
        assert result["archived_plan_id"] == first["rating_plan_id"]

    def test_list_filters_by_product(self, client: TestClient) -> None:
        create_plan(client, display_name="DO KS", product="do", jurisdiction="KS")
        create_plan(client, display_name="EO KS", product="eo", jurisdiction="KS")

        only_do = client.get(
            "/api/v1/plans", params={"product": "do", "status": "all"}
        ).json()
        assert [p["display_name"] for p in only_do] == ["DO KS"]
        assert only_do[0]["product"] == "do"

        unknown = client.get(
            "/api/v1/plans", params={"product": "nonsense", "status": "all"}
        )
        assert unknown.status_code == 400
        assert unknown.json()["error"]["code"] == "unknown_product"


# ---------------------------------------------------------------------------
# 2 · Pinned-version policy quotes use the FROZEN rollup declarations
# ---------------------------------------------------------------------------


class TestPinnedPolicyMapping:
    def test_published_policy_quote_uses_frozen_rollups(
        self, client: TestClient, monkeypatch: Any
    ) -> None:
        from tests.test_routes_inputs_mapping import make_csv_mapping

        plan_id = _plan_with_form_inputs(client, ["tiv"], display_name="Pin plan")

        v1_mapping = make_csv_mapping()
        v1_mapping["rollup_fields"] = ["tiv"]
        r = client.put(
            f"/api/v1/plans/{plan_id}/inputs-mapping", json={"mapping": v1_mapping}
        )
        assert r.status_code == 200, r.text

        snapshot_id = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, snapshot_id)

        # Draft drifts: the live mapping now rolls a second field.
        v2_mapping = make_csv_mapping()
        v2_mapping["rollup_fields"] = ["tiv", "payroll"]
        r = client.put(
            f"/api/v1/plans/{plan_id}/inputs-mapping", json={"mapping": v2_mapping}
        )
        assert r.status_code == 200, r.text

        captured: dict[str, Any] = {}

        def fake_score_policy(*, request: dict[str, Any], base_url: str | None = None):
            captured.clear()
            captured.update(request)
            return {
                "premium": 100.0,
                "row_status": "ok",
                "composed": {"subtotal": 100.0, "final": 100.0, "adjustments": []},
                "locations": [],
                "location_count": 1,
            }

        monkeypatch.setattr(
            "openrater.rates.quotes.service.score_policy_once", fake_score_policy
        )

        # Published-version quote → the FROZEN declaration (v1).
        r = client.post(
            f"/api/v1/plans/{plan_id}/quote",
            json={"locations": [{"tiv": 100}]},
        )
        assert r.status_code == 200, r.text
        assert captured.get("rollupFields") == ["tiv"]

        # Draft quote → the live declaration (the drifted one).
        r = client.post(
            f"/api/v1/plans/{plan_id}/quote",
            params={"draft": "true"},
            json={"locations": [{"tiv": 100}]},
        )
        assert r.status_code == 200, r.text
        assert captured.get("rollupFields") == ["tiv", "payroll"]


# ---------------------------------------------------------------------------
# 3 · The republish tripwire
# ---------------------------------------------------------------------------


class TestRepublishTripwire:
    def test_coverage_gap_demotes_to_unmapped(self, client: TestClient) -> None:
        plan_id = _plan_with_form_inputs(client, ["tiv", "payroll"])
        _publish(client, plan_id, _freeze(client, plan_id, "v1"))
        integration_id = _integration(client)
        exposed = _expose(client, integration_id, plan_id)

        # Map only ONE of two required consumed inputs.
        r = _map_exposure(client, integration_id, exposed["exposed_id"], ["tiv"])
        assert r.status_code == 200, r.text
        row = _exposure_row(client, integration_id, exposed["exposed_id"])
        assert row["consumed_required"] == 2
        assert row["consumed_missing"] == 1
        assert row["status"] == "unmapped"

    def test_live_flip_refuses_on_gaps(self, client: TestClient) -> None:
        plan_id = _plan_with_form_inputs(client, ["tiv", "payroll"])
        snapshot_id = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, snapshot_id)
        integration_id = _integration(client)
        exposed = _expose(client, integration_id, plan_id)
        _map_exposure(client, integration_id, exposed["exposed_id"], ["tiv"])
        _stamp_receipt(client, exposed["exposed_id"], snapshot_id)

        r = _map_exposure(
            client, integration_id, exposed["exposed_id"], ["tiv"], live=True
        )
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "mapping_gaps"

    def test_republish_with_new_required_input_trips_the_wire(
        self, client: TestClient
    ) -> None:
        plan_id = _plan_with_form_inputs(client, ["tiv"])
        v1 = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, v1)
        integration_id = _integration(client)
        exposed = _expose(client, integration_id, plan_id)
        _map_exposure(client, integration_id, exposed["exposed_id"], ["tiv"])
        _stamp_receipt(client, exposed["exposed_id"], v1)
        r = _map_exposure(
            client, integration_id, exposed["exposed_id"], ["tiv"], live=True
        )
        assert r.status_code == 200, r.text
        assert _exposure_row(client, integration_id, exposed["exposed_id"])[
            "status"
        ] == "live"

        # The republish: v2 consumes a NEW required input nobody mapped.
        add_stage(
            client,
            plan_id,
            stage_id="form_sprinklered",
            stage_kind="input_node",
            display_name="sprinklered",
            config_json={
                "name": "sprinklered",
                "data_type": "number",
                "source": "form",
                "source_path": "sprinklered",
                "required": True,
            },
            outputs=[
                {"output_name": "value", "data_type": "number", "description": None}
            ],
        )
        _publish(client, plan_id, _freeze(client, plan_id, "v2"))

        row = _exposure_row(client, integration_id, exposed["exposed_id"])
        assert row["consumed_missing"] == 1
        assert row["status"] == "unmapped"  # the wire stops promising quotes
        assert row["live_version_untested"] is True  # receipt pins v1, live is v2
        assert row["published_version_name"] == "v2"
        assert row["last_test_version_name"] == "v1"

        pulse = client.get(f"/api/v1/integrations/{integration_id}/pulse").json()
        assert pulse["plans_live"] == 0

    def test_content_republish_marks_receipt_stale_but_stays_live(
        self, client: TestClient
    ) -> None:
        plan_id = _plan_with_form_inputs(client, ["tiv"])
        v1 = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, v1)
        integration_id = _integration(client)
        exposed = _expose(client, integration_id, plan_id)
        _map_exposure(client, integration_id, exposed["exposed_id"], ["tiv"])
        _stamp_receipt(client, exposed["exposed_id"], v1)
        assert (
            _map_exposure(
                client, integration_id, exposed["exposed_id"], ["tiv"], live=True
            ).status_code
            == 200
        )

        # Republish without changing the consumed inputs: same coverage,
        # stale receipt.
        _publish(client, plan_id, _freeze(client, plan_id, "v2"))
        row = _exposure_row(client, integration_id, exposed["exposed_id"])
        assert row["status"] == "live"
        assert row["consumed_missing"] == 0
        assert row["live_version_untested"] is True


# ---------------------------------------------------------------------------
# 4 · Publish history (migration 040)
# ---------------------------------------------------------------------------


class TestPublishHistory:
    def test_publish_writes_audit_event(self, client: TestClient) -> None:
        plan_id = create_plan(client, display_name="History plan")["rating_plan_id"]
        v1 = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, v1)

        publishes = [
            e for e in _audit_events(client, plan_id) if e["event_kind"] == "publish"
        ]
        assert len(publishes) == 1
        assert _payload(publishes[0], "after").get("snapshot_id") == v1
        assert _payload(publishes[0], "before") == {}

    def test_repoint_preserves_what_was_live(self, client: TestClient) -> None:
        plan_id = create_plan(client, display_name="Repoint plan")["rating_plan_id"]
        v1 = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, v1)
        v2 = _freeze(client, plan_id, "v2")
        _publish(client, plan_id, v2)

        publishes = [
            e for e in _audit_events(client, plan_id) if e["event_kind"] == "publish"
        ]
        assert len(publishes) == 2
        latest = max(publishes, key=lambda e: e.get("event_at") or "")
        # The demoted version is preserved on the event even though the
        # snapshot row's published_at was NULLed by the repoint.
        assert _payload(latest, "before").get("snapshot_id") == v1
        assert _payload(latest, "before").get("display_name") == "v1"
        assert _payload(latest, "after").get("snapshot_id") == v2

    def test_go_live_verb_writes_the_same_event(self, client: TestClient) -> None:
        plan_id = create_plan(client, display_name="Verb plan")["rating_plan_id"]
        r = client.post(f"/api/v1/plans/{plan_id}/publish", json={})
        assert r.status_code in (200, 201), r.text
        publishes = [
            e for e in _audit_events(client, plan_id) if e["event_kind"] == "publish"
        ]
        assert len(publishes) == 1

    def test_archive_writes_unpublish(self, client: TestClient) -> None:
        plan_id = create_plan(client, display_name="Archive plan")["rating_plan_id"]
        v1 = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, v1)

        r = client.request("DELETE", f"/api/v1/drafts/{plan_id}")
        assert r.status_code == 200, r.text

        events = _audit_events(client, plan_id)
        unpublishes = [e for e in events if e["event_kind"] == "unpublish"]
        assert len(unpublishes) == 1
        assert _payload(unpublishes[0], "before").get("snapshot_id") == v1
        # And the pointer is really gone (D-E): nothing published.
        status = client.get(f"/api/v1/plans/{plan_id}/publish-status").json()
        assert status["published"] is False


# ---------------------------------------------------------------------------
# 5 · Hard-delete guard
# ---------------------------------------------------------------------------


class TestHardDeleteGuard:
    def test_blocked_while_exposed_then_force(self, client: TestClient) -> None:
        plan_id = _plan_with_form_inputs(client, ["tiv"], display_name="Guard plan")
        _publish(client, plan_id, _freeze(client, plan_id, "v1"))
        integration_id = _integration(client)
        _expose(client, integration_id, plan_id)

        assert client.request("DELETE", f"/api/v1/drafts/{plan_id}").status_code == 200

        blocked = client.request("DELETE", f"/api/v1/plans/{plan_id}")
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["error"]["code"] == "plan_delete_blocked"

        forced = client.request("DELETE", f"/api/v1/plans/{plan_id}?force=true")
        assert forced.status_code == 200, forced.text
        assert client.get(f"/api/v1/plans/{plan_id}").status_code == 404

    def test_clean_archived_plan_deletes_without_force(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client, display_name="Clean delete")["rating_plan_id"]
        _freeze(client, plan_id, "v1")
        assert client.request("DELETE", f"/api/v1/drafts/{plan_id}").status_code == 200
        assert client.request("DELETE", f"/api/v1/plans/{plan_id}").status_code == 200
