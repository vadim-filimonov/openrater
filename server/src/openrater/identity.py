# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The global risk identity — ADR-0060, Brief 85 §3.

One durable, pseudonymous `risk_id` per risk, minted ONCE at the risk's
first durable touch (in practice by openrater-front) and echoed — never
re-minted — by every other party. Labs never mints: this module only
recognizes.

The wire convention (ADR-0060 rule 2): there is no new wire field. A
`risk_`-prefixed, format-valid `risk_ref` IS the global risk id; anything
else keeps the legacy per-integration scoping byte-for-byte. Validation is
shape-only — the mint spec says UUIDv7, but the seam does not police the
version nibble; the canonical UUID shape is the collision guard.

This module sits at the top level deliberately: both layers that need it
(`integrations/…` and `rates/quotes/…`) may import it without bending the
"integrations → rates, never back" arrow.
"""

from __future__ import annotations

import re

# The canonical shape: `risk_` + lowercase UUID (8-4-4-4-12). Anchored.
RISK_ID_PATTERN = (
    r"^risk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
RISK_ID_RE = re.compile(RISK_ID_PATTERN)


def parse_risk_id(ref: str | None) -> str | None:
    """The seam's recognizer: the global `risk_id` when `ref` follows the
    ADR-0060 convention, else None (legacy per-integration pseudonym).
    Never raises — an odd ref is a scoping choice, not an error."""
    if ref is None:
        return None
    return ref if RISK_ID_RE.fullmatch(ref) else None
