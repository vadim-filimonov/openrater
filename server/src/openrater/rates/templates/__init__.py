# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan templates registry — D6.4 / ADR-0027.

Server-owned recipes that the `/from-template` endpoint materializes
into a full plan + its dims + factor tables (+ cells) + input mapping
+ chain stages. Replaces the hard-coded "nonprofit_990" path that
PlanNewRoute.tsx today special-cases via localStorage seeding.
"""

from openrater.rates.templates.models import (
    FromTemplateRequest,
    FromTemplateResponse,
    ListTemplatesResponse,
    PlanTemplate,
    PlanTemplateSummary,
    UpsertTemplateRequest,
)
from openrater.rates.templates.repo import (
    delete_template,
    get_template,
    list_templates,
    upsert_template,
)
from openrater.rates.templates.seed import seed_bundled_templates
from openrater.rates.templates.service import materialize_from_template

__all__ = [
    "PlanTemplate",
    "PlanTemplateSummary",
    "UpsertTemplateRequest",
    "ListTemplatesResponse",
    "FromTemplateRequest",
    "FromTemplateResponse",
    "list_templates",
    "get_template",
    "upsert_template",
    "delete_template",
    "materialize_from_template",
    "seed_bundled_templates",
]
