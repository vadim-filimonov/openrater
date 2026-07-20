/**
 * Genericity invariant — projector guard (ADR-0033 §0, gate 6 finish).
 *
 * Sibling to the contracts-side genericity guard (which scans the
 * composer + the runtime kinds). The substrate→runtime projector
 * (`stagesToRuntimePlan`) is the third layer the §0 invariant binds:
 * it turns authored stages into a generic Plan DAG and must NEVER bake
 * in a product/coverage literal. The name-heuristic that used to live
 * here (`inferLobFromName`, the multi-LOB lob-sum pass) was deleted in
 * gate 5, and the legacy `line: "bop"` metadata default was dropped in
 * gate 6 — so the projector now scans clean, and this guard keeps it
 * that way.
 *
 * Mechanism: load the projector's own source via Vite `?raw`, strip
 * comments, assert no `PRODUCT_CODES` value appears as a quoted literal
 * in the remaining executable code. (Lives in @openrater/ui, not contracts,
 * because the projector lives here — a contracts test cannot import a
 * UI module without inverting the package dependency.)
 */

import { describe, it, expect } from "vitest";
import { PRODUCT_CODES } from "@openrater/contracts";
import projectorSrc from "./stagesToRuntimePlan?raw";

/** Remove block + line comments so we only scan executable code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
    .replace(/\/\/.*$/gm, ""); // line comments
}

// e.g. /["'](bop|cgl|do|eo|wc|auto|umbrella|excess|marine|inland_marine|other)["']/
const PRODUCT_LITERAL = new RegExp(`["'](${PRODUCT_CODES.join("|")})["']`, "g");

describe("Genericity invariant — projector references no product literal", () => {
  it("stagesToRuntimePlan.ts contains no product/coverage literal in executable code", () => {
    const hits = stripComments(projectorSrc).match(PRODUCT_LITERAL) ?? [];
    expect(
      hits,
      `stagesToRuntimePlan.ts hard-codes product literal(s): ${hits.join(", ")} — ` +
        `the projector must stay product-blind; a product axis belongs on the ` +
        `persisted plan, not baked into projection (ADR-0033 §0).`,
    ).toEqual([]);
  });

  it("the guard is wired correctly (it WOULD catch a planted literal)", () => {
    const planted = `const line = options?.line ?? "bop";`;
    expect(planted.match(PRODUCT_LITERAL)).not.toBeNull();
  });
});
