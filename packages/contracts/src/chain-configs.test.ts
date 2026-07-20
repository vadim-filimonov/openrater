/**
 * Tests for chain-related config_json schemas.
 *
 * The point of these schemas is *parse-time drift detection*: if the
 * backend Pydantic shape moves and this file doesn't, the Zod parse
 * fails loudly instead of letting the bad payload reach the wire.
 *
 * Tests cover:
 *   · Minimal valid payloads for each schema
 *   · Boundary conditions (min/max lengths, positive divisors)
 *   · The exactly-one-of constraint on FlatFactorConfig
 */

import { describe, it, expect } from "vitest";
import {
  chainSpecSchema,
  dimensionBindingSchema,
  factorLookupSchema,
  flatFactorConfigSchema,
  formulaConfigSchema,
  lcmApplicationSchema,
  multiplicativeChainConfigSchema,
} from "./chain-configs";

describe("dimensionBindingSchema", () => {
  it("parses a minimal binding", () => {
    expect(
      dimensionBindingSchema.parse({
        source: "form_input",
        path: "class_code",
      }),
    ).toMatchObject({ source: "form_input", path: "class_code" });
  });

  it("rejects an empty path", () => {
    expect(() =>
      dimensionBindingSchema.parse({ source: "form_input", path: "" }),
    ).toThrow();
  });

  it("rejects an unknown source", () => {
    expect(() =>
      dimensionBindingSchema.parse({ source: "made_up", path: "x" }),
    ).toThrow();
  });

  // Axis sources beyond a raw form_input column.
  it("parses a literal-source binding (constant key)", () => {
    expect(
      dimensionBindingSchema.parse({ source: "literal", value: "group_c" }),
    ).toMatchObject({ source: "literal", value: "group_c" });
  });

  it("parses a computed-sum binding", () => {
    expect(
      dimensionBindingSchema.parse({
        source: "computed",
        op: "sum",
        fields: ["building_limit", "bpp_limit"],
      }),
    ).toMatchObject({ op: "sum", fields: ["building_limit", "bpp_limit"] });
  });

  it("parses a derived-source binding (path names the derived dim)", () => {
    expect(
      dimensionBindingSchema.parse({
        source: "derived",
        path: "prop_rate_number",
      }),
    ).toMatchObject({ source: "derived", path: "prop_rate_number" });
  });

  it("rejects a literal binding without a value", () => {
    expect(() => dimensionBindingSchema.parse({ source: "literal" })).toThrow();
  });

  it("rejects a computed binding missing op+fields", () => {
    expect(() =>
      dimensionBindingSchema.parse({ source: "computed", op: "sum" }),
    ).toThrow();
  });

  it("rejects an unsupported computed op (only 'sum' today)", () => {
    expect(() =>
      dimensionBindingSchema.parse({
        source: "computed",
        op: "product",
        fields: ["a"],
      }),
    ).toThrow();
  });
});

