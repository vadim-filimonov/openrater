# Transcription evals

The product bet is **"the AI is a transcriber, never a calculator"** —
a model reads a rate filing and produces a spec-v1.0 workbook; the
platform checks, builds, and rates deterministically. This directory
holds the instrument that grades the transcriber.

## The harness (v0)

`score_transcription.py` scores an ATTEMPT workbook against the
Meridian reference filing's golden truth, deterministically, with no
model in the loop:

| Axis | Question | Bar |
| --- | --- | --- |
| **check** | Does the attempt pass the spec-v1.0 deterministic check (the same one the build door runs)? | zero errors |
| **cells** | Every factor value vs the golden — all 115 factor cells (1-D levels + 2-D matrix) and 36 geo ZIP rows, keyed and compared. | 151/151 |
| **examples** | The filing states 8 fully worked examples (Rule G.1). Are their inputs, totals, and tiers transcribed faithfully into `test_cases`? | 8/8 |
| **gaps** | The filing contains two application-default conventions (Rule A.4). Were they CAPTURED — as a gaps/assumptions row **or** as the named input's filing-stated `default_value` — instead of silently dropped? | 2/2 |
| **live** (`--api`) | Build the attempt through the server's ingest door, quote the 8 examples, compare premiums to the filing's stated totals. | 8/8 exact, tiers 8/8 |

**Naming alignment.** Slugs, band level ids, and some input names are
transcriber choices — the filing states concepts and codes, not
snake_case. The scorer aligns the attempt's naming onto the golden's
(dimensions by shape + name tokens, tables by their dimension pair,
banded levels by their `min` bound, geo values through each
workbook's own `territory_ref → level_id` join) and then compares
VALUES exactly. Every tolerated rename is listed in the report's
`alignment` section; nothing about numbers is ever fuzzy.

Run:

```sh
server/.venv/bin/python evals/score_transcription.py ATTEMPT.xlsx \
    [--api http://127.0.0.1:8021] [--json runs/my-run.json]
```

Exit 0 = PASS (every axis at its bar), 1 = FAIL. The harness's own
regression net is `server/tests/test_eval_harness.py`: the golden
scored against itself must be a perfect PASS, and a mutant golden
(one wrong factor cell, one deleted gap row, one altered example
total) must FAIL with exactly those findings.

## Why the bars are "exact"

The reference filing was designed to be fully transcribable: every
factor is stated in a table, every example shows its arithmetic, and
the only two judgment calls (the Rule A.4 defaults) have a designated
honest home (the gaps sheet). Against THIS document, anything less
than exact is a transcription defect, not noise. Real-world filings
earn looser rubrics later — as additional eval documents with their
own goldens, not by softening this one.

## Recording runs

Write reports to a local or CI artifact directory, for example:

```sh
server/.venv/bin/python evals/score_transcription.py ATTEMPT.xlsx \
  --json /tmp/openrater-eval.json
```

Do not commit model transcripts, raw attempts, or run-by-run reports.
When an eval informs a change, record only the aggregate result and the
synthetic reproducer in the pull request.
