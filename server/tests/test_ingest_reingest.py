# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Brief 92.R phase 92R.3 — the apply.

The revision lands on the SAME plan (one transaction, deletions
included), the filing's examples re-run, the drift is measured against
the prior build, and the report row is APPENDED. Refusals: stale
If-Match (412, G14), dirty workbook, identity mismatch, non-draft
plans (the state machine's law), and a mid-apply explosion rolls the
whole thing back.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from test_ingest_build import _fake_score, tmp_db  # noqa: E402, F401
from test_ingest_check import find_row, to_bytes  # noqa: E402
from test_ingest_diff import build_base, build_revision  # noqa: E402

from openrater.persistence import Database  # noqa: E402
from openrater.rates.ingest.__main__ import main as cli_main  # noqa: E402
from openrater.rates.ingest.service import build_workbook, reingest_apply  # noqa: E402


def _built_plan(client, monkeypatch) -> tuple[str, str]:  # noqa: ANN001
    """Build the base via the endpoint; return (plan_id, content_hash)."""
    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 390.0}),
    )
    resp = client.post(
        "/api/v1/plans/ingest?filename=base.xlsx", content=to_bytes(build_base())
    )
    assert resp.status_code == 200, resp.text
    plan_id = resp.json()["rating_plan_id"]
    row = (
        client.app.state.db.connection()
        .execute(
            "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
            (plan_id,),
        )
        .fetchone()
    )
    return plan_id, row["content_hash"]


