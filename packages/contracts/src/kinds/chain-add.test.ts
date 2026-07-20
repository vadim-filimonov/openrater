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

  it("explainStep treats missing base as 0", () => {
    expect(
      ChainAddKind.explainStep!(
        { addends: [10, 20, 30] },
        {},
        { result: 60 },
      ),
    ).toBe("0 + 10 + 20 + 30 = 60");
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
