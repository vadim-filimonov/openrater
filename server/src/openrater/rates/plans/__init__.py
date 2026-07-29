# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""`openrater.rates.plans` — RatingPlan substrate + Plan Author state machine.

Slice 2 of the API Lab port. Owns:

  · models.py            — typed RatingPlan / Stage / StageInput / StageOutput
                           contracts (Pydantic, frozen).
  · errors.py            — typed exception base.
  · hashing.py           — content-addressable plan hash (ADR-0015).
  · validator.py         — cross-stage DAG reachability checks.
  · configs.py           — per-`StageKind` config shapes + the
                           `parse_stage_config(stage)` dispatch.
  · stage_kind_specs.py  — operator-visible taxonomy registry.
  · repo.py              — DB persistence for plans + stages + IO.
  · plan_signoff.py      — lock-for-filing read path + revoke (port note:
                           the SIGN-OFF CREATE path is deferred to a later
                           slice — see the module docstring).
  · author.py            — fork / patch / promote / discard / rollback /
                           audit / position / wire state-machine
                           primitives.

The original prototype's `preview` module is NOT in this slice — it requires
the cascade engine (`rates.plans.engine`) which lands in its own slice.
"""
