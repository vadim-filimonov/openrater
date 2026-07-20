import { describe, it, expect } from "vitest";
import { RatingModelKind } from "./model-rating";

describe("RatingModelKind (stub)", () => {
  it("declares features input + value output", () => {
    expect(RatingModelKind.inputs[0]?.name).toBe("features");
    expect(RatingModelKind.outputs[0]?.name).toBe("value");
    expect(RatingModelKind.outputs[0]?.type).toBe("factor");
  });

  it("declares category=model + certainty=experimental", () => {
    expect(RatingModelKind.category).toBe("model");
    expect(RatingModelKind.certainty).toBe("experimental");
  });

  it("execute returns 1.0 (identity factor) without clamps", () => {
    const r = RatingModelKind.execute(
      { features: { age: 5 } },
      { modelId: "schedule-model" },
    );
    expect(r.value).toBe(1.0);
  });

  it("clampLo raises the stub output when above 1.0", () => {
    const r = RatingModelKind.execute(
      { features: {} },
      { modelId: "x", clampLo: 1.5 },
    );
    expect(r.value).toBe(1.5);
  });

  it("clampHi lowers the stub output when below 1.0", () => {
    const r = RatingModelKind.execute(
      { features: {} },
      { modelId: "x", clampHi: 0.8 },
    );
    expect(r.value).toBe(0.8);
  });

  it("validate flags clampLo > clampHi", () => {
    const r = RatingModelKind.validate!({
      modelId: "x",
      clampLo: 2,
      clampHi: 1,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/clampLo must be/);
  });

  it("validate warns when modelId is empty (still valid)", () => {
    const r = RatingModelKind.validate!({ modelId: "" });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });
});
