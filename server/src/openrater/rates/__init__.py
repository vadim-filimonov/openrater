# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""`openrater.rates` — rating substrate (plans, stages, factor tables, …).

The hierarchy mirrors the original prototype's layout for ease of port: each
subpackage is a slice in the API Lab port checklist. Today only
`plans` ships; the other slices (dimensions, class-codes, coverage-
chains, curves, factor-tables, etc.) land in subsequent commits.
"""
