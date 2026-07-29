/**
 * Type-system tests — `isCompatible` / `primitiveOf` / `isPrimitiveType`.
 *
 * Ported verbatim from `<prototype>/plan-builder/src/blocks/
 * __tests__/types.test.ts` (Phase A.1 of the original port plan). The type-
 * compatibility rules ARE the engine's wire-checking contract; if
 * these tests pass against the ported helpers, plans authored against
 * either runtime produce identical wire-validation results.
 */

import { describe, it, expect } from "vitest";
import { isCompatible, primitiveOf, isPrimitiveType } from "./block-types";

describe("Type compatibility · §5", () => {
  it("identity matches", () => {
    expect(isCompatible("money", "money")).toBe(true);
    expect(isCompatible("factor", "factor")).toBe(true);
  });

  it("different primitives do not match", () => {
    expect(isCompatible("money", "factor")).toBe(false);
    expect(isCompatible("bool", "int")).toBe(false);
  });

  it("T → optional(T) is compatible", () => {
    expect(isCompatible("factor", { kind: "optional", of: "factor" })).toBe(true);
    expect(isCompatible("money", { kind: "optional", of: "money" })).toBe(true);
  });

  it("pct ↔ factor is allowed (recorded as coercion)", () => {
    expect(isCompatible("pct", "factor")).toBe(true);
    expect(isCompatible("factor", "pct")).toBe(true);
  });

  it("money does not coerce to factor", () => {
    expect(isCompatible("money", "factor")).toBe(false);
    expect(isCompatible("factor", "money")).toBe(false);
  });
});

describe("primitiveOf", () => {
  it("returns the primitive itself", () => {
    expect(primitiveOf("money")).toBe("money");
  });

  it("unwraps optional", () => {
    expect(primitiveOf({ kind: "optional", of: "factor" })).toBe("factor");
  });

  it("unwraps list", () => {
    expect(primitiveOf({ kind: "list", of: "int" })).toBe("int");
  });

  it("returns null for record", () => {
    expect(primitiveOf({ kind: "record", fields: {} })).toBeNull();
  });
});

describe("isPrimitiveType", () => {
  it("true for strings", () => {
    expect(isPrimitiveType("money")).toBe(true);
  });

  it("false for composite refs", () => {
    expect(isPrimitiveType({ kind: "optional", of: "money" })).toBe(false);
  });
});
