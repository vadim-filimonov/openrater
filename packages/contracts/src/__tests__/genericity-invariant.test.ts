/**
 * Genericity invariant — static guard (ADR-0033 §0 / ADR-0034 §0).
 *
 * THE "NO PATCH JOB" GUARD. Shared rating machinery MUST NOT reference a
 * product/coverage LITERAL. Cross-product behavior belongs INSIDE each
 * product's authored Plan, never in shared composition or execution
 * machinery — `product` and `coverage_id` are opaque tags that flow
 * through generic code. If someone later writes `if (product === "do")`
 * in the composer or a runtime kind, this test goes red.
 *
 * Scope (gate 6):
 *   1. The composer + policy shapes (`policy-compose.ts`, `policy-types.ts`).
 *   2. The runtime kind implementations (`kinds/*.ts`) — the engine's
 *      execute() functions. Gate 5 deleted `inferLobFromName` (the
 *      name-heuristic the projector used to branch on a product), so the
 *      runtime now earns the same guard the composer always had.
 *
 * The substrate→runtime projector (`stagesToRuntimePlan` in `@openrater/ui`)
 * earns the SAME guard, but the scan lives in labs-ui
 * (`genericity-projector.test.ts`) since a contracts test cannot import a
 * labs-ui module without inverting the package dependency. Its last legacy
 * literal — `line: "bop"` — was dropped when `Plan.lines` was retired (gate
 * 6 finish), so it now scans clean. The behavioral proof of end-to-end
 * genericity meanwhile is the bop second-product book test (labs-ui) + the
 * bop/auto/wc composePolicy unit tests.
 *
 * Mechanism: load each module's own source via Vite `?raw`
 * (`import.meta.glob` for the kinds fan-out), strip comments, then assert
 * no `PRODUCT_CODES` value appears as a quoted literal in the remaining
 * executable code.
 */

import { describe, it, expect } from "vitest";
import { PRODUCT_CODES } from "../product-types";
import composerSrc from "../policy-compose?raw";
import policyTypesSrc from "../policy-types?raw";
import policyAdjustmentsSrc from "../policy-adjustments?raw";
import irpmSourceSrc from "../irpm-source?raw";

/** Remove block + line comments so we only scan executable code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
    .replace(/\/\/.*$/gm, ""); // line comments
}

// e.g. /["'](bop|cgl|do|eo|wc|auto|umbrella|excess|marine|inland_marine|other)["']/
const PRODUCT_LITERAL = new RegExp(
  `["'](${PRODUCT_CODES.join("|")})["']`,
  "g",
);

/** Assert one module's executable code carries no product literal. */
function expectNoProductLiteral(name: string, src: string): void {
  const hits = stripComments(src).match(PRODUCT_LITERAL) ?? [];
  expect(
    hits,
    `${name} hard-codes product literal(s): ${hits.join(", ")} — ` +
      `cross-product logic belongs in a Plan, not shared machinery (ADR-0033 §0).`,
  ).toEqual([]);
}

describe("Genericity invariant — composer references no product literal", () => {
  for (const [name, src] of [
    ["policy-compose.ts", composerSrc],
    ["policy-types.ts", policyTypesSrc],
    ["policy-adjustments.ts", policyAdjustmentsSrc],
    ["irpm-source.ts", irpmSourceSrc],
  ] as const) {
    it(`${name} contains no product/coverage literal in executable code`, () => {
      expectNoProductLiteral(name, src);
    });
  }

  it("the guard is wired correctly (it WOULD catch a planted literal)", () => {
    // Self-test: a sample line that branches on a product must trip the
    // regex — proving the guard isn't silently matching nothing.
    const planted = `if (line.plan_ref.product === "do") return 0;`;
    expect(planted.match(PRODUCT_LITERAL)).not.toBeNull();
  });
});

// ── Source-blind invariant (ADR-0042 D2) ─────────────────────────────
//
// The composer resolves an IRPM/adjustment value either by reading a
// `literal` inline OR by asking the injected `resolveAdjustment`. It must
// NEVER branch on a NON-literal `source.from` ("column"/"model"/
// "connector") — that business logic belongs in the caller's resolver, so
// a model-sourced and a connector-sourced IRPM flow through the identical
// code path. Branching on `=== "literal"` is the one allowed split (the
// built-in vs. ask-the-resolver decision); the typed validation switch in
// policy-adjustments.ts (`isIrpmSourceSpec`) is NOT a composer branch and
// is out of scope here.

