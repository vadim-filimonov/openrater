"""The deploy overlay's SPA fallback (openrater_deploy.app · _SPAStaticFiles).

The demo box serves the built Rate Lab SPA and the API from ONE origin.
The SPA uses BrowserRouter, so a hard refresh or deep link to /rate-lab
(or any client route) reaches the server as a real GET — the static mount
must answer with index.html, not a 404.

The regression this pins: Starlette signals a missing file by RAISING
HTTPException(404), not by returning a 404 response. The original fallback
inspected `response.status_code` and therefore never fired — every deep
refresh on the demo box surfaced FastAPI's `{"detail":"Not Found"}`.

Also pinned: the two carve-outs that keep honest 404s honest — unknown
/api/* paths stay JSON 404s for machine callers, and a missing hashed
/assets/* bundle stays a 404 instead of masquerading as HTML.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

_OVERLAY = str(Path(__file__).resolve().parents[2] / "deploy" / "overlay")
if _OVERLAY not in sys.path:
    sys.path.insert(0, _OVERLAY)

INDEX_SENTINEL = "<!doctype html><title>rater-spa-index</title>"
ASSET_SENTINEL = "console.log('rater-spa-asset')"


@pytest.fixture()
def spa_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """The overlay app booted in RATER_AUTH_MODE=none over a stub SPA dir
    (index.html + one hashed asset), against a scratch db. Imported fresh so
    the module-level env reads see this configuration."""
    from fastapi.testclient import TestClient

    spa_dir = tmp_path / "spa"
    (spa_dir / "assets").mkdir(parents=True)
    (spa_dir / "index.html").write_text(INDEX_SENTINEL)
    (spa_dir / "assets" / "app-abc123.js").write_text(ASSET_SENTINEL)

    monkeypatch.setenv("RATER_AUTH_MODE", "none")
    monkeypatch.setenv("RATER_SPA_DIR", str(spa_dir))
    monkeypatch.setenv("RATER_DB_PATH", str(tmp_path / "spa.db"))
    monkeypatch.setenv("RATER_SEED_COLD_TEST", "0")
    sys.modules.pop("openrater_deploy.app", None)
    mod = importlib.import_module("openrater_deploy.app")
    try:
        with TestClient(mod.app) as client:
            yield client
    finally:
        # Importing the overlay registered its resolver GLOBALLY — restore the
        # core's stub so later tests are unaffected.
        from openrater.auth import reset_operator_resolver

        reset_operator_resolver()
        sys.modules.pop("openrater_deploy.app", None)


def test_root_serves_index(spa_client) -> None:
    r = spa_client.get("/")
    assert r.status_code == 200
    assert INDEX_SENTINEL in r.text


@pytest.mark.parametrize(
    "path",
    [
        "/rate-lab",  # the reported symptom: refresh -> {"detail":"Not Found"}
        "/exhibits",
        "/rate-lab/plan_abc/workspace/assemble",
        "/integrations/int_abc123",
    ],
)
def test_deep_link_refresh_serves_index(spa_client, path: str) -> None:
    r = spa_client.get(path)
    assert r.status_code == 200, f"deep link {path} must fall back to index.html"
    assert INDEX_SENTINEL in r.text
    assert r.headers["content-type"].startswith("text/html")


def test_real_asset_is_served(spa_client) -> None:
    r = spa_client.get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert ASSET_SENTINEL in r.text


def test_missing_asset_stays_404(spa_client) -> None:
    # A stale-cached index.html referencing a gone bundle must fail loudly,
    # not receive index.html re-labeled as JavaScript.
    r = spa_client.get("/assets/app-gone999.js")
    assert r.status_code == 404
    assert INDEX_SENTINEL not in r.text


def test_unknown_api_path_stays_json_404(spa_client) -> None:
    r = spa_client.get("/api/v1/nonexistent")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert INDEX_SENTINEL not in r.text


def test_health_still_wins_over_the_mount(spa_client) -> None:
    r = spa_client.get("/health")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
