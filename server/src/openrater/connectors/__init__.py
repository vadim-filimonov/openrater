# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""API Lab connectors — generic, manifest-driven enrichment framework (Brief 47)."""

from __future__ import annotations

from openrater.connectors.models import (
    ConnectorInfo,
    ConnectorInvokeRequest,
    ConnectorInvokeResponse,
    ConnectorListResponse,
    ConnectorManifest,
    EnrichmentSnapshot,
)
from openrater.connectors.registry import ConnectorRegistry, default_registry
from openrater.connectors.rest_connector import RestConnector
from openrater.connectors.service import invoke_connector

__all__ = [
    "ConnectorInfo",
    "ConnectorInvokeRequest",
    "ConnectorInvokeResponse",
    "ConnectorListResponse",
    "ConnectorManifest",
    "ConnectorRegistry",
    "EnrichmentSnapshot",
    "RestConnector",
    "default_registry",
    "invoke_connector",
]
