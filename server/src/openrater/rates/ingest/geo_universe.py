# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The geographic universe the workbook lint checks against.

`geo-universe.json` (packaged; regenerate with
scripts/geo/build-geo-universe.py) carries every US ZCTA grouped by
state via the USPS SCF ranges, and every county FIPS by state, from
the Census Bureau's 2024 Gazetteer (public domain). The R-083…R-085
checks use it to name transcription holes at validate time instead
of quote time: in-scope keys never mapped, keys outside the declared
scope, keys the Census universe doesn't know at all.

Geography only — no bureau or carrier rate content (repo rule C5).
"""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources


class GeoUniverse:
    """State-keyed key sets + a reverse key→state map, per grain."""

    def __init__(self, by_state: dict[str, frozenset[str]]) -> None:
        self.by_state = by_state
        self.state_of: dict[str, str] = {}
        for state, keys in by_state.items():
            for key in keys:
                self.state_of[key] = state

    def in_states(self, states: list[str] | None) -> frozenset[str]:
        """The universe restricted to `states` (None = national)."""
        picked = (
            self.by_state.values()
            if states is None
            else [self.by_state.get(s, frozenset()) for s in states]
        )
        out: set[str] = set()
        for keys in picked:
            out |= keys
        return frozenset(out)


@lru_cache(maxsize=1)
def load_geo_universe() -> dict[str, GeoUniverse]:
    """`{"zip": …, "county": …}` — keyed by geo_granularity."""
    raw = json.loads(
        resources.files("openrater.rates.ingest.assets")
        .joinpath("geo-universe.json")
        .read_text()
    )
    return {
        "zip": GeoUniverse(
            {s: frozenset(packed.split()) for s, packed in raw["zcta"].items()}
        ),
        "county": GeoUniverse(
            {s: frozenset(packed.split()) for s, packed in raw["county"].items()}
        ),
    }
