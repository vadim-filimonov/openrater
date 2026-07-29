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

This package was ported as-is from the original prototype in 2026-05 as part
of the W4 §0.5 OSS detachment. Auth and session middleware were
stripped — Labs runs unauthenticated against a dev database;
integrators wrap with their own auth layer per their stack.
"""

__version__ = "0.1.0"
