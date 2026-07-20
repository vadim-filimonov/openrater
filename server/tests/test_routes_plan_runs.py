# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-run endpoints (Brief 75, v4 P3) — the Run zone's substrate.

The scoring delegation is stubbed at the `score_once` seam (the same
philosophy as the portfolio scoring tests): these tests pin the
ORCHESTRATION — substrate composition, provenance pinning, append-only
persistence, honest failures — not the engine (the conformance suites
own that).
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan

SAMPLE_RESULT: dict[str, Any] = {
    "outputs": {"total_premium": 4731},
    "views": {"premium": 4731, "perCoverage": {}, "tier": "standard"},
    "as_of": "2026-07-06",
    "durationMs": 3,
    "row_status": "ok",
    "composed": {"subtotal": 5085, "final": 4731, "adjustments": []},
}


def _stub_scoring(monkeypatch: Any, result: dict[str, Any]) -> list[dict[str, Any]]:
    """Capture the outgoing scoring request; return a canned response."""
    calls: list[dict[str, Any]] = []

    def fake_score_once(*, request: dict[str, Any], base_url: str | None = None):
        calls.append(request)
        return result

    monkeypatch.setattr(
        "openrater.rates.runs.service.score_once", fake_score_once
    )
    return calls


def test_sample_run_persists_the_filed_premium(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    calls = _stub_scoring(monkeypatch, SAMPLE_RESULT)

    res = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "sample", "inputs": {"class_code": "62114"}},
    )
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["kind"] == "sample"
    assert run["status"] == "done"
    # The persisted record IS the scoring service's honest response.
    assert run["result"]["views"]["premium"] == 4731
    assert run["result"]["composed"]["final"] == 4731
    assert run["result"]["row_status"] == "ok"
    # Provenance: the draft's content hash is pinned.
    assert run["plan_content_hash"]

    # The outgoing request shipped the plan's OWN substrate.
    assert len(calls) == 1
    assert calls[0]["source"] == "plan_stages"
    assert calls[0]["inputs"] == {"class_code": "62114"}

    # …and the run survives: list + detail read the same record.
    listed = client.get(f"/api/v1/plans/{plan_id}/runs").json()["runs"]
    assert [r["run_id"] for r in listed] == [run["run_id"]]
    assert listed[0]["headline"]["premium"] == 4731
    assert listed[0]["headline"]["row_status"] == "ok"

    detail = client.get(
        f"/api/v1/plans/{plan_id}/runs/{run['run_id']}"
    ).json()
    assert detail["result"]["views"]["premium"] == 4731


