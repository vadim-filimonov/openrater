import { describe, it, expect } from "vitest";
import { GlmModelKind, GLM_REGISTRY_RETIRED_MESSAGE } from "./model-glm";

describe("GlmModelKind", () => {
  it("declares features input + predicted/contributions outputs", () => {
    expect(GlmModelKind.inputs[0]?.name).toBe("features");
    expect(GlmModelKind.outputs).toHaveLength(2);
    expect(GlmModelKind.outputs[0]?.name).toBe("predicted");
    expect(GlmModelKind.outputs[1]?.name).toBe("contributions");
  });

  it("declares category=model + certainty=experimental", () => {
    expect(GlmModelKind.category).toBe("model");
    expect(GlmModelKind.certainty).toBe("experimental");
  });

  it("evaluates inline coefficients for real — identity link (62.5 PR1)", () => {
    // lp = 1 + 2·5 + 3·10 = 41 ; identity ⇒ output = lp
    const r = GlmModelKind.execute(
      { features: { x1: 5, x2: 10 } },
      { modelId: "", intercept: 1, link: "identity", coefficients: { x1: 2, x2: 3 } },
    );
    expect(r.predicted).toBe(41);
    expect(r.contributions).toEqual({ x1: 10, x2: 30 });
  });

  it("applies the log link to the linear predictor", () => {
    // lp = 0 + 1·2 = 2 ; log ⇒ output = e² ≈ 7.389
    const r = GlmModelKind.execute(
      { features: { x: 2 } },
      { modelId: "", intercept: 0, link: "log", coefficients: { x: 1 } },
    );
    expect(r.predicted).toBeCloseTo(Math.exp(2), 10);
  });

  it("applies the logit link to the linear predictor", () => {
    // lp = 0 ; logit ⇒ 1/(1+e⁰) = 0.5
    const r = GlmModelKind.execute(
      { features: { x: 0 } },
      { modelId: "", intercept: 0, link: "logit", coefficients: { x: 1 } },
    );
    expect(r.predicted).toBeCloseTo(0.5, 12);
  });

  it("treats an absent feature as baseline (0 contribution) — deterministic", () => {
    const r = GlmModelKind.execute(
      { features: { x: 5 } }, // y absent
      { modelId: "", intercept: 0, link: "identity", coefficients: { x: 2, y: 3 } },
    );
    expect(r.predicted).toBe(10);
    expect(r.contributions).toEqual({ x: 10, y: 0 });
  });

  it("refuses governed-by-id with no inline coefficients (S1 — no registry, never identity)", () => {
    expect(() =>
      GlmModelKind.execute(
        { features: { tiv: 100_000, year_built: 1990 } },
        { modelId: "loss-model-v2", intercept: 0, link: "log" },
      ),
    ).toThrow(GLM_REGISTRY_RETIRED_MESSAGE);
  });

  it("validate: inline coefficients → info (ungoverned, still valid)", () => {
    const r = GlmModelKind.validate!({ modelId: "", coefficients: { x: 1 } });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("info");
    expect(r.issues[0]?.message).toMatch(/inline GLM coefficients/i);
  });

  it("validate: no coefficients (with or without a modelId) → ERROR at authoring time (S1)", () => {
    for (const params of [{ modelId: "" }, { modelId: "loss-model-v2" }]) {
      const r = GlmModelKind.validate!(params);
      expect(r.valid).toBe(false);
      expect(r.issues[0]?.severity).toBe("error");
      expect(r.issues[0]?.message).toBe(GLM_REGISTRY_RETIRED_MESSAGE);
    }
  });
});
