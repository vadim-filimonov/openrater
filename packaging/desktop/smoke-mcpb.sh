#!/bin/sh
# Unpack the built extension and prove its complete seeded MCP loop works.
set -e
cd "$(dirname "$0")/../.."

ART=$(find packaging/desktop/dist -maxdepth 1 -name '*.mcpb' -print)
[ -n "$ART" ] || { echo "smoke-mcpb: no packed artifact found"; exit 1; }
[ "$(printf '%s\n' "$ART" | wc -l | tr -d ' ')" = "1" ] \
  || { echo "smoke-mcpb: expected exactly one packed artifact"; exit 1; }

EXTRACT="${RUNNER_TEMP:-/tmp}/mcpb-extract"
DATA="${RUNNER_TEMP:-/tmp}/mcpb-data"
rm -rf "$EXTRACT" "$DATA"
unzip -q "$ART" -d "$EXTRACT"

cd services/mcp
MCP_ENTRY="$EXTRACT/mcp/index.mjs" \
RATER_BUNDLE_ROOT="$EXTRACT" \
RATER_DATA_DIR="$DATA" \
RATER_SEED_COLD_TEST=0 \
node scripts/demo-loop.mjs | tee "${RUNNER_TEMP:-/tmp}/openrater-loop.log"

grep -q "premium=1898" "${RUNNER_TEMP:-/tmp}/openrater-loop.log"
grep -q "P1 loop complete" "${RUNNER_TEMP:-/tmp}/openrater-loop.log"
