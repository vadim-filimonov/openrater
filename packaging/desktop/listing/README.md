# Directory-listing assets

Everything the Connectors Directory submission form asks for, in one
place. Screenshots are 2880×1800 PNGs (≥1000px required), captured
from the seeded Meridian demo by the audit rig; the icon is rendered
from `../icon.svg` by `../render-icon.mjs`.

## Screenshots, in listing order

| File | Caption to use |
| --- | --- |
| `01-plan-report.png` | The plan report: a counted lede, the reference risk walked through the engine, and what moves price — generated from the plan itself, verifiable against it. |
| `02-rating-sheet.png` | The algorithm as a worksheet: every step named, every factor table editable in place, every number cited to the page of the filing. |
| `03-territory-map.png` | Geographic rating drawn on real Census boundaries — territories are places, not rows. |
| `04-compare-underwriting.png` | Two versions, one ledger: what changed across factors, curves, territories — and the underwriting rules, spoken in plain language. |
| `05-build-report.png` | The trust artifact: the build report re-runs the filing's own worked examples (40/40 match) and echoes every assumption the transcriber flagged. |

## Form fields (crib sheet)

- **Display name:** OpenRater
- **Tagline (≤55 chars):** `Turn a rate filing into a working rating engine.` (48)
- **Description:** use `long_description` from `../manifest.template.json`.
- **Categories:** Productivity / Analysis / Internal Tools (pick per
  the form's live taxonomy; "insurance" rides `keywords`).
- **Icon:** `../icon.png` (512×512 RGBA; bundled at the mcpb root).
- **Privacy policy:** `docs/PRIVACY.md` — the manifest points at its
  GitHub URL. **Must be publicly reachable before submitting** (the
  repo is private today — make it public, or host the policy at a
  public URL and update `privacy_policies` in the manifest).
- **Documentation URL:** the repo README (same public-visibility gate).
- **Support contact:** owner's email (form-time entry).
- **Test account:** none needed — the bundle seeds the Meridian
  reference plan; the reviewer's first `runtime_status` call boots a
  working, populated install.

## Pre-submission checks

1. `desktop-build.yml` green on all three platforms (the packed-artifact
   smoke test runs the full MCP loop and asserts mv_01 = $1,898).
2. Every tool exercised once via MCP Inspector against the packed
   bundle (`npx @modelcontextprotocol/inspector node mcp/index.mjs`
   with `RATER_BUNDLE_ROOT` set to an unpacked root).
3. Cold install of the signed artifact on a clean machine — follow
   [`../TESTING.md`](../TESTING.md) and record the result.
4. Submit at the desktop-extension form (linked from
   claude.com/docs/connectors/building/submission).

## Version updates (resubmission)

To move an existing listing to a new version: file the same
desktop-extension form again with the new artifact attached and a
note naming the prior submission ("supersedes the YYYY-MM-DD
<version> submission"). Point the note at the GitHub Release for the
per-platform artifacts and checksums. If the review thread is
already open or the form misbehaves, mcp-review@anthropic.com is the
escalation channel.
