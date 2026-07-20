/**
 * Engine conformance — JSON fixture runner.
 *
 * Loads the V0 conformance vectors from `./conformance/V*.json` and
 * exercises each against the engine + the registered V0 kinds. Three
 * assertion tiers per vector:
 *
 *   1. schema — every loaded vector has the required shape
 *   2. correctness — outputs deep-equal expectedOutputs
 *   3. reproducibility — two runs produce byte-identical outputs
 *      (engine-contract.md §6)
 *
 * Vectors are imported explicitly (rather than via `import.meta.glob`)
 * so the test runs with stock tsc + vitest — no Vite client types,
 * no Node fs imports, no `@types/node`. Adding a new vector is one
 * line: drop a `V*.json` file in `./conformance/`, add an `import` +
 * push it onto `VECTORS`.
 *
 * The JSON files are the integrator-facing artifact: any non-TS port
 * of the engine can consume the same fixtures with a stock JSON
 * parser and verify byte-identical outputs. See ./conformance/README.md.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { compilePlan, executePlan, runPlan } from "../runtime";
import { _clearRegistryForTests } from "../registry";
import { registerBuiltinKinds } from "../kinds";
import {
  makeClassLibrary,
  type ClassLibraryEntry,
} from "../class-library-types";
import type { Plan, RunOptions } from "../plan-types";

import V1 from "./conformance/V1.trivial-constant.json";
import V2 from "./conformance/V2.input-passthrough.json";
import V3 from "./conformance/V3.chain-mult.json";
import V4 from "./conformance/V4.lookup-direct-known.json";
import V5 from "./conformance/V5.lookup-range-middle-bucket.json";
import V6 from "./conformance/V6.subplan-composition.json";
import V7 from "./conformance/V7.bop-like-end-to-end.json";
import V8 from "./conformance/V8.class-exposure-primary.json";
import V9 from "./conformance/V9.class-exposure-coverage-scope.json";
import V10 from "./conformance/V10.chain-lob-sum.json";
import V11 from "./conformance/V11.eligibility-first-match.json";
import V12 from "./conformance/V12.eligibility-default-fallback.json";
import V13 from "./conformance/V13.modifier-schedule-cap.json";
import V14 from "./conformance/V14.modifier-schedule-tier-filter.json";
import V17 from "./conformance/V17.endorsement-auto-attach.json";
import V18 from "./conformance/V18.endorsement-rate-branch.json";
import V19 from "./conformance/V19.modifier-model-fallback.json";
import V20 from "./conformance/V20.full-gate-cascade.json";
import V21 from "./conformance/V21.geographic-dim.json";
import V22 from "./conformance/V22.derive-territory.json";
import V23 from "./conformance/V23.derive-territory-unmapped.json";
import V24 from "./conformance/V24.derive-class-attribute.json";
import V32 from "./conformance/V32.input-source-dictionary-metadata.json";
import V33 from "./conformance/V33.eligibility-floor-area-gate.json";
import V34 from "./conformance/V34.eligibility-gate-within-appetite.json";
import V35 from "./conformance/V35.coverage-split-2d-table.json";
import V37 from "./conformance/V37.tower-base-identity-authored-lcm.json";
import V38 from "./conformance/V38.min-premium-floor.json";
import V39 from "./conformance/V39.derive-territory-zip.json";
import V40 from "./conformance/V40.derive-territory-ungrouped-tail.json";
import V41 from "./conformance/V41.eligibility-submit-standard-default.json";
import V42 from "./conformance/V42.eligibility-preferred-credit.json";
import V43 from "./conformance/V43.eligibility-decline-knockout-still-computes.json";
import V47 from "./conformance/V47.round-half-up.json";
import V48 from "./conformance/V48.lookup-multi-wired.json";
import V49 from "./conformance/V49.exposure-rated-tower.json";
import V50 from "./conformance/V50.banded-limit-range-tower.json";
import V51 from "./conformance/V51.predicate-gated-factor.json";
import V52 from "./conformance/V52.dual-input-derived-multi.json";
import V53 from "./conformance/V53.derive-computed-tiv.json";
import V54 from "./conformance/V54.unknown-key-error-policy.json";
import V55 from "./conformance/V55.unknown-key-default-policy.json";
import V56 from "./conformance/V56.unknown-key-refer-policy.json";
import V57 from "./conformance/V57.unresolved-output-backstop.json";
import V58 from "./conformance/V58.eligibility-compound-and.json";
import V59 from "./conformance/V59.class-attribute-override.json";
import V60 from "./conformance/V60.boolean-input-coercion.json";
import V61 from "./conformance/V61.interpolate-linear.json";
import V62 from "./conformance/V62.eligibility-wire-string-inputs.json";
import V63 from "./conformance/V63.eligibility-portless-gate-variable.json";
import MANIFEST from "./conformance/manifest.json";

interface JsonVector {
  readonly name: string;
  readonly description: string;
  readonly plan: Plan;
  readonly externalInputs: Record<string, unknown>;
  readonly expectedOutputs: Record<string, unknown>;
  /**
   * Optional class library entries. When present,
   * the runner builds a ClassLibrary via makeClassLibrary() and passes
   * it through RunOptions.classLibrary.
   *
   * The integrator porting to a non-TS engine builds their library
   * the same way: from this array.
   */
  readonly classLibraryEntries?: readonly ClassLibraryEntry[];
  /**
   * Optional `as_of` pin. When omitted, "2024-01-01" is used so the
   * vector remains time-stable across reruns.
   */
  readonly asOf?: string;
  /**
   * Optional unresolved-key assertions. `expectedRowStatus` pins the
   * run's rateability verdict; `expectedIssues` pins a SUBSET match on
   * each listed issue ({nodeId, code, severity} — message copy may
   * evolve without breaking vectors); `expectedEligibilityTier` pins
   * the resolved tier (used by the `refer`-policy escalation vector).
   * A vector may also assert `expectedOutputs` omits a field the
   * runtime WITHHELD (unresolved numeric outputs never leave the
   * engine — the toEqual comparison enforces absence).
   */
  readonly expectedRowStatus?: "ok" | "error";
  readonly expectedIssues?: ReadonlyArray<{
    readonly nodeId?: string;
    readonly code: string;
    readonly severity?: "error" | "warning";
  }>;
  readonly expectedEligibilityTier?: string | null;
}

