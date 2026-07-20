#!/bin/sh
# Build the desktop `openrater-server` one-dir bundle.
# Output: packaging/desktop/dist/openrater-server/
set -e
cd "$(dirname "$0")/../.."
exec uv run --project server --with pyinstaller \
  python -m PyInstaller --clean -y \
  --distpath packaging/desktop/dist \
  --workpath packaging/desktop/build \
  packaging/desktop/openrater-server.spec
