/**
 * report-gates — Brief 93 §1.1.6 (93.2): the rules, stated in the
 * SAME grammar the Eligibility document speaks (appetitePhrases).
 */

import { describe, expect, it } from "vitest";
import { buildGateRows, type ReportGateFieldMeta } from "./report-gates";

const META: Record<string, ReportGateFieldMeta> = {
  construction_class: { label: "Construction class" },
  tiv: { label: "Total insured value", dtype: "money" },
  year_built: { label: "Year built", dtype: "int" },
};
const metaFor = (v: string) => META[v];

describe("buildGateRows (Brief 93 §1.1.6)", () => {
  it("phrases a single-clause rule with the field label + op phrase + formatted value", () => {
    const rows = buildGateRows(
      [
        {
          id: "r1",
          tier: "decline",
          conditions: [
            {
              variable: "construction_class",
              op: "eq",
              value: "Fire Resistive",
            },
          ],
        },
      ],
      metaFor,
    );
    expect(rows).toEqual([
      {
        id: "r1",
        tier: "decline",
        text: "Construction class is exactly Fire Resistive",
      },
    ]);
  });

  it("a compound rule reads as ONE sentence, clauses joined by 'and'; numeric values get separators", () => {
    const rows = buildGateRows(
      [
        {
          id: "r2",
          tier: "submit",
          conditions: [
            { variable: "tiv", op: "ge", value: "5000000" },
            { variable: "year_built", op: "lt", value: "1950" },
          ],
        },
      ],
      metaFor,
    );
    // Numeric formatting is the ONE shared grammar (appetitePhrases) —
    // the Eligibility document separators apply here identically.
    expect(rows[0]!.text).toBe(
      "Total insured value is at least 5,000,000 and Year built is less than 1,950",
    );
    expect(rows[0]!.tier).toBe("submit");
  });

  it("an in-list phrases as 'is one of'; an unknown variable falls back to its raw name", () => {
    const rows = buildGateRows(
      [
        {
          id: "r3",
          tier: "decline",
          conditions: [
            { variable: "occupancy", op: "in", value: "vacant, unoccupied" },
          ],
        },
      ],
      metaFor,
    );
    expect(rows[0]!.text).toBe("occupancy is one of vacant, unoccupied");
  });
});
