# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Bundled-template seeder.

On lifespan startup the app calls `seed_bundled_templates(db=...)`.
The function walks every `*.json` file in `recipes/`, validates them
into `UpsertTemplateRequest`, upserts each one, then prunes any DB row
whose backing recipe file is gone. Idempotent — re-running is a no-op
(modulo `updated_at`).

Adding a bundled template is one file: drop a JSON in `recipes/`
matching the `UpsertTemplateRequest` shape, restart the server, the
template is in the gallery. Removing one is the inverse: delete the
file and restart — the reconcile pass prunes the now-orphaned DB row
so `recipes/` stays the single source of truth for *bundled*
templates. (This is why a removed recipe like the old `nonprofit_990`
stops being materializable by `/from-template`, instead of lingering
in the DB — cold-test finding K9.)

The reconcile is GUARDED: if any recipe file fails to parse we skip
the delete pass entirely. A malformed file means we can't know which
`template_id` it was meant to back, so deleting "unseen" rows could
wrongly wipe a valid template. Better to leave the DB untouched until
the bad file is fixed.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from openrater.persistence.db import Database
from openrater.rates.templates.models import UpsertTemplateRequest
from openrater.rates.templates.repo import (
    delete_template,
    list_template_ids,
    upsert_template,
)

_RECIPES_DIR = Path(__file__).parent / "recipes"
_log = logging.getLogger(__name__)


def seed_bundled_templates(*, db: Database) -> int:
    """Upsert every bundled recipe, then prune orphaned DB rows.

    Returns the count of templates written (always == file count when
    no errors). Recipe files in ``recipes/`` are the source of truth:
    a row in ``plan_templates`` with no backing file is deleted, unless
    a parse error makes that unsafe (see the module docstring).
    """
    if not _RECIPES_DIR.exists():
        return 0

    written = 0
    seen_ids: set[str] = set()
    had_errors = False
    for path in sorted(_RECIPES_DIR.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            req = UpsertTemplateRequest.model_validate(payload)
            upsert_template(db=db, req=req)
            seen_ids.add(req.template_id)
            written += 1
        except Exception:  # noqa: BLE001 — seed is best-effort
            had_errors = True
            _log.exception("Failed to seed template from %s", path)

    # Reconcile: prune DB rows whose recipe file is gone, so `recipes/`
    # is the single source of truth for bundled templates. Skipped on
    # any parse error so a single bad file can't wipe valid templates.
    if not had_errors:
        orphans = list_template_ids(db=db) - seen_ids
        for template_id in sorted(orphans):
            delete_template(db=db, template_id=template_id)
            _log.info(
                "Pruned orphaned bundled template %r (no backing recipe file)",
                template_id,
            )

    return written
