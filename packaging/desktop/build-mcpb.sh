#!/bin/sh
# Build the OpenRater Desktop Extension (.mcpb).
#
# Assembles every artifact into one bundle root and packs it with the
# official mcpb toolchain:
#
#   mcpb-root/
#     manifest.json        (from manifest.template.json, version stamped)
#     mcp/index.mjs        (the MCP server, esbuild single file — runs
#                           on Claude Desktop's own Node)
#     server/              (PyInstaller one-dir openrater-server)
#     scoring/server.mjs   (the scoring sidecar bundle)
#     spa/                 (the review UI, same-origin build)
#     fixtures/            (the seeded Meridian reference plan)
#     SKILL.md             (the transcription runbook, for reading)
#
# Output: packaging/desktop/dist/openrater-<version>-<platform>.mcpb
# This script creates an unsigned bundle. Release CI signs the native
# binaries, notarizes macOS artifacts, and then re-packs the bundle.
set -e
cd "$(dirname "$0")/../.."
REPO="$PWD"
OUT="$REPO/packaging/desktop/dist"
ROOT="$OUT/mcpb-root"
VERSION=$(node -p "require('./services/mcp/package.json').version")
PLATFORM=$(node -p "process.platform + '-' + process.arch")

echo "── [1/6] scoring bundle"
(cd services/scoring && npm run build --silent)

echo "── [2/6] review UI (same-origin build)"
pnpm -r --filter='./packages/*' build >/dev/null
VITE_API_BASE=same-origin pnpm --filter @openrater/app exec vite build \
  --logLevel error

echo "── [3/6] frozen server (PyInstaller)"
"$REPO/packaging/desktop/build-server.sh" >/dev/null

echo "── [4/6] MCP server bundle (esbuild, ESM single file)"
(cd services/mcp && npx esbuild src/main.ts \
  --bundle --platform=node --format=esm --target=node18 \
  --outfile="$OUT/mcp-index.mjs" --log-level=warning)

echo "── [5/6] assemble bundle root"
rm -rf "$ROOT"
mkdir -p "$ROOT/mcp" "$ROOT/scoring" "$ROOT/fixtures"
sed "s/{{VERSION}}/$VERSION/" \
  "$REPO/packaging/desktop/manifest.template.json" > "$ROOT/manifest.json"
# The directory-listing icon (512×512 RGBA, rendered from icon.svg —
# see render-icon.mjs). manifest.json points at it by relative path.
cp "$REPO/packaging/desktop/icon.png" "$ROOT/icon.png"
mv "$OUT/mcp-index.mjs" "$ROOT/mcp/index.mjs"
cp -R "$OUT/openrater-server" "$ROOT/server"
cp services/scoring/dist/server.mjs "$ROOT/scoring/"
cp -R frontend/dist "$ROOT/spa"
cp docs/fixtures/*.plan.json "$ROOT/fixtures/"
# The guided tour includes a demo book and its matching sample filing.
cp docs/fixtures/meridian-demo-book.csv "$ROOT/fixtures/"
cp docs/specs/examples/meridian-shopfront-bop/meridian_shopfront_bop_filing.pdf "$ROOT/fixtures/"
cp skills/transcribe-filing/SKILL.md "$ROOT/SKILL.md"

# MCP hosts may use embedded runtimes that cannot be re-spawned as Node,
# and the destination machine may not have Node installed. Ship the build
# platform's runtime so the extension remains self-contained.
mkdir -p "$ROOT/runtime"
NODE_BIN="$(node -p 'process.execPath')"
NODE_EXT="$(node -p "process.platform === 'win32' ? '.exe' : ''")"
cp "$NODE_BIN" "$ROOT/runtime/node$NODE_EXT"
chmod +x "$ROOT/runtime/node$NODE_EXT"
# Official Node.js builds are self-contained; package-manager builds may
# link a shared libnode via @rpath — copy
# it beside the runtime when needed, then PROVE the runtime runs on its
# own. A bundle whose runtime can't start must fail the build, not the
# user.
if ! "$ROOT/runtime/node$NODE_EXT" -e 'process.exit(0)' 2>/dev/null; then
  mkdir -p "$ROOT/lib"
  cp "$(dirname "$NODE_BIN")"/../lib/libnode*.dylib "$ROOT/lib/" 2>/dev/null || true
  "$ROOT/runtime/node$NODE_EXT" -e 'process.exit(0)' \
    || { echo "FATAL: bundled runtime cannot run standalone ($NODE_BIN)"; exit 1; }
fi
echo "   runtime: $(node -p 'process.version') from $NODE_BIN"

echo "── [6/6] pack"
ARTIFACT="$OUT/openrater-$VERSION-$PLATFORM.mcpb"
npx --yes @anthropic-ai/mcpb pack "$ROOT" "$ARTIFACT"
ls -lh "$ARTIFACT"
