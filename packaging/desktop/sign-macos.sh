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
# available. Release builds find and sign every Mach-O file before
# submitting a zip of the signed root for notarization. Bare executables
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

echo "── sign every Mach-O in the bundle, deepest-first"
# Apple rejects any unsigned Mach-O, including helper binaries without a
# conventional extension. Inspect file contents and sign nested code first.
MACHO_LIST="$RUNNER_TEMP/macho.list"
: > "$MACHO_LIST"
find "$ROOT" -type f | while IFS= read -r f; do
  if file -b "$f" 2>/dev/null | grep -q 'Mach-O'; then
    printf '%s\t%s\n' "$(printf '%s' "$f" | tr -cd '/' | wc -c)" "$f" \
      >> "$MACHO_LIST"
  fi
done
COUNT=$(wc -l < "$MACHO_LIST" | tr -d ' ')
echo "   $COUNT Mach-O files to sign"
sort -rn "$MACHO_LIST" | cut -f2- | while IFS= read -r f; do sign "$f"; done

echo "── re-pack the signed root"
VERSION=$(node -p "require('./services/mcp/package.json').version")
PLATFORM=$(node -p "process.platform + '-' + process.arch")
ARTIFACT="$OUT/openrater-$VERSION-$PLATFORM.mcpb"
npx --yes @anthropic-ai/mcpb pack "$ROOT" "$ARTIFACT"

echo "── notarize: submit, then poll (ticket is server-side)"
# Polling uses short, independent requests so a transient network error or
# a slow Apple queue does not discard an otherwise valid submission.
ditto -c -k --keepParent "$ROOT" "$RUNNER_TEMP/notarize.zip"
SUBMIT_JSON=$(xcrun notarytool submit "$RUNNER_TEMP/notarize.zip" \
  --apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" \
  --password "$NOTARY_PASSWORD" --output-format json --no-wait)
echo "$SUBMIT_JSON"
SUBMIT_ID=$(printf '%s' "$SUBMIT_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
[ -n "$SUBMIT_ID" ] || { echo "notarize: submit returned no id"; exit 1; }
echo "── submission $SUBMIT_ID — polling for up to 150 minutes"

NOTARY_STATUS="In Progress"
i=0
while [ "$i" -lt 300 ]; do
  i=$((i + 1))
  sleep 30
  INFO=$(xcrun notarytool info "$SUBMIT_ID" \
    --apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" \
    --password "$NOTARY_PASSWORD" --output-format json 2>/dev/null) || {
      echo "   poll $i: transient error — retrying"; continue; }
  NOTARY_STATUS=$(printf '%s' "$INFO" | python3 -c "import json,sys;print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  echo "   poll $i: $NOTARY_STATUS"
  case "$NOTARY_STATUS" in Accepted | Invalid | Rejected) break ;; esac
done

echo "── notarization: $NOTARY_STATUS (submission $SUBMIT_ID)"
if [ "$NOTARY_STATUS" != "Accepted" ]; then
  echo "── Not accepted — Apple's detailed findings:"
  xcrun notarytool log "$SUBMIT_ID" \
    --apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" \
    --password "$NOTARY_PASSWORD" || true
  exit 1
fi

echo "sign-macos: signed + notarized $ARTIFACT"
