# Book conformance fixtures

These frozen CSV fixtures support the book-level conformance test in
[`../nonprofit-book.conformance.test.ts`](../nonprofit-book.conformance.test.ts).
The test exercises the same deterministic projection, compilation, and policy
composition path used by the Inputs workspace.

## What the test covers

For each product plan, the harness projects authored stages, dimensions, and
factor tables into a runtime plan and compiles it with the production engine.
It then composes both plan results for every row and applies the workbook's
whole-dollar rounding convention.

The assertions pin:

- all 2,000 book rows;
- the aggregate premiums for each product and the composed policy;
- all 20 workbook examples;
- top-band clamping and territory-key resolution; and
- half-away-from-zero rounding, matching spreadsheet `ROUND` for positive
  premiums.

## Files

- `nonprofit_990_2000_policies.csv` contains the 2,000 input rows.
- `nonprofit_990_test_cases.csv` contains 20 worked examples with expected
  premium columns.

Keep these files frozen unless the corresponding example workbook and the
conformance expectations are intentionally revised together.

## Extending coverage

- Add a sibling `*-book.conformance.test.ts` for another plan-level book.
- Add portable, single-row engine vectors under
  [`packages/contracts/src/__tests__/conformance/`](../../../../contracts/src/__tests__/conformance/README.md)
  for individual engine kinds or projection edges.
