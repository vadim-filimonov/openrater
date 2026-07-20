/**
 * Bench smoke — keeps the benchmark's row generator + scoring path
 * green in CI (the full 2,000-row run is `pnpm bench`, not a test).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { executePlanBatch, type Plan } from "@openrater/contracts";
import { describe, it, expect } from "vitest";

import { ensureEngineReady } from "../core/engine";
import { generateRows } from "../bench/generateRows";

const PLAN = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../packages/contracts/src/__tests__/conformance/V49.exposure-rated-tower.json",
    ),
    "utf8",
  ),
).plan as Plan;

describe("benchmark · generateRows", () => {
  it("is deterministic for a given seed", () => {
    expect(generateRows(20, 7)).toEqual(generateRows(20, 7));
  });

  it("produces BOP-shaped rows", () => {
    const rows = generateRows(5);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(typeof row.territory).toBe("string");
      expect(typeof row.prop_rate_number).toBe("string");
      expect(row.building_limit).toBeGreaterThan(0);
    }
  });

  it("scores a generated book through the engine", () => {
    const registry = ensureEngineReady();
    const rows = generateRows(50);
    const results = executePlanBatch(PLAN, rows, { as_of: "2024-01-01" }, registry);
    expect(results).toHaveLength(50);
    // Every row produces a building_premium output (the V49 plan's output).
    for (const r of results) {
      expect(Object.keys(r.outputs).length).toBeGreaterThan(0);
    }
  });
});