const VECTORS: readonly JsonVector[] = [
  V1 as JsonVector,
  V2 as JsonVector,
  V3 as JsonVector,
  V4 as JsonVector,
  V5 as JsonVector,
  V6 as JsonVector,
  V7 as JsonVector,
  V8 as JsonVector,
  V9 as JsonVector,
  V10 as JsonVector,
  V11 as JsonVector,
  V12 as JsonVector,
  V13 as JsonVector,
  V14 as JsonVector,
  V17 as JsonVector,
  V18 as JsonVector,
  V19 as JsonVector,
  V20 as JsonVector,
  V21 as JsonVector,
  V22 as JsonVector,
  V23 as JsonVector,
  V24 as JsonVector,
  V32 as JsonVector,
  V33 as JsonVector,
  V34 as JsonVector,
  V35 as JsonVector,
  V37 as JsonVector,
  V38 as JsonVector,
  V39 as JsonVector,
  V40 as JsonVector,
  V41 as JsonVector,
  V42 as JsonVector,
  V43 as JsonVector,
  V47 as JsonVector,
  V48 as JsonVector,
  V49 as JsonVector,
  V50 as JsonVector,
  V51 as JsonVector,
  V52 as JsonVector,
  V53 as JsonVector,
  V54 as JsonVector,
  V55 as JsonVector,
  V56 as JsonVector,
  V57 as JsonVector,
  V58 as JsonVector,
  V59 as JsonVector,
  V60 as JsonVector,
  V61 as JsonVector,
  V62 as JsonVector,
  V63 as JsonVector,
];

