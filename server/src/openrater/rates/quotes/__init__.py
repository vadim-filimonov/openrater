# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Quote endpoint (Brief 76, v4 P4) — un-persisted single-risk rating
against a plan's version of record, reusing the run-zone scoring
delegation. See `models.py` for the wire shapes, `service.py` for the
orchestration."""

from openrater.rates.quotes.models import (
    QuoteRequest,
    QuoteResponse,
    QuoteVersion,
)
from openrater.rates.quotes.service import quote_plan

__all__ = [
    "QuoteRequest",
    "QuoteResponse",
    "QuoteVersion",
    "quote_plan",
]
