# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan-templates endpoints + /from-template.

The template SUBSYSTEM is intentionally kept alive but DORMANT: no
recipes ship in ``rates/templates/recipes/`` today. The bundled
``nonprofit_990`` recipe was removed because its factors were
placeholder values, not filed rates. These tests pin the zero-recipe
contract so the endpoints don't rot before a real recipe is added:

  · GET  /api/v1/plan-templates        → 200, empty list
  · GET  /api/v1/plan-templates/{id}   → 404 (nothing bundled)
  · POST /api/v1/plans/from-template   → 404 for any template_id,
                                         422 on malformed request bodies

When a real recipe returns, drop a JSON in ``recipes/`` and add
coverage for its specific materialization (the old nonprofit_990
assertions live in git history).
"""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestListTemplates:
    def test_list_is_empty_with_no_bundled_recipes(
        self,
        client: TestClient,
    ) -> None:
        """No recipes are bundled, so the lifespan seeder writes nothing
        and the gallery list comes back empty — but the endpoint itself
        still answers 200 (the dormant subsystem stays healthy)."""
        response = client.get("/api/v1/plan-templates")
        assert response.status_code == 200
        body = response.json()
        assert body["templates"] == []


class TestGetTemplate:
    def test_get_unknown_template_returns_404(self, client: TestClient) -> None:
        response = client.get("/api/v1/plan-templates/does-not-exist")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "template_not_found"


class TestFromTemplate:
    def test_materialize_with_unknown_template_returns_404(
        self,
        client: TestClient,
    ) -> None:
        """With no recipes bundled, every template_id is unknown."""
        response = client.post(
            "/api/v1/plans/from-template",
            json={
                "template_id": "nonprofit_990",
                "display_name": "X",
                "effective_date": "2026-07-01",
            },
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "template_not_found"

    def test_materialize_with_missing_required_fields_returns_422(
        self,
        client: TestClient,
    ) -> None:
        # Body validation runs before the template lookup, so this is a
        # 422 regardless of whether the template exists.
        response = client.post(
            "/api/v1/plans/from-template",
            json={"template_id": "nonprofit_990"},  # no display_name / effective_date
        )
        assert response.status_code == 422

    def test_materialize_with_extra_field_returns_422(
        self,
        client: TestClient,
    ) -> None:
        response = client.post(
            "/api/v1/plans/from-template",
            json={
                "template_id": "anything",
                "display_name": "X",
                "effective_date": "2026-07-01",
                "nonsense": "boom",
            },
        )
        assert response.status_code == 422
