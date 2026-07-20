# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Bundled connector manifests.

Each entry is a connector declared as DATA — the generic `RestConnector` runs
it. This is the extension point: a new vendor is a new manifest here (or, later,
an OpenAPI-derived / user-authored one in the registry). Connectors return RAW
facts only; interpreting them for rating is the Plan's job.
"""

from __future__ import annotations

from openrater.connectors.models import ConnectorManifest, InputParam, OutputPort

GOOGLE_ADDRESS_VALIDATION = ConnectorManifest(
    connector_id="google-address-validation",
    display_name="Google Address Validation",
    vendor="google",
    category="address_geo",
    version="v1",
    method="POST",
    endpoint="https://addressvalidation.googleapis.com/v1:validateAddress",
    secret_env="RATER_GOOGLE_MAPS_API_KEY",
    secret_param="key",
    request_json={
        "address": {"addressLines": ["{{address}}"], "regionCode": "{{region_code}}"}
    },
    inputs=[
        InputParam(
            name="address",
            required=True,
            example="455 N Main St, Wichita, KS 67202",
            description="Free-form street address to validate.",
        ),
        InputParam(
            name="region_code",
            required=False,
            default="US",
            description="ISO country (CLDR) region code.",
        ),
    ],
    outputs=[
        OutputPort(
            name="formatted_address",
            json_path="result.address.formattedAddress",
            description="Standardized postal address.",
        ),
        OutputPort(
            name="postal_code",
            json_path="result.address.postalAddress.postalCode",
            description="Validated ZIP / postal code (a raw fact).",
        ),
        OutputPort(
            name="address_complete",
            data_type="boolean",
            json_path="result.verdict.addressComplete",
            description="Verdict: the address is complete.",
        ),
        OutputPort(
            name="location",
            data_type="object",
            json_path="result.geocode.location",
            description="Rooftop geocode (lat/lng).",
        ),
    ],
    cost_per_call_usd=0.017,
    ttl_seconds=2_592_000,
    docs_url="https://developers.google.com/maps/documentation/address-validation",
)


GOOGLE_PLACES_TEXT_SEARCH = ConnectorManifest(
    connector_id="google-places-text-search",
    display_name="Google Places (Text Search)",
    vendor="google",
    category="identity",
    version="v1",
    method="GET",
    endpoint="https://maps.googleapis.com/maps/api/place/textsearch/json",
    secret_env="RATER_GOOGLE_MAPS_API_KEY",
    secret_param="key",
    request_query={"query": "{{query}}"},
    inputs=[
        InputParam(
            name="query",
            required=True,
            example="Riverside Youth Foundation, 4275 Lemon St, Riverside, CA",
            description="Business name + address/location to look up.",
        ),
    ],
    outputs=[
        OutputPort(
            name="business_types",
            data_type="array",
            json_path="results.0.types",
            description="Google place categories for the top match — a raw classification fact.",
        ),
        OutputPort(
            name="matched_name",
            json_path="results.0.name",
            description="Name of the business Google matched (review it — may differ from the query).",
            # Drives the match-confidence badge: compare this against
            # the value bound to the `query` input so a wrong-org match is visible.
            echo_of="query",
        ),
        OutputPort(
            name="business_status",
            json_path="results.0.business_status",
            description="Operational status of the matched business.",
        ),
        OutputPort(
            name="formatted_address",
            json_path="results.0.formatted_address",
            description="Address of the matched business (a raw fact).",
        ),
    ],
    cost_per_call_usd=0.017,
    ttl_seconds=2_592_000,
    docs_url="https://developers.google.com/maps/documentation/places/web-service/search-text",
)


LIGHTBOX_STRUCTURES = ConnectorManifest(
    connector_id="lightbox-structures",
    display_name="LightBox (Property Structures)",
    vendor="lightbox",
    category="property_peril",
    version="v1",
    method="GET",
    # Bundled local-development endpoint. A real LightBox license overrides
    # it via a "duplicate to
    # customize" user connector; the contract (inputs/outputs) is identical.
    endpoint="http://127.0.0.1:8900/v1/structures",
    secret_env="RATER_LIGHTBOX_API_KEY",
    secret_param="X-API-Key",
    secret_in="header",
    request_query={"address": "{{address}}"},
    inputs=[
        InputParam(
            name="address",
            required=True,
            example="700 Minnesota Ave, Kansas City, KS 66101",
            description="Full street address to look up the structure for.",
        ),
    ],
    outputs=[
        OutputPort(
            name="square_footage",
            data_type="number",
            # Dotted numeric segments index lists (rest_connector.extract).
            json_path="matches.0.building.square_footage",
            description="Total building square footage for the top match (a raw fact).",
        ),
        OutputPort(
            name="matched_address",
            json_path="matches.0.formatted_address",
            description="Address LightBox matched — review it; may differ from the query.",
            # Drives the name-similarity confidence badge so a
            # wrong match is caught before the value is pushed onto the plan.
            echo_of="address",
        ),
        OutputPort(
            name="confidence",
            data_type="number",
            json_path="matches.0.confidence",
            description="LightBox match confidence (0–1).",
        ),
        OutputPort(
            name="year_built",
            data_type="number",
            json_path="matches.0.building.year_built",
            description="Year the structure was built (a raw fact).",
        ),
    ],
    cost_per_call_usd=0.18,
    ttl_seconds=2_592_000,  # 30 days — property data is slow-moving.
    docs_url="https://www.lightboxre.com/",
)


BUNDLED_MANIFESTS: list[ConnectorManifest] = [
    GOOGLE_ADDRESS_VALIDATION,
    GOOGLE_PLACES_TEXT_SEARCH,
    LIGHTBOX_STRUCTURES,
]
