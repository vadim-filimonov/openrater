**What + why**

<!-- What changed, why it is needed, and any user-visible effect. -->

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
- [ ] Relevant checks are green (the full local suite is
      `pnpm typecheck && pnpm test && pnpm design:check` plus
      `cd server && uv run pytest`)
- [ ] Contract-affecting changes (engine, plan format, transcription
      spec, HTTP API) update the relevant spec + its changelog +
      conformance vectors in the same PR
- [ ] User-facing changes include screenshots or another clear manual
      verification note where appropriate
