# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Connector registry (Brief 47 §8).

Built from manifests: code-bundled vendors live in `manifests.py`; user-authored
ones are persisted in the DB and merged in by `registry_for(db)`. Custom
(non-REST) connectors can `register()` a bespoke implementation, but the common
case is purely declarative. Each connector carries a `source` so the UI knows
which are read-only (bundled) vs editable (user).
"""

from __future__ import annotations

from collections.abc import Callable

from openrater.connectors.base import Connector, connector_info
from openrater.connectors.errors import ConnectorNotFoundError
from openrater.connectors.manifests import BUNDLED_MANIFESTS
from openrater.connectors.manifests_repo import list_manifests
from openrater.connectors.models import ConnectorInfo, ConnectorManifest, ConnectorSource
from openrater.connectors.rest_connector import RestConnector
from openrater.persistence.db import Database

# Ids shipped in code — reserved (a user can't author over them) + read-only.
BUNDLED_IDS: frozenset[str] = frozenset(m.connector_id for m in BUNDLED_MANIFESTS)


def is_bundled(connector_id: str) -> bool:
    return connector_id in BUNDLED_IDS


class ConnectorRegistry:
    """In-memory registry of connector instances, keyed by connector_id."""

    def __init__(self) -> None:
        self._by_id: dict[str, Connector] = {}
        self._source_by_id: dict[str, ConnectorSource] = {}

    def register(self, connector: Connector, *, source: ConnectorSource = "bundled") -> None:
        self._by_id[connector.manifest.connector_id] = connector
        self._source_by_id[connector.manifest.connector_id] = source

    def register_manifest(
        self, manifest: ConnectorManifest, *, source: ConnectorSource = "bundled"
    ) -> None:
        self.register(RestConnector(manifest), source=source)

    def get(self, connector_id: str) -> Connector:
        connector = self._by_id.get(connector_id)
        if connector is None:
            raise ConnectorNotFoundError(
                f"No connector registered with id {connector_id!r}.",
                param="connector_id",
            )
        return connector

    def source_of(self, connector_id: str) -> ConnectorSource:
        return self._source_by_id.get(connector_id, "bundled")

    def infos(
        self, *, secret_set: Callable[[str], bool] | None = None
    ) -> list[ConnectorInfo]:
        """Public infos for every registered connector. `secret_set(connector_id)`
        (optional) reports whether an in-product vault key is stored, feeding each
        connector's `configured` flag (E06)."""
        return [
            connector_info(
                c.manifest,
                source=self._source_by_id.get(cid, "bundled"),
                secret_set=bool(secret_set(cid)) if secret_set else False,
            )
            for cid, c in self._by_id.items()
        ]


def default_registry() -> ConnectorRegistry:
    """The seed registry — every bundled manifest, run by the generic engine.

    Bundled-only (no DB). Used by the engine's unit tests; request handlers use
    `registry_for(db)` so user-authored connectors are included."""
    registry = ConnectorRegistry()
    for manifest in BUNDLED_MANIFESTS:
        registry.register_manifest(manifest, source="bundled")
    return registry


def registry_for(db: Database) -> ConnectorRegistry:
    """Bundled ⊕ user-authored connectors. Bundled win on id collision (defensive;
    authoring already rejects bundled ids)."""
    registry = default_registry()
    for manifest in list_manifests(db=db):
        if is_bundled(manifest.connector_id):
            continue
        registry.register_manifest(manifest, source="user")
    return registry
