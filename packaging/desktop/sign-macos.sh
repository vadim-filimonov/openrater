#!/bin/sh
# Sign + notarize the assembled macOS bundle root, then re-pack (D14,
# per SIGNING.md — the Apple-only path the owner chose 2026-07-19).
#
# Runs AFTER build-mcpb.sh (the unsigned root + artifact exist) and
# expects these env vars, all supplied by CI secrets:
#
#   MACOS_CERT_P12_BASE64   Developer ID Application cert, .p12, base64
#   MACOS_CERT_PASSWORD     the .p12 password
#   MACOS_SIGN_IDENTITY     e.g. "Developer ID Application: NAME (TEAMID)"
#   NOTARY_APPLE_ID         Apple ID email
#   NOTARY_TEAM_ID          the 10-char team id
#   NOTARY_PASSWORD         an app-specific password
#
# Missing secrets → exit 0 with a note (unsigned dev builds never
# block; the CI step is additive). Signing walks INNER-FIRST per the
# runbook: every Mach-O inside the PyInstaller one-dir, then the
# frozen executable, then the bundled Node runtime. Notarization
# submits a zip of the signed root; bare executables can't be stapled,
# so Gatekeeper verifies the ticket online at first launch.
set -e
cd "$(dirname "$0")/../.."
ROOT="$PWD/packaging/desktop/dist/mcpb-root"
OUT="$PWD/packaging/desktop/dist"

if [ -z "$MACOS_CERT_P12_BASE64" ]; then
  echo "sign-macos: signing secrets absent — skipping (unsigned dev build)."
  exit 0
fi
[ -d "$ROOT" ] || { echo "sign-macos: no bundle root at $ROOT — run build-mcpb.sh first"; exit 1; }

echo "── import cert into a throwaway keychain"
KEYCHAIN="$RUNNER_TEMP/signing.keychain-db"
KEYCHAIN_PW="$(uuidgen)"
echo "$MACOS_CERT_P12_BASE64" | base64 -d > "$RUNNER_TEMP/cert.p12"
security create-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security set-keychain-settings -lut 1800 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN" \
  -P "$MACOS_CERT_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s \
  -k "$KEYCHAIN_PW" "$KEYCHAIN" > /dev/null
security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
rm -f "$RUNNER_TEMP/cert.p12"

# sign <file> [entitlements.plist] — hardened runtime always; the
# optional plist is for the ONE binary that JITs (runtime/node).
sign() {
  if [ -n "${2:-}" ]; then
    codesign --force --options runtime --timestamp --entitlements "$2" \
      --keychain "$KEYCHAIN" --sign "$MACOS_SIGN_IDENTITY" "$1"
  else
    codesign --force --options runtime --timestamp \
      --keychain "$KEYCHAIN" --sign "$MACOS_SIGN_IDENTITY" "$1"
  fi
}

echo "── sign inner Mach-Os (PyInstaller one-dir), inner-first"
find "$ROOT/server" -type f \( -name '*.so' -o -name '*.dylib' \) \
  -print0 | while IFS= read -r -d '' f; do sign "$f"; done
sign "$ROOT/server/openrater-server"

echo "── sign the bundled Node runtime (JIT entitlements — PRE-1)"
# Hardened runtime WITHOUT allow-jit kills V8's code-range reservation:
# the signed node then dies on any real script while `node --version`
# still passes — exactly how v0.1.0 shipped with a dead scoring
# sidecar. The entitlements ride the main executable only; dylibs are
# signed plain.
sign "$ROOT/runtime/node" "$PWD/packaging/desktop/node.entitlements.plist"
for lib in "$ROOT"/lib/libnode*.dylib; do
  [ -e "$lib" ] || continue
  sign "$lib"
done

echo "── prove the SIGNED runtime still executes real JS (PRE-1 gate)"
# Runs before re-pack + notarize, so a bad signature fails the build —
# never the actuary. Notarization does NOT catch a missing JIT
# entitlement; only executing real JS does.
"$PWD/packaging/desktop/verify-node-runtime.sh" "$ROOT/runtime/node"

echo "── re-pack the signed root"
VERSION=$(node -p "require('./services/mcp/package.json').version")
PLATFORM=$(node -p "process.platform + '-' + process.arch")
ARTIFACT="$OUT/openrater-$VERSION-$PLATFORM.mcpb"
npx --yes @anthropic-ai/mcpb pack "$ROOT" "$ARTIFACT"

echo "── notarize (ticket is server-side; bare binaries aren't stapled)"
ditto -c -k --keepParent "$ROOT" "$RUNNER_TEMP/notarize.zip"
xcrun notarytool submit "$RUNNER_TEMP/notarize.zip" \
  --apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" \
  --password "$NOTARY_PASSWORD" --wait

echo "sign-macos: signed + notarized $ARTIFACT"
