/**
 * inferPayloadSchema tests — Brief 38 PR 38.7.
 *
 * Covers each shape webhook responses commonly take:
 *   - Flat object
 *   - Nested object (dotted paths)
 *   - Array at root (recurses into [0] with warning)
 *   - Array at a field (recurses into [0])
 *   - JSONPath root resolution
 *   - Mixed primitive types + dtype inference
 *   - Edge cases: null, empty object/array, primitive root, deep nesting
 */

import { describe, it, expect } from "vitest";

import {
  inferPayloadSchema,
} from "./inferPayloadSchema";

describe("inferPayloadSchema — flat object", () => {
  it("emits one field per top-level key in document order", () => {
    const r = inferPayloadSchema({
      policy_id: "BOP-001",
      class_code: "c101",
      tiv: 1360000,
    });
    expect(r.fields).toEqual([
      { name: "policy_id", dtype: "string" },
      { name: "class_code", dtype: "string" },
      { name: "tiv", dtype: "number" },
    ]);
  });

  it("infers boolean for true/false values", () => {
    const r = inferPayloadSchema({ sprinklered: true, active: false });
    expect(r.fields.map((f) => f.dtype)).toEqual(["boolean", "boolean"]);
  });

  it("infers date for ISO 8601 string values", () => {
    const r = inferPayloadSchema({ eff_date: "2026-07-01" });
    expect(r.fields[0]?.dtype).toBe("date");
  });

  it("falls back to string for non-finite numbers + nulls", () => {
    const r = inferPayloadSchema({
      x: 1 / 0,
      y: null,
    });
    expect(r.fields[0]?.dtype).toBe("string");
    expect(r.fields[1]?.dtype).toBe("string");
  });
});

describe("inferPayloadSchema — nested object", () => {
  it("walks nested objects with dot-paths", () => {
    const r = inferPayloadSchema({
      policy_id: "BOP-001",
      policy: {
        class_code: "c101",
        tiv: 1360000,
        construction: "Frame",
      },
    });
    expect(r.fields.map((f) => f.name)).toEqual([
      "policy_id",
      "policy.class_code",
      "policy.tiv",
      "policy.construction",
    ]);
  });

  it("walks deeply nested objects", () => {
    const r = inferPayloadSchema({
      a: { b: { c: { d: 42 } } },
    });
    expect(r.fields[0]).toEqual({ name: "a.b.c.d", dtype: "number" });
  });

  it("stops at maxDepth + emits a warning", () => {
    const r = inferPayloadSchema(
      { a: { b: { c: { d: { e: 42 } } } } },
      { maxDepth: 2 },
    );
    expect(
      r.warnings.find((w) => w.kind === "max_depth_reached"),
    ).toBeDefined();
  });
});

describe("inferPayloadSchema — arrays", () => {
  it("recurses into [0] when the root is an array (with a warning)", () => {
    const r = inferPayloadSchema([
      { policy_id: "BOP-001", tiv: 1000 },
      { policy_id: "BOP-002", tiv: 2000 },
    ]);
    expect(r.fields).toEqual([
      { name: "policy_id", dtype: "string" },
      { name: "tiv", dtype: "number" },
    ]);
    expect(r.warnings.some((w) => w.kind === "array_at_root")).toBe(true);
  });

  it("does NOT warn when the root is an array AND a rootPath was provided", () => {
    const r = inferPayloadSchema(
      [{ policy_id: "BOP-001" }],
      { rootPath: "$[0]" },
    );
    expect(r.warnings.some((w) => w.kind === "array_at_root")).toBe(false);
  });

  it("recurses into [0] when an array appears at a field position", () => {
    const r = inferPayloadSchema({
      data: [
        { policy_id: "BOP-001", tiv: 1000 },
        { policy_id: "BOP-002", tiv: 2000 },
      ],
    });
    expect(r.fields).toEqual([
      { name: "data.policy_id", dtype: "string" },
      { name: "data.tiv", dtype: "number" },
    ]);
  });

  it("emits a single 'string' leaf for an empty array property", () => {
    const r = inferPayloadSchema({ data: [] });
    expect(r.fields).toEqual([{ name: "data", dtype: "string" }]);
  });

  it("treats arrays as leaves when treatArraysAsLeaves is true", () => {
    const r = inferPayloadSchema(
      {
        data: [{ x: 1 }],
      },
      { treatArraysAsLeaves: true },
    );
    expect(r.fields.find((f) => f.name === "data")).toBeDefined();
    // The nested x is NOT walked.
    expect(r.fields.find((f) => f.name === "data.x")).toBeUndefined();
  });
});

