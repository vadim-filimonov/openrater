/**
 * Test-2 finding — the Route wizard nudges the user to declare a plan input
 * when a connector param has nothing plausible to bind to. These cover the
 * predicate that drives that nudge.
 */
import { describe, it, expect } from "vitest";
import { hasPlausiblePlanInput, normalizeIdent } from "./planInputMatch";
import type { PlanInputDef } from "../../api/connectors";

function inputs(...keys: string[]): PlanInputDef[] {
  return keys.map((key) => ({
    key,
    label: key,
    data_type: "string",
    required: false,
    description: "",
  }));
}

describe("normalizeIdent", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeIdent("Property_Address")).toBe("propertyaddress");
    expect(normalizeIdent("ZIP Code")).toBe("zipcode");
  });
});

describe("hasPlausiblePlanInput", () => {
  // The pilot case: an `address` param on a plan with only BOP inputs → nudge.
  it("returns false (→ nudge) when no input resembles the param", () => {
    const planInputs = inputs("class_code", "building_limit", "zip", "tiv");
    expect(hasPlausiblePlanInput("address", planInputs)).toBe(false);
  });

  it("returns true (→ no nudge) for an exact-name input", () => {
    expect(hasPlausiblePlanInput("address", inputs("address", "zip"))).toBe(true);
  });

  it("matches a containing input name (property_address ⊇ address)", () => {
    expect(hasPlausiblePlanInput("address", inputs("property_address"))).toBe(true);
  });

  it("matches an abbreviation the param contains (addr ⊂ address)", () => {
    expect(hasPlausiblePlanInput("address", inputs("addr"))).toBe(true);
  });

  it("matches zip → zip_code", () => {
    expect(hasPlausiblePlanInput("zip", inputs("zip_code", "class_code"))).toBe(true);
  });

  it("does not over-match on a <3-char overlap", () => {
    // param `id` vs `building_limit` — only a 2-char incidental overlap → nudge.
    expect(hasPlausiblePlanInput("id", inputs("building_limit", "class_code"))).toBe(false);
  });

  it("matches on the human label when the key differs", () => {
    const planInputs: PlanInputDef[] = [
      { key: "input_7c3", label: "Mailing address", data_type: "string", required: false, description: "" },
    ];
    expect(hasPlausiblePlanInput("address", planInputs)).toBe(true);
  });

  it("treats an empty/symbol-only param as satisfied (nothing to nudge about)", () => {
    expect(hasPlausiblePlanInput("", inputs("zip"))).toBe(true);
    expect(hasPlausiblePlanInput("***", inputs("zip"))).toBe(true);
  });

  it("returns false when the plan has no inputs at all", () => {
    expect(hasPlausiblePlanInput("address", [])).toBe(false);
  });
});
