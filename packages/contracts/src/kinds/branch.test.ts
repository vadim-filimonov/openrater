import { describe, it, expect } from "vitest";
import { BranchKind } from "./branch";

describe("BranchKind", () => {
  it("declares predicate + then + else inputs, result output", () => {
    expect(BranchKind.inputs).toHaveLength(3);
    expect(BranchKind.inputs[0]?.name).toBe("predicate");
    expect(BranchKind.inputs[0]?.type).toBe("bool");
    expect(BranchKind.inputs[1]?.name).toBe("then");
    expect(BranchKind.inputs[2]?.name).toBe("else");
    expect(BranchKind.outputs[0]?.name).toBe("result");
  });

  it("declares category=branch", () => {
    expect(BranchKind.category).toBe("branch");
  });

  it("returns `then` when predicate is true", () => {
    expect(
      BranchKind.execute({ predicate: true, then: 1.25, else: 1.0 }, {}).result,
    ).toBe(1.25);
  });

  it("returns `else` when predicate is false", () => {
    expect(
      BranchKind.execute({ predicate: false, then: 1.25, else: 1.0 }, {})
        .result,
    ).toBe(1.0);
  });

  it("passes through any type (then/else just need to be typed-identical)", () => {
    expect(
      BranchKind.execute(
        { predicate: true, then: "frame", else: "masonry" },
        {},
      ).result,
    ).toBe("frame");
    expect(
      BranchKind.execute({ predicate: false, then: [1, 2], else: [3, 4] }, {})
        .result,
    ).toEqual([3, 4]);
  });

  it("validate accepts any params (BranchParams is empty)", () => {
    expect(BranchKind.validate!({}).valid).toBe(true);
  });
});
