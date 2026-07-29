# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""API-key orchestration + the quote gate (Brief 76, v4 P4.2).

Mint generates a random secret, hashes it (SHA-256), and stores only the
hash + a display prefix — the secret is returned ONCE and is thereafter
unrecoverable. Verification hashes the presented `X-API-Key` and looks it
up among the plan's non-revoked keys.

The gate (`authorize_quote`) is deliberately permissive by default: OpenRater
Labs ships open (OSS/dev), so a quote succeeds with no key UNLESS
`RATER_QUOTE_REQUIRE_KEY` is set. When it is, a valid key is
mandatory (401 without). Either way, a presented valid key is verified +
attributed. This mirrors the `auth.py` shim — open by default, locked by
config, never by a fork.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timezone

from openrater.errors import UnauthorizedError
from openrater.persistence.db import Database
from openrater.rates.api_keys.models import ApiKeyCreated, ApiKeySummary
from openrater.rates.api_keys.repo import (
    find_active_key,
    insert_api_key,
    list_api_keys,
    revoke_api_key,
    touch_last_used,
)

_SECRET_SCHEME = "rater_live_"
_PREFIX_LEN = 16  # "rater_live_" + 6 chars — enough to recognize, not to guess.


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def quote_key_required() -> bool:
    """Whether the quote endpoint DEMANDS a key (env-gated; default off)."""
    return os.environ.get("RATER_QUOTE_REQUIRE_KEY", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def mint_api_key(
    *,
    db: Database,
    rating_plan_id: str,
    label: str | None,
    created_by: str | None,
) -> ApiKeyCreated:
    """Generate + persist a key. The returned `secret` is the ONLY copy
    the caller will ever see — the server keeps only its hash."""
    secret = _SECRET_SCHEME + secrets.token_urlsafe(32)
    key_id = "klk_" + secrets.token_hex(8)
    created_at = _now_iso()
    insert_api_key(
        db=db,
        key_id=key_id,
        rating_plan_id=rating_plan_id,
        key_hash=_hash_secret(secret),
        secret_prefix=secret[:_PREFIX_LEN],
        label=label,
        created_at=created_at,
        created_by=created_by,
    )
    return ApiKeyCreated(
        key_id=key_id,
        rating_plan_id=rating_plan_id,
        secret_prefix=secret[:_PREFIX_LEN],
        label=label,
        created_at=created_at,
        created_by=created_by,
        last_used_at=None,
        revoked_at=None,
        secret=secret,
    )


def list_keys(*, db: Database, rating_plan_id: str) -> list[ApiKeySummary]:
    return list_api_keys(db=db, rating_plan_id=rating_plan_id)


def revoke_key(*, db: Database, rating_plan_id: str, key_id: str) -> bool:
    return revoke_api_key(
        db=db, rating_plan_id=rating_plan_id, key_id=key_id, when=_now_iso()
    )


def verify_key(
    *, db: Database, rating_plan_id: str, secret: str
) -> ApiKeySummary | None:
    """Return the active key matching the presented secret (+ touch its
    last-used stamp), or None. Constant-work hash + a scoped lookup."""
    if not secret:
        return None
    match = find_active_key(
        db=db, rating_plan_id=rating_plan_id, key_hash=_hash_secret(secret)
    )
    if match is not None:
        touch_last_used(db=db, key_id=match.key_id, when=_now_iso())
    return match


def authorize_quote(
    *,
    db: Database,
    rating_plan_id: str,
    presented_key: str | None,
    operator_authenticated: bool = False,
) -> ApiKeySummary | None:
    """The quote gate (D-D). Open by default (OSS/dev) — a key is optional
    and, when presented, verified + attributed. When
    `RATER_QUOTE_REQUIRE_KEY` is set, a caller MUST present a valid
    `X-API-Key` OR arrive on an authenticated operator session (the in-app
    try-it — the browser is already an operator behind the deploy's auth
    proxy); otherwise 401. An invalid/revoked key always fails closed."""
    key = (presented_key or "").strip()
    verified = (
        verify_key(db=db, rating_plan_id=rating_plan_id, secret=key)
        if key
        else None
    )
    if not quote_key_required():
        return verified  # open: a key is optional, still attributed when valid.
    if verified is not None:
        return verified
    if operator_authenticated:
        return None  # in-app try-it via the operator session — allowed.
    raise UnauthorizedError(
        "This quote endpoint requires a valid API key. Send it as the "
        "`X-API-Key` header; mint one at POST /plans/{id}/api-keys.",
        code="quote_key_required",
    )
