# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Deterministic workbook ingestion (Brief 92, ADR-0065).

Reads a filing-transcription workbook (docs/specs/
filing-transcription-spec.md v1.0) and — with ZERO AI, zero fuzzy
matching, zero repair — either reports precisely what's wrong
(`R-###` rules, cited by sheet!cell) or builds the plan.

Phase 92.2 ships the read side:

    from openrater.rates.ingest import check_workbook
    result = check_workbook(data=xlsx_bytes, filename="my_filing.xlsx")

`result.errors` empty ⇒ the workbook conforms to spec v1.0 and
`result.manifest` says exactly what a build would create. The build
itself (Phase 92.3) refuses to run against a workbook whose check
isn't clean.
"""

from openrater.rates.ingest.service import CheckResult, check_workbook

__all__ = ["CheckResult", "check_workbook"]
