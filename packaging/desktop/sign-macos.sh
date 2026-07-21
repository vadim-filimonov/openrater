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

# PyInstaller links _internal/Python into Python.framework, and codesign
# gives the framework binary a bundle-context signature that leans on its
# _CodeSignature sidecar. Zip packing materializes symlinks into copies,
# orphaning that signature — the shipped copy then fails dyld validation.
# Materialize Mach-O symlinks now and give each copy its own flat,
# self-contained signature.
find "$ROOT" -type l | while IFS= read -r l; do
  # Framework-internal symlinks are bundle plumbing; their materialized
  # copies are never loaded, and codesign refuses paths like
  # Foo.framework/Foo as "bundle format is ambiguous". Leave them be.
  case "$l" in *.framework/*) continue ;; esac
  t="$(readlink -f "$l" 2>/dev/null)" || continue
  [ -f "$t" ] || continue
  if file -b "$t" 2>/dev/null | grep -q 'Mach-O'; then
    rm "$l" && cp "$t" "$l" && sign "$l"
    echo "   materialized + flat-signed: $l"
  fi
done

# Forensics: prove the signatures are valid at each stage, so a runtime
# "code signature invalid" can be pinned to the stage that broke it.
echo "── verify signed root (spot-check)"
for f in "$ROOT/server/_internal/Python" "$ROOT/server/openrater-server" \
  "$ROOT/runtime/node"; do
  [ -f "$f" ] || { echo "   missing: $f"; continue; }
  codesign -dvv "$f" 2>&1 | grep -E 'CodeDirectory|Signature size' | head -2
  codesign --verify --verbose=2 "$f" && echo "   OK: $f" \
    || echo "   VERIFY FAILED IN ROOT: $f"
done

echo "── re-pack the signed root"
VERSION=$(node -p "require('./services/mcp/package.json').version")
PLATFORM=$(node -p "process.platform + '-' + process.arch")
ARTIFACT="$OUT/openrater-$VERSION-$PLATFORM.mcpb"
npx --yes @anthropic-ai/mcpb pack "$ROOT" "$ARTIFACT"

echo "── verify the packed artifact roundtrip"
RT="$RUNNER_TEMP/rt-extract"
rm -rf "$RT" && mkdir -p "$RT"
unzip -q "$ARTIFACT" -d "$RT"
if cmp -s "$ROOT/server/_internal/Python" "$RT/server/_internal/Python"; then
  echo "   python bytes identical root vs artifact"
else
  echo "   PYTHON BYTES DIFFER root vs artifact"
fi
codesign --verify --verbose=2 "$RT/server/_internal/Python" \
  && echo "   OK: artifact python" || echo "   VERIFY FAILED IN ARTIFACT: python"
# The kernel-grade check: static verify can pass where dyld refuses.
python3 -c "import ctypes; ctypes.CDLL('$RT/server/_internal/Python')" \
  && echo "   dlopen OK: artifact python" || echo "   DLOPEN FAILED IN ARTIFACT: python"

if [ "${NOTARY_SKIP:-0}" = "1" ]; then
  echo "── NOTARY_SKIP=1 — diagnostic build; not submitting to Apple"
  echo "sign-macos: signed (not submitted) $ARTIFACT"
  exit 0
fi

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
echo "── submission $SUBMIT_ID — polling for up to ~5 hours"

NOTARY_STATUS="In Progress"
i=0
while [ "$i" -lt 550 ]; do
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
case "$NOTARY_STATUS" in
  Accepted)
    echo "sign-macos: signed + notarized $ARTIFACT"
    ;;
  Invalid | Rejected)
    echo "── Not accepted — Apple's detailed findings:"
    xcrun notarytool log "$SUBMIT_ID" \
      --apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" \
      --password "$NOTARY_PASSWORD" || true
    exit 1
    ;;
  *)
    # Apple's queue outlasted the wait. The ticket attaches server-side to
    # these exact bytes whenever acceptance lands, so a timeout must never
    # discard the signed artifact — keep it and verify out-of-band.
    echo "── WARNING: still '$NOTARY_STATUS' after the full wait."
    echo "── Keeping the signed artifact; acceptance attaches retroactively."
    echo "── Verify later: xcrun notarytool info $SUBMIT_ID"
    echo "sign-macos: signed (notarization pending) $ARTIFACT"
    ;;
esac
