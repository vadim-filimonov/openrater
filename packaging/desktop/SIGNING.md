# Signing and notarization

The `desktop-build` workflow builds macOS Apple Silicon, macOS Intel,
and Windows extension artifacts. macOS release artifacts are signed
with an Apple Developer ID certificate and submitted to Apple's
notarization service. Windows release artifacts are signed with an
Azure Artifact Signing Public Trust certificate.

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

## Windows signing identity

Windows signing uses GitHub's passwordless OpenID Connect exchange with
Azure. There is no downloadable certificate, client secret, or private key
in the repository or in GitHub.

The `windows-signing` GitHub environment holds three identifiers as secrets:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`. It also
holds the Artifact Signing endpoint, account name, and certificate profile
as environment variables. The environment accepts only `main` and version
tags.

The Azure identity has only the **Artifact Signing Certificate Profile
Signer** role on the OpenRater signing account. Its federated credential is
bound to this repository and the `windows-signing` environment.

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

On Windows, the workflow performs a similarly strict sequence:

1. Finds every `.exe`, `.dll`, and `.pyd` file in the assembled extension.
2. Rejects any existing broken signature and preserves every valid vendor
   signature.
3. Sends only unsigned files to Azure Artifact Signing, with SHA-256 and a
   trusted timestamp.
4. Requires every Windows binary to report a valid Authenticode signature.
5. Re-packs the `.mcpb` and runs the complete seeded MCP smoke test against
   that exact signed package.

The `.mcpb` file itself is a zip-format container; the executable files
inside it are what receive Authenticode signatures.

## Release verification

A successful macOS release job must show both the code-signing step and
`notarization: Accepted`. A successful Windows job must show that every PE
file was verified. A green unsigned build is not a release. Test the exact
resulting artifact using
[`TESTING.md`](./TESTING.md) before publishing it.

When the Developer ID certificate or app-specific password changes,
replace the corresponding GitHub secrets and run the complete release
test again.