describe("inferPayloadSchema — JSONPath root resolution", () => {
  it("resolves $.data[0] into the array element", () => {
    const r = inferPayloadSchema(
      {
        data: [
          { policy_id: "BOP-001", tiv: 1000 },
          { policy_id: "BOP-002", tiv: 2000 },
        ],
      },
      { rootPath: "$.data[0]" },
    );
    expect(r.fields).toEqual([
      { name: "policy_id", dtype: "string" },
      { name: "tiv", dtype: "number" },
    ]);
  });

  it("resolves a path without the leading $.", () => {
    const r = inferPayloadSchema(
      { data: { record: { id: 1 } } },
      { rootPath: "data.record" },
    );
    expect(r.fields[0]?.name).toBe("id");
  });

  it("falls back + warns when rootPath misses", () => {
    const r = inferPayloadSchema(
      { policy_id: "BOP-001" },
      { rootPath: "$.does.not.exist" },
    );
    expect(r.warnings.some((w) => w.kind === "root_path_missed")).toBe(true);
    // Falls back to inferring from the whole sample.
    expect(r.fields.length).toBeGreaterThan(0);
  });

  it("resolves the bare $ root", () => {
    const r = inferPayloadSchema({ x: 1 }, { rootPath: "$" });
    expect(r.fields).toEqual([{ name: "x", dtype: "number" }]);
  });
});

describe("inferPayloadSchema — edge cases", () => {
  it("emits empty_sample warning when sample is null", () => {
    const r = inferPayloadSchema(null);
    expect(r.fields).toEqual([]);
    expect(r.warnings.some((w) => w.kind === "empty_sample")).toBe(true);
  });

  it("emits empty_sample warning when sample is an empty array", () => {
    const r = inferPayloadSchema([]);
    expect(r.warnings.some((w) => w.kind === "empty_sample")).toBe(true);
  });

  it("emits a single leaf for a primitive root", () => {
    const r = inferPayloadSchema("hello");
    expect(r.fields).toEqual([{ name: "(root)", dtype: "string" }]);
  });

  it("emits a single leaf for a numeric root", () => {
    const r = inferPayloadSchema(42);
    expect(r.fields).toEqual([{ name: "(root)", dtype: "number" }]);
  });

  it("handles empty object", () => {
    const r = inferPayloadSchema({});
    expect(r.fields).toEqual([]);
  });
});

describe("inferPayloadSchema — Brief 38 fixture: realistic webhook response", () => {
  const sample = {
    data: [
      {
        policy_id: "BOP-001",
        policy: {
          class_code: "c101",
          tiv: 1360000,
          construction: "Frame",
          quality_grade: "q1",
          sprinklered: true,
          year_built: 1987,
          eff_date: "2026-07-01",
          bpp_limit: 50000,
        },
      },
    ],
    meta: {
      pagination: { page: 1, total: 1 },
    },
  };

  it("infers fields when rootPath = $.data[0]", () => {
    const r = inferPayloadSchema(sample, { rootPath: "$.data[0]" });
    const fieldNames = r.fields.map((f) => f.name);
    expect(fieldNames).toContain("policy_id");
    expect(fieldNames).toContain("policy.class_code");
    expect(fieldNames).toContain("policy.tiv");
    expect(fieldNames).toContain("policy.construction");
    expect(fieldNames).toContain("policy.sprinklered");
    expect(fieldNames).toContain("policy.eff_date");
    expect(fieldNames).toContain("policy.bpp_limit");
  });

  it("infers correct dtypes for the policy sub-object", () => {
    const r = inferPayloadSchema(sample, { rootPath: "$.data[0]" });
    const m = Object.fromEntries(r.fields.map((f) => [f.name, f.dtype]));
    expect(m["policy.class_code"]).toBe("string");
    expect(m["policy.tiv"]).toBe("number");
    expect(m["policy.sprinklered"]).toBe("boolean");
    expect(m["policy.eff_date"]).toBe("date");
    expect(m["policy.year_built"]).toBe("number");
  });
});
