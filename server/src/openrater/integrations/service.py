# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Integration-seam orchestration (ADR-0057, L1): pairing, keys, descriptor.

Mirrors the `rates/api_keys/service.py` disciplines — secrets are minted,
hashed (SHA-256), and stored hash-only; the clear value is returned ONCE.
The pairing code is a one-time bearer credential with a 10-minute TTL;
exchanging it rotates every prior integrator key (re-pair = rotate).

The PII guard runs at the catalog boundary too: a peer catalog that
carries identity-class keys is rejected with the same named-keys 422 the
quote-set uses (contract §7) — the Hub's mapper can then never even list
an identity field.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from openrater.errors import NotFoundError, UnauthorizedError, ValidationError
from openrater.integrations.models import (
    ACCEPTED_EVENT_KINDS,
    CONTRACT_VERSION,
    CatalogField,
    Descriptor,
    DescriptorFieldSpec,
    DescriptorPlan,
    IntegrationOut,
    PairingCodeCreated,
    PairResponse,
)
from openrater.integrations.repo import (
    find_active_integrator_key,
    find_open_code_by_hash,
    get_integration,
    insert_integration,
    insert_integrator_key,
    insert_pairing_code,
    list_exposed_plans,
    list_integrations,
    mark_code_used,
    revoke_integrator_keys,
    revoke_open_codes,
    set_paired,
    touch_integrator_key,
    update_catalog,
)
from openrater.persistence.db import Database
from openrater.rates.plans.repo import get_plan

_CODE_TTL = timedelta(minutes=10)
_KEY_SCHEME = "rater_int_"
_PREFIX_LEN = 15  # "rater_int_" + 6 chars — recognizable, not guessable.

# The identity deny-classes (contract §7). Mirrors the reference
# integrator's outbound lint (`openrater-front/lib/rating/client.ts`)
# so the same key fails the same way on both sides of the wire.
IDENTITY_RE = re.compile(
    r"legal_name|display_name|owner_name|additional_interest|liquor_license"
    r"|\bdba\b|phone|email|address|website|\burl\b|editorial",
    re.IGNORECASE,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def reject_identity_keys(keys: list[str]) -> None:
    """Raise the contract's named-keys 422 if any key is identity-class."""
    offending = [k for k in keys if IDENTITY_RE.search(k)]
    if offending:
        raise ValidationError(
            "Identity-class keys are rejected at the seam — the wire is "
            "pseudonymous by construction (integration contract §7). "
            f"Offending keys: {', '.join(sorted(offending))}.",
            code="identity_keys_rejected",
            details={"keys": sorted(offending)},
        )


# ── authoring (operator) ────────────────────────────────────────────────────


def create_integration(*, db: Database, name: str, created_by: str | None) -> IntegrationOut:
    integration_id = "int_" + secrets.token_hex(8)
    insert_integration(
        db=db,
        integration_id=integration_id,
        name=name,
        created_at=_iso(_now()),
        created_by=created_by,
    )
    return integration_out(db=db, integration_id=integration_id)


def integration_out(*, db: Database, integration_id: str) -> IntegrationOut:
    import json as _json

    from openrater.integrations.repo import events_pulse

    row = get_integration(db=db, integration_id=integration_id)
    if row is None:
        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    exposed = list_exposed_plans(db=db, integration_id=integration_id)
    try:
        catalog = _json.loads(row["peer_catalog"] or "[]")
    except (TypeError, ValueError):
        catalog = []
    feed = events_pulse(db=db, integration_id=integration_id)
    return IntegrationOut(
        integration_id=row["integration_id"],
        name=row["name"],
        peer_name=row["peer_name"],
        paired=row["paired_at"] is not None,
        paired_at=row["paired_at"],
        created_at=row["created_at"],
        plans_exposed=len(exposed),
        # Truly serving: a drifted live plan (published ≠ tested) is demoted
        # (§4.5), and so is one whose republished version outran its mapping
        # (§3 coverage) — the home card's "Live · N" never over-counts.
        plans_live=sum(
            1
            for p in exposed
            if _journey_status(
                p,
                required_missing=sum(
                    1
                    for c in consumed_inputs_with_coverage(db=db, exposed=p)
                    if c.required and not c.mapped_from
                ),
                untested=live_version_untested(db=db, exposed=p),
            )
            == "live"
        ),
        catalog_field_count=len(catalog) if isinstance(catalog, list) else 0,
        events_error=feed["error"],
        last_event_at=feed["last_at"],
    )


def list_integrations_out(*, db: Database) -> list[IntegrationOut]:
    return [
        integration_out(db=db, integration_id=row["integration_id"])
        for row in list_integrations(db=db)
    ]


def mint_pairing_code(
    *, db: Database, integration_id: str, created_by: str | None
) -> PairingCodeCreated:
    """Generate a one-time code (TTL 10 min). Prior open codes die —
    the Hub's 'Generate a new code' invalidates, stated on the button."""
    if get_integration(db=db, integration_id=integration_id) is None:
        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    now = _now()
    revoke_open_codes(db=db, integration_id=integration_id, when=_iso(now))
    # RATE-XXXX-XXXX-XXXX — hand-copyable, unambiguous alphabet.
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)]
    code = "RATE-" + "-".join(groups)
    code_id = "ipc_" + secrets.token_hex(6)
    expires_at = _iso(now + _CODE_TTL)
    insert_pairing_code(
        db=db,
        code_id=code_id,
        integration_id=integration_id,
        code_hash=_hash(code),
        code_prefix=code[:9],  # "RATE-XXXX"
        created_at=_iso(now),
        created_by=created_by,
        expires_at=expires_at,
    )
    return PairingCodeCreated(code_id=code_id, code=code, expires_at=expires_at)


