**What + why**

<!-- What changed and the reason. For ports: include the manifest
     ("Ported: […] Cut: […] Reason: […]"). -->

**How it was verified**

<!-- Tests run, browser checked (light AND dark if UI), vectors
     added/updated. "CI is green" alone is not verification for
     user-facing changes. -->

**Checklist**

- [ ] Commits are signed off (`git commit -s` — the DCO,
      CONTRIBUTING.md)
- [ ] No bureau-derived or carrier-filed rate content anywhere in
      the diff; any new fixture is synthetic **and** has a
      `docs/fixtures/FIXTURE_PROVENANCE.md` entry
- [ ] `pnpm typecheck && pnpm test && pnpm design:check` and
      `cd server && uv run pytest` are green
- [ ] Contract-affecting changes (engine, plan format, transcription
      spec, HTTP API) update the relevant spec + its changelog +
      conformance vectors in the same PR
- [ ] New user-facing surfaces have a validated design brief
      (`docs/design-briefs/`)