def test_apply_lands_on_the_same_plan_with_drift(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, content_hash = _built_plan(client, monkeypatch)

    # The revision's expectation is 409.50; the engine agrees (fake).
    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 409.5}),
    )
    resp = client.post(
        f"/api/v1/plans/{plan_id}/reingest?filename=rev.xlsx",
        content=to_bytes(build_revision()),
        headers={"If-Match": content_hash},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["rating_plan_id"] == plan_id
    assert payload["verification"] == "all_match"

    report = payload["report"]
    # The diff rode into the report (D4) with the applied totals…
    assert report["diff"]["totals"] == {
        "added": 1,
        "changed": 4,
        "removed": 1,
        "sections_changed": 5,
    }
    # …and the drift is the measured +5% on the filing's own example (D6).
    drift = report["drift"]
    assert drift["median_pct"] == 5.0 and drift["max_pct"] == 5.0
    assert drift["expectations_revised"] == 1
    case = next(c for c in drift["cases"] if c["field"] == "building_premium")
    assert (case["was"], case["now"], case["pct"]) == (390.0, 409.5, 5.0)

    # History appended, never overwritten; the manifest reflects the
    # REVISED workbook (masonry level in, endorsement out).
    history = client.get(f"/api/v1/plans/{plan_id}/build-reports").json()
    assert len(history) == 2
    assert history[0]["workbook_version"] == "1.1.0"
    assert history[0]["manifest"]["counts"]["dimension_levels"] == 5
    assert history[0]["manifest"]["counts"]["endorsements"] == 0
    assert history[1]["manifest"]["counts"]["endorsements"] == 1

    # The substrate really moved: the endorsement stage is gone, the
    # new level exists, and the content hash rotated (ADR-0064's
    # staleness signal).
    conn = client.app.state.db.connection()
    kinds = [
        r["stage_kind"]
        for r in conn.execute(
            "SELECT stage_kind FROM rating_plan_stages WHERE rating_plan_id = ?",
            (plan_id,),
        )
    ]
    assert not any(k.startswith("endorsement.") for k in kinds)
    dims = client.get(f"/api/v1/plans/{plan_id}/dimensions").json()
    cc = next(d for d in dims["dimensions"] if d["slug"] == "construction_class")
    assert any(lvl.get("id") == "masonry" for lvl in cc["levels"])
    new_hash = (
        conn.execute(
            "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
            (plan_id,),
        ).fetchone()["content_hash"]
    )
    assert new_hash != content_hash


def test_stale_if_match_is_412_and_nothing_changes(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, _ = _built_plan(client, monkeypatch)
    resp = client.post(
        f"/api/v1/plans/{plan_id}/reingest",
        content=to_bytes(build_revision()),
        headers={"If-Match": "somebody-elses-hash"},
    )
    assert resp.status_code == 412
    err = resp.json()["error"]
    assert err["code"] == "stale_write"
    assert err["details"]["supplied_hash"] == "somebody-elses-hash"
    history = client.get(f"/api/v1/plans/{plan_id}/build-reports").json()
    assert len(history) == 1


def test_dirty_and_mismatched_revisions_change_nothing(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, content_hash = _built_plan(client, monkeypatch)

    dirty = build_revision()
    dirty.remove(dirty["inputs"])
    resp = client.post(
        f"/api/v1/plans/{plan_id}/reingest",
        content=to_bytes(dirty),
        headers={"If-Match": content_hash},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "ingest_check_failed"

    stranger = build_revision()
    ws = stranger["plan"]
    ws.cell(row=find_row(ws, 1, "rating_plan_id"), column=2).value = "not-this-plan"
    resp = client.post(
        f"/api/v1/plans/{plan_id}/reingest",
        content=to_bytes(stranger),
        headers={"If-Match": content_hash},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "reingest_identity_mismatch"

    assert len(client.get(f"/api/v1/plans/{plan_id}/build-reports").json()) == 1


def test_non_draft_plan_refuses_via_the_state_machine(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, content_hash = _built_plan(client, monkeypatch)
    conn = client.app.state.db.connection()
    conn.execute(
        "UPDATE rating_plans SET status = 'active' WHERE rating_plan_id = ?",
        (plan_id,),
    )
    conn.commit()
    resp = client.post(
        f"/api/v1/plans/{plan_id}/reingest",
        content=to_bytes(build_revision()),
        headers={"If-Match": content_hash},
    )
    # The platform's own law: editing a non-draft refuses; nothing lands.
    assert resp.status_code >= 400
    assert len(client.get(f"/api/v1/plans/{plan_id}/build-reports").json()) == 1


def test_apply_is_atomic(
    tmp_db: Database,  # noqa: F811 — the imported pytest fixture
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 390.0}),
    )
    outcome = build_workbook(db=tmp_db, data=to_bytes(build_base()), filename="a.xlsx")
    plan_id = outcome.rating_plan_id
    before = (
        tmp_db.connection()
        .execute(
            "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
            (plan_id,),
        )
        .fetchone()["content_hash"]
    )

    def explode(**kwargs):  # noqa: ANN003
        raise RuntimeError("mid-apply explosion")

    monkeypatch.setattr(
        "openrater.rates.ingest.builder.bulk_upsert_factor_tables", explode
    )
    with pytest.raises(RuntimeError):
        reingest_apply(
            db=tmp_db, rating_plan_id=plan_id, data=to_bytes(build_revision())
        )

    conn = tmp_db.connection()
    after = conn.execute(
        "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
        (plan_id,),
    ).fetchone()["content_hash"]
    stage_count = conn.execute(
        "SELECT COUNT(*) AS n FROM rating_plan_stages WHERE rating_plan_id = ?",
        (plan_id,),
    ).fetchone()["n"]
    report_count = conn.execute(
        "SELECT COUNT(*) AS n FROM plan_build_reports WHERE rating_plan_id = ?",
        (plan_id,),
    ).fetchone()["n"]
    assert after == before
    assert stage_count > 0
    assert report_count == 1


def test_pre_92r_plan_applies_with_drift_but_no_diff(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, content_hash = _built_plan(client, monkeypatch)
    conn = client.app.state.db.connection()
    conn.execute(
        "UPDATE plan_build_reports SET workbook_blob = NULL WHERE rating_plan_id = ?",
        (plan_id,),
    )
    conn.commit()
    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 409.5}),
    )
    resp = client.post(
        f"/api/v1/plans/{plan_id}/reingest",
        content=to_bytes(build_revision()),
        headers={"If-Match": content_hash},
    )
    assert resp.status_code == 200, resp.text
    report = resp.json()["report"]
    assert report["diff"] is None
    # Drift needs only the prior VECTORS — pre-92R plans still get it.
    assert report["drift"]["median_pct"] == 5.0


def test_cli_reingest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    db_path = tmp_path / "cli.db"
    db = Database(str(db_path))
    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 390.0}),
    )
    outcome = build_workbook(db=db, data=to_bytes(build_base()), filename="a.xlsx")

    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 409.5}),
    )
    rev = tmp_path / "rev.xlsx"
    rev.write_bytes(to_bytes(build_revision()))
    code = cli_main(
        ["reingest", outcome.rating_plan_id, str(rev), "--db", str(db_path)]
    )
    out = capsys.readouterr().out
    assert code == 0
    assert "verification: all_match" in out
    assert "moved +5.0% median" in out

# ---------------------------------------------------------------------------
# Drift honesty (brief drift-honesty.md — MVP-002/007/008): the sweep's
# Walk-3 sequence, pinned. An edited plan names its edits, refuses a
# blind apply, snapshots before a consented one, and the cells API
# shares the workbook's factor law.
# ---------------------------------------------------------------------------


def _edit_frame_cell(client, plan_id: str, value: float) -> None:  # noqa: ANN001
    resp = client.put(
        f"/api/v1/plans/{plan_id}/factor-tables/construction_class/cells",
        json={"cells": {"frame": value, "jm": 1.15}},
    )
    assert resp.status_code == 200, resp.text


