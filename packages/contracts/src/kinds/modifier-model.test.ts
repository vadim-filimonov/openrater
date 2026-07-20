/**
 * `modifier.model` tests (Phase H.7 — Brief 41 + Brief 42 §−1 Q6).
 *
 * The kind has two paths:
 *
 *   1. FALLBACK — any declared_input missing → fallback_factor
 *      applied verbatim, clamp NOT evaluated. V19 conformance vector
 *      locks this case at the engine level; these unit tests exercise
 *      it at the kind level for fast iteration + edge coverage.
 *
 *   2. NORMAL — all declared_inputs present → v1 stub factor (1.0)
 *      passes through the clamp envelope. Verifies clamp enforcement.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ModifierModelKind } from "./modifier-model";
import { ConstantKind } from "./constant";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, registerBlockKind } from "../registry";
import type { Plan } from "../plan-types";

beforeEach(() => {
  _clearRegistryForTests();
  registerBlockKind(ModifierModelKind);
  registerBlockKind(ConstantKind);
  registerBlockKind(OutputKind);
});

describe("ModifierModelKind — fallback path", () => {
  it("fires fallback when any declared_input is missing (V19 case)", () => {
    const plan: Plan = {
      id: "model-fallback",
      version: "1.0.0",
      name: "model fallback",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "mod",
          kind: "modifier.model",
          params: {
            model_id: "test_pricing_v1",
            version: "2026.05",
            declared_inputs: [{ variable: "credit_score", source: "input" }],
            clamp: { min_factor: 0.85, max_factor: 1.25 },
            rationale: "Test cap.",
            fallback_factor: 0.95,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out_premium",
          kind: "output",
          params: { fieldName: "premium", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
        {
          id: "out_factor",
          kind: "output",
          params: { fieldName: "factor_used", fieldType: "number" },
          position: { x: 400, y: 100 },
        },
        {
          id: "out_fired",
          kind: "output",
          params: { fieldName: "fallback_fired", fieldType: "boolean" },
          position: { x: 400, y: 200 },
        },
        {
          id: "out_reason",
          kind: "output",
          params: { fieldName: "fallback_reason", fieldType: "string" },
          position: { x: 400, y: 300 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "mod", port: "premium" } },
        { from: { node: "mod", port: "premium_out" }, to: { node: "out_premium", port: "value" } },
        { from: { node: "mod", port: "factor_used" }, to: { node: "out_factor", port: "value" } },
        { from: { node: "mod", port: "fallback_fired" }, to: { node: "out_fired", port: "value" } },
        { from: { node: "mod", port: "fallback_reason" }, to: { node: "out_reason", port: "value" } },
      ],
    };
    const result = executePlan(plan, {}); // credit_score missing
    expect(result.outputs.premium).toBeCloseTo(950, 4); // 1000 × 0.95
    expect(result.outputs.factor_used).toBeCloseTo(0.95, 4);
    expect(result.outputs.fallback_fired).toBe(true);
    expect(result.outputs.fallback_reason).toBe("missing_input:credit_score");
  });

  it("reports the FIRST missing input when multiple are missing", () => {
    const plan: Plan = {
      id: "model-fallback-multi",
      version: "1.0.0",
      name: "model fallback multi",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "mod",
          kind: "modifier.model",
          params: {
            model_id: "test",
            version: "1",
            declared_inputs: [
              { variable: "credit_score", source: "input" },
              { variable: "building_age", source: "input" },
            ],
            clamp: { min_factor: 0.85, max_factor: 1.25 },
            rationale: "Cap.",
            fallback_factor: 0.95,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "reason", fieldType: "string" },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "mod", port: "premium" } },
        { from: { node: "mod", port: "fallback_reason" }, to: { node: "out", port: "value" } },
      ],
    };
    // Both missing — fallback_reason should report the FIRST declared one
    const result = executePlan(plan, {});
    expect(result.outputs.reason).toBe("missing_input:credit_score");
  });

  it("does NOT evaluate the clamp when fallback fires (Brief 42 §−1 Q6 case 2)", () => {
    // fallback_factor = 0.50 sits OUTSIDE the clamp [0.85, 1.25] but the
    // clamp is NOT evaluated when fallback fires — the filed factor
    // passes through verbatim.
    const plan: Plan = {
      id: "model-fallback-out-of-clamp",
      version: "1.0.0",
      name: "fallback bypasses clamp",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "mod",
          kind: "modifier.model",
          params: {
            model_id: "test",
            version: "1",
            declared_inputs: [{ variable: "credit_score", source: "input" }],
            clamp: { min_factor: 0.85, max_factor: 1.25 },
            rationale: "Cap.",
            fallback_factor: 0.50,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "factor", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "mod", port: "premium" } },
        { from: { node: "mod", port: "factor_used" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    // 0.50 passes through unclamped; if the clamp WERE applied this would be 0.85
    expect(result.outputs.factor).toBeCloseTo(0.5, 4);
  });
});

describe("ModifierModelKind — normal path (stub)", () => {
  it("applies stub factor 1.0 when all declared_inputs present + clamp wraps 1.0", () => {
    // V1 stub: when all inputs present, model returns 1.0; clamp
    // [0.85, 1.25] doesn't change it; premium unchanged.
    const plan: Plan = {
      id: "model-normal",
      version: "1.0.0",
      name: "model normal",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "mod",
          kind: "modifier.model",
          params: {
            model_id: "test",
            version: "1",
            declared_inputs: [{ variable: "credit_score", source: "input" }],
            clamp: { min_factor: 0.85, max_factor: 1.25 },
            rationale: "Cap.",
            fallback_factor: 0.95,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out_factor",
          kind: "output",
          params: { fieldName: "factor", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
        {
          id: "out_fired",
          kind: "output",
          params: { fieldName: "fallback_fired", fieldType: "boolean" },
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "mod", port: "premium" } },
        { from: { node: "mod", port: "factor_used" }, to: { node: "out_factor", port: "value" } },
        { from: { node: "mod", port: "fallback_fired" }, to: { node: "out_fired", port: "value" } },
      ],
    };
    const result = executePlan(plan, { credit_score: 720 });
    expect(result.outputs.factor).toBeCloseTo(1.0, 4);
    expect(result.outputs.fallback_fired).toBe(false);
  });

  it("clamps stub factor when clamp envelope sits below 1.0", () => {
    // Clamp [0.5, 0.8] forces the stub 1.0 down to 0.8.
    const plan: Plan = {
      id: "model-normal-clamped",
      version: "1.0.0",
      name: "model normal clamped",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "mod",
          kind: "modifier.model",
          params: {
            model_id: "test",
            version: "1",
            declared_inputs: [{ variable: "x", source: "input" }],
            clamp: { min_factor: 0.5, max_factor: 0.8 },
            rationale: "Aggressive cap.",
            fallback_factor: 0.7,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "factor", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "mod", port: "premium" } },
        { from: { node: "mod", port: "factor_used" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { x: 1 });
    // Stub 1.0 clamped to max 0.8
    expect(result.outputs.factor).toBeCloseTo(0.8, 4);
  });
});