# ── the exchange (anonymous + code) ─────────────────────────────────────────


def exchange_pairing_code(
    *, db: Database, code: str, peer_name: str, catalog: list[CatalogField]
) -> PairResponse:
    """§2: code → integrator key + descriptor, uploading the peer catalog
    in the same call. Single-use; expiry honored; re-pair rotates keys."""
    row = find_open_code_by_hash(db=db, code_hash=_hash(code.strip()))
    now = _now()
    if row is None or _iso(now) > row["expires_at"]:
        raise UnauthorizedError(
            "This pairing code is invalid, already used, or expired. "
            "Generate a fresh one in the Integration Hub.",
            code="pairing_code_invalid",
        )
    reject_identity_keys([f.key for f in catalog])
    integration_id = row["integration_id"]
    mark_code_used(db=db, code_id=row["code_id"], when=_iso(now))
    revoke_integrator_keys(db=db, integration_id=integration_id, when=_iso(now))
    secret = _KEY_SCHEME + secrets.token_urlsafe(32)
    insert_integrator_key(
        db=db,
        key_id="ik_" + secrets.token_hex(8),
        integration_id=integration_id,
        key_hash=_hash(secret),
        secret_prefix=secret[:_PREFIX_LEN],
        created_at=_iso(now),
    )
    set_paired(
        db=db,
        integration_id=integration_id,
        peer_name=peer_name,
        peer_catalog=[f.model_dump() for f in catalog],
        when=_iso(now),
    )
    return PairResponse(
        integration_id=integration_id,
        integrator_key=secret,
        descriptor=build_descriptor(db=db, integration_id=integration_id),
    )


# ── the integrator gate ─────────────────────────────────────────────────────


def require_integrator(*, db: Database, integration_id: str, presented_key: str | None) -> None:
    """Integrator endpoints ALWAYS require the key (contract §6.1) —
    unlike the Brief-76 quote gate, there is no open mode here: the
    descriptor names plans and mappings, which is relationship data."""
    key = (presented_key or "").strip()
    match = (
        find_active_integrator_key(db=db, integration_id=integration_id, key_hash=_hash(key))
        if key
        else None
    )
    if match is None:
        raise UnauthorizedError(
            "A valid integrator key is required. Send it as the "
            "`X-OpenRater-Integration-Key` header; pairing mints it.",
            code="integration_key_invalid",
        )
    touch_integrator_key(db=db, key_id=match["key_id"], when=_iso(_now()))


