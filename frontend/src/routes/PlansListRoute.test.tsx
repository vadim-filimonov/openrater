/**
 * V9 — plans-list search matcher. Pure-helper coverage (the full route
 * needs a router + query provider; the matcher is the load-bearing logic).
 */
import { describe, it, expect } from "vitest";
import type { PlanSummary } from "@openrater/api-client";
import { matchesPlanQuery } from "./PlansListRoute";

const plan = {
  rating_plan_id: "bop_ks_blank_42613938",
  display_name: "Meridian BOP — Kansas — 2025",
  product: "bop",
  line_of_business: "BOP",
  jurisdiction: "KS",
  status: "draft",
} as unknown as PlanSummary;

describe("matchesPlanQuery (V9)", () => {
  it("matches everything on an empty query", () => {
    expect(matchesPlanQuery(plan, "")).toBe(true);
    expect(matchesPlanQuery(plan, "   ")).toBe(true);
  });

  it("matches on name (case-insensitive)", () => {
    expect(matchesPlanQuery(plan, "meridian")).toBe(true);
    expect(matchesPlanQuery(plan, "KANSAS")).toBe(true);
  });

  it("matches on jurisdiction, product, and id", () => {
    expect(matchesPlanQuery(plan, "ks")).toBe(true);
    expect(matchesPlanQuery(plan, "bop")).toBe(true);
    expect(matchesPlanQuery(plan, "42613938")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(matchesPlanQuery(plan, "wisconsin")).toBe(false);
    expect(matchesPlanQuery(plan, "auto")).toBe(false);
  });
});
