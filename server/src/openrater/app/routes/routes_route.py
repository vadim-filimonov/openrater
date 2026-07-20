# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Routes router (Brief 48) — plan-scoped enrichment routes.

A Route binds a plan's input variables to a Connection and pushes chosen outputs
back onto the plan's input values. Many routes can share one connection.

  · GET    /plans/{plan_id}/routes                 — routes for a plan
  · POST   /plans/{plan_id}/routes                 — create a route
  · GET    /plans/{plan_id}/routes/{route_id}      — one route
  · DELETE /plans/{plan_id}/routes/{route_id}      — remove a route
  · POST   /plans/{plan_id}/routes/{route_id}/apply — run it; push outputs back
  · GET    /plans/{plan_id}/input-values           — the plan's filled inputs
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Request, Response
from fastapi import Path as FPath

from openrater.auth import current_operator
from openrater.connectors.models import (
    ApplyRouteRequest,
    ApplyRouteResponse,
    CreateRouteRequest,
    ListInputValuesResponse,
    ListRoutesResponse,
    Route,
)
from openrater.connectors.registry import registry_for
from openrater.connectors.routes_repo import (
    create_route,
    delete_route,
    get_route,
    list_plan_input_values,
    list_routes,
)
from openrater.connectors.service import apply_route
from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.plans.repo import get_plan
from openrater.rates.plans.state_machine import assert_plan_writable

router = APIRouter(tags=["api-lab routes"])


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_writable_plan(db: Database, plan_id: str) -> None:
    """404 if absent, 409 if the plan isn't in a writable (DRAFT) state.
    An enrichment route (a connection + its input bindings) is part of how
    the plan rates, so adding/removing one is a definition edit that must
    freeze once the plan leaves DRAFT — like the sibling child-resource
    families (audit A-2026-07-12 P2-01, extends P1-05). Running a route
    (`apply`) is a runtime/test op on input values, NOT a definition edit,
    so it stays ungated."""
    plan = get_plan(db=db, rating_plan_id=plan_id)
    if plan is None:
        raise NotFoundError(
            f"Plan {plan_id!r} not found.",
            code="plan_not_found",
            param="plan_id",
        )
    assert_plan_writable(plan, resource="routes")


@router.get("/plans/{plan_id}/routes", response_model=ListRoutesResponse)
async def list_routes_endpoint(
    request: Request,
    plan_id: Annotated[str, FPath(description="The target plan.")],
) -> ListRoutesResponse:
    """Every route defined for a plan."""
    db = _resolve_db(request)
    return ListRoutesResponse(routes=list_routes(db=db, plan_id=plan_id))


@router.post("/plans/{plan_id}/routes", response_model=Route, status_code=201)
async def create_route_endpoint(
    request: Request,
    plan_id: Annotated[str, FPath(description="The target plan.")],
    payload: Annotated[CreateRouteRequest, Body(...)],
) -> Route:
    """Create a route: a connection + the plan-input→param bindings + the
    output→plan-input pushes."""
    db = _resolve_db(request)
    _require_writable_plan(db, plan_id)
    return create_route(
        db=db,
        plan_id=plan_id,
        connection_id=payload.connection_id,
        name=payload.name,
        bindings=payload.bindings,
        pushes=payload.pushes,
        created_by=current_operator(),
    )


@router.get("/plans/{plan_id}/routes/{route_id}", response_model=Route)
async def get_route_endpoint(
    request: Request,
    plan_id: Annotated[str, FPath(description="The target plan.")],
    route_id: Annotated[str, FPath(description="The route to fetch.")],
) -> Route:
    """One route (with its bindings + pushes) — what the wizard loads to edit."""
    db = _resolve_db(request)
    route = get_route(db=db, plan_id=plan_id, route_id=route_id)
    if route is None:
        raise NotFoundError(
            f"Route {route_id!r} not found.", code="route_not_found", param="route_id"
        )
    return route


@router.delete("/plans/{plan_id}/routes/{route_id}", status_code=204)
async def delete_route_endpoint(
    request: Request,
    plan_id: Annotated[str, FPath(description="The target plan.")],
    route_id: Annotated[str, FPath(description="The route to remove.")],
) -> Response:
    """Remove a route."""
    db = _resolve_db(request)
    _require_writable_plan(db, plan_id)
    if not delete_route(db=db, plan_id=plan_id, route_id=route_id):
        raise NotFoundError(
            f"Route {route_id!r} not found.", code="route_not_found", param="route_id"
        )
    return Response(status_code=204)


@router.post(
    "/plans/{plan_id}/routes/{route_id}/apply",
    response_model=ApplyRouteResponse,
)
async def apply_route_endpoint(
    request: Request,
    plan_id: Annotated[str, FPath(description="The target plan.")],
    route_id: Annotated[str, FPath(description="The route to run.")],
    payload: Annotated[ApplyRouteRequest, Body(...)],
) -> ApplyRouteResponse:
    """Run a route: resolve its params, call the connection, snapshot, and push the
    outputs back onto the plan's input values (the 'land on the Inputs screen' step)."""
    db = _resolve_db(request)
    route = get_route(db=db, plan_id=plan_id, route_id=route_id)
    if route is None:
        raise NotFoundError(
            f"Route {route_id!r} not found.", code="route_not_found", param="route_id"
        )
    return await apply_route(
        db=db,
        route=route,
        values=payload.values,
        persist=payload.persist,
        operator=current_operator(),
        registry=registry_for(db),
    )


@router.get("/plans/{plan_id}/input-values", response_model=ListInputValuesResponse)
async def list_input_values_endpoint(
    request: Request,
    plan_id: Annotated[str, FPath(description="The target plan.")],
) -> ListInputValuesResponse:
    """The plan's filled input values (route-pushed or provided) + provenance —
    what the Inputs screen shows."""
    db = _resolve_db(request)
    return ListInputValuesResponse(values=list_plan_input_values(db=db, plan_id=plan_id))