def refresh_catalog(*, db: Database, integration_id: str, catalog: list[CatalogField]) -> None:
    reject_identity_keys([f.key for f in catalog])
    update_catalog(
        db=db,
        integration_id=integration_id,
        peer_catalog=[f.model_dump() for f in catalog],
    )


# ── exposed-plan authoring (Brief 77 steps 2 + 4 + 6; operator) ─────────────


def current_version_is_tested(
    *, db: Database, rating_plan_id: str, tested_snapshot_id: str | None
) -> bool:
    """True iff the plan HAS a published snapshot AND it is the exact one
    that last passed a green Hub test (the step-5 receipt, stamped
    `last_test_snapshot_id`). A missing receipt, nothing published, or a
    DIFFERENT published snapshot than the tested one all read False — the
    republish drift the serving gate demotes on (audit 2026-07-11 gap #3:
    the old gate checked test-EVER, so a new snapshot whose mapping was
    never tested still served live). Body-free — compares ids only."""
    from openrater.rates.snapshots.service import get_published_snapshot_id_for_plan

    if tested_snapshot_id is None:
        return False
    published_id = get_published_snapshot_id_for_plan(db=db, plan_id=rating_plan_id)
    return published_id is not None and published_id == tested_snapshot_id


def live_version_untested(*, db: Database, exposed) -> bool:  # noqa: ANN001 — ExposedPlan
    """The drift predicate: a plan whose live toggle is ON but whose
    CURRENTLY-published version is not the one that passed its Hub mapping
    test. An off plan is never 'untested-live' — it's simply paused. This
    single predicate governs the descriptor status, the quote-set serving
    scope, the Hub read model, and the live-flip gate, so the four agree."""
    if not exposed.live:
        return False
    return not current_version_is_tested(
        db=db,
        rating_plan_id=exposed.rating_plan_id,
        tested_snapshot_id=exposed.last_test_snapshot_id,
    )


def _journey_status(
    exposed, *, required_missing: int = 0, untested: bool = False
) -> str:  # noqa: ANN001 — ExposedPlan
    """The DESCRIPTOR's per-plan status — the spec §3 wire triad
    (live | paused | unmapped). Two demotions compose here, worst first.

    `unmapped` is a COVERAGE statement, not a has-any-mapping statement
    (§3): a republish that adds a required consumed input the mapping
    doesn't cover flips the plan back to `unmapped` — the integrator can
    neither see nor send a field the mapping doesn't name, so every
    quote would refuse.

    `paused` additionally covers DRIFT (§4.5): a live plan whose
    published version is not the one that passed its Hub test
    (`untested`) reports paused, not live — the seam won't advertise a
    version whose mapping it never validated (the integrator then
    re-quotes, §4.4).

    The Hub's richer operator-facing ladder is `_hub_status`; this one
    stays wire-stable for integrators."""
    has_required = any(e.required for e in exposed.mapping)
    if not has_required or required_missing > 0:
        return "unmapped"
    return "live" if (exposed.live and not untested) else "paused"


def _hub_status(exposed, *, required_missing: int = 0) -> str:  # noqa: ANN001 — ExposedPlan
    """The operator-facing journey chip (Brief 77 step 2):
    unmapped → mapped → tested → live. Coverage gaps demote to `unmapped`
    exactly as the wire triad does — one derivation, two vocabularies,
    zero drift. Read model only."""
    has_required = any(e.required for e in exposed.mapping)
    if not has_required or required_missing > 0:
        return "unmapped"
    if exposed.live:
        return "live"
    return "tested" if exposed.last_test_at else "mapped"


def _natural_key(value: str) -> tuple:
    """q2 before q10 — digit runs compare numerically."""
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value))


_ALLOWED_VALUES_CAP = 60  # beyond this a picker stops helping — free text


