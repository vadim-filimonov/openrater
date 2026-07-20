"""The integration wire's Access exemption — WHICH requests skip the operator gate.

The integration seam's machine endpoints (integration-contract §§2–5)
authenticate themselves: the pairing exchange consumes a single-use code, and
descriptor / quote-set / events / catalog-refresh demand
`X-OpenRater-Integration-Key` (`require_integrator` has no open mode). In the demo
deployment those calls arrive from the PEER PLATFORM's server — there is no
browser and no Cloudflare Access session to present — so the operator resolver
must stand aside and let them reach their own auth instead of demanding an
Access JWT they can never carry.

Exact method+path matches ONLY. Everything else under /integrations — create,
list, mint pairing codes, expose/map plans, policies, test-quote, pulse — is
the operator's Hub API and keeps demanding the Access identity. Mind the
catalog twins: PUT (the peer's refresh, key-authed) is on the wire; GET (the
mapper's read) is not.

Edge note: Cloudflare Access Bypass policies are path-prefix grained, so the
dashboard opens the whole `/api/v1/integrations/*` prefix (runbook Part A) —
THIS matcher is what keeps the operator endpoints closed at the app layer
regardless of what the edge lets through.
"""

from __future__ import annotations

import re

# One entry per machine endpoint — the seam's whole machine surface, nothing more.
_WIRE: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("POST", re.compile(r"^/api/v1/integrations/pair$")),
    ("GET", re.compile(r"^/api/v1/integrations/[^/]+/descriptor$")),
    ("POST", re.compile(r"^/api/v1/integrations/[^/]+/quote-set$")),
    ("POST", re.compile(r"^/api/v1/integrations/[^/]+/events$")),
    ("PUT", re.compile(r"^/api/v1/integrations/[^/]+/catalog$")),
)


def is_integration_wire(method: str, path: str) -> bool:
    """True when this request is one of the seam's self-authenticating machine
    endpoints — the resolver then binds the wire sentinel and stands aside."""
    m = method.upper()
    return any(m == verb and rx.match(path) for verb, rx in _WIRE)
