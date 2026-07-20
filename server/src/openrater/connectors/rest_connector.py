# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Generic manifest-driven REST connector (Brief 47).

One class runs ANY `ConnectorManifest`: it renders the request from the inputs,
injects the secret at call time (never snapshotted), calls the transport, and
extracts the declared output ports via dotted JSON paths. Adding a vendor = a
new manifest — no new code.
"""

from __future__ import annotations

import os
import re
from typing import Any

from openrater.connectors.base import ConnectorRun, ConnectorSecrets, HttpTransport
from openrater.connectors.errors import (
    ConnectorNotConfiguredError,
    ConnectorUpstreamError,
)
from openrater.connectors.models import ConnectorManifest, HttpRequest
from openrater.errors import BadRequestError

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
_VENDOR_ID_KEYS = ("responseId", "requestId", "request_id", "id")


def render(template: Any, inputs: dict[str, Any]) -> Any:
    """Substitute `{{name}}` placeholders from `inputs`, recursively.

    A string that is exactly one placeholder is replaced by the raw value
    (type preserved); an inline placeholder does string substitution.
    """
    if isinstance(template, str):
        exact = _PLACEHOLDER.fullmatch(template.strip())
        if exact:
            return inputs.get(exact.group(1))
        return _PLACEHOLDER.sub(lambda m: str(inputs.get(m.group(1), "")), template)
    if isinstance(template, dict):
        return {k: render(v, inputs) for k, v in template.items()}
    if isinstance(template, list):
        return [render(v, inputs) for v in template]
    return template


def extract(body: Any, json_path: str) -> Any:
    """Walk a dotted path (`a.b.c`; numeric segments index lists). None if absent."""
    cur = body
    for seg in json_path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(seg)
        elif isinstance(cur, list) and seg.isdigit():
            idx = int(seg)
            cur = cur[idx] if 0 <= idx < len(cur) else None
        else:
            return None
        if cur is None:
            return None
    return cur


class RestConnector:
    """A connector whose entire behavior comes from its manifest."""

    def __init__(self, manifest: ConnectorManifest) -> None:
        self._manifest = manifest

    @property
    def manifest(self) -> ConnectorManifest:
        return self._manifest

    def _secrets(self, secret_value: str | None = None) -> ConnectorSecrets:
        """Resolve the API key and place it per the manifest's `secret_in` (query
        param vs request header), with an optional value prefix (E05).

        Value resolution order: the in-product vault key (`secret_value`, passed
        by the service from the encrypted store, E06) → the env var named by
        `secret_env` (legacy / ops-managed). A connector "needs a key" when it
        declares `secret_param` (where to send it) or `secret_env`."""
        m = self._manifest
        needs_key = bool(m.secret_param) or bool(m.secret_env)
        if not needs_key:
            return ConnectorSecrets()
        key = secret_value or (os.environ.get(m.secret_env, "") if m.secret_env else "")
        if not key:
            hint = f" (or set the {m.secret_env} env var)" if m.secret_env else ""
            raise ConnectorNotConfiguredError(
                f"No API key is configured for {m.display_name}. "
                f"Add one in the connector's settings{hint}.",
            )
        if not m.secret_param:
            return ConnectorSecrets()
        value = f"{m.secret_prefix}{key}" if m.secret_prefix else key
        if m.secret_in == "header":
            return ConnectorSecrets(headers={m.secret_param: value})
        return ConnectorSecrets(query={m.secret_param: value})

    async def execute(
        self,
        inputs: dict[str, Any],
        *,
        transport: HttpTransport,
        secret_value: str | None = None,
    ) -> ConnectorRun:
        m = self._manifest
        # apply manifest input defaults (caller-supplied values win)
        defaults = {p.name: p.default for p in m.inputs if p.default is not None}
        inputs = {**defaults, **inputs}
        for param in m.inputs:
            if param.required and (inputs.get(param.name) in (None, "")):
                raise BadRequestError(
                    f"Missing required input {param.name!r} for {m.connector_id}.",
                    param=param.name,
                )
        secrets = self._secrets(secret_value)
        # Render `{{placeholders}}` in the URL path too (e.g. `/us/{{zip}}`), not
        # just the query/body — path params are common in REST APIs.
        rendered_url = render(m.endpoint, inputs)
        request = HttpRequest(
            method=m.method,
            url=rendered_url if isinstance(rendered_url, str) else m.endpoint,
            params={k: str(v) for k, v in render(m.request_query, inputs).items()},
            json_body=render(m.request_json, inputs) if m.request_json is not None else None,
        )
        response = await transport(request, secrets)
        if response.status_code != 200:
            detail = ""
            if isinstance(response.json_body, dict):
                err = response.json_body.get("error")
                if isinstance(err, dict):
                    detail = str(err.get("message", ""))
            raise ConnectorUpstreamError(
                f"{m.display_name} returned {response.status_code}"
                + (f": {detail}" if detail else "")
            )
        outputs = {port.name: extract(response.json_body, port.json_path) for port in m.outputs}
        vendor_request_id = None
        if isinstance(response.json_body, dict):
            for k in _VENDOR_ID_KEYS:
                if isinstance(response.json_body.get(k), str):
                    vendor_request_id = response.json_body[k]
                    break
        return ConnectorRun(
            outputs=outputs,
            request=request,
            response=response,
            vendor_request_id=vendor_request_id,
        )
