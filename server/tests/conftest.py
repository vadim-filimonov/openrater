# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Shared pytest fixtures + helpers for the api-lab test suite.

Centralizes the throwaway-SQLite + TestClient pattern so individual
test files don't duplicate it. Two flavors:

  · `client` — bare `TestClient` against a fresh DB. Use for endpoint
    integration tests.
  · `seeded_client` — `TestClient` + a pre-created plan. Use when the
    test starts from "I already have a plan and want to mutate it".
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _cleanup_db(db_path: Path) -> None:
    """Remove the SQLite file + WAL + SHM sidecars created by the test."""
    if db_path.exists():
        db_path.unlink()
    for ext in ("-wal", "-shm"):
        sidecar = db_path.with_suffix(db_path.suffix + ext)
        if sidecar.exists():
            sidecar.unlink()


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    """A `TestClient` wired against a throwaway SQLite DB.

    Each test gets a fresh DB; cleanup deletes the file + sidecars.
    Auth resolver is reset to default at teardown so tests that
    register a custom resolver don't leak to other tests.
    """
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    os.environ["RATER_DB_PATH"] = str(db_path)
    try:
        from openrater.main import create_app

        app = create_app()
        with TestClient(app) as c:
            yield c
    finally:
        # Reset auth resolver in case a test registered one + didn't reset.
        try:
            from openrater.auth import reset_operator_resolver

            reset_operator_resolver()
        except ImportError:
            pass
        _cleanup_db(db_path)
        os.environ.pop("RATER_DB_PATH", None)


# Helper functions live in `tests/_helpers.py` so per-route test files
# import them with `from tests._helpers import create_plan`.
