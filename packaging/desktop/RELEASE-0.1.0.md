# Release note — OpenRater 0.1.0 desktop extension

**Date:** 2026-07-21. The hands-on clean-machine walks were waived by
owner decision; this note records the machine evidence standing in for
them, per `TESTING.md`'s record-the-result requirement.

## Release artifacts

| Platform | Artifact | Proving run | Signature |
| --- | --- | --- | --- |
| macOS Apple Silicon | `openrater-0.1.0-darwin-arm64.mcpb` | [29839202353](https://github.com/vadim-filimonov/openrater/actions/runs/29839202353) | Developer ID, notarized in-run (`eeda6987-9872-463e-88ef-28962f389556`) |
| macOS Intel | `openrater-0.1.0-darwin-x64.mcpb` | [29839202353](https://github.com/vadim-filimonov/openrater/actions/runs/29839202353) | Developer ID, notarized in-run (`3b44c72b-221a-420b-bf84-bcc8133e9c62`) |
| Windows x64 | `openrater-0.1.0-win32-x64.mcpb` | [29784726272](https://github.com/vadim-filimonov/openrater/actions/runs/29784726272) | Azure Trusted Signing (public trust), 80/80 PE files verified |

Each manifest declares exactly the platform it was built for.

## Release gate

- `desktop-build` green on macOS arm64, macOS Intel (both with
  `notarization: Accepted` inside the signing step), and Windows
  (every PE file verified, smoke test run against the re-packed signed
  artifact). Gate met.

## Checkpoints and their evidence

| Checkpoint | Status | Evidence |
| --- | --- | --- |
| Install without warnings | waived (not hand-walked) | `spctl -t install` on the shipped binaries: "accepted — source=Notarized Developer ID" (owner's Apple Silicon Mac, Darwin 25) |
| First boot | machine-verified | CI smoke boots the exact packed artifact against a fresh data dir on every run |
| Workbook review stop | observed in the 2026-07-21 tour | exported workbook sha256 `363b1f8e…` byte-identical to the build report's `workbook_hash` |
| Build + build report | observed + machine-verified | 115/115 factor cells cited; 40/40 verification vectors match to the cent |
| Sample quote = $1,898 | machine-verified on the exact artifact | CI smoke drives the full MCP loop and asserts `premium=1898` |
| Restart persistence | waived (not hand-walked) | same storage layer persisted the dev plan across sessions Jul 17→21 |

## Fixed during release hardening

1. Zip packing materialized `_internal/Python`'s symlink, orphaning its
   framework-context signature — now materialized and flat-signed at
   build, with a dlopen probe gate (`bb97fab`).
2. Re-signing stripped the bundled Node runtime's JIT entitlements;
   newer macOS kills V8 at startup for it (found on the owner's Mac,
   invisible on CI's older images) — entitlements restored, with a
   fail-hard entitlement check (`c478bcd`).

## Residual risk (accepted)

The pristine-machine install-and-enable experience (quarantined
download through Claude Desktop's installer) was not hand-walked on
either platform.