def _allowed_values_by_input(body: dict) -> dict[str, list]:
    """The value-transparency seam (Brief 77 §8.5 erratum 2): for every
    form input that keys enumerable lookups, derive the ONLY values the
    published version will accept — straight from where the engine looks
    (factor-table cell keys), labeled from the dimensions substrate when
    a level matches. Banded dimensions (raw numbers band server-side),
    classification and geographic dimensions stay free-form: their value
    spaces are open or huge, and a picker would mislead."""
    from openrater.integrations.models import AllowedValue

    # 1 · dim → input bindings, read where the engine reads them: the
    # chain stages' factor_lookups[].dimensions specs.
    bindings: dict[str, set[str]] = {}

    def _walk(node) -> None:  # noqa: ANN001
        if isinstance(node, dict):
            for lookup in node.get("factor_lookups") or []:
                if not isinstance(lookup, dict):
                    continue
                for dim_id, spec in (lookup.get("dimensions") or {}).items():
                    if not isinstance(spec, dict):
                        continue
                    if spec.get("source") == "form_input" and isinstance(spec.get("path"), str):
                        bindings.setdefault(dim_id, set()).add(spec["path"])
            for child in node.values():
                _walk(child)
        elif isinstance(node, list):
            for child in node:
                _walk(child)

    _walk(body.get("stages") or [])

    # 2 · dim → the cell-key parts the tables actually hold.
    values_by_dim: dict[str, set[str]] = {}
    for table in body.get("factor_tables") or []:
        if not isinstance(table, dict):
            continue
        key_dims = table.get("key_dimensions") or []
        cells = table.get("cells") or {}
        for index, dim_id in enumerate(key_dims):
            if dim_id not in bindings:
                continue
            bucket = values_by_dim.setdefault(dim_id, set())
            for cell_key in cells:
                parts = str(cell_key).split("::")
                if index < len(parts) and parts[index]:
                    bucket.add(parts[index])

    # 3 · dimensions substrate: labels + the free-form exclusions. A
    # substrate row matches its dim by id, or — when authoring gave the
    # dim an opaque id — by its level ids covering the table's values.
    substrate = [d for d in body.get("dimensions") or [] if isinstance(d, dict)]
    by_dim_id = {d.get("dim_id"): d for d in substrate}

    def _substrate_for(dim_id: str, values: set[str]):  # noqa: ANN202
        direct = by_dim_id.get(dim_id)
        if direct is not None:
            return direct
        best, best_hits = None, 0
        for dim in substrate:
            level_ids = {lv.get("id") for lv in dim.get("levels") or [] if isinstance(lv, dict)}
            hits = len(values & level_ids)
            if hits > best_hits:
                best, best_hits = dim, hits
        return best if values and best_hits * 2 >= len(values) else None

    out: dict[str, list] = {}
    for dim_id, input_paths in bindings.items():
        values = values_by_dim.get(dim_id) or set()
        dim = _substrate_for(dim_id, values)
        labels: dict[str, str] = {}
        if dim is not None:
            if dim.get("dimension_type") in ("classification", "geographic"):
                continue  # open value spaces — free text
            levels = [lv for lv in dim.get("levels") or [] if isinstance(lv, dict)]
            if levels and all(lv.get("kind") == "banded" for lv in levels):
                continue  # raw numbers band server-side — free numeric
            labels = {
                lv["id"]: lv["label"]
                for lv in levels
                if isinstance(lv.get("id"), str) and isinstance(lv.get("label"), str)
            }
            if not values:  # no table carries the dim — substrate is truth
                values = set(labels)
        if not values or len(values) > _ALLOWED_VALUES_CAP:
            continue
        allowed = [
            AllowedValue(value=v, label=labels.get(v)) for v in sorted(values, key=_natural_key)
        ]
        for input_key in input_paths:
            existing = {a.value for a in out.get(input_key, [])}
            out.setdefault(input_key, []).extend(a for a in allowed if a.value not in existing)
    return out


