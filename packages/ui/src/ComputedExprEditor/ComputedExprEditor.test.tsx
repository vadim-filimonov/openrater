/**
 * <ComputedExprEditor> tests (E03 / brief D3).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ComputedExprEditor,
  flattenComputedExpr,
  buildComputedExpr,
} from "./ComputedExprEditor";
import type { ComputedExpr } from "@openrater/contracts";

const TIV: ComputedExpr = {
  kind: "op",
  op: "+",
  left: { kind: "input", name: "building_limit" },
  right: { kind: "input", name: "bpp_limit" },
};

describe("flatten / build round-trip", () => {
  it("flattens a left-associative chain into ordered terms", () => {
    const terms = flattenComputedExpr(TIV);
    expect(terms).toEqual([
      { operand: { kind: "input", name: "building_limit" } },
      { op: "+", operand: { kind: "input", name: "bpp_limit" } },
    ]);
  });

  it("build is the inverse of flatten", () => {
    expect(buildComputedExpr(flattenComputedExpr(TIV)!)).toEqual(TIV);
  });

  it("returns null for a nested (non-flat) expression", () => {
    const nested: ComputedExpr = {
      kind: "op",
      op: "*",
      left: { kind: "input", name: "a" },
      right: { kind: "op", op: "+", left: { kind: "input", name: "b" }, right: { kind: "const", value: 1 } },
    };
    expect(flattenComputedExpr(nested)).toBeNull();
  });
});

describe("<ComputedExprEditor>", () => {
  const FIELDS = ["building_limit", "bpp_limit", "lcm"];

  it("renders one row per term + the formula preview", () => {
    render(
      <ComputedExprEditor value={TIV} availableFields={FIELDS} onChange={() => {}} />,
    );
    expect(screen.getByTestId("rater-computed-expr-editor-term-0")).toBeInTheDocument();
    expect(screen.getByTestId("rater-computed-expr-editor-term-1")).toBeInTheDocument();
    expect(screen.getByTestId("rater-computed-expr-editor-formula").textContent).toBe(
      "building_limit + bpp_limit",
    );
  });

  it("shows the live numeric value against the sample risk", () => {
    render(
      <ComputedExprEditor
        value={TIV}
        availableFields={FIELDS}
        sampleInputs={{ building_limit: 850000, bpp_limit: 210000 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-computed-expr-editor-value").textContent).toMatch(
      /1,060,000/,
    );
  });

  it("fires onChange building a new AST when an operator changes", () => {
    const onChange = vi.fn();
    render(
      <ComputedExprEditor value={TIV} availableFields={FIELDS} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("rater-computed-expr-editor-op-1"), {
      target: { value: "*" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "op",
      op: "*",
      left: { kind: "input", name: "building_limit" },
      right: { kind: "input", name: "bpp_limit" },
    });
  });

  it("adds a term", () => {
    const onChange = vi.fn();
    render(
      <ComputedExprEditor value={TIV} availableFields={FIELDS} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("rater-computed-expr-editor-add"));
    const next = onChange.mock.calls[0]![0] as ComputedExpr;
    // 3 operands now → 2 nested ops.
    expect(flattenComputedExpr(next)).toHaveLength(3);
  });

  it("switches an operand to a constant", () => {
    const onChange = vi.fn();
    render(
      <ComputedExprEditor value={TIV} availableFields={FIELDS} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("rater-computed-expr-editor-kind-1"), {
      target: { value: "const" },
    });
    const next = onChange.mock.calls[0]![0] as ComputedExpr;
    expect(next).toEqual({
      kind: "op",
      op: "+",
      left: { kind: "input", name: "building_limit" },
      right: { kind: "const", value: 0 },
    });
  });
});