def test_sample_run_requires_inputs(client: TestClient) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    res = client.post(
        f"/api/v1/plans/{plan_id}/runs", json={"kind": "sample"}
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "missing_inputs"


def test_book_run_without_a_book_refuses(client: TestClient) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    res = client.post(f"/api/v1/plans/{plan_id}/runs", json={"kind": "book"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "no_book"


def test_book_run_submits_and_lazily_finalizes(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    # Connect a tiny book (mapping envelope with raw rows + grouping).
    put = client.put(
        f"/api/v1/plans/{plan_id}/inputs-mapping",
        json={
            "mapping": {
                "source": {
                    "kind": "csv",
                    "columns": ["pol", "loc", "x"],
                    "sample_rows": [
                        {"pol": "P-1", "loc": "L1", "x": "1"},
                        {"pol": "P-1", "loc": "L2", "x": "1"},
                    ],
                },
                "column_map": {},
                "grouping_config": {
                    "policy_id_column": "pol",
                    "location_id_column": "loc",
                },
                "rollup_fields": [
                    {"fieldName": "total_premium", "reducer": "sum"}
                ],
            }
        },
    )
    assert put.status_code in (200, 201), put.text

    captured: list[dict[str, Any]] = []

    def fake_submit(*, request: dict[str, Any], base_url: str | None = None):
        captured.append(request)
        return "job_test_1"

    monkeypatch.setattr(
        "openrater.rates.runs.service.submit_batch", fake_submit
    )
    res = client.post(f"/api/v1/plans/{plan_id}/runs", json={"kind": "book"})
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["kind"] == "book"
    assert run["status"] == "running"
    assert run["job_id"] == "job_test_1"
    assert run["request"] == {"row_count": 2, "grouped": True}
    # The submitted request ships RAW rows + the book bag + policy scope.
    assert captured[0]["rows"] == [
        {"pol": "P-1", "loc": "L1", "x": "1"},
        {"pol": "P-1", "loc": "L2", "x": "1"},
    ]
    assert captured[0]["book"]["grouping"]["policy_id_column"] == "pol"
    assert captured[0]["projectorOptions"] == {"minPremiumScope": "policy"}

    # Lazy finalize: the job finished with a summary → GET flips to done.
    summary = {
        "row_count": 2,
        "grouped": True,
        "totals": {"written": 500, "declined_indicative": 0, "error_rows": 0},
        "rows": [],
        "policies": [
            {
                "policy_id": "P-1",
                "location_count": 2,
                "premium": 500,
                "tier": "standard",
            }
        ],
    }

    def fake_state(*, job_id: str, base_url: str | None = None):
        return {"status": "succeeded", "summary": summary}

    monkeypatch.setattr(
        "openrater.rates.runs.service.fetch_batch_state", fake_state
    )
    detail = client.get(
        f"/api/v1/plans/{plan_id}/runs/{run['run_id']}"
    ).json()
    assert detail["status"] == "done"
    assert detail["result"]["totals"]["written"] == 500
    listed = client.get(f"/api/v1/plans/{plan_id}/runs").json()["runs"]
    assert listed[0]["headline"]["totals"]["written"] == 500


def test_adhoc_book_run_scores_caller_rows_as_a_book(
    client: TestClient, monkeypatch: Any
) -> None:
    """A CSV handed to the chat door is a real book:
    `kind: book` + `rows` scores through the batch path with an
    identity column map and lands in history as a book (never a
    probe), rows independent (row-scoped floor)."""
    plan_id = create_plan(client)["rating_plan_id"]
    captured: list[dict[str, Any]] = []

    def fake_submit(*, request: dict[str, Any], base_url: str | None = None):
        captured.append(request)
        return "job_adhoc_1"

    monkeypatch.setattr(
        "openrater.rates.runs.service.submit_batch", fake_submit
    )
    res = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={
            "kind": "book",
            "rows": [
                {"class_code": "c101", "tiv": 250000},
                {"class_code": "c999", "tiv": 80000},
            ],
        },
    )
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["kind"] == "book"
    assert run["status"] == "running"
    assert run["request"] == {"row_count": 2, "adhoc": True}
    # Identity projection over the caller's own keys; row-scoped floor.
    assert captured[0]["book"]["column_map"] == {
        "class_code": "class_code",
        "tiv": "tiv",
    }
    assert captured[0]["projectorOptions"] == {"minPremiumScope": "row"}
    assert captured[0]["rows"][0] == {"class_code": "c101", "tiv": "250000"}

    # The cap is named.
    too_many = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "book", "rows": [{"x": 1}] * 5001},
    )
    assert too_many.status_code == 422
    assert too_many.json()["error"]["code"] == "too_many_rows"


def test_runs_404_on_unknown_plan_and_run(client: TestClient) -> None:
    assert (
        client.get("/api/v1/plans/nope/runs").status_code == 404
    )
    plan_id = create_plan(client)["rating_plan_id"]
    res = client.get(f"/api/v1/plans/{plan_id}/runs/run_nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "run_not_found"
    # audit A-2026-07-12 P1-18: the /rows sibling must ALSO 404 (it used
    # to 422 for the same run_not_found condition).
    rows = client.get(f"/api/v1/plans/{plan_id}/runs/run_nope/rows")
    assert rows.status_code == 404
    assert rows.json()["error"]["code"] == "run_not_found"


def test_error_rows_persist_the_refusal_not_a_number(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    refusal = {
        "outputs": {},
        "views": {"premium": None, "perCoverage": {}, "tier": None},
        "as_of": "2026-07-06",
        "durationMs": 2,
        "row_status": "error",
        "rowIssues": [
            {
                "severity": "error",
                "code": "unknown_key",
                "nodeId": "lk_x",
                "message": "Cannot rate: key `99999` not found in `class_rel`.",
            }
        ],
    }
    _stub_scoring(monkeypatch, refusal)
    res = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "sample", "inputs": {"class_code": "99999"}},
    )
    assert res.status_code == 201
    run = res.json()
    assert run["status"] == "done"  # the RUN succeeded; the ROW refused
    assert run["result"]["row_status"] == "error"
    assert run["result"]["views"]["premium"] is None
    listed = client.get(f"/api/v1/plans/{plan_id}/runs").json()["runs"]
    assert listed[0]["headline"]["row_status"] == "error"
    assert listed[0]["headline"]["premium"] is None


def test_run_rows_page_relays_the_result_store(
    client: TestClient, monkeypatch: Any
) -> None:
    """Phase 4 — GET /runs/{id}/rows relays a DONE book run's per-row
    page (projected inputs + outputs + verdict) from the scoring
    store; guards refuse sample runs + unfinished runs by name."""
    plan_id = create_plan(client)["rating_plan_id"]
    client.put(
        f"/api/v1/plans/{plan_id}/inputs-mapping",
        json={
            "mapping": {
                "source": {
                    "kind": "csv",
                    "columns": ["pol"],
                    "sample_rows": [{"pol": "P-1"}],
                },
                "column_map": {},
            }
        },
    )
    monkeypatch.setattr(
        "openrater.rates.runs.service.submit_batch",
        lambda *, request, base_url=None: "job_rows_1",
    )
    run_id = client.post(
        f"/api/v1/plans/{plan_id}/runs", json={"kind": "book"}
    ).json()["run_id"]

    # Still running → named refusal, never an empty 200.
    res = client.get(f"/api/v1/plans/{plan_id}/runs/{run_id}/rows")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "run_not_done"

    # Finalize via the lazy GET…
    monkeypatch.setattr(
        "openrater.rates.runs.service.fetch_batch_state",
        lambda *, job_id, base_url=None: {
            "status": "succeeded",
            "summary": {"row_count": 1, "grouped": False, "totals": {}},
        },
    )
    client.get(f"/api/v1/plans/{plan_id}/runs/{run_id}")

    # …then the rows page relays the store verbatim.
    page = {
        "rows": [
            {
                "inputs": {"class_code": "0912"},
                "outputs": {"total_premium": 140},
                "views": {"premium": 140, "tier": "standard"},
                "row_status": "ok",
            }
        ],
        "total": 1,
        "offset": 0,
        "nextOffset": None,
    }
    monkeypatch.setattr(
        "openrater.rates.runs.scoring.httpx.get",
        lambda url, params=None, timeout=None: type(
            "R", (), {"status_code": 200, "json": lambda self: page}
        )(),
    )
    res = client.get(f"/api/v1/plans/{plan_id}/runs/{run_id}/rows")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["rows"][0]["inputs"] == {"class_code": "0912"}
    assert body["rows"][0]["outputs"]["total_premium"] == 140


def test_run_rows_refuses_sample_runs(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    _stub_scoring(monkeypatch, SAMPLE_RESULT)
    run_id = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "sample", "inputs": {"a": 1}},
    ).json()["run_id"]
    res = client.get(f"/api/v1/plans/{plan_id}/runs/{run_id}/rows")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "not_a_book_run"


