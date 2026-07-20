# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Observability — structured logging + request correlation.

Two artifacts an integrator needs to debug a production incident:

  1. **Logs.** Every log line carries the `request_id` of the request
     that produced it. Filter by `request_id` to see the full trace
     of one request across every component (route → middleware →
     service → DB).

  2. **Headers.** Responses include `X-Request-Id`. Clients echo it
     in their own logs so a customer support call ("this request
     failed at 2026-05-20T14:33Z") maps to a single backend log
     stream in one query.

The two together close the loop: a customer reports a bad response,
they share the `X-Request-Id` from the failing call, the operator
filters the JSON logs by that ID and gets the full trace.

## How it's wired

  - `configure_logging()` sets up structlog at app startup. Reads
    `RATER_LOG_FORMAT` (`json` for prod, `pretty` for dev) +
    `RATER_LOG_LEVEL`. Called once in `main.create_app`.
  - `RequestIdMiddleware` (Starlette middleware) generates/reads the
    request ID, binds it to the structlog context, logs request
    start + end, returns `X-Request-Id` in the response.
  - Inside any function during a request, `get_logger()` returns a
    bound logger that includes `request_id` automatically.

## What's NOT in scope here

  - **Tracing** (OpenTelemetry spans) — lands later when we have a
    distributed system to trace. Today's API Lab is a single process.
  - **Metrics** — Prometheus / OTel metrics export. Same reason —
    add when there's something to measure.
  - **Sampling** — log volume is low enough we don't need it; revisit
    at scale.
"""

from openrater.observability.logging import configure_logging, get_logger
from openrater.observability.request_id import (
    REQUEST_ID_HEADER,
    RequestIdMiddleware,
    bind_request_id,
    get_request_id,
)

__all__ = [
    "REQUEST_ID_HEADER",
    "RequestIdMiddleware",
    "bind_request_id",
    "configure_logging",
    "get_logger",
    "get_request_id",
]
