/**
 * useCohortConnectorEvaluator — pure-core coverage (Brief 62.6 PR3 §5).
 *
 * The hook is a react-query wrapper; the load-bearing new logic is the
 * per-run cache (`distinctBookCalls` / `hashFeatures`): a connector book makes
 * one paid call per distinct (connector, version, row-features) — identical
 * insureds don't pay twice.
 */

import { describe, it, expect } from "vitest";
import { distinctBookCalls, hashFeatures } from "./useCohortConnectorEvaluator";

const refs = [{ connector_id: "lossnav", version: "v2" }];

describe("hashFeatures", () => {
  it("is field-order-independent (same hash for reordered keys)", () => {
    expect(hashFeatures({ a: 1, b: 2 })).toBe(hashFeatures({ b: 2, a: 1 }));
  });
  it("distinguishes different values", () => {
    expect(hashFeatures({ revenue: 100 })).not.toBe(hashFeatures({ revenue: 200 }));
  });
});

describe("distinctBookCalls (per-run cache)", () => {
  it("makes one call per row when all rows differ", () => {
    const calls = distinctBookCalls(refs, [{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect(calls).toHaveLength(3);
  });

  it("collapses identical rows to a single paid call (§5 — no double-pay)", () => {
    // 4 rows, 2 distinct → 2 calls, not 4.
    const calls = distinctBookCalls(refs, [{ x: 1 }, { x: 1 }, { x: 2 }, { x: 1 }]);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.features)).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("multiplies by distinct connectors (refs × distinct rows)", () => {
    const twoRefs = [
      { connector_id: "lossnav", version: "v2" },
      { connector_id: "terror", version: "v1" },
    ];
    const calls = distinctBookCalls(twoRefs, [{ x: 1 }, { x: 2 }]);
    expect(calls).toHaveLength(4); // 2 connectors × 2 distinct rows
  });

  it("treats a different version as a distinct call (no floating latest)", () => {
    const calls = distinctBookCalls(
      [
        { connector_id: "lossnav", version: "v2" },
        { connector_id: "lossnav", version: "v3" },
      ],
      [{ x: 1 }],
    );
    expect(calls).toHaveLength(2);
  });

  it("is empty for no refs or no rows", () => {
    expect(distinctBookCalls([], [{ x: 1 }])).toEqual([]);
    expect(distinctBookCalls(refs, [])).toEqual([]);
  });
});
