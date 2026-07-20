# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""ONNX adapter + sandbox tests (Brief 62.5 PR5).

Builds tiny linear .onnx models, ingests them through the SANDBOXED path
(subprocess worker + determinism gate, ADR-0043 D3/D4), and serves
`evaluate`. Skips cleanly when the `[models]` extra (onnx/onnxruntime/numpy)
isn't installed — GLM-only deployments don't carry it.
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

np = pytest.importorskip("numpy")
onnx = pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")
from onnx import TensorProto, helper, numpy_helper  # noqa: E402

BASE = "/api/v1/model-lab/models"


def _linear_onnx(coeffs: dict[str, float], intercept: float, *, with_dropout: bool = False) -> str:
    """A linear ONNX (output = Σ βᵢxᵢ + b) with feature_names metadata,
    base64-encoded. `with_dropout` appends an inference-time Dropout (a
    nondeterministic op) to exercise the determinism gate."""
    names = list(coeffs)
    W = np.array([[coeffs[n]] for n in names], dtype=np.float32)
    B = np.array([intercept], dtype=np.float32)
    inp = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, len(names)])
    out = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 1])
    gemm_out = "output" if not with_dropout else "gemm_out"
    nodes = [helper.make_node("Gemm", ["input", "W", "B"], [gemm_out])]
    if with_dropout:
        nodes.append(helper.make_node("Dropout", ["gemm_out"], ["output"], ratio=0.5))
    graph = helper.make_graph(
        nodes, "linear", [inp], [out],
        [numpy_helper.from_array(W, name="W"), numpy_helper.from_array(B, name="B")],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.metadata_props.append(
        onnx.StringStringEntryProto(key="feature_names", value=",".join(names))
    )
    return base64.b64encode(model.SerializeToString()).decode("ascii")


def _ingest(client: TestClient, onnx_b64: str, model_id: str = "onnx_irpm"):
    return client.post(
        BASE,
        json={
            "model_id": model_id,
            "display_name": "ONNX IRPM",
            "format": "onnx",
            "role": "predictor",
            "output": {"role": "irpm_net"},
            "onnx_base64": onnx_b64,
            "status": "experimental",
        },
    )


def test_ingest_onnx_sandboxed_extracts_schema_and_versions(client: TestClient) -> None:
    r = _ingest(client, _linear_onnx({"stress": -8.0}, 0.0))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"].startswith("v")
    assert body["format"] == "onnx"
    assert [f["name"] for f in body["feature_schema"]] == ["stress"]
    # ONNX isn't client-evaluable → no GLM artifact surfaced.
    assert body["artifact"] is None


def test_evaluate_onnx_matches_the_linear_math(client: TestClient) -> None:
    ver = _ingest(client, _linear_onnx({"stress": -8.0}, 0.0)).json()["version"]
    r = client.post(f"{BASE}/onnx_irpm/versions/{ver}/evaluate", json={"features": {"stress": 0.95}})
    assert r.status_code == 200, r.text
    assert r.json()["output"] == pytest.approx(-7.6, abs=1e-4)  # -8 · 0.95


def test_ingest_onnx_is_idempotent_on_identical_content(client: TestClient) -> None:
    art = _linear_onnx({"stress": -8.0}, 0.0)
    v1 = _ingest(client, art).json()["version"]
    v2 = _ingest(client, art).json()["version"]
    assert v1 == v2


def test_nondeterministic_onnx_rejected_at_ingest(client: TestClient) -> None:
    r = _ingest(client, _linear_onnx({"stress": -8.0}, 0.0, with_dropout=True), model_id="onnx_bad")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "model_nondeterministic"


def test_onnx_missing_artifact_rejected(client: TestClient) -> None:
    r = client.post(
        BASE,
        json={
            "model_id": "onnx_x", "display_name": "x", "format": "onnx",
            "role": "predictor", "output": {"role": "irpm_net"}, "status": "experimental",
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "model_missing_artifact"


def test_registry_lists_glm_and_onnx_together(client: TestClient) -> None:
    _ingest(client, _linear_onnx({"stress": -8.0}, 0.0), model_id="onnx_one")
    client.post(
        BASE,
        json={
            "model_id": "glm_one", "display_name": "GLM", "format": "glm_coeff",
            "role": "predictor", "output": {"role": "irpm_net"},
            "glm": {"coefficients": {"stress": -8}, "intercept": 0, "link": "identity"},
            "status": "experimental",
        },
    )
    formats = {m["model_id"]: m["format"] for m in client.get(BASE).json()["models"]}
    assert formats.get("onnx_one") == "onnx"
    assert formats.get("glm_one") == "glm_coeff"
