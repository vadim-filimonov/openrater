# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Structlog configuration — JSON in prod, pretty in dev.

Why structlog
=============

stdlib `logging` is OK but its f-string-style formatting throws away
structure. structlog keeps every log line as a dict so:

  · operators can grep by field (`request_id=foo`, `lob=bop`).
  · downstream log shippers (Loki, Datadog, CloudWatch) get structured
    payloads they can index without regex.
  · the developer doesn't have to remember to inline log keys —
    contextvars carry them across function boundaries.

Configuration
=============

Reads two env vars at `configure_logging` time:

  · `RATER_LOG_FORMAT` — `json` (default in prod) or `pretty` (default
    in dev — TTY-detected). JSON one-line-per-event is what carriers'
    log pipelines expect; pretty is ANSI-color console output.
  · `RATER_LOG_LEVEL`  — Python log level (`DEBUG`, `INFO`, `WARNING`,
    `ERROR`). Default: `INFO`.

Usage
=====

::

    from openrater.observability import configure_logging, get_logger

    configure_logging()  # once at startup, in main.create_app

    log = get_logger(__name__)
    log.info("created_plan", rating_plan_id="bop_wi_2026", lob="bop")
    # → {"event": "created_plan", "rating_plan_id": "bop_wi_2026",
    #    "lob": "bop", "request_id": "...", "timestamp": "...", ...}

Request-scoped context (request_id, route, method) is bound by the
`RequestIdMiddleware` and propagates automatically through any log
call inside the request.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

import structlog

# ---------------------------------------------------------------------------
# Config detection
# ---------------------------------------------------------------------------


def _resolve_format() -> str:
    """Pick `json` or `pretty` based on env or TTY."""
    raw = os.environ.get("RATER_LOG_FORMAT", "").strip().lower()
    if raw in ("json", "pretty"):
        return raw
    # No env override — default to JSON unless stderr is an interactive TTY
    # (which means we're probably in a dev terminal).
    if sys.stderr.isatty():
        return "pretty"
    return "json"


def _resolve_level() -> int:
    raw = os.environ.get("RATER_LOG_LEVEL", "INFO").strip().upper()
    return getattr(logging, raw, logging.INFO)


# ---------------------------------------------------------------------------
# Configuration entrypoint
# ---------------------------------------------------------------------------


_CONFIGURED = False


def configure_logging() -> None:
    """Configure structlog + stdlib logging. Idempotent.

    Call once at app startup. Subsequent calls are no-ops.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    log_format = _resolve_format()
    log_level = _resolve_level()

    # Shared processors — applied to every log event regardless of format.
    # `add_logger_name` is deliberately omitted: it reads `logger.name`,
    # which structlog's `PrintLogger` doesn't expose. The logger name is
    # passed as the first arg to `get_logger(__name__)` and surfaces in
    # the event payload via the calling convention; integrators who want
    # it as a structured field can bind it explicitly.
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    # Format-specific renderer.
    if log_format == "json":
        renderer: Any = structlog.processors.JSONRenderer(sort_keys=True)
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )

    # Quiet uvicorn's default access log; we emit our own via RequestIdMiddleware
    # (which has request_id binding). uvicorn's error log stays.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    _CONFIGURED = True


def get_logger(name: str | None = None) -> structlog.typing.FilteringBoundLogger:
    """Return a structlog logger. Pass `__name__` from the calling module
    so log lines carry the logger name.

    Bound context vars (e.g., `request_id`) are merged in automatically.
    """
    return structlog.get_logger(name or "openrater")


__all__ = ["configure_logging", "get_logger"]
