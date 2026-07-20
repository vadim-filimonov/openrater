# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Content-addressable plan hashing — ADR-0015.

Every persisted plan is referenced by a stable content hash. Same plan
content = same hash, regardless of when or by whom it was written.

Hash format: 16-character hex prefix of the SHA-256 digest of the
canonical JSON encoding of the plan's content.

16 hex chars = 64 bits of entropy ≈ 10^19 unique values. The probability
of collision across 10^6 plans is ~10^-13. Shorter strings are easier to
grep, scan, embed in URLs, and copy/paste during debug.

What's hashed: the plan's semantic identity (rating_plan_id, display_name,
line_of_business, product, jurisdiction, effective_date, description,
parent chain, template_id, coverages, section_layout, all stages). NOT
hashed: lifecycle metadata (created_at, last_edited_at, status,
content_hash itself, draft_session_id). (`product` joined the hash in
ADR-0033 — a one-time re-hash for existing plans, which self-heal on
their next edit via recompute_content_hash.)

Canonicalization: `json.dumps(obj, sort_keys=True, separators=(",", ":"),
ensure_ascii=False)`. Approximates RFC 8785.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

# Hash output length. 16 chars = 64 bits. See module docstring.
HASH_LENGTH = 16


def canonical_json(obj: Any) -> str:
    """Canonical JSON encoding of `obj`. Same input → same output."""
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def hash_content(obj: Any) -> str:
    """Content hash of an arbitrary JSON-serializable object.

    Returns a 16-char hex string (lowercase). Stable across machines +
    Python versions + UTC offsets.
    """
    canonical = canonical_json(obj)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest[:HASH_LENGTH]


def hash_plan(plan_content: dict[str, Any]) -> str:
    """Compute the content hash of a plan.

    Lifecycle fields are stripped before hashing — they're metadata,
    not content. Returns the 16-char hex hash.
    """
    content_only = _strip_lifecycle_fields(plan_content)
    return hash_content(content_only)


# ----------------------------------------------------------------
# Internal helpers
# ----------------------------------------------------------------

_LIFECYCLE_FIELDS = frozenset(
    {
        "created_at",
        "last_edited_at",
        "status",
        "content_hash",
        "draft_session_id",
    }
)


def _strip_lifecycle_fields(plan_content: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of `plan_content` with lifecycle fields removed."""
    return {k: v for k, v in plan_content.items() if k not in _LIFECYCLE_FIELDS}
