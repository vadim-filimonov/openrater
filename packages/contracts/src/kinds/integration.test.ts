/**
 * Built-in kinds × runtime — end-to-end integration.
 *
 * Exercises `registerBuiltinKinds()` against `executePlan()` with the
 * ACTUAL kinds exported from this package (input + input.source +
 * output + constant + math.op). The other test files cover each kind
 * in isolation; this one proves the wiring works end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { executePlan } from "../runtime";
import { _clearRegistryForTests } from "../registry";
import { registerBuiltinKinds } from "./index";
import type { Plan } from "../plan-types";

beforeEach(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

describe("registerBuiltinKinds() — registration", () => {
  it("registers all 5 v0 kinds without ID collision", () => {
    // beforeEach already called registerBuiltinKinds() once;
    // calling again must throw on duplicates.
    expect(() => registerBuiltinKinds()).toThrow();
  });
});

describe("input → math.op → output pipeline", () => {
  it("substitutes external value, applies math, collects output", () => {
    const plan: Plan = {
      version: "0",
      id: "test:in-mul-out",
      name: "in-mul-out",
      nodes: [
        {
          id: "in_tiv",
          kind: "input",
          params: { fieldName: "tiv", fieldType: "money" },
        },
        {
          id: "in_rate",
          kind: "input",
          params: { fieldName: "rate", fieldType: "factor" },
        },
        {
          id: "premium",
          kind: "math.op",
          params: { op: "mul" },
        },
        {
          id: "out_premium",
          kind: "output",
          params: { fieldName: "premium", fieldType: "money" },
        },
      ],
      edges: [
        { from: { node: "in_tiv", port: "value" }, to: { node: "premium", port: "x" } },
        { from: { node: "in_rate", port: "value" }, to: { node: "premium", port: "y" } },
        { from: { node: "premium", port: "result" }, to: { node: "out_premium", port: "value" } },
      ],
    };

    const result = executePlan(plan, { tiv: 1000000, rate: 0.0012 });
    expect(result.outputs.premium).toBeCloseTo(1200);
  });

  it("falls back to params.defaultValue when external input missing", () => {
    const plan: Plan = {
      version: "0",
      id: "test:default",
      name: "default",
      nodes: [
        {
          id: "in_factor",
          kind: "input",
          params: { fieldName: "factor", fieldType: "factor", defaultValue: 1.25 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "result", fieldType: "factor" },
        },
      ],
      edges: [
        { from: { node: "in_factor", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };

    const result = executePlan(plan, {});
    expect(result.outputs.result).toBe(1.25);
  });
});

describe("constant → math.op → output pipeline", () => {
  it("applies clamp with inline lo/hi to a constant", () => {
    const plan: Plan = {
      version: "0",
      id: "test:clamp",
      name: "clamp",
      nodes: [
        {
          id: "k",
          kind: "constant",
          params: { value: 2.0, type: "factor" },
        },
        {
          id: "clamp",
          kind: "math.op",
          params: { op: "clamp", lo: 0.5, hi: 1.5 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "factor", fieldType: "factor" },
        },
      ],
      edges: [
        { from: { node: "k", port: "value" }, to: { node: "clamp", port: "x" } },
        { from: { node: "clamp", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };

    const result = executePlan(plan, {});
    expect(result.outputs.factor).toBe(1.5);
  });
});

describe("input.source — runtime special-case", () => {
  it("substitutes external value by params.fieldName (just like `input`)", () => {
    const plan: Plan = {
      version: "0",
      id: "test:input-source",
      name: "input-source",
      nodes: [
        {
          id: "alc",
          kind: "input.source",
          params: {
            fieldName: "alcohol_intensity",
            fieldType: "factor",
            sourceType: "lookup",
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "alc", fieldType: "factor" },
        },
      ],
      edges: [
        { from: { node: "alc", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };

    const result = executePlan(plan, { alcohol_intensity: 0.85 });
    expect(result.outputs.alc).toBe(0.85);
  });

  it("falls back to params.defaultValue when external input missing", () => {
    const plan: Plan = {
      version: "0",
      id: "test:input-source-default",
      name: "input-source-default",
      nodes: [
        {
          id: "alc",
          kind: "input.source",
          params: {
            fieldName: "alcohol_intensity",
            fieldType: "factor",
            sourceType: "lookup",
            defaultValue: 1.0,
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "alc", fieldType: "factor" },
        },
      ],
      edges: [
        { from: { node: "alc", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };

    const result = executePlan(plan, {});
    expect(result.outputs.alc).toBe(1.0);
  });
});

describe("trace contract", () => {
  it("trace records every node's inputs + outputs in topo order", () => {
    const plan: Plan = {
      version: "0",
      id: "test:trace",
      name: "trace",
      nodes: [
        {
          id: "in_x",
          kind: "input",
          params: { fieldName: "x", fieldType: "factor" },
        },
        {
          id: "in_y",
          kind: "input",
          params: { fieldName: "y", fieldType: "factor" },
        },
        {
          id: "sum",
          kind: "math.op",
          params: { op: "add" },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "sum", fieldType: "factor" },
        },
      ],
      edges: [
        { from: { node: "in_x", port: "value" }, to: { node: "sum", port: "x" } },
        { from: { node: "in_y", port: "value" }, to: { node: "sum", port: "y" } },
        { from: { node: "sum", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };

    const result = executePlan(plan, { x: 3, y: 4 });
    expect(result.outputs.sum).toBe(7);
    expect(result.trace.in_x?.outputs.value).toBe(3);
    expect(result.trace.in_y?.outputs.value).toBe(4);
    expect(result.trace.sum?.outputs.result).toBe(7);
  });
});
