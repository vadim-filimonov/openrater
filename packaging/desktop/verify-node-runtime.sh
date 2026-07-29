#!/bin/sh
# verify-node-runtime.sh <path-to-node-binary> — the PRE-1 gate.
#
# Proves the bundled Node runtime can execute REAL JavaScript. A
# hardened-runtime signature without JIT entitlements kills V8 the
# moment it reserves its CodeRange — but `node --version` and
# `node -e 'process.exit(0)'` both exit BEFORE that happens, which is
# exactly how v0.1.0 shipped with a dead scoring sidecar (FCA PRE-1).
# So this gate runs a workload that forces the code-range reservation
# and JIT tiers (hot loop + JSON round-trip) and asserts exact output.
#
# Runs three times per release: pre-sign (build-mcpb.sh), post-sign
# (sign-macos.sh, before re-pack/notarize), and on the unpacked
# artifact (desktop-build.yml smoke) — so the exact shipped bytes are
# proven on every platform. Plain POSIX sh, no codesign concepts:
# correct on macOS, Windows (Git Bash, runtime/node.exe), and any
# future linux lane.
set -u

BIN="${1:?usage: verify-node-runtime.sh <node-binary>}"

[ -f "$BIN" ] || { echo "verify-node-runtime FATAL: no node binary at $BIN"; exit 1; }
[ -x "$BIN" ] || {
  echo "verify-node-runtime FATAL: $BIN is not executable."
  echo "  (If this is an unpacked artifact, the pack/unpack path may have dropped the exec bit.)"
  exit 1
}

# Sum forces the optimizing JIT tiers on a hot loop; the JSON
# round-trip + array exercise allocation and the parser. Expected
# values are exact: sum(2i, i<1e6) = 999999000000; arr[999] = 1998.
EXPECT="RUNTIME_OK 999999000000 1998"
JS='let a=0;for(let i=0;i<1e6;i++)a+=i*2;const arr=Array.from({length:1000},function(_,i){return i*2;});const r=JSON.parse(JSON.stringify({a:a,arr:arr}));if(r.a!==a)throw new Error("roundtrip mismatch");console.log("RUNTIME_OK",r.a,r.arr[999]);'

OUT=$("$BIN" -e "$JS" 2>&1)
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "verify-node-runtime FATAL: bundled node died running real JS (exit $STATUS)."
  echo "  This is a signing/entitlements defect in the BUILD, not the user's environment"
  echo "  (a hardened-runtime signature without com.apple.security.cs.allow-jit — see"
  echo "  packaging/desktop/node.entitlements.plist). \`node --version\` passing means"
  echo "  nothing: it exits before V8 reserves its code range."
  echo "── output ──"
  echo "$OUT"
  exit 1
fi
if [ "$OUT" != "$EXPECT" ]; then
  echo "verify-node-runtime FATAL: bundled node produced wrong output."
  echo "  expected: $EXPECT"
  echo "  actual:   $OUT"
  exit 1
fi
echo "verify-node-runtime: OK — $("$BIN" --version 2>/dev/null) at $BIN ran real JS (code range + JIT proven)"
