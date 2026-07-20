import { describe, it, expect } from "vitest";
import { SubplanKind } from "./subplan";
import type { Plan } from "../plan-types";

const SIMPLE_INNER: Plan = {
  id: "inner-1",
  version: "0.0.0",
  name: "Simple inner plan",
  nodes: [
    {
      id: "in_x",
      kind: "input",
      params: { fieldName: "x", fieldType: "factor", description: "X value" },
    },
    {
      id: "out_y",
      kind: "output",
      params: { fieldName: "y", fieldType: "factor" },
    },
  ],
  edges: [
    { from: { node: "in_x", port: "value" }, to: { node: "out_y", port: "value" } },
  ],
};

describe("SubplanKind", () => {
  it("declares category=chain (subplans compose like chain blocks do)", () => {
    expect(SubplanKind.category).toBe("chain");
  });

  it("static inputs/outputs are empty; ports come from derivedPorts", () => {
    expect(SubplanKind.inputs).toEqual([]);
    expect(SubplanKind.outputs).toEqual([]);
  });

  it("execute returns empty {} (runtime special-cases subplan)", () => {
    expect(SubplanKind.execute({}, { plan: SIMPLE_INNER })).toEqual({});
  });

  it("derivedPorts mirrors inner plan's input + output node names", () => {
    const ports = SubplanKind.derivedPorts!({ plan: SIMPLE_INNER });
    expect(ports.inputs).toHaveLength(1);
    expect(ports.inputs[0]?.name).toBe("x");
    expect(ports.inputs[0]?.type).toBe("factor");
    expect(ports.outputs).toHaveLength(1);
    expect(ports.outputs[0]?.name).toBe("y");
  });

  it("derivedPorts treats input.source as an input source too", () => {
    const inner: Plan = {
      id: "i",
      version: "0.0.0",
      name: "i",
      nodes: [
        {
          id: "src",
          kind: "input.source",
          params: {
            fieldName: "alc",
            fieldType: "factor",
            sourceType: "lookup",
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "out", fieldType: "factor" },
        },
      ],
      edges: [],
    };
    const ports = SubplanKind.derivedPorts!({ plan: inner });
    expect(ports.inputs[0]?.name).toBe("alc");
  });

  it("derivedPorts skips input/output nodes without a fieldName", () => {
    const inner: Plan = {
      id: "i",
      version: "0.0.0",
      name: "i",
      nodes: [
        { id: "bad_in", kind: "input", params: { fieldType: "factor" } },
        { id: "bad_out", kind: "output", params: { fieldType: "factor" } },
      ],
      edges: [],
    };
    const ports = SubplanKind.derivedPorts!({ plan: inner });
    expect(ports.inputs).toHaveLength(0);
    expect(ports.outputs).toHaveLength(0);
  });

  it("validate flags missing plan", () => {
    const r = SubplanKind.validate!({
      // @ts-expect-error — intentionally invalid
      plan: null,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("plan");
  });

  it("validate flags plan with non-array nodes", () => {
    const r = SubplanKind.validate!({
      // @ts-expect-error — intentionally invalid
      plan: { id: "x", version: "0", name: "x", nodes: "oops", edges: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/nodes must be an array/);
  });

  it("validate warns on empty plan (still valid)", () => {
    const r = SubplanKind.validate!({
      plan: {
        id: "x",
        version: "0",
        name: "x",
        nodes: [],
        edges: [],
      },
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });

  it("validate accepts a populated plan", () => {
    const r = SubplanKind.validate!({ plan: SIMPLE_INNER });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});
