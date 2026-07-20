# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Connector-specific errors (Brief 47 — API Lab).

Subclasses `RaterError` so they flow through the central error envelope
(`openrater.errors`). Two failure modes that aren't covered by the generic
4xx subclasses:

  · ConnectorNotConfiguredError — a required secret (API key) is absent.
  · ConnectorUpstreamError      — the external vendor call failed / returned
                                  a non-2xx, i.e. a gateway problem (502).
"""

from __future__ import annotations

from openrater.errors import RaterError


class ConnectorNotConfiguredError(RaterError):
    """A connector is missing a required secret / config (e.g. API key)."""

    code = "connector_not_configured"
    default_status_code = 503


class ConnectorUpstreamError(RaterError):
    """The external vendor call failed or returned a non-success status."""

    code = "connector_upstream_error"
    default_status_code = 502


class ConnectorNotFoundError(RaterError):
    """No connector registered under the requested id."""

    code = "connector_not_found"
    default_status_code = 404


class SecretsVaultUnavailableError(RaterError):
    """The server can't store a secret because the master key is unset (E06).

    Encrypting a key at rest needs `RATER_SECRETS_KEY` on the backend. Writes
    fail-safe (this error) rather than persisting a key in the clear."""

    code = "secrets_vault_unavailable"
    default_status_code = 503