def test_probe_run_requires_rows(client: TestClient) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    res = client.post(f"/api/v1/plans/{plan_id}/runs", json={"kind": "probe"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "missing_rows"


def test_probe_run_caps_the_sweep(client: TestClient) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    res = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "probe", "rows": [{"x": i} for i in range(2001)]},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "too_many_rows"


def test_probe_run_rides_the_book_path_with_identity_projection(
    client: TestClient, monkeypatch: Any
) -> None:
    """Brief 89 §3.2 B3 — a probe run ships the client-built sweep as
    CSV-shaped strings under an identity column map (the sweep's keys
    ARE the runtime input keys), row-scoped, trace off; it needs NO
    connected book; and it stays out of the kind='book' lens the real
    exhibits query."""
    plan_id = create_plan(client)["rating_plan_id"]

    captured: list[dict[str, Any]] = []

    def fake_submit(*, request: dict[str, Any], base_url: str | None = None):
        captured.append(request)
        return "job_probe_1"

    monkeypatch.setattr(
        "openrater.rates.runs.service.submit_batch", fake_submit
    )
    res = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={
            "kind": "probe",
            "rows": [
                {"base": 1000, "cls": "fr", "sprinkled": True},
                {"base": 2000.0, "cls": "jm", "roof_age": None},
            ],
        },
    )
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["kind"] == "probe"
    assert run["status"] == "running"
    assert run["job_id"] == "job_probe_1"
    assert run["request"] == {"row_count": 2, "probe": True}
    assert run["plan_content_hash"]

    # The wire rows are the CSV-string shape the book projection layer
    # coerces (raw JSON numbers would crash the worker); None drops the
    # key (missing input, engine semantics).
    assert captured[0]["rows"] == [
        {"base": "1000", "cls": "fr", "sprinkled": "true"},
        {"base": "2000", "cls": "jm"},
    ]
    assert captured[0]["book"] == {
        "column_map": {"base": "base", "cls": "cls", "sprinkled": "sprinkled"}
    }
    assert captured[0]["projectorOptions"] == {"minPremiumScope": "row"}
    assert captured[0]["trace"] == "none"

    # Exclusion by kind: the real-book lens never sees the probe…
    books = client.get(
        f"/api/v1/plans/{plan_id}/runs", params={"kind": "book"}
    ).json()["runs"]
    assert books == []
    # …and the probe lens sees exactly it.
    probes = client.get(
        f"/api/v1/plans/{plan_id}/runs", params={"kind": "probe"}
    ).json()["runs"]
    assert [r["run_id"] for r in probes] == [run["run_id"]]

    # Lazy finalize + the rows page (allowed for probe runs).
    summary = {
        "row_count": 2,
        "grouped": False,
        "totals": {
            "written": 3100,
            "declined_indicative": 0,
            "error_rows": 0,
            "row_count": 2,
        },
        "rows": [],
    }
    monkeypatch.setattr(
        "openrater.rates.runs.service.fetch_batch_state",
        lambda *, job_id, base_url=None: {
            "status": "succeeded",
            "summary": summary,
        },
    )
    detail = client.get(
        f"/api/v1/plans/{plan_id}/runs/{run['run_id']}"
    ).json()
    assert detail["status"] == "done"
    assert detail["result"]["totals"]["written"] == 3100

    page = {
        "rows": [
            {
                "inputs": {"base": 1000, "cls": "fr", "sprinkled": True},
                "outputs": {"premium": 1379},
                "row_status": "ok",
            }
        ],
        "total": 1,
        "offset": 0,
        "nextOffset": None,
    }
    monkeypatch.setattr(
        "openrater.rates.runs.scoring.httpx.get",
        lambda url, params=None, timeout=None: type(
            "R", (), {"status_code": 200, "json": lambda self: page}
        )(),
    )
    rows_res = client.get(f"/api/v1/plans/{plan_id}/runs/{run['run_id']}/rows")
    assert rows_res.status_code == 200, rows_res.text
    assert rows_res.json()["rows"][0]["outputs"]["premium"] == 1379


