# -*- mode: python ; coding: utf-8 -*-
# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
#
# PyInstaller spec — the desktop `openrater-server` one-dir bundle.
# Build via packaging/desktop/build-server.sh; output
# lands in packaging/desktop/dist/openrater-server/.
#
# One-DIR (not one-file) deliberately: no self-extraction on every
# boot, so warm start stays fast (< 3s target) and the binary is
# signable file-by-file for notarization.

from pathlib import Path

SPEC_DIR = Path(SPECPATH).resolve()
REPO = SPEC_DIR.parents[1]
SRC = REPO / "server" / "src"
OVERLAY = REPO / "deploy" / "overlay"

# Every __file__/importlib.resources data root the server reads at
# runtime (enumerated, not globbed-by-hope — new data roots must be
# added here and will fail loudly in the P3 smoke otherwise):
#   · persistence/migrations/*.sql        (the schema baseline)
#   · rates/ingest/assets/*               (spec, template, example)
#   · rates/ingest/capability_registry.json
datas = [
    (str(SRC / "openrater" / "persistence" / "migrations"),
     "openrater/persistence/migrations"),
    (str(SRC / "openrater" / "rates" / "ingest" / "assets"),
     "openrater/rates/ingest/assets"),
    (str(SRC / "openrater" / "rates" / "ingest" / "capability_registry.json"),
     "openrater/rates/ingest"),
]

a = Analysis(
    [str(SPEC_DIR / "desktop_main.py")],
    pathex=[str(SRC), str(OVERLAY)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        # The overlay is imported by dotted name at runtime.
        "openrater_deploy",
        "openrater_deploy.app",
        "openrater_deploy.seed",
        "openrater_deploy.wire",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # Overlay-only dependency for the Cloudflare deploy path; the
        # desktop runs RATER_AUTH_MODE=none and never imports it.
        "jwt",
        # Dev/test baggage that must not ride into the bundle.
        "pytest", "pip", "setuptools", "wheel",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="openrater-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="openrater-server",
)