/** Build the RunOptions for a vector — including classLibrary when set. */
function optionsFor(v: JsonVector): RunOptions {
  const opts: RunOptions = { as_of: v.asOf ?? "2024-01-01" };
  if (v.classLibraryEntries) {
    return { ...opts, classLibrary: makeClassLibrary(v.classLibraryEntries) };
  }
  return opts;
}

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

describe("Engine conformance · JSON fixture discovery", () => {
  it("loads exactly 50 vectors spanning baseline math, synthetic Meridian lookup and appetite paths, unknown-key policies, coercion, and derived-input behavior", () => {
    expect(VECTORS).toHaveLength(50);
  });

  it("every loaded vector has the required schema fields", () => {
    for (const v of VECTORS) {
      expect(v.name, "missing name").toBeTruthy();
      expect(v.description, `${v.name}: missing description`).toBeTruthy();
      expect(v.plan, `${v.name}: missing plan`).toBeTruthy();
      expect(
        v.externalInputs,
        `${v.name}: missing externalInputs`,
      ).toBeDefined();
      expect(
        v.expectedOutputs,
        `${v.name}: missing expectedOutputs`,
      ).toBeDefined();
    }
  });

  it("vector names are unique", () => {
    const names = VECTORS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("G20 — the wired list matches the manifest EXACTLY (the parity suite loads from it)", () => {
    expect(VECTORS.map((v) => v.name)).toEqual(MANIFEST.engine_vectors);
  });
});

describe("Engine conformance · JSON · correctness", () => {
  for (const v of VECTORS) {
    it(`${v.name} · ${v.description}`, () => {
      const result = executePlan(
        v.plan,
        v.externalInputs,
        optionsFor(v),
      );
      expect(result.outputs).toEqual(v.expectedOutputs);
      // Check unresolved-key assertions only when the vector declares them.
      if (v.expectedRowStatus !== undefined) {
        expect(result.row_status, `${v.name}: row_status`).toBe(
          v.expectedRowStatus,
        );
      }
      if (v.expectedIssues !== undefined) {
        const actual = result.issues ?? [];
        for (const want of v.expectedIssues) {
          const found = actual.some(
            (i) =>
              i.code === want.code &&
              (want.nodeId === undefined || i.nodeId === want.nodeId) &&
              (want.severity === undefined || i.severity === want.severity),
          );
          expect(
            found,
            `${v.name}: expected issue ${JSON.stringify(want)} in ${JSON.stringify(actual.map((i) => ({ nodeId: i.nodeId, code: i.code, severity: i.severity })))}`,
          ).toBe(true);
        }
      }
      if (v.expectedEligibilityTier !== undefined) {
        expect(
          result.eligibility_tier ?? null,
          `${v.name}: eligibility_tier`,
        ).toBe(v.expectedEligibilityTier);
      }
    });
  }
});

describe("Engine conformance · JSON · reproducibility", () => {
  for (const v of VECTORS) {
    it(`${v.name} · two runs produce identical outputs`, () => {
      const compiled = compilePlan(v.plan);
      const opts = optionsFor(v);
      const r1 = runPlan(compiled, v.externalInputs, opts);
      const r2 = runPlan(compiled, v.externalInputs, opts);
      expect(r1.outputs).toEqual(r2.outputs);
      // Trace contents must also match (modulo wall-clock fields,
      // which the trace itself doesn't store).
      const k1 = Object.keys(r1.trace).sort();
      const k2 = Object.keys(r2.trace).sort();
      expect(k1).toEqual(k2);
      for (const nodeId of k1) {
        expect(r1.trace[nodeId]).toEqual(r2.trace[nodeId]);
      }
    });
  }
});