// e.g. /\.from\s*===?\s*["'](column|model|connector)["']/
const SOURCE_BRANCH = /\.from\s*===?\s*["'](column|model|connector)["']/g;

describe("Genericity invariant — the composer is source-blind", () => {
  it("policy-compose.ts never branches on a non-literal source.from", () => {
    const hits = stripComments(composerSrc).match(SOURCE_BRANCH) ?? [];
    expect(
      hits,
      `policy-compose.ts branches on a non-literal source: ${hits.join(", ")} — ` +
        `non-literal resolution belongs in the injected resolveAdjustment, ` +
        `not the composer (ADR-0042 D2).`,
    ).toEqual([]);
  });

  it("the guard is wired correctly (it WOULD catch a planted source branch)", () => {
    const planted = `if (adj.source.from === "model") return resolveModel(adj);`;
    expect(planted.match(SOURCE_BRANCH)).not.toBeNull();
    // …and the allowed literal split must NOT trip it.
    expect(`if (source.from === "literal") {`.match(SOURCE_BRANCH)).toBeNull();
  });
});

// ── Gate 6 — the engine runtime is product-blind too ─────────────────
//
// Every kind's execute() processes opaque numbers/tags; none may branch
// on a product. We fan out over `kinds/*.ts` (excluding tests) via
// `import.meta.glob` so a NEW kind is auto-covered the moment it lands —
// no enumeration to keep in sync.
const KIND_SOURCES = import.meta.glob("../kinds/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("Genericity invariant — runtime kinds reference no product literal", () => {
  const entries = Object.entries(KIND_SOURCES).filter(
    ([path]) => !path.includes(".test."),
  );

  it("scans a non-empty set of kind modules (glob resolved)", () => {
    // Guards against a silently-empty glob (a refactor moving the dir
    // would make every assertion below vacuously pass).
    expect(entries.length).toBeGreaterThan(20);
  });

  for (const [path, src] of entries) {
    const name = path.split("/").pop() ?? path;
    it(`${name} contains no product/coverage literal in executable code`, () => {
      expectNoProductLiteral(name, src);
    });
  }
});

// ── Model-format-blind invariant (ADR-0043 D1) ───────────────────────
//
// Model formats live ONLY in `model-artifact.ts`'s `FORMAT_ADAPTERS`
// array. No composer, resolver, or runtime kind may branch on a format
// literal — a GLM-coeff and an ONNX model resolve through the IDENTICAL
// `LoadedModel` seam (ADR-0033 §0 applied to models). `model-artifact.ts`
// itself is the adapter home and is exempt by design.
const MODEL_FORMATS = [
  "glm_coeff",
  "onnx",
  "pmml",
  "xgboost",
  "lightgbm",
  "scorecard",
] as const;
const MODEL_FORMAT_LITERAL = new RegExp(`["'](${MODEL_FORMATS.join("|")})["']`, "g");

function expectNoModelFormatLiteral(name: string, src: string): void {
  const hits = stripComments(src).match(MODEL_FORMAT_LITERAL) ?? [];
  expect(
    hits,
    `${name} references a model-format literal: ${hits.join(", ")} — ` +
      `formats live only in model-artifact.ts's adapters; consumers read the ` +
      `format-blind LoadedModel seam (ADR-0043 D1).`,
  ).toEqual([]);
}

describe("Genericity invariant — consumers are model-format-blind (ADR-0043 D1)", () => {
  for (const [name, src] of [
    ["policy-compose.ts", composerSrc],
    ["irpm-source.ts", irpmSourceSrc],
  ] as const) {
    it(`${name} references no model-format literal`, () => {
      expectNoModelFormatLiteral(name, src);
    });
  }

  for (const [path, src] of Object.entries(KIND_SOURCES).filter(
    ([p]) => !p.includes(".test."),
  )) {
    const name = path.split("/").pop() ?? path;
    it(`${name} references no model-format literal`, () => {
      expectNoModelFormatLiteral(name, src);
    });
  }

  it("the guard is wired correctly (it WOULD catch a planted format branch)", () => {
    const planted = `if (model.card.format === "onnx") return runOnnx(model);`;
    expect(planted.match(MODEL_FORMAT_LITERAL)).not.toBeNull();
  });
});