def test_runs_pin_the_client_scoring_fingerprint(
    client: TestClient, monkeypatch: Any
) -> None:
    """ADR-0064 — a run stores the CLIENT-attested scoring fingerprint
    verbatim (opaque; it covers the factor-table cells that
    plan_content_hash, per ADR-0015, cannot see) and echoes it on the
    201, the detail GET, and the list summaries. Runs created without
    one — older records, non-browser API consumers — stay None, and the
    staleness surfaces fall back to the content-hash grammar."""
    plan_id = create_plan(client)["rating_plan_id"]
    _stub_scoring(monkeypatch, SAMPLE_RESULT)

    # Sample path (sync insert).
    res = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={
            "kind": "sample",
            "inputs": {"class_code": "62114"},
            "scoring_fingerprint": "1a2b3c4d",
        },
    )
    assert res.status_code == 201, res.text
    sample = res.json()
    assert sample["scoring_fingerprint"] == "1a2b3c4d"
    # …independent of the content hash, which is also still pinned.
    assert sample["plan_content_hash"]

    # Probe path (batch insert — the surface that found the blind spot).
    monkeypatch.setattr(
        "openrater.rates.runs.service.submit_batch",
        lambda *, request, base_url=None: "job_fp_probe",
    )
    probe = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={
            "kind": "probe",
            "rows": [{"x": 1}],
            "scoring_fingerprint": "9z8y7x",
        },
    ).json()
    assert probe["scoring_fingerprint"] == "9z8y7x"

    # Book path (batch insert with a connected book).
    client.put(
        f"/api/v1/plans/{plan_id}/inputs-mapping",
        json={
            "mapping": {
                "source": {
                    "kind": "csv",
                    "columns": ["pol"],
                    "sample_rows": [{"pol": "P-1"}],
                },
                "column_map": {},
            }
        },
    )
    book = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "book", "scoring_fingerprint": "b00kfp"},
    ).json()
    assert book["scoring_fingerprint"] == "b00kfp"

    # Detail + list summaries both carry the pin.
    detail = client.get(
        f"/api/v1/plans/{plan_id}/runs/{sample['run_id']}"
    ).json()
    assert detail["scoring_fingerprint"] == "1a2b3c4d"
    listed = client.get(f"/api/v1/plans/{plan_id}/runs").json()["runs"]
    by_id = {r["run_id"]: r for r in listed}
    assert by_id[sample["run_id"]]["scoring_fingerprint"] == "1a2b3c4d"
    assert by_id[probe["run_id"]]["scoring_fingerprint"] == "9z8y7x"
    assert by_id[book["run_id"]]["scoring_fingerprint"] == "b00kfp"

    # Omitting it is legal and stays None (content-hash fallback).
    bare = client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "sample", "inputs": {"class_code": "62114"}},
    ).json()
    assert bare["scoring_fingerprint"] is None


