/**
 * `input.class_exposure` kind tests.
 *
 * Two layers:
 *
 *   1. Kind-level: defaults, ports, validate(). The execute() stub
 *      itself returns { value: 0 } (the runtime substitutes before
 *      reaching it), so we don't unit-test execute resolution here.
 *
 *   2. Runtime-level: the full resolution path via executePlan. We
 *      bind a ClassLibrary, build a tiny plan with input.class_exposure
 *      → output, run it, assert the resolved value + trace explanation.
 *      Then we negative-test the failure modes (no library, missing
 *      class, no declarations, missing value).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InputClassExposureKind } from "./input-class-exposure";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import {
  KindRegistry,
  _clearRegistryForTests,
  globalRegistry,
} from "../registry";
import { makeClassLibrary } from "../class-library-types";
import type { ClassLibraryEntry } from "../class-library-types";
import type { Plan } from "../plan-types";

const CAFE: ClassLibraryEntry = {
  class_code: "c101",
  display_name: "Meridian Cafe",
  exposure_bases: [
    {
      code: "sales",
      is_primary: true,
      unit: "USD",
    },
  ],
};

const WORKSHOP: ClassLibraryEntry = {
  class_code: "c201",
  display_name: "Meridian Workshop",
  exposure_bases: [
    {
      code: "payroll",
      is_primary: true,
      unit: "USD",
      coverage_tags: ["liability", "wc"],
    },
    {
      code: "area",
      is_primary: false,
      unit: "sq ft",
      coverage_tags: ["property"],
    },
  ],
};

const EMPTY_CLASS: ClassLibraryEntry = {
  class_code: "c999",
  display_name: "Meridian Empty Class",
  exposure_bases: [],
};

const library = makeClassLibrary([
  CAFE,
  WORKSHOP,
  EMPTY_CLASS,
]);

describe("InputClassExposureKind — contract surface", () => {
  it("has the correct id, category, label, ports, defaults", () => {
    expect(InputClassExposureKind.id).toBe("input.class_exposure");
    expect(InputClassExposureKind.category).toBe("input");
    expect(InputClassExposureKind.inputs).toHaveLength(0);
    expect(InputClassExposureKind.outputs).toHaveLength(1);
    expect(InputClassExposureKind.outputs[0]?.name).toBe("value");
    expect(InputClassExposureKind.defaultParams.coverage_scope).toBeNull();
    expect(InputClassExposureKind.defaultParams.classCodeFieldName).toBe(
      "class_code",
    );
  });

  it("execute() returns a stub value (the runtime substitutes)", () => {
    // Direct callers who bypass the runtime get a deterministic 0
    // rather than an exception — a clear "you forgot the runtime" signal.
    expect(InputClassExposureKind.execute({}, { coverage_scope: null })).toEqual({
      value: 0,
    });
  });

  it("validate accepts default + custom classCodeFieldName", () => {
    expect(
      InputClassExposureKind.validate?.(
        InputClassExposureKind.defaultParams,
      ),
    ).toEqual({ valid: true, issues: [] });
    expect(
      InputClassExposureKind.validate?.({
        coverage_scope: "liability",
        classCodeFieldName: "primary_class",
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it("validate rejects empty classCodeFieldName", () => {
    const result = InputClassExposureKind.validate?.({
      coverage_scope: null,
      classCodeFieldName: "  ",
    });
    expect(result?.valid).toBe(false);
    expect(result?.issues?.[0]?.field).toBe("classCodeFieldName");
  });
});

describe("input.class_exposure — runtime resolution path", () => {
  function makePlan(coverage_scope: string | null = null): Plan {
    return {
      id: "test.class.exposure",
      version: "0.1.0",
      name: "Test plan",
      nodes: [
        {
          id: "cls_exp",
          kind: "input.class_exposure",
          params: {
            coverage_scope,
            classCodeFieldName: "class_code",
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "exposure", fieldType: "money" },
        },
      ],
      edges: [
        {
          from: { node: "cls_exp", port: "value" },
          to: { node: "out", port: "value" },
        },
      ],
    };
  }

  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(InputClassExposureKind);
    globalRegistry.register(OutputKind);
  });

  it("resolves to the class's primary exposure when no scope set", () => {
    const result = executePlan(
      makePlan(),
      {
        class_code: "c101", // Meridian Cafe → primary: sales
        annual_sales: 1_500_000,
      },
      { classLibrary: library },
    );
    expect(result.outputs.exposure).toBe(1_500_000);
    const trace = result.trace["cls_exp"];
    expect(trace?.outputs.value).toBe(1_500_000);
    expect(trace?.explanation).toMatch(/c101.*Meridian Cafe.*sales.*primary/);
    expect(trace?.explanation).toMatch(/1500000 USD|1_?500_?000 USD/);
    expect(trace?.error).toBeUndefined();
  });

  it("resolves via coverage_scope to alternate declaration", () => {
    const result = executePlan(
      makePlan("property"),
      {
        class_code: "c201", // Meridian Workshop → property: area
        area_sqft: 5000,
        annual_payroll: 850_000, // Also present but ignored for property
      },
      { classLibrary: library },
    );
    expect(result.outputs.exposure).toBe(5000);
    expect(result.trace["cls_exp"]?.explanation).toMatch(/area.*coverage property/);
  });

  it("falls back to primary when no declaration matches scope", () => {
    const result = executePlan(
      makePlan("auto"), // No declaration tagged "auto"; falls back to primary
      {
        class_code: "c201",
        annual_payroll: 850_000,
      },
      { classLibrary: library },
    );
    expect(result.outputs.exposure).toBe(850_000); // primary payroll
  });

  it("errors clearly when no classLibrary bound", () => {
    const result = executePlan(makePlan(), {
      class_code: "c101",
      annual_sales: 1_500_000,
    });
    // No classLibrary in RunOptions
    const trace = result.trace["cls_exp"];
    expect(trace?.error?.message).toMatch(/Class library not bound/);
    // Downstream output is undefined (no value flowed)
    expect(result.outputs.exposure).toBeUndefined();
  });

  it("errors clearly when class_code is missing from inputs", () => {
    const result = executePlan(
      makePlan(),
      { annual_sales: 1_500_000 }, // no class_code
      { classLibrary: library },
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(
      /Missing or invalid class_code/,
    );
  });

  it("errors clearly when class_code is empty string", () => {
    const result = executePlan(
      makePlan(),
      { class_code: "   ", annual_sales: 1_500_000 },
      { classLibrary: library },
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(
      /Missing or invalid class_code/,
    );
  });

  it("errors clearly when class is not in the library", () => {
    const result = executePlan(
      makePlan(),
      { class_code: "c404", annual_sales: 1_500_000 },
      { classLibrary: library },
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(
      /Class c404 not found/,
    );
  });

  it("errors clearly when class has no exposure_bases declared", () => {
    const result = executePlan(
      makePlan(),
      { class_code: "c999", annual_sales: 1_500_000 },
      { classLibrary: library },
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(
      /no declared exposure_bases/,
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(/Declare one/);
  });

  it("errors clearly when the resolved exposure value is missing", () => {
    const result = executePlan(
      makePlan(),
      { class_code: "c101" }, // No annual_sales for the resolved declaration
      { classLibrary: library },
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(
      /Missing annual_sales/,
    );
  });

  it("errors clearly when the resolved exposure value is non-numeric", () => {
    const result = executePlan(
      makePlan(),
      { class_code: "c101", annual_sales: "1.5M" }, // Not a number
      { classLibrary: library },
    );
    expect(result.trace["cls_exp"]?.error?.message).toMatch(
      /Missing annual_sales/,
    );
  });

  it("respects a custom classCodeFieldName", () => {
    const plan: Plan = {
      id: "test.custom.field",
      version: "0.1.0",
      name: "Test",
      nodes: [
        {
          id: "cls_exp",
          kind: "input.class_exposure",
          params: { classCodeFieldName: "primary_class", coverage_scope: null },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "exposure", fieldType: "money" },
        },
      ],
      edges: [
        {
          from: { node: "cls_exp", port: "value" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(
      plan,
      { primary_class: "c101", annual_sales: 2_000_000 },
      { classLibrary: library },
    );
    expect(result.outputs.exposure).toBe(2_000_000);
  });
});

describe("isolated KindRegistry honors input.class_exposure", () => {
  it("registers + runs against an isolated registry", () => {
    const reg = new KindRegistry();
    reg.register(InputClassExposureKind);
    reg.register(OutputKind);

    const plan: Plan = {
      id: "test.synthetic",
      version: "0.1.0",
      name: "Test",
      nodes: [
        {
          id: "cls_exp",
          kind: "input.class_exposure",
          params: { coverage_scope: null },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "exposure", fieldType: "money" },
        },
      ],
      edges: [
        {
          from: { node: "cls_exp", port: "value" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(
      plan,
      { class_code: "c101", annual_sales: 1_500_000 },
      { classLibrary: library },
      reg,
    );
    expect(result.outputs.exposure).toBe(1_500_000);
  });
});
