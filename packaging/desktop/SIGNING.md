# Signing + notarization runbook (D14)

**Owner decision (2026-07-19): Apple-only for now.** The macOS path
below is WIRED — `sign-macos.sh` runs as a secrets-gated CI step in
`desktop-build.yml` (no-op until the secrets exist, so unsigned dev
builds never block). Remaining owner action: buy the Apple Developer
Program membership ($99/yr), export the Developer ID Application cert
as .p12, and set the six `MACOS_*`/`NOTARY_*` secrets named below on
the GitHub repo. Windows signing stays a future addition.

Unsigned builds throw OS malware-style warnings that end a
non-technical actuary's session on the spot. The beta ships SIGNED
builds on both platforms. This is the owner's checklist — the
certificates are purchases only the owner can make (~$400/yr
combined, recurring because certs expire annually).

## What to buy (owner actions)

| Platform | What | Where | Cost | Notes |
| --- | --- | --- | --- | --- |
| macOS | Apple Developer Program membership → a **Developer ID Application** certificate | developer.apple.com | $99/yr | Also enables notarization (required on modern macOS) |
| Windows | Code-signing. Two routes: **Azure Trusted Signing** (subscription, ~$10/mo, individual/org validation) or a classic **OV certificate** from a CA (Sectigo/DigiCert resellers, ~$250–350/yr, ships on a hardware key or cloud HSM) | Azure portal / a CA | ~$120–350/yr | Trusted Signing is the cheaper modern route; classic OV builds SmartScreen reputation over time either way |

## macOS pipeline (per release)

1. **Sign every Mach-O inside the one-dir bundle**, inner-first —
   `server/_internal/**/*.so|*.dylib`, then the `openrater-server`
   executable — with the Developer ID cert, hardened runtime on:

   ```sh
   codesign --force --options runtime --timestamp \
     --sign "Developer ID Application: <NAME> (<TEAMID>)" <file>
   ```

   (Script this as a walk over `packaging/desktop/dist/mcpb-root/server`;
   PyInstaller one-dir is signable file-by-file — that is why we build
   one-dir, not one-file.)

   **`runtime/node` is the exception — it MUST carry JIT entitlements**
   (`packaging/desktop/node.entitlements.plist`: `allow-jit`,
   `allow-unsigned-executable-memory`, `disable-library-validation`):

   ```sh
   codesign --force --options runtime --timestamp \
     --entitlements packaging/desktop/node.entitlements.plist \
     --sign "Developer ID Application: <NAME> (<TEAMID>)" \
     packaging/desktop/dist/mcpb-root/runtime/node
   ```

   Hardened runtime without `allow-jit` forbids the MAP_JIT mapping V8
   needs, so the signed node dies on ANY real script — while
   `node --version` still exits 0. v0.1.0 shipped exactly that way
   (FCA finding PRE-1): a dead scoring sidecar blaming the user's
   environment. **Neither codesign nor notarization catches this** —
   only executing real JS through the signed binary does, which is what
   `packaging/desktop/verify-node-runtime.sh` gates (pre-sign in
   `build-mcpb.sh`, post-sign in `sign-macos.sh`, and on the unpacked
   artifact in the CI smoke). The entitlements are scoped to the one
   binary that JITs — never the PyInstaller server (CPython doesn't
   JIT and its dylibs are same-identity signed).

   Keep the plist comment-free: AMFI's parser rejects XML comments
   ("AMFIUnserializeXML: syntax error"), and codesign still exits 0
   after that parse failure — you'd ship the broken shape again with a
   green codesign step. The verify gate is what actually catches it.
2. **Pack** the bundle (`build-mcpb.sh` step 5–6 re-run, or pack the
   already-signed root).
3. **Notarize + staple** the archive's payload: notarization operates
   on the signed binaries; submit a zip of the bundle root:

   ```sh
   xcrun notarytool submit bundle.zip \
     --apple-id <APPLE_ID> --team-id <TEAMID> \
     --password <APP_SPECIFIC_PASSWORD> --wait
   ```

   Gatekeeper's first-launch scan of a large UNSIGNED binary is also
   why cold first boot is slow today; signing + notarization removes
   both the warning and most of that stall.

## Windows pipeline (per release)

Sign `openrater-server.exe` (and any bundled DLLs the toolchain
flags) before packing:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /a packaging\desktop\dist\mcpb-root\server\openrater-server.exe
```

(With Azure Trusted Signing, use its `signtool` dlib integration per
their docs; in CI it authenticates via the federated GitHub OIDC
identity — no cert file secrets at all.)

## CI wiring (when the repo has a remote + secrets)

- macOS: `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`,
  `NOTARY_APPLE_ID`, `NOTARY_TEAM_ID`, `NOTARY_PASSWORD` — import the
  cert into a throwaway keychain on the runner, sign, notarize, then
  pack + upload.
- Windows: Trusted Signing via OIDC (preferred; zero secret files) or
  `WIN_CERT_PFX_BASE64` + `WIN_CERT_PASSWORD`.
- The `desktop-build.yml` lane stays green WITHOUT any of these —
  signing is an additive, secrets-gated step so unsigned dev builds
  never block.

## The .mcpb itself

The mcpb toolchain supports signing the archive; the load-bearing
trust for the OS, though, lives on the BINARIES inside (that is what
Gatekeeper/SmartScreen inspect at spawn time). Sign binaries first,
always; add archive signing when the toolchain path is confirmed
during the beta.
