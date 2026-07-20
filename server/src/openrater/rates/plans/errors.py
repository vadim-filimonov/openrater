# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Typed errors for the plan substrate.

These are the *internal* errors raised when stored plan content can't
be parsed back into typed shapes — i.e., they fire from `repo.py` when
something we wrote got corrupted, or from upstream parsers when input
data is malformed.

Inheritance: every error here ultimately extends
`openrater.errors.RaterError`, so the FastAPI exception handler in
`openrater.errors` converts them to the structured envelope without any
per-route `except`. The default status is 500 (internal) because by
the time content lives in our DB it should have been validated on the
way in; if parsing fails it's a server-side data issue, not a 400.
"""

from __future__ import annotations

from openrater.errors import RaterError


class PlanIngestError(RaterError):
    """Base class for plan-substrate ingest + persistence failures.

    Catch this when you want to handle any plan-related failure;
    catch a subclass when you want to handle one specific kind.
    """

    code = "plan_ingest_error"
    default_status_code = 500


class PlanParseError(PlanIngestError):
    """Raised when typed plan content cannot be parsed or persisted.

    The message MUST identify (a) the entity (plan / stage / IO row),
    (b) what was expected, (c) what was found. Parse failures are loud —
    they prevent silent garbage in `rating_plans` / `rating_plan_stages`.
    """

    code = "plan_parse_error"
    default_status_code = 500


__all__ = [
    "PlanIngestError",
    "PlanParseError",
]
