/**
 * Brief 91 — create-plan card. Pure-helper coverage (the full route
 * needs a router + query provider; the body/option builders are the
 * load-bearing logic — same pattern as PlansListRoute.test.tsx).
 */
import { describe, it, expect } from "vitest";
import type { PlanSummary } from "@openrater/api-client";
import {
  ALL_STATES_VALUE,
  buildCreatePlanBody,
  buildProductOptions,
  buildStateOptions,
  planCopyMeta,
  stateOptionFilter,
} from "./PlanNewRoute";

describe("buildCreatePlanBody (Brief 91)", () => {
  it("trims the name and maps All-states to a null jurisdiction", () => {
    const body = buildCreatePlanBody({
      name: "  Q3 book  ",
      product: "bop",
      stateCode: ALL_STATES_VALUE,
      note: "",
    });
    expect(body.display_name).toBe("Q3 book");
    expect(body.product).toBe("bop");
    expect(body.jurisdiction).toBeNull();
    expect(body.template).toBe("blank");
    expect(body.description).toBeNull();
  });

  it("never sends an effective_date — the backend defaults it", () => {
    const body = buildCreatePlanBody({
      name: "X",
      product: "wc",
      stateCode: "WI",
      note: "",
    });
    expect("effective_date" in body).toBe(false);
  });

  it("carries a picked state and a trimmed note", () => {
    const body = buildCreatePlanBody({
      name: "X",
      product: "bop",
      stateCode: "KS",
      note: "  pilot scope  ",
    });
    expect(body.jurisdiction).toBe("KS");
    expect(body.description).toBe("pilot scope");
  });
});

describe("option builders", () => {
  it("offers all 13 products with description hints", () => {
    const options = buildProductOptions();
    expect(options).toHaveLength(13);
    expect(options.some((o) => o.value === "homeowners")).toBe(true);
    const bop = options.find((o) => o.value === "bop");
    expect(bop?.label).toBe("Businessowners");
    expect(bop?.hint).toMatch(/property \+ liability/i);
  });

  it("puts All states first, then the 51 seeded states", () => {
    const options = buildStateOptions();
    expect(options[0]).toMatchObject({
      value: ALL_STATES_VALUE,
      label: "All states",
    });
    expect(options).toHaveLength(52);
    const wi = options.find((o) => o.value === "WI");
    expect(wi?.label).toBe("Wisconsin");
  });

  it("state filter is prefix-only — 'kan' means Kansas, never Arkansas", () => {
    const options = buildStateOptions();
    const matches = options.filter((o) => stateOptionFilter(o, "kan"));
    expect(matches.map((o) => o.value)).toEqual(["KS"]);
    // The USPS code is a prefix seat too.
    const byCode = options.filter((o) => stateOptionFilter(o, "ks"));
    expect(byCode.map((o) => o.value)).toEqual(["KS"]);
    // Empty query shows everything (the open-listbox state).
    expect(options.filter((o) => stateOptionFilter(o, " "))).toHaveLength(52);
  });
});

describe("planCopyMeta", () => {
  const base = {
    rating_plan_id: "bop_ks_blank_1234",
    display_name: "Sample BOP 2025",
    product: "bop",
    line_of_business: "bop",
    jurisdiction: "KS",
    status: "draft",
  } as unknown as PlanSummary;

  it("spells out product, state, and status", () => {
    expect(planCopyMeta(base)).toBe("Businessowners · Kansas · draft");
  });

  it("names All states for multistate plans", () => {
    const multi = { ...base, jurisdiction: null } as unknown as PlanSummary;
    expect(planCopyMeta(multi)).toBe("Businessowners · All states · draft");
  });

  it("falls back to the raw value for an unknown product tag", () => {
    const odd = { ...base, product: "zorgon" } as unknown as PlanSummary;
    expect(planCopyMeta(odd)).toBe("zorgon · Kansas · draft");
  });
});
