# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""`openrater.app` — FastAPI app composition + route modules.

Pattern: one module per endpoint group (`plan_author_route`,
`coverage_chains_route`, etc.), each exposing `router: APIRouter`.
`main.create_app()` mounts them.
"""