def plan_consumed_inputs(*, db: Database, rating_plan_id: str):
    """The mapper's LEFT column (Brief 77 step 3): the inputs the
    PUBLISHED plan declares — `input_node` stages with `source: "form"`,
    each carrying its enumerable legal values when the version has them.
    Connector-sourced inputs are Routes' job (Brief 48), never the
    peer's. No published version → an empty list (the Hub says why)."""
    from openrater.integrations.models import ConsumedInput
    from openrater.rates.snapshots.service import get_published_snapshot_with_body

    snap = get_published_snapshot_with_body(db=db, plan_id=rating_plan_id)
    if snap is None or not isinstance(snap.body, dict):
        return []
    allowed_by_input = _allowed_values_by_input(snap.body)
    out = []
    for stage in snap.body.get("stages") or []:
        if not isinstance(stage, dict):
            continue
        kind = stage.get("stage_kind") or stage.get("kind")
        if kind != "input_node":
            continue
        config = stage.get("config_json") or stage.get("config") or {}
        if not isinstance(config, dict) or config.get("source") != "form":
            continue
        key = config.get("source_path") or stage.get("stage_id")
        if not isinstance(key, str) or not key:
            continue
        out.append(
            ConsumedInput(
                key=key,
                label=config.get("name") if isinstance(config.get("name"), str) else None,
                dtype=(
                    config.get("data_type") if isinstance(config.get("data_type"), str) else None
                ),
                required=bool(config.get("required")),
                allowed_values=allowed_by_input.get(key),
            )
        )
    return out


def consumed_inputs_with_coverage(*, db: Database, exposed):  # noqa: ANN001, ANN202
    """The consumed inputs, each annotated with the peer key covering it."""
    to_peer = {e.plan_input_key: e.peer_key for e in exposed.mapping}
    inputs = plan_consumed_inputs(db=db, rating_plan_id=exposed.rating_plan_id)
    return [input.model_copy(update={"mapped_from": to_peer.get(input.key)}) for input in inputs]


def exposed_plan_out(*, db: Database, exposed):  # noqa: ANN001, ANN202
    from openrater.integrations.models import ExposedPlanOut
    from openrater.rates.snapshots.service import (
        get_snapshot_with_body,
        publish_overview_for_plans,
    )

    plan = get_plan(db=db, rating_plan_id=exposed.rating_plan_id)
    # Publish facts via the D-F batch read (json_extract, no body blobs) —
    # one light read serves three facts: whether anything is published,
    # the version NAME for operator copy ("live is v2"), and the id the
    # drift predicate compares the test receipt against.
    pub_facts = publish_overview_for_plans(
        db=db, plan_ids=[exposed.rating_plan_id]
    ).get(exposed.rating_plan_id)
    published_snapshot_id = (
        pub_facts.published_snapshot_id if pub_facts else None
    )
    # The §4.5 drift predicate, same semantics as `live_version_untested`:
    # toggle ON but the published version is not the tested one (a missing
    # receipt or nothing published also reads untested).
    untested = exposed.live and not (
        published_snapshot_id is not None
        and published_snapshot_id == exposed.last_test_snapshot_id
    )
    consumed = consumed_inputs_with_coverage(db=db, exposed=exposed)
    required = [c for c in consumed if c.required]
    required_missing = sum(1 for c in required if not c.mapped_from)
    # The receipt names the VERSION, never the snapshot id (Brief 77 §1 —
    # no internal ids in operator copy).
    version_name = None
    if exposed.last_test_snapshot_id:
        receipt_snap = get_snapshot_with_body(
            db=db,
            plan_id=exposed.rating_plan_id,
            snapshot_id=exposed.last_test_snapshot_id,
        )
        version_name = receipt_snap.display_name if receipt_snap else None
    return ExposedPlanOut(
        exposed_id=exposed.exposed_id,
        rating_plan_id=exposed.rating_plan_id,
        plan_display_name=plan.display_name if plan else None,
        product=str(plan.product) if plan and plan.product else None,
        state=plan.jurisdiction if plan else None,
        published=published_snapshot_id is not None,
        published_snapshot_id=published_snapshot_id,
        published_version_name=(
            pub_facts.published_display_name if pub_facts else None
        ),
        plan_ref=exposed.plan_ref,
        carrier_label=exposed.carrier_label,
        mapping=exposed.mapping,
        required_mapped=sum(1 for e in exposed.mapping if e.required),
        optional_mapped=sum(1 for e in exposed.mapping if not e.required),
        consumed_required=len(required),
        consumed_missing=required_missing,
        trace_policy=exposed.trace_policy,
        validity_days=exposed.validity_days,
        live=exposed.live,
        status=_hub_status(exposed, required_missing=required_missing),  # type: ignore[arg-type]
        # The operator-facing drift flag: toggle ON but the live version is
        # not the tested one → the seam has demoted it from serving until a
        # re-test (Brief 77 step 5). `status` still reads `live` (the toggle
        # state); this is what reconciles "toggle on" with "not serving".
        live_version_untested=untested,
        last_test_at=exposed.last_test_at,
        last_test_premium_cents=exposed.last_test_premium_cents,
        last_test_snapshot_id=exposed.last_test_snapshot_id,
        last_test_version_name=version_name,
        created_at=exposed.created_at,
    )


