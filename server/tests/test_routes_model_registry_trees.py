# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""XGBoost / LightGBM → ONNX convert-at-ingest tests (Brief 62.5 PR5b; ADR-0043 D2/D3).

A native booster is parsed + converted to ONNX INSIDE the sandbox; the
converted ONNX is stored + served via the SAME pure path as a Tier-A ONNX
model. These tests need the api-lab `[models]` extra (+ xgboost / lightgbm /
onnxmltools) — they skip gracefully when it's absent (CI without the extra).
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

# Tier-B conversion libs — skip the whole module without the [models] extra.
np = pytest.importorskip("numpy")
xgb = pytest.importorskip("xgboost")
lgb = pytest.importorskip("lightgbm")
pytest.importorskip("onnxmltools")

BASE = "/api/v1/model-lab/models"

# Monotone training data: y = x on a single feature. A converted tree model
# must distinguish low vs high x (proving conversion + serving work) without
# us asserting exact leaf values.
_X = np.array([[0.0], [1.0], [2.0], [3.0], [4.0]], dtype=np.float32)
_Y = np.array([0.0, 1.0, 2.0, 3.0, 4.0], dtype=np.float32)

# Pin the input feature name so eval keys are unambiguous.
_FEATURE_SCHEMA = [{"name": "x", "type": "number", "required": True, "description": "the feature"}]


def _xgboost_booster_b64() -> str:
    model = xgb.XGBRegressor(n_estimators=4, max_depth=2, base_score=0.5)
    model.fit(_X, _Y)
    raw = model.get_booster().save_raw("json")  # native JSON booster (bytes/bytearray)
    return base64.b64encode(bytes(raw)).decode("ascii")


def _lightgbm_booster_b64() -> str:
    ds = lgb.Dataset(_X, label=_Y)
    model = lgb.train(
        {"objective": "regression", "num_leaves": 3, "min_data_in_leaf": 1, "verbose": -1},
        ds,
        num_boost_round=4,
    )
    return base64.b64encode(model.model_to_string().encode("utf-8")).decode("ascii")


def _ingest(client: TestClient, fmt: str, booster_b64: str, **overrides: object) -> dict:
    body = {
        "model_id": f"tree_{fmt}",
        "display_name": f"{fmt} regressor",
        "format": fmt,
        "role": "rating_factor",
        "output": {"role": "rating_factor"},
        "booster_base64": booster_b64,
        "feature_schema": _FEATURE_SCHEMA,
        "status": "experimental",
        **overrides,
    }
    return client.post(BASE, json=body)


@pytest.mark.parametrize("fmt", ["xgboost", "lightgbm"])
def test_booster_converts_and_serves(client: TestClient, fmt: str) -> None:
    b64 = _xgboost_booster_b64() if fmt == "xgboost" else _lightgbm_booster_b64()
    r = _ingest(client, fmt, b64)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"].startswith("v")
    assert body["format"] == fmt
    # A converted booster serves via the registry (ONNX) → NOT client-evaluable.
    assert body["artifact"] is None
    assert [f["name"] for f in body["feature_schema"]] == ["x"]

    # Serve the converted ONNX: it must distinguish low vs high x + be cached.
    url = f"{BASE}/tree_{fmt}/versions/{body['version']}/evaluate"
    lo = client.post(url, json={"features": {"x": 0.0}})
    hi = client.post(url, json={"features": {"x": 4.0}})
    assert lo.status_code == 200 and hi.status_code == 200, (lo.text, hi.text)
    lo_out, hi_out = lo.json()["output"], hi.json()["output"]
    assert lo_out == lo_out and hi_out == hi_out  # finite (not NaN)
    assert hi_out > lo_out  # monotone data → high-x prediction exceeds low-x
    # Identical input → snapshot cache hit (deterministic serving).
    assert client.post(url, json={"features": {"x": 4.0}}).json()["cached"] is True


def test_idempotent_on_identical_booster(client: TestClient) -> None:
    b64 = _xgboost_booster_b64()
    v1 = _ingest(client, "xgboost", b64).json()["version"]
    v2 = _ingest(client, "xgboost", b64).json()["version"]
    assert v1 == v2  # same converted ONNX bytes → same content-addressed version


def test_missing_booster_rejected(client: TestClient) -> None:
    r = client.post(
        BASE,
        json={
            "model_id": "tree_x",
            "display_name": "x",
            "format": "xgboost",
            "role": "rating_factor",
            "output": {"role": "rating_factor"},
            "status": "experimental",
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "model_missing_artifact"
