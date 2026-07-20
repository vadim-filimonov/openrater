"""The deploy overlay's integration-wire exemption (openrater_deploy.wire · runbook Part A).

The demo deployment gates every request behind Cloudflare Access — but the
seam's five machine endpoints (contract §§2–5) are called by the PEER
PLATFORM's server, which can never present an Access JWT. The overlay
resolver stands aside for exactly those method+path pairs so their OWN auth
runs (single-use pairing code / X-OpenRater-Integration-Key); every operator
endpoint — including the catalog GET twin of the wire's PUT — keeps
demanding the Access identity.

Two layers proven here: the pure matcher (exact, method-aware, nothing but
the five), and the composed overlay app in REAL cloudflare mode — a wire
call reaches route auth and is refused by the KEY check, an operator call
dies at the door asking for the token.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

_OVERLAY = str(Path(__file__).resolve().parents[2] / "deploy" / "overlay")
if _OVERLAY not in sys.path:
    sys.path.insert(0, _OVERLAY)

from openrater_deploy.wire import is_integration_wire  # noqa: E402, I001


# ── the matcher: the seam's whole machine surface, nothing more ──

WIRE = [
    ("POST", "/api/v1/integrations/pair"),
    ("GET", "/api/v1/integrations/int_abc123/descriptor"),
    ("POST", "/api/v1/integrations/int_abc123/quote-set"),
    ("POST", "/api/v1/integrations/int_abc123/events"),
    ("PUT", "/api/v1/integrations/int_abc123/catalog"),
]

OPERATOR = [
    ("POST", "/api/v1/integrations"),  # create
    ("GET", "/api/v1/integrations"),  # Hub home
    ("GET", "/api/v1/integrations/int_abc123"),  # detail
    ("POST", "/api/v1/integrations/int_abc123/pairing-codes"),  # mint
    ("GET", "/api/v1/integrations/int_abc123/plans"),  # exposed plans
    ("POST", "/api/v1/integrations/int_abc123/plans"),  # expose
    ("GET", "/api/v1/integrations/int_abc123/catalog"),  # the mapper's read — PUT's twin
    ("POST", "/api/v1/integrations/int_abc123/plans/ep_1/test-quote"),
    ("GET", "/api/v1/integrations/int_abc123/pulse"),
]


def test_the_five_wire_endpoints_match() -> None:
    for method, path in WIRE:
        assert is_integration_wire(method, path), f"{method} {path} must ride the wire"


def test_operator_endpoints_never_match() -> None:
    for method, path in OPERATOR:
        assert not is_integration_wire(method, path), f"{method} {path} must demand Access"


def test_method_twins_and_shape_are_exact() -> None:
    # the catalog twins: the peer's PUT rides; the mapper's GET does not —
    # and no other verb sneaks through on a wire path.
    assert is_integration_wire("put", "/api/v1/integrations/int_x/catalog")  # case-blind
    assert not is_integration_wire("POST", "/api/v1/integrations/int_x/descriptor")
    assert not is_integration_wire("GET", "/api/v1/integrations/pair")
    # exact shape: no trailing segments, no missing mount prefix
    assert not is_integration_wire("POST", "/api/v1/integrations/int_x/quote-set/extra")
    assert not is_integration_wire("POST", "/integrations/pair")


# ── the composed overlay, real cloudflare mode ──


@pytest.fixture()
def wire_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """The overlay app booted in RATER_AUTH_MODE=cloudflare against a scratch
    db (no network: the JWKS client is lazy and no wire test presents a JWT).
    Imported fresh so the module-level mode/env reads see this configuration."""
    pytest.importorskip("jwt", reason="PyJWT[crypto] — the overlay's dependency (dev group)")
    from fastapi.testclient import TestClient

    monkeypatch.setenv("RATER_AUTH_MODE", "cloudflare")
    monkeypatch.setenv("RATER_CF_ACCESS_TEAM_DOMAIN", "example.cloudflareaccess.com")
    monkeypatch.setenv("RATER_CF_ACCESS_AUD", "a" * 64)
    monkeypatch.setenv("RATER_DB_PATH", str(tmp_path / "wire.db"))
    monkeypatch.setenv("RATER_SEED_COLD_TEST", "0")
    sys.modules.pop("openrater_deploy.app", None)
    mod = importlib.import_module("openrater_deploy.app")
    try:
        with TestClient(mod.app) as client:
            yield client
    finally:
        # Importing the overlay registered its resolver GLOBALLY — restore the
        # core's stub or every later test's operator calls demand a JWT.
        from openrater.auth import reset_operator_resolver

        reset_operator_resolver()
        sys.modules.pop("openrater_deploy.app", None)


def test_wire_calls_reach_their_own_auth(wire_client) -> None:
    # A bogus pairing exchange gets the SEAM's refusal, not Cloudflare's door.
    r = wire_client.post(
        "/api/v1/integrations/pair",
        json={"code": "RATE-XXXX-XXXX-XXXX", "peer_name": "test-peer", "catalog": []},
    )
    assert r.status_code in (400, 401, 404)
    assert "Cloudflare" not in r.text

    # A bogus integrator key gets the KEY refusal — the middleware stood aside.
    r = wire_client.get(
        "/api/v1/integrations/int_nope/descriptor",
        headers={"X-OpenRater-Integration-Key": "bogus"},
    )
    assert r.status_code in (401, 404)
    assert "Cloudflare" not in r.text


def test_operator_calls_still_die_at_the_door(wire_client) -> None:
    for method, path in [
        ("GET", "/api/v1/integrations"),  # the Hub home
        ("GET", "/api/v1/integrations/int_nope/catalog"),  # the wire PUT's operator twin
        ("POST", "/api/v1/integrations/int_nope/pairing-codes"),  # minting stays human
    ]:
        r = wire_client.request(method, path)
        assert r.status_code == 401, f"{method} {path} must demand the Access token"
        assert "Cloudflare Access token" in r.text
