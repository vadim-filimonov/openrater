# Book conformance fixtures + harness (ADR-0032 Phase 0)

This folder freezes the **nonprofit D&O + GL** rating dataset so the
end-to-end book can be asserted to the dollar in CI. The harness lives at
[`../nonprofit-book.conformance.test.ts`](../nonprofit-book.conformance.test.ts).

## Why

Every prior validation of the full rating pipeline was a **manual**
cold-test (`docs/cold-test/J…O-walkthrough-*.md`). That let regressions
slip — most notably **N13** (the territory-keyed factor grid), which a
prior round *claimed* fixed but never verified end-to-end. This harness
makes the happy path un-break-able and is the **regression guard** the
ADR-0032 axis-cleanup + location-input work leans on.

## What it does

It drives the **same pipeline the Inputs workspace uses** — no browser.
As of **ADR-0034 gate 8** the cold-test plan is **split into two product
Plans** (a `do` Plan + a `cgl` Plan) composed by a `Policy` via the
generic `composePolicy` — no longer one plan with two name-inferred
chains:

```
per product (do / cgl):
  authored stage + dims + factor tables
    → stagesToRuntimePlan()      (the real projector — derive.band / derive.territory / lookup.direct / LCM)
    → compilePlan()              (the real engine)
then per insured row:
  composePolicy(policy, resolve) (runs both Plans, sums by premium_output)
    → round each product premium to $1 (Excel ROUND / half-up) → book
```

The composer is **product-blind** (ADR-0033 §0): the SAME `composePolicy`
composes a `bop + auto` policy. The split is non-regressing — the book is
still asserted to the dollar below.

…and asserts:

| Assertion | Value |
| --- | --- |
| D&O book (2,000 rows) | **$2,279,163** |
| GL book | **$1,565,091** |
| Total book | **$3,844,254** |
| 20 xlsx test cases (incl. NP-001) | reproduced to the dollar (658 / 396) |
| Rows > $5M revenue (top-band clamp) | 93 |
| State factor keys (N13 guard) | 5 territory tiers (T1–T5), not 51 states |

## Rounding convention (and a finding)

The spec is an **Excel** workbook, so its per-premium "round to nearest
$1" is `ROUND` = **half-away-from-zero** (= JS `Math.round` for positive
premiums). The engine matches it and the 20 xlsx test cases confirm it.

The cold-test J–O docs quote **$3,844,244** — that figure was a pre-flight
Python `round()` artifact (**banker's** / half-to-even), which diverges
from Excel on ~10 exact-`.5` ties (D&O −$1, GL −$9). The spec/Excel/engine
book is **$3,844,254**; this harness pins that. (The docs aren't wrong
about the chain math — only about the tie-break convention.)

## Why engine-layer, not browser e2e

This guards the **projector + engine** — exactly what the ADR-0032 axis
cleanup + location-input refactor touch — and it's deterministic and fast
(no flaky DOM driving; the cold-tests showed some UI interactions resist
synthetic events). UI-authoring regressions (like N13's grid render) are
guarded by component tests (`FactorTableNode.test.tsx` territory cases).
The portable, language-agnostic single-kind vectors live in
[`packages/contracts/src/__tests__/conformance/`](../../../../contracts/src/__tests__/conformance/README.md);
this is the **book-level** complement.

## The fixtures (frozen — don't regenerate casually)

- `nonprofit_990_2000_policies.csv` — the 2,000-row book (raw columns;
  ratios + bands derived in the harness).
- `nonprofit_990_test_cases.csv` — 20 accounts with `expected_*_premium`
  columns from the xlsx Test Cases sheet.

Both are copies of `docs/rating-algorithms/*` frozen here so regenerating
the served data can't silently move the asserted book.

## Extending

- **A new plan's book** → add a sibling `*-book.conformance.test.ts` that
  builds that plan's substrate and asserts its dataset (mirror this file).
- **A new engine kind / projection edge** → add a single-row JSON vector
  under `packages/contracts/src/__tests__/conformance/` (portable; runs
  with a stock JSON parser).
