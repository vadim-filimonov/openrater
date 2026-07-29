import { describe, it, expect } from "vitest";
import { InterpolateKind } from "./interpolate";

describe("InterpolateKind", () => {
  const points = [
    { x: 100_000, y: 1.0 },
    { x: 250_000, y: 1.3 },
    { x: 500_000, y: 1.45 },
    { x: 1_000_000, y: 1.6 },
  ];

  it("declares x input, y output, transform category", () => {
    expect(InterpolateKind.id).toBe("interpolate");
    expect(InterpolateKind.category).toBe("transform");
    expect(InterpolateKind.inputs[0]?.name).toBe("x");
    expect(InterpolateKind.outputs[0]?.name).toBe("y");
  });

  it("an exact breakpoint returns that y byte-exactly", () => {
    for (const p of points) {
      expect(
        InterpolateKind.execute({ x: p.x }, { points, mode: "linear", clamp: true }).y,
      ).toBe(p.y);
    }
  });

  it("interpolates linearly between two breakpoints", () => {
    // x=315000 sits between (250000,1.3) and (500000,1.45).
    // 1.3 + (315000-250000)/(500000-250000) * (1.45-1.3) = 1.3 + 0.26*0.15 = 1.339
    const r = InterpolateKind.execute(
      { x: 315_000 },
      { points, mode: "linear", clamp: true },
    );
    expect(r.y).toBeCloseTo(1.339, 6);
  });

  it("the midpoint of a segment is the mean of its endpoints", () => {
    const r = InterpolateKind.execute(
      { x: 175_000 },
      { points, mode: "linear", clamp: true },
    );
    expect(r.y).toBeCloseTo((1.0 + 1.3) / 2, 6);
  });

  it("clamps to the nearest endpoint outside the range (default)", () => {
    expect(InterpolateKind.execute({ x: 1 }, { points, mode: "linear", clamp: true }).y).toBe(1.0);
    expect(
      InterpolateKind.execute({ x: 9_999_999 }, { points, mode: "linear", clamp: true }).y,
    ).toBe(1.6);
  });

  it("clamp:false extrapolates linearly off the end segments", () => {
    // above the top: extend the (500000,1.45)->(1000000,1.6) slope past 1e6.
    const r = InterpolateKind.execute(
      { x: 1_500_000 },
      { points, mode: "linear", clamp: false },
    );
    // slope 0.15/500000; y = 1.6 + 500000*slope = 1.75
    expect(r.y).toBeCloseTo(1.75, 6);
  });

  it("a non-finite or non-numeric x refuses (NaN → withheld)", () => {
    for (const bad of [null, undefined, [], {}, true, "", "abc", NaN, Infinity]) {
      const r = InterpolateKind.execute(
        { x: bad as unknown as number },
        { points, mode: "linear", clamp: true },
      );
      expect(Number.isNaN(r.y)).toBe(true);
    }
  });

  it("a clean numeric STRING x still coerces (stringly wire)", () => {
    const r = InterpolateKind.execute(
      { x: "315000" as unknown as number },
      { points, mode: "linear", clamp: true },
    );
    expect(r.y).toBeCloseTo(1.339, 6);
  });

  it("empty points → NaN (never improvise)", () => {
    expect(
      Number.isNaN(InterpolateKind.execute({ x: 100 }, { points: [], mode: "linear", clamp: true }).y),
    ).toBe(true);
  });

  it("validate rejects non-ascending points", () => {
    expect(
      InterpolateKind.validate!({
        points: [
          { x: 100, y: 1 },
          { x: 100, y: 2 },
        ],
      }).valid,
    ).toBe(false);
    expect(InterpolateKind.validate!({ points }).valid).toBe(true);
  });

  it("explainStep names the bracketing breakpoints", () => {
    const out = InterpolateKind.execute({ x: 315_000 }, { points, mode: "linear", clamp: true });
    const s = InterpolateKind.explainStep!(
      { x: 315_000 },
      { points, mode: "linear", clamp: true, axisLabel: "building_limit" },
      out,
    );
    expect(s).toContain("building_limit=315000");
    expect(s).toContain("(250000, 1.3)");
    expect(s).toContain("(500000, 1.45)");
  });
});

  // FCA #34 (findings 40/47) — an exactly-on-anchor lookup was
  // narrated as "between (600000, 1.18) and (1000000, 1.28) → 1.28",
  // describing a boundary hit as interpolation. An anchor hit says so.
  it("explainStep names an exact anchor hit instead of 'between'", () => {
    const line = InterpolateKind.explainStep!(
      { x: 1_000_000 },
      {
        points: [
          { x: 600_000, y: 1.18 },
          { x: 1_000_000, y: 1.28 },
        ],
        axisLabel: "aggregate_limit",
      },
      { y: 1.28 },
    );
    expect(line).toContain("at the");
    expect(line).toContain("anchor");
    expect(line).not.toContain("between");
  });
