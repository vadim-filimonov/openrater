#!/bin/sh
# Sign and notarize the assembled macOS bundle root, then re-pack it.
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
# Missing secrets exit successfully so local development builds remain
# available. Release builds sign nested code before outer code, then
# submit a zip of the signed root for notarization. Bare executables
# cannot be stapled, so Gatekeeper verifies the ticket online at first
# launch.
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

sign() {
  codesign --force --options runtime --timestamp \
    --keychain "$KEYCHAIN" --sign "$MACOS_SIGN_IDENTITY" "$1"
}

echo "── sign inner Mach-Os (PyInstaller one-dir), inner-first"
find "$ROOT/server" -type f \( -name '*.so' -o -name '*.dylib' \) \
  -print0 | while IFS= read -r -d '' f; do sign "$f"; done
sign "$ROOT/server/openrater-server"

echo "── sign the bundled Node runtime"
sign "$ROOT/runtime/node"
for lib in "$ROOT"/lib/libnode*.dylib; do
  [ -e "$lib" ] && sign "$lib"
done

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
