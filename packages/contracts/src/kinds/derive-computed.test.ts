/**
 * DeriveComputedKind tests (E03) — the computed appetite field.
 */

import { describe, it, expect } from "vitest";
import { DeriveComputedKind } from "./derive-computed";
import type { ComputedExpr } from "../policy-appetite";
import type { ExecuteContext } from "../block-types";

const TIV: ComputedExpr = {
  kind: "op",
  op: "+",
  left: { kind: "input", name: "building_limit" },
  right: { kind: "input", name: "bpp_limit" },
};

const ctx = (externalInputs: Record<string, unknown>): ExecuteContext => ({
  as_of: "2026-01-01",
  externalInputs,
});

describe("DeriveComputedKind", () => {
  it("is registered under derive.computed with a single value output", () => {
    expect(DeriveComputedKind.id).toBe("derive.computed");
    expect(DeriveComputedKind.inputs).toHaveLength(0);
    expect(DeriveComputedKind.outputs[0]?.name).toBe("value");
  });

  it("execute sums inputs read from ctx.externalInputs", () => {
    const r = DeriveComputedKind.execute(
      {},
      { fieldName: "tiv", expr: TIV },
      ctx({ building_limit: 850000, bpp_limit: 210000 }),
    );
    expect(r.value).toBe(1060000);
  });

  it("an absent input contributes 0 (graceful, like the gate)", () => {
    const r = DeriveComputedKind.execute(
      {},
      { fieldName: "tiv", expr: TIV },
      ctx({ building_limit: 500000 }),
    );
    expect(r.value).toBe(500000);
  });

  it("validate rejects an empty fieldName + a malformed expression", () => {
    expect(DeriveComputedKind.validate!({ fieldName: "", expr: TIV }).valid).toBe(false);
    expect(
      DeriveComputedKind.validate!({
        fieldName: "tiv",
        expr: { kind: "op", op: "%" } as unknown as ComputedExpr,
      }).valid,
    ).toBe(false);
    expect(DeriveComputedKind.validate!({ fieldName: "tiv", expr: TIV }).valid).toBe(true);
  });

  it("explainStep renders the expression + the result", () => {
    expect(
      DeriveComputedKind.explainStep!(
        {},
        { fieldName: "tiv", expr: TIV },
        { value: 1060000 },
      ),
    ).toBe("tiv = building_limit + bpp_limit = 1060000");
  });
});
