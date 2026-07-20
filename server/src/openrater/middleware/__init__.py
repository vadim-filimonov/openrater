# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""HTTP middleware for the API Lab FastAPI app.

Middlewares wrap the route layer to provide cross-cutting behavior
(idempotency replay, request IDs + structured logs, auth shim, rate
limiting). Today this package exports:

  · `IdempotencyMiddleware` — Stripe-style Idempotency-Key replay.
  · `prune_expired_keys` — boot-time sweep of expired replay rows.

M3.5.3 will add `RequestIdMiddleware` + structured logging hooks.
M3.5.4 will add `AuthShimMiddleware` (verify_operator callable hook).
"""

from openrater.middleware.idempotency import (
    IdempotencyMiddleware,
    prune_expired_keys,
)

__all__ = ["IdempotencyMiddleware", "prune_expired_keys"]
