# Seed fixtures

The synthetic Meridian program (Detachment Brief 1 S3). The deploy
image copies every `*.plan.json` from this directory and pre-loads it
on boot, so a fresh box starts with a working, fully-rated reference
plan — built-from-workbook provenance, report drawer, and re-ingest
door included.

Everything here is invented; see
[`FIXTURE_PROVENANCE.md`](./FIXTURE_PROVENANCE.md) for the per-file
audit trail and the regeneration recipe. The CI oracle gate for these
files is `frontend/src/integrations/meridianSeedFixture.verify.test.ts`.
