import { describe, it, expect } from "vitest";
import { ChainAddKind } from "./chain-add";

describe("ChainAddKind", () => {
  it("declares optional base + addends inputs, result output", () => {
    expect(ChainAddKind.inputs[0]?.name).toBe("base");
    expect(ChainAddKind.inputs[0]?.optional).toBe(true);
    expect(ChainAddKind.inputs[0]?.default).toBe(0);
    expect(ChainAddKind.inputs[1]?.name).toBe("addends");
    expect(ChainAddKind.inputs[1]?.cardinality).toBe("N");
    expect(ChainAddKind.outputs[0]?.name).toBe("result");
  });

  it("base + Σ addends", () => {
    const r = ChainAddKind.execute(
      { base: 100, addends: [10, 20, 30] },
      { addendNames: [] },
    );
    expect(r.result).toBe(160);
  });

  it("treats missing base as 0", () => {
    const r = ChainAddKind.execute(
      { addends: [10, 20, 30] },
      { addendNames: [] },
    );
    expect(r.result).toBe(60);
  });

  it("returns base alone when addends is empty", () => {
    const r = ChainAddKind.execute(
      { base: 100, addends: [] },
      { addendNames: [] },
    );
    expect(r.result).toBe(100);
  });

  it("handles negative addends (credits / refunds)", () => {
    const r = ChainAddKind.execute(
      { base: 100, addends: [-25, -10] },
      { addendNames: [] },
    );
    expect(r.result).toBe(65);
  });

  it("jacobian ∂result/∂base = 1", () => {
    const j = ChainAddKind.jacobian!(
      { base: 100, addends: [] },
      { addendNames: [] },
      { result: 100 },
    );
    expect(j["result/base"]?.base).toBe(1);
  });

  it("validate accepts any params", () => {
    expect(ChainAddKind.validate!({}).valid).toBe(true);
    expect(ChainAddKind.validate!({ addendNames: ["a"] }).valid).toBe(true);
  });

  it("explainStep renders signs cleanly for negative addends", () => {
    expect(
      ChainAddKind.explainStep!(
        { base: 100, addends: [50, -25, -10] },
        { addendNames: ["load", "disc", "rebate"] },
        { result: 115 },
      ),
    ).toBe("100 + 50 (load) − 25 (disc) − 10 (rebate) = 115");
  });

  it("explainStep treats missing base as 0 (and hides the empty seed — FCA #34)", () => {
    expect(
      ChainAddKind.explainStep!(
        { addends: [10, 20, 30] },
        {},
        { result: 60 },
      ),
    ).toBe("10 + 20 + 30 = 60");
  });

  it("explainStep flags the no-addends case", () => {
    expect(
      ChainAddKind.explainStep!(
        { base: 100, addends: [] },
        {},
        { result: 100 },
      ),
    ).toBe("100 (no addends) → 100");
  });
});

  // FCA #34 (findings 25/53) — the package line read "0 + 822 + 211 =
  // 1033": the zero seed is an accumulator detail, not arithmetic the
  // manual shows. And on failed rows "0 − NaN − NaN = NaN" (NaN >= 0
  // is false, so NaN addends drew MINUS signs). The seed is dropped
  // when it adds nothing and unresolved addends are named.
  it("explainStep drops the zero seed", () => {
    expect(
      ChainAddKind.explainStep!(
        { base: 0, addends: [822, 211] },
        {},
        { result: 1033 },
      ),
    ).toBe("822 + 211 = 1033");
  });

  it("explainStep keeps a real base", () => {
    expect(
      ChainAddKind.explainStep!(
        { base: 100, addends: [22] },
        {},
        { result: 122 },
      ),
    ).toBe("100 + 22 = 122");
  });

  it("explainStep names unresolved addends instead of − NaN", () => {
    const line = ChainAddKind.explainStep!(
      { base: 0, addends: [Number.NaN, 527] },
      { addendNames: ["building", "liability"] },
      { result: Number.NaN },
    );
    expect(line).not.toContain("NaN");
    expect(line).toContain("building");
    expect(line).toContain("unresolved");
  });
