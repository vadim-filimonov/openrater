# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Unit tests for the bundled-template seeder's reconcile pass (K9).

`recipes/*.json` is the source of truth: after upserting every recipe
file the seeder prunes DB rows that no longer have a backing file, so a
removed recipe (like the old ``nonprofit_990``) stops being
materializable by ``/from-template`` instead of lingering in the DB.

The prune is GUARDED — a recipe that fails to parse aborts the prune,
because a malformed file means we can't know which ``template_id`` it
was meant to back, and deleting "unseen" rows could wrongly wipe a
valid template.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from openrater.persistence.db import Database
from openrater.rates.templates import seed as seed_mod
from openrater.rates.templates.models import UpsertTemplateRequest
from openrater.rates.templates.repo import (
    get_template,
    list_template_ids,
    upsert_template,
)
from openrater.rates.templates.seed import seed_bundled_templates


def _make_db() -> tuple[Database, Path]:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    return Database(db_path), db_path


def _cleanup(db_path: Path) -> None:
    if db_path.exists():
        db_path.unlink()
    for ext in ("-wal", "-shm"):
        sidecar = db_path.with_suffix(db_path.suffix + ext)
        if sidecar.exists():
            sidecar.unlink()


def _orphan_request() -> UpsertTemplateRequest:
    """A template with no backing recipe file on disk."""
    return UpsertTemplateRequest(
        template_id="ghost_template",
        display_name="Ghost",
        line_of_business="cgl",
        recipe={"stages": []},
    )


def test_prunes_orphan_rows_with_no_backing_recipe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A DB row whose recipe file is gone is deleted on seed."""
    # Point the seeder at an EMPTY recipes dir → seen_ids is empty →
    # every existing row is an orphan and must be pruned.
    monkeypatch.setattr(seed_mod, "_RECIPES_DIR", tmp_path)
    db, db_path = _make_db()
    try:
        upsert_template(db=db, req=_orphan_request())
        assert "ghost_template" in list_template_ids(db=db)

        seed_bundled_templates(db=db)

        assert get_template(db=db, template_id="ghost_template") is None
        assert "ghost_template" not in list_template_ids(db=db)
    finally:
        _cleanup(db_path)


def test_skips_prune_when_a_recipe_fails_to_parse(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A malformed recipe file aborts the prune pass so valid rows
    survive — a single bad file must not wipe the table."""
    (tmp_path / "broken.json").write_text("{ not valid json", encoding="utf-8")
    monkeypatch.setattr(seed_mod, "_RECIPES_DIR", tmp_path)
    db, db_path = _make_db()
    try:
        upsert_template(db=db, req=_orphan_request())

        seed_bundled_templates(db=db)

        # Guard held: the orphan is untouched because parsing errored.
        assert get_template(db=db, template_id="ghost_template") is not None
    finally:
        _cleanup(db_path)