def test_list_runs_filters_by_kind_and_status(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    _stub_scoring(monkeypatch, SAMPLE_RESULT)
    client.post(
        f"/api/v1/plans/{plan_id}/runs",
        json={"kind": "sample", "inputs": {"a": 1}},
    )
    client.put(
        f"/api/v1/plans/{plan_id}/inputs-mapping",
        json={
            "mapping": {
                "source": {
                    "kind": "csv",
                    "columns": ["pol"],
                    "sample_rows": [{"pol": "P-1"}],
                },
                "column_map": {},
            }
        },
    )
    monkeypatch.setattr(
        "openrater.rates.runs.service.submit_batch",
        lambda *, request, base_url=None: "job_filter_1",
    )
    client.post(f"/api/v1/plans/{plan_id}/runs", json={"kind": "book"})

    both = client.get(f"/api/v1/plans/{plan_id}/runs").json()["runs"]
    assert len(both) == 2
    books = client.get(
        f"/api/v1/plans/{plan_id}/runs", params={"kind": "book"}
    ).json()["runs"]
    assert [r["kind"] for r in books] == ["book"]
    done_books = client.get(
        f"/api/v1/plans/{plan_id}/runs",
        params={"kind": "book", "status": "done"},
    ).json()["runs"]
    assert done_books == []