def test_edited_plan_is_named_gated_and_snapshotted(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, _ = _built_plan(client, monkeypatch)

    # Pristine: the endpoint and the check agree there is nothing.
    pristine = client.get(f"/api/v1/plans/{plan_id}/edits-since-build").json()
    assert pristine == {
        "edited": False,
        "changes": [],
        "stage_edits": [],
        "note": None,
    }

    # The sweep's edit: a factor cell moves in the app.
    _edit_frame_cell(client, plan_id, 0.85)

    # 1. The fact is itemized, hash-exact.
    edits = client.get(f"/api/v1/plans/{plan_id}/edits-since-build").json()
    assert edits["edited"] is True
    assert {
        "table": "construction_class",
        "field": "frame",
        "workbook": 1.0,
        "yours": 0.85,
    } in edits["changes"]

    # 2. The re-ingest preview of the ORIGINAL workbook shows the edit
    #    as a revert — never "0 changed" silence (MVP-002).
    check = client.post(
        f"/api/v1/plans/{plan_id}/reingest/check",
        content=to_bytes(build_base()),
    ).json()
    assert check["hand_edited_since_build"] is True
    assert check["edits_since_build"]["edited"] is True
    assert any(
        c["field"] == "frame" for c in check["edits_since_build"]["changes"]
    )

    # 3. Apply without consent refuses, naming the edit.
    row = (
        client.app.state.db.connection()
        .execute(
            "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
            (plan_id,),
        )
        .fetchone()
    )
    refused = client.post(
        f"/api/v1/plans/{plan_id}/reingest",
        content=to_bytes(build_base()),
        headers={"If-Match": row["content_hash"]},
    )
    assert refused.status_code == 422, refused.text
    body = refused.json()["error"]
    assert body["code"] == "reingest_would_replace_edits"
    assert "frame" in body["message"]

    # 4. Consent applies, snapshots first, and restores pristine.
    monkeypatch.setattr(
        "openrater.rates.ingest.vectors.score_once",
        _fake_score({"building_premium": 390.0}),
    )
    applied = client.post(
        f"/api/v1/plans/{plan_id}/reingest?replace_edits=true",
        content=to_bytes(build_base()),
        headers={"If-Match": row["content_hash"]},
    )
    assert applied.status_code == 200, applied.text
    snapshots = client.get(f"/api/v1/plans/{plan_id}/snapshots").json()
    names = [
        s.get("display_name", "") for s in (
            snapshots if isinstance(snapshots, list)
            else snapshots.get("snapshots", [])
        )
    ]
    assert any(n.startswith("Before re-ingest") for n in names), names
    after = client.get(f"/api/v1/plans/{plan_id}/edits-since-build").json()
    assert after["edited"] is False


def test_cells_api_shares_the_workbook_factor_law(
    client, monkeypatch  # noqa: ANN001
) -> None:
    plan_id, _ = _built_plan(client, monkeypatch)
    for bad in (-0.5, 0):
        resp = client.put(
            f"/api/v1/plans/{plan_id}/factor-tables/construction_class/cells",
            json={"cells": {"frame": bad, "jm": 1.15}},
        )
        assert resp.status_code == 422, f"{bad}: {resp.text}"
        assert resp.json()["error"]["code"] == "factor_out_of_range"



def test_stage_edits_itemize_and_exports_stamp_divergence(
    client, monkeypatch  # noqa: ANN001
) -> None:
    """FCA fca-2026-07-25 #16 — repairs must travel, or say they
    didn't. Before: a stage-level in-app edit tripped the
    edited-since-build banner with changes=[] and a note claiming the
    change was 'outside what this differ itemizes' (wrong — it names
    the very classes it can't itemize); the export served build-time
    bytes with no divergence stamp; and a what-if built from the
    export silently resurrected the repaired defect. Now the audit
    timeline itemizes the edit, the export stamps the divergence, and
    a check of the stale bytes names the staleness."""
    from tests._helpers import add_stage

    plan_id, _ = _built_plan(client, monkeypatch)
    add_stage(
        client,
        plan_id,
        stage_id="in_extra_flag",
        stage_kind="input_node",
        display_name="Extra flag",
        config_json={
            "name": "extra_flag",
            "data_type": "bool",
            "source": "form",
            "source_path": "extra_flag",
            "required": False,
        },
        outputs=[{
            "output_name": "value",
            "data_type": "string",
            "description": None,
        }],
    )

    # 1. The stage edit is ITEMIZED (audit timeline), not hand-waved.
    edits = client.get(f"/api/v1/plans/{plan_id}/edits-since-build").json()
    assert edits["edited"] is True
    assert edits["changes"] == []  # not a factor-cell edit
    assert len(edits["stage_edits"]) == 1
    assert "in_extra_flag" in edits["stage_edits"][0]
    assert "1 in-app edit" in edits["note"]
    assert "outside what this differ itemizes" not in (edits["note"] or "")

    # 2. The export stamps the divergence on the wire.
    wb = client.get(f"/api/v1/plans/{plan_id}/workbook")
    assert wb.status_code == 200
    assert wb.headers["x-edited-since-build"] == "true"
    assert int(wb.headers["x-edits-since-build-count"]) >= 1

    # 3. Checking those exact bytes names the staleness BY NAME.
    check = client.post(
        "/api/v1/plans/ingest/check", content=wb.content
    ).json()
    ab = check["already_built"]
    assert ab["rating_plan_id"] == plan_id
    assert ab["edited_since_build"] is True
    assert "NOT in these bytes" in ab["edits_note"]