def plan_connections(*, db: Database, rating_plan_id: str):  # noqa: ANN202
    """Brief 84 D-D — the Ship Connect card's read model: every
    integration's exposure of THIS plan, each wrapped in the Hub's own
    `exposed_plan_out` (one journey ladder, two surfaces, zero drift),
    plus the platform facts the empty states key off (`any_integration`,
    `any_paired`). Plan-side READ only — expose/map/test/live stay Hub
    verbs."""
    from openrater.integrations.models import PlanConnectionOut, PlanConnectionsOut
    from openrater.integrations.repo import (
        list_exposed_plans_for_plan,
        list_integrations,
    )

    integrations = {r["integration_id"]: r for r in list_integrations(db=db)}
    connections = []
    for exposed in list_exposed_plans_for_plan(db=db, rating_plan_id=rating_plan_id):
        integ = integrations.get(exposed.integration_id)
        if integ is None:  # FK guarantees this; belt-and-braces
            continue
        connections.append(
            PlanConnectionOut(
                integration_id=exposed.integration_id,
                integration_name=integ["name"],
                paired=integ["paired_at"] is not None,
                exposed=exposed_plan_out(db=db, exposed=exposed),
            )
        )
    return PlanConnectionsOut(
        any_integration=len(integrations) > 0,
        any_paired=any(r["paired_at"] is not None for r in integrations.values()),
        connections=connections,
    )


def expose_plan(
    *,
    db: Database,
    integration_id: str,
    rating_plan_id: str,
    carrier_label: str,
    trace_policy: str,
    validity_days: int,
):
    from openrater.integrations.repo import insert_exposed_plan

    if get_integration(db=db, integration_id=integration_id) is None:
        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    if get_plan(db=db, rating_plan_id=rating_plan_id) is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    # Brief 77 §5 — published versions only. The wizard teaches this with
    # a disabled row; the seam enforces it regardless of the client.
    from openrater.rates.snapshots.service import get_published_snapshot

    if get_published_snapshot(db=db, plan_id=rating_plan_id) is None:
        raise ValidationError(
            "This plan has no published version yet — freeze and publish "
            "one in its Ship tab first, then expose it here.",
            code="plan_not_published",
            param="rating_plan_id",
        )
    exposed_id = "iep_" + secrets.token_hex(6)
    try:
        insert_exposed_plan(
            db=db,
            exposed_id=exposed_id,
            integration_id=integration_id,
            rating_plan_id=rating_plan_id,
            plan_ref="ipl_" + secrets.token_hex(6),
            carrier_label=carrier_label.strip(),
            mapping=[],
            trace_policy=trace_policy,
            validity_days=validity_days,
            live=False,
            created_at=_iso(_now()),
        )
    except Exception as exc:  # sqlite UNIQUE — label or plan already exposed
        raise ValidationError(
            "That carrier label or plan is already exposed on this "
            "integration — labels and plans are one-to-one (§1.1).",
            code="exposed_plan_conflict",
        ) from exc
    exposed = get_exposed_plan_or_404(db=db, integration_id=integration_id, exposed_id=exposed_id)
    return exposed_plan_out(db=db, exposed=exposed)


