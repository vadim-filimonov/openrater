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

# PRE-1 gate on the EXACT shipped bytes (post-sign, post-pack): a
# hardened-runtime signature without JIT entitlements passes
# `node --version` but dies on real JS — v0.1.0 shipped that way.
# Also proves the pack/unpack path kept the exec bit.
NODE_RT="$EXTRACT/runtime/node"
[ "${RUNNER_OS:-}" = "Windows" ] && NODE_RT="$NODE_RT.exe"
bash packaging/desktop/verify-node-runtime.sh "$NODE_RT"

cd services/mcp
MCP_ENTRY="$EXTRACT/mcp/index.mjs" \
RATER_BUNDLE_ROOT="$EXTRACT" \
RATER_DATA_DIR="$DATA" \
RATER_SEED_COLD_TEST=0 \
node scripts/demo-loop.mjs 2>&1 | tee "${RUNNER_TEMP:-/tmp}/openrater-loop.log"

grep -q "premium=1898" "${RUNNER_TEMP:-/tmp}/openrater-loop.log"
grep -q "P1 loop complete" "${RUNNER_TEMP:-/tmp}/openrater-loop.log"

# A degraded boot (engine up, scoring down) means the bundled sidecar
# runtime is dead — the loop above passes anyway because its numbers
# come from the Python engine. Fail loudly. (Explicit if/exit:
# `! grep` is exempt from set -e.)
if grep -q "degraded boot" "${RUNNER_TEMP:-/tmp}/openrater-loop.log"; then
  echo "FATAL: degraded boot — the bundled scoring runtime is dead"; exit 1
fi
if grep -qi "scoring worker killed" "${RUNNER_TEMP:-/tmp}/openrater-loop.log"; then
  echo "FATAL: the scoring worker died — see the loop log above"; exit 1
fi
