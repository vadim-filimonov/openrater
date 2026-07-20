# Signing and notarization

The `desktop-build` workflow builds macOS Apple Silicon, macOS Intel,
and Windows extension artifacts. macOS release artifacts are signed
with an Apple Developer ID certificate and submitted to Apple's
notarization service. Windows code signing is not configured yet.

Local builds remain convenient: when the Apple secrets are absent,
`packaging/desktop/sign-macos.sh` exits successfully and leaves the
artifact unsigned. An unsigned artifact is for development only and
must not be published as a release.

## Required GitHub Actions secrets

| Secret | Value |
| --- | --- |
| `MACOS_CERT_P12_BASE64` | Base64-encoded Developer ID Application certificate (`.p12`) |
| `MACOS_CERT_PASSWORD` | Password used when exporting the `.p12` |
| `MACOS_SIGN_IDENTITY` | Full certificate identity, such as `Developer ID Application: Name (TEAMID)` |
| `NOTARY_APPLE_ID` | Apple ID used for notarization |
| `NOTARY_TEAM_ID` | Ten-character Apple Developer team ID |
| `NOTARY_PASSWORD` | App-specific password for the Apple ID |

Store these values only as repository secrets. Never commit a
certificate, password, or decoded signing file.

## What the release workflow does

After `build-mcpb.sh` assembles the extension,
`sign-macos.sh` performs these steps:

1. Imports the certificate into a temporary CI keychain.
2. Finds every Mach-O file in the bundle by inspecting file contents,
   signs the deepest files first, and enables hardened runtime and a
   trusted timestamp.
3. Re-packs the `.mcpb` with the signed binaries.
4. Submits a zip of the signed bundle to Apple, then polls the
   submission. Transient polling errors are retried because Apple's
   queue can take time.
5. Continues only when Apple returns `Accepted`. Any rejection or
   timeout fails the build and prints Apple's notarization log.

The ticket is held by Apple's service. The executables nested inside an
`.mcpb` are not containers that can receive a stapled ticket, so
Gatekeeper verifies the notarization online when they first launch.

## Release verification

A successful macOS release job must show both the code-signing step and
`notarization: Accepted`; a green unsigned build is not a release. Test
the exact resulting artifact using
[`TESTING.md`](./TESTING.md) before publishing it.

When the Developer ID certificate or app-specific password changes,
replace the corresponding GitHub secrets and run the complete release
test again.