describe("factorLookupSchema", () => {
  const base = {
    name: "BOP class factor",
    factor_kind: "class_factor",
    lookup_method: "direct" as const,
    description_template: "Class factor: ×{value}",
  };

  it("parses a minimal direct lookup", () => {
    const parsed = factorLookupSchema.parse(base);
    expect(parsed.table).toBe("rate_factors");
    expect(parsed.citation_rule).toBe("");
    expect(parsed.citation_page).toBe("");
    expect(parsed.dimensions).toEqual({});
  });

  it("parses an interpolated lookup (curve.evaluate map)", () => {
    expect(
      factorLookupSchema.parse({
        ...base,
        lookup_method: "interpolated",
        dimensions: {
          tiv: { source: "form_input", path: "tiv" },
        },
      }),
    ).toMatchObject({ lookup_method: "interpolated" });
  });

  it("rejects an unknown lookup_method", () => {
    expect(() =>
      factorLookupSchema.parse({
        ...base,
        lookup_method: "literal",
      }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      factorLookupSchema.parse({ ...base, name: "" }),
    ).toThrow();
  });

  it("rejects empty description_template", () => {
    expect(() =>
      factorLookupSchema.parse({ ...base, description_template: "" }),
    ).toThrow();
  });

  it("rejects an over-length name (>120 chars)", () => {
    expect(() =>
      factorLookupSchema.parse({ ...base, name: "x".repeat(121) }),
    ).toThrow();
  });
});

describe("lcmApplicationSchema", () => {
  it("applies defaults for carrier-set fields", () => {
    const parsed = lcmApplicationSchema.parse({
      input_path: "form_input.lcm",
    });
    expect(parsed.factor_kind).toBe("lcm");
    expect(parsed.citation_rule).toBe("(carrier-set)");
  });

  it("rejects empty input_path", () => {
    expect(() => lcmApplicationSchema.parse({ input_path: "" })).toThrow();
  });

  // Authored carrier LCM aligned with the backend value/overridable shape.
  it("parses an authored carrier LCM value (no input column)", () => {
    const parsed = lcmApplicationSchema.parse({
      value: 1.4,
      citation_rule: "Meridian synthetic rule MS-R4",
    });
    expect(parsed.value).toBe(1.4);
    expect(parsed.input_path).toBeUndefined();
    expect(parsed.overridable).toBe(false);
  });

  it("parses an overridable value + input (D3 escape hatch)", () => {
    const parsed = lcmApplicationSchema.parse({
      value: 1.4,
      input_path: "form_input.lcm",
      overridable: true,
    });
    expect(parsed.overridable).toBe(true);
    expect(parsed.value).toBe(1.4);
  });

  it("rejects neither value nor input_path (must resolve the LCM)", () => {
    expect(() => lcmApplicationSchema.parse({})).toThrow();
  });
});

describe("chainSpecSchema", () => {
  const lcm = { input_path: "form_input.lcm" };

  it("parses a minimal chain", () => {
    const parsed = chainSpecSchema.parse({
      name: "BOP building chain",
      base_input: "stages.rate_number.value",
      lcm,
      exposure_input: "form_input.tiv",
      exposure_unit_divisor: 100,
      output_field: "building_premium_usd",
    });
    expect(parsed.factor_lookups).toEqual([]);
  });

  it("rejects a zero exposure_unit_divisor (gt 0)", () => {
    expect(() =>
      chainSpecSchema.parse({
        name: "x",
        base_input: "x",
        lcm,
        exposure_input: "x",
        exposure_unit_divisor: 0,
        output_field: "x",
      }),
    ).toThrow();
  });

  // Cold-test L30 — editable literal base rate.
  it("parses an authored literal base_value", () => {
    const parsed = chainSpecSchema.parse({
      name: "D&O chain",
      base_input: "literal.base_value",
      base_value: 600,
      lcm,
      exposure_input: "form_input.exposure",
      exposure_unit_divisor: 1,
      output_field: "do_premium",
    });
    expect(parsed.base_value).toBe(600);
  });

  it("treats base_value as optional (legacy plans omit it)", () => {
    const parsed = chainSpecSchema.parse({
      name: "legacy chain",
      base_input: "stages.rate_number.value",
      lcm,
      exposure_input: "form_input.tiv",
      exposure_unit_divisor: 100,
      output_field: "premium",
    });
    expect(parsed.base_value).toBeUndefined();
  });

  it("accepts a null base_value (explicit clear)", () => {
    const parsed = chainSpecSchema.parse({
      name: "cleared chain",
      base_input: "literal.base_value",
      base_value: null,
      lcm,
      exposure_input: "form_input.exposure",
      exposure_unit_divisor: 1,
      output_field: "premium",
    });
    expect(parsed.base_value).toBeNull();
  });

  // Explicit exposure opt-in for a per-account tower.
  it("parses an exposure-rated per-account tower (apply_exposure)", () => {
    const parsed = chainSpecSchema.parse({
      name: "nonprofit tower",
      base_input: "literal.base_value",
      base_value: 1,
      lcm,
      exposure_input: "form_input.annual_revenue",
      exposure_unit_divisor: 1000,
      apply_exposure: true,
      output_field: "premium",
    });
    expect(parsed.apply_exposure).toBe(true);
  });

  it("treats apply_exposure as optional (legacy chains omit it)", () => {
    const parsed = chainSpecSchema.parse({
      name: "legacy chain",
      base_input: "stages.rate_number.value",
      lcm,
      exposure_input: "form_input.tiv",
      exposure_unit_divisor: 100,
      output_field: "premium",
    });
    expect(parsed.apply_exposure).toBeUndefined();
  });
});

describe("multiplicativeChainConfigSchema", () => {
  it("rejects an empty chains list", () => {
    expect(() =>
      multiplicativeChainConfigSchema.parse({
        chains: [],
        output_total_field: "total",
      }),
    ).toThrow();
  });
});

describe("flatFactorConfigSchema", () => {
  it("parses with input_path set", () => {
    expect(
      flatFactorConfigSchema.parse({
        input_path: "form_input.tiv",
        factor: 0.95,
        factor_kind: "sprinkler_credit",
      }),
    ).toMatchObject({ factor: 0.95 });
  });

  it("parses with input_paths set", () => {
    expect(
      flatFactorConfigSchema.parse({
        input_paths: ["form_input.tiv", "form_input.bpp"],
        factor: 1.05,
        factor_kind: "loading",
      }),
    ).toMatchObject({ input_paths: ["form_input.tiv", "form_input.bpp"] });
  });

  it("rejects when both input_path AND input_paths are set", () => {
    expect(() =>
      flatFactorConfigSchema.parse({
        input_path: "form_input.tiv",
        input_paths: ["form_input.tiv"],
        factor: 1.0,
        factor_kind: "x",
      }),
    ).toThrow();
  });

  it("rejects when neither input_path NOR input_paths is set", () => {
    expect(() =>
      flatFactorConfigSchema.parse({
        factor: 1.0,
        factor_kind: "x",
      }),
    ).toThrow();
  });

  it("applies defaults for factor_unit + output_field + description_template", () => {
    const parsed = flatFactorConfigSchema.parse({
      input_path: "form_input.tiv",
      factor: 0.95,
      factor_kind: "sprinkler_credit",
    });
    expect(parsed.factor_unit).toBe("multiplier");
    expect(parsed.output_field).toBe("value");
    expect(parsed.description_template).toBe("{factor_kind}: ×{value}");
  });
});

describe("formulaConfigSchema", () => {
  it("parses a minimal formula", () => {
    const parsed = formulaConfigSchema.parse({
      name: "min_of_two",
      expression: "min(a, b)",
    });
    expect(parsed.data_type).toBe("number");
    expect(parsed.output_field).toBe("value");
  });

  it("rejects an over-length expression (>400 chars)", () => {
    expect(() =>
      formulaConfigSchema.parse({
        name: "x",
        expression: "a".repeat(401),
      }),
    ).toThrow();
  });
});
