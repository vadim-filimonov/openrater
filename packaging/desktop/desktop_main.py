# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The desktop runtime's server entrypoint.

This is what PyInstaller freezes into `openrater-server`. It honors
the SERVER COMMAND CONTRACT the MCP supervisor spawns it under
(services/mcp/src/runtime.ts): a single executable, no args,
configured entirely by environment —

    RATER_PORT               required in managed runs (default 8001)
    RATER_DB_PATH            SQLite location (~/.openrater/openrater.db)
    RATER_SCORING_URL        where the supervisor put the scoring sidecar
    RATER_AUTH_MODE          defaults to "none" here — loopback only
    RATER_SPA_DIR            the built review UI (skipped when absent)
    RATER_COLD_TEST_FIXTURE  the bundled seed fixtures (no-op when absent)
    RATER_SEED_COLD_TEST     defaults on — the box is never empty

The app itself is the DEPLOY OVERLAY (openrater_deploy.app): the
unchanged OSS core + SPA static serving + the reference-plan seed.
One overlay, two distributions — the Docker image and this binary —
so their behavior can't drift.

Loopback posture: binds 127.0.0.1 only. Nothing listens beyond the
laptop; there is no API key locally (SECURITY.md documents this).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _default_env() -> None:
    """Desktop defaults — set BEFORE the overlay imports (it reads env
    at import time). Never overrides what the supervisor passed."""
    os.environ.setdefault("RATER_AUTH_MODE", "none")
    os.environ.setdefault("RATER_SEED_COLD_TEST", "1")

    data_dir = Path(os.environ.get("RATER_DATA_DIR", Path.home() / ".openrater"))
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("RATER_DB_PATH", str(data_dir / "openrater.db"))

    # Standalone convenience (double-clicking the binary without the
    # supervisor): look for spa/ + fixtures/ beside the bundle. The
    # overlay skips either when the directory doesn't exist.
    bundle_parent = Path(sys.executable).resolve().parent.parent
    os.environ.setdefault("RATER_SPA_DIR", str(bundle_parent / "spa"))
    os.environ.setdefault("RATER_COLD_TEST_FIXTURE", str(bundle_parent / "fixtures"))


def _dev_sys_path() -> None:
    """Running as plain Python from the repo (not frozen): make the
    core + overlay importable. Frozen builds bake both in."""
    if getattr(sys, "frozen", False):
        return
    repo = Path(__file__).resolve().parents[2]
    for p in (repo / "server" / "src", repo / "deploy" / "overlay"):
        sys.path.insert(0, str(p))


def main() -> None:
    _default_env()
    _dev_sys_path()

    import uvicorn

    from openrater_deploy.app import app  # noqa: PLC0415 — after env defaults

    port = int(os.environ.get("RATER_PORT", "8001"))
    print(
        f"openrater-server listening on http://127.0.0.1:{port} "
        f"(db: {os.environ['RATER_DB_PATH']})",
        file=sys.stderr,
        flush=True,
    )
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
