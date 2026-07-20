# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""openrater — the OpenRater API Lab backend.

FastAPI service hosting the entity registry that Rate Lab consumes:
plans, dimensions, factor tables, curves, class codes, eligibility
rules, loadings, modifiers, sample submissions, etc.

The local development service runs unauthenticated against a development
database. Production integrators provide the authentication layer appropriate
for their deployment.
"""

__version__ = "0.1.0"
