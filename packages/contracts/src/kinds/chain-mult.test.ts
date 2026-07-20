import { describe, it, expect } from "vitest";
import { ChainMultKind } from "./chain-mult";

describe("ChainMultKind", () => {
  it("declares base + factors inputs, result output", () => {
    expect(ChainMultKind.inputs).toHaveLength(2);
    expect(ChainMultKind.inputs[0]?.name).toBe("base");
    expect(ChainMultKind.inputs[1]?.name).toBe("factors");
    expect(ChainMultKind.inputs[1]?.cardinality).toBe("N");
    expect(ChainMultKind.outputs[0]?.name).toBe("result");
  });

  it("base × ∏ factors", () => {
    const r = ChainMultKind.execute(
      { base: 1000, factors: [1.1, 0.95, 1.2] },
      { stopOnZero: false },
    );
    expect(r.result).toBeCloseTo(1000 * 1.1 * 0.95 * 1.2);
  });

  it("returns base when factors is empty", () => {
    const r = ChainMultKind.execute(
      { base: 1000, factors: [] },
      { stopOnZero: false },
    );
    expect(r.result).toBe(1000);
  });

  it("stopOnZero=true short-circuits to 0 on first zero factor", () => {
    const r = ChainMultKind.execute(
      { base: 1000, factors: [1.1, 0, 1.2] },
      { stopOnZero: true },
    );
    expect(r.result).toBe(0);
  });

  it("stopOnZero=false multiplies through (0 × anything = 0)", () => {
    const r = ChainMultKind.execute(
      { base: 1000, factors: [1.1, 0, 1.2] },
      { stopOnZero: false },
    );
    expect(r.result).toBe(0);
  });

  // ── P1-01 (audit A-2026-07-12): a non-finite base/factor REFUSES ──
  // JS arithmetic silently coerces null/[]/""→0 and true→1; those must
  // not improvise a premium. execute emits NaN so the output node's
  // unresolved-output backstop withholds the premium.
  describe("non-finite base or factor → NaN (refuse, never improvise)", () => {
    for (const bad of [null, undefined, [], {}, true, false, "", "abc", NaN, Infinity, -Infinity]) {
      it(`base = ${JSON.stringify(bad)} → NaN`, () => {
        const r = ChainMultKind.execute(
          // runtime feeds real (untyped) wire values; the compile-time
          // `number` type is a fiction here on purpose.
          { base: bad as unknown as number, factors: [1.1] },
          { stopOnZero: false },
        );
        expect(Number.isNaN(r.result)).toBe(true);
      });
      it(`factor = ${JSON.stringify(bad)} → NaN`, () => {
        const r = ChainMultKind.execute(
          { base: 1000, factors: [bad as unknown as number] },
          { stopOnZero: false },
        );
        expect(Number.isNaN(r.result)).toBe(true);
      });
    }

    it("a finite base with all finite factors is byte-identical to before", () => {
      const r = ChainMultKind.execute(
        { base: 1510, factors: [1.0] },
        { stopOnZero: false },
      );
      expect(r.result).toBe(1510);
    });

    it("a clean numeric STRING still coerces (the wire is stringly)", () => {
      const r = ChainMultKind.execute(
        { base: "1510" as unknown as number, factors: ["1.5" as unknown as number] },
        { stopOnZero: false },
      );
      expect(r.result).toBe(2265);
    });
  });

  it("jacobian for ∂result/∂base = result / base", () => {
    const inputs = { base: 1000, factors: [1.1, 0.95] };
    const outputs = ChainMultKind.execute(inputs, { stopOnZero: false });
    const j = ChainMultKind.jacobian!(inputs, { stopOnZero: false }, outputs);
    expect(j["result/base"]?.base).toBeCloseTo(1.1 * 0.95);
  });

  it("jacobian when base is 0 returns 0 slope (no divide-by-zero)", () => {
    const inputs = { base: 0, factors: [1.1] };
    const outputs = { result: 0 };
    const j = ChainMultKind.jacobian!(inputs, { stopOnZero: false }, outputs);
    expect(j["result/base"]?.base).toBe(0);
  });

  it("validate accepts any params (params are display-only)", () => {
    expect(ChainMultKind.validate!({}).valid).toBe(true);
    expect(
      ChainMultKind.validate!({
        factorNames: ["a", "b"],
        stopOnZero: true,
      }).valid,
    ).toBe(true);
  });

  it("explainStep shows the chain expression", () => {
    expect(
      ChainMultKind.explainStep!(
        { base: 1000, factors: [1.1, 0.95, 1.32] },
        { factorNames: ["LCM", "disc", "load"] },
        { result: 1379.4 },
      ),
    ).toBe("1000 × 1.1 (LCM) × 0.95 (disc) × 1.32 (load) = 1379.4");
  });

  it("explainStep omits names when factorNames is empty", () => {
    expect(
      ChainMultKind.explainStep!(
        { base: 1000, factors: [1.1, 0.95] },
        {},
        { result: 1045 },
      ),
    ).toBe("1000 × 1.1 × 0.95 = 1045");
  });

  it("explainStep flags the no-factors case", () => {
    expect(
      ChainMultKind.explainStep!(
        { base: 1000, factors: [] },
        {},
        { result: 1000 },
      ),
    ).toBe("1000 (no factors) → 1000");
  });
});
