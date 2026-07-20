# Seed fixtures

This directory contains the synthetic Meridian reference program. The
deploy image copies every `*.plan.json` from here and loads missing
plans on boot, so a fresh deployment starts with a working, fully rated
example — including workbook provenance, its build report, and the
re-ingest workflow.

Everything here is invented; see
[`FIXTURE_PROVENANCE.md`](./FIXTURE_PROVENANCE.md) for the per-file
audit trail and regeneration recipe. The CI verification test is
`frontend/src/integrations/meridianSeedFixture.verify.test.ts`.