def get_exposed_plan_or_404(*, db: Database, integration_id: str, exposed_id: str):
    from openrater.integrations.repo import get_exposed_plan

    exposed = get_exposed_plan(db=db, integration_id=integration_id, exposed_id=exposed_id)
    if exposed is None:
        raise NotFoundError(
            f"Exposed plan {exposed_id!r} not found on this integration.",
            code="exposed_plan_not_found",
            param="exposed_id",
        )
    return exposed


def integration_pulse(*, db: Database, integration_id: str):
    from openrater.integrations.models import IntegrationPulse
    from openrater.integrations.repo import events_pulse

    if get_integration(db=db, integration_id=integration_id) is None:
        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    exposed = list_exposed_plans(db=db, integration_id=integration_id)
    feed = events_pulse(db=db, integration_id=integration_id)

    def _required_missing(p) -> int:  # noqa: ANN001 — ExposedPlan
        consumed = consumed_inputs_with_coverage(db=db, exposed=p)
        return sum(1 for c in consumed if c.required and not c.mapped_from)

    return IntegrationPulse(
        plans_exposed=len(exposed),
        # Same composed derivation as the descriptor — a plan whose
        # republished version outran its mapping (coverage) or its test
        # receipt (drift) is NOT live, and the pulse must not say otherwise.
        plans_live=sum(
            1
            for p in exposed
            if _journey_status(
                p,
                required_missing=_required_missing(p),
                untested=live_version_untested(db=db, exposed=p),
            )
            == "live"
        ),
        events_applied=feed["applied"],
        events_duplicate=feed["duplicate"],
        events_error=feed["error"],
        last_event_at=feed["last_at"],
    )


# ── the descriptor (§3) ─────────────────────────────────────────────────────


def build_descriptor(*, db: Database, integration_id: str) -> Descriptor:
    """The machine-readable statement of the integration. required_fields
    are DERIVED, never authored: each exposed plan's mapping entries,
    partitioned by the `required` flag, emitted in PEER vocabulary."""
    if get_integration(db=db, integration_id=integration_id) is None:
        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    plans: list[DescriptorPlan] = []
    for exposed in list_exposed_plans(db=db, integration_id=integration_id):
        plan = get_plan(db=db, rating_plan_id=exposed.rating_plan_id)
        required = [
            DescriptorFieldSpec(key=e.peer_key, dtype=e.dtype, unit=e.unit)
            for e in exposed.mapping
            if e.required
        ]
        optional = [
            DescriptorFieldSpec(key=e.peer_key, dtype=e.dtype, unit=e.unit)
            for e in exposed.mapping
            if not e.required
        ]
        # Coverage against the CURRENT published version — a republish
        # that consumes new required inputs the mapping doesn't cover
        # demotes the wire status to `unmapped` (§3), and an untested
        # live version demotes to `paused` (§4.5) — the integrator learns
        # from the descriptor, not from reason-less refusals.
        consumed = consumed_inputs_with_coverage(db=db, exposed=exposed)
        required_missing = sum(
            1 for c in consumed if c.required and not c.mapped_from
        )
        status = _journey_status(
            exposed,
            required_missing=required_missing,
            untested=live_version_untested(db=db, exposed=exposed),
        )
        plans.append(
            DescriptorPlan(
                carrier=exposed.carrier_label,
                plan_ref=exposed.plan_ref,
                product=str(plan.product) if plan and plan.product else None,
                state=plan.jurisdiction if plan else None,
                status=status,
                required_fields=required,
                optional_fields=optional,
                trace_policy=exposed.trace_policy,
                validity_days=exposed.validity_days,
            )
        )
    plans.sort(key=lambda p: p.carrier)  # §4.2's ordering, everywhere
    return Descriptor(
        contract_version=CONTRACT_VERSION,
        integration_id=integration_id,
        labs={"engine_contract": "v1", "deployment": "self-hosted"},
        plans=plans,
        events={"accepted_kinds": list(ACCEPTED_EVENT_KINDS)},
    )
