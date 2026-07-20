# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The risk-identity recognizer (ADR-0060 rule 2).

Shape-only, anchored, never raises: a `risk_`-prefixed canonical UUID is
the global id; everything else — including near-misses — is a legacy
per-integration pseudonym. The near-miss cases matter most: a ref that
LOOKS global but isn't must scope legacy, never unify."""

from __future__ import annotations

from openrater.identity import parse_risk_id

_VALID = "risk_01981e6e-7c2a-7f3b-9d41-a2b6c9e0f412"


def test_valid_risk_id_is_recognized() -> None:
    assert parse_risk_id(_VALID) == _VALID


def test_none_and_legacy_refs_pass_through_as_none() -> None:
    assert parse_risk_id(None) is None
    assert parse_risk_id("r-ev-0001") is None
    assert parse_risk_id("sub_9f31c2") is None


def test_near_misses_stay_legacy() -> None:
    # wrong prefix
    assert parse_risk_id("RISK_01981e6e-7c2a-7f3b-9d41-a2b6c9e0f412") is None
    # uppercase hex — canonical form is lowercase
    assert parse_risk_id("risk_01981E6E-7c2a-7f3b-9d41-a2b6c9e0f412") is None
    # truncated tail
    assert parse_risk_id("risk_01981e6e-7c2a-7f3b-9d41-a2b6c9e0f41") is None
    # trailing garbage must not match (anchored)
    assert parse_risk_id(_VALID + "x") is None
    # missing dashes
    assert parse_risk_id("risk_01981e6e7c2a7f3b9d41a2b6c9e0f412") is None
