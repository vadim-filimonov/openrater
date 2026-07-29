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
 * Ported from `<prototype>/plan-builder/src/canvas/__tests__/
 * engine-conformance-json.test.ts` (Phase A.1 final). Same vectors,
 * same assertions, no Vite-glob dep.
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
// V15 (chain-from-report-acceptance) — removed with the Detachment
// Brief 1 §3.2 cut (values derived from a non-synthetic acceptance
// report). TODO(S3): re-add as a Meridian-derived acceptance golden.
// V16 — input_mapping runtime-ignored (Brief 38). Not wired into
// VECTORS because the runtime doesn't read input_mapping (UI-only).
// V17 — endorsement.* auto-attach (Brief 39 PR 39.1).
import V17 from "./conformance/V17.endorsement-auto-attach.json";
// V18 — endorsement.rate_branch (Brief 40 §−1 + Brief 42 §−1 Q5). Lit
// up by Phase H.4 once EndorsementRateBranchKind is registered.
import V18 from "./conformance/V18.endorsement-rate-branch.json";
// V19 — modifier.model fallback (Brief 41 + Brief 42 §−1 Q6 case 2).
// Lit up by Phase H.7 once ModifierModelKind is registered.
import V19 from "./conformance/V19.modifier-model-fallback.json";
// V20 — full gate cascade (Brief 42 §−1 Q1 fixed order). All runtime
// kinds exist after Phase H.3.1-H.3.3 + H.4; this fixture exercises
// their composition end-to-end.
import V20 from "./conformance/V20.full-gate-cascade.json";
// V21 — Brief 44 PR 44.1 geographic dim substrate. The runtime treats
// `dimension_type='geographic'` like a categorical lookup; this fixture
// proves the engine still produces deterministic output when the
// upstream substrate (geo_granularity / geo_scope / geo_territories)
// is set. New geo_* metadata is authoring-only — no runtime change.
import V21 from "./conformance/V21.geographic-dim.json";
// V22 — ADR-0028 derive.territory (cold-test L13). A state code resolves
// THROUGH the dim's geo_territories grouping onto a territory id, then a
// territory-keyed lookup.direct returns the tier factor. Closes the gap
// where a territory-keyed table silently priced raw state codes at 1.0.
import V22 from "./conformance/V22.derive-territory.json";
// V23 — derive.territory unmapped case. A state in no territory surfaces
// unmapped=true (diagnostic) + falls to the lookup default 1.0.
import V23 from "./conformance/V23.derive-territory-unmapped.json";
// V24 — derive.class_attribute (ADR-0035 / Brief 51). class_code → a
// derived structural attribute (rate number) → a rate-number-keyed
// lookup.direct. The class→string-attribute path (V8/V9 are class→number).
import V24 from "./conformance/V24.derive-class-attribute.json";
// V32 — Brief 52 input-dictionary metadata is runtime-inert (input.source
// with required/allowedValues/unit/category + sourceType=derived still
// substitutes externalInputs[fieldName] unchanged; derived is not
// auto-computed in this contract version).
import V32 from "./conformance/V32.input-source-dictionary-metadata.json";
// V33/V34 — Brief 52 acceptance: an eligibility gate keyed on a DECLARED
// input (total_floor_area_sqft) fires on the Sample BOP-20 risk (42,000
// sq ft > 35,000 → submit) and stays silent for a within-appetite risk.
import V33 from "./conformance/V33.eligibility-floor-area-gate.json";
import V34 from "./conformance/V34.eligibility-gate-within-appetite.json";
// V35 — ADR-0039 coverage-split 2-D factor table. base_lc_property
// (territory × coverage) rates the right column per coverage tower:
// fed the same territory (701), the Building column returns 0.389 and
// the BPP column 0.199. Proves a 2-D coverage table selects the column
// rather than collapsing to the neutral 1.0. Brief 53 acceptance,
// portable form.
import V35 from "./conformance/V35.coverage-split-2d-table.json";
// V37 — Brief 54: a multiplicative tower with an identity base (1.0) +
// an authored carrier LCM *constant* (1.401) resolves to the product.
import V37 from "./conformance/V37.tower-base-identity-authored-lcm.json";
// V38 — Brief 54: a chain premium below the carrier minimum is floored.
import V38 from "./conformance/V38.min-premium-floor.json";
// V39 — ADR-0038 ZIP-granularity territory rollup (the Sample BOP shape). A
// ZIP resolves through derive.territory onto its territory id, then the
// territory-keyed lookup returns the factor. (Numbered V39 — V35/V37 were
// claimed by concurrent ADR-0039/Brief-54 branches while this was in flight.)
import V39 from "./conformance/V39.derive-territory-zip.json";
// V40 — ADR-0038 mixed model: an UNGROUPED level self-maps and rates on
// itself (not the 1.0 default), proving the key space is rateable end-to-end.
import V40 from "./conformance/V40.derive-territory-ungrouped-tail.json";
// V41/V42/V43 — Brief 55: the canonical Sample BOP appetite gate (ordered
// rules decline > floor-area submit > sales submit > preferred credit,
// default_tier STANDARD). V41 fires submit on KS-20 (42k sqft, first-match
// ordering beats the bceg_1 credit — the §3.3 masking fix); V42 fires
// preferred for a within-appetite bceg_1 risk (preferred reachable, not
// masked by the standard default); V43 fires decline AND still computes a
// parallel premium (Brief 42 Q4 decline-doesn't-halt). Renumbered 39-41 ->
// 41-43 — the concurrent ADR-0038 territory branch claimed V39/V40.
import V41 from "./conformance/V41.eligibility-ks-submit-standard-default.json";
import V42 from "./conformance/V42.eligibility-ks-preferred-credit.json";
import V43 from "./conformance/V43.eligibility-decline-knockout-still-computes.json";
// V47 — ADR-0044 PR1. The `round` kind: ISO Rule 23 rate->3dp + premium->$
// roundings as runtime nodes. (V44-V46 claimed by the schedule-column branch.)
import V47 from "./conformance/V47.round-half-up.json";
// V48 — ADR-0044 PR2. lookup.multi wired through derived per-key ports
// (two upstream inputs -> two named key ports -> composite-key factor).
import V48 from "./conformance/V48.lookup-multi-wired.json";
// V49 — ADR-0044 PR3. Exposure-rated tower: chain.mult(relativities) ->
// round(3) -> ÷exposure -> ×LCM -> round(0), as the projector emits it.
import V49 from "./conformance/V49.exposure-rated-tower.json";
// V50/V51 — ADR-0044 PR4. Banded limit relativity via lookup.range (BPP
// exposure tower) + predicate-gated factor (branch sprinkler ? rel : 1.0).
import V50 from "./conformance/V50.banded-limit-range-tower.json";
import V51 from "./conformance/V51.predicate-gated-factor.json";
// V52 — ADR-0044 PR5. Dual-input lookup.multi with a DERIVED second axis
// (chain.add(building+BPP) -> derive.band -> lookup.multi[ded, band]).
import V52 from "./conformance/V52.dual-input-derived-multi.json";
// V53 — derive.computed (E03 computed appetite field; brief D3). Renumbered
// from V48 (taken above by ADR-0044 lookup.multi); V47 is the lessors branch.
import V53 from "./conformance/V53.derive-computed-tiv.json";
// V54-V57 — ADR-0056 (Law 2, refuse-or-resolve): the three authored
// unknown-key policies (error / default(x) / refer) + the unresolved-
// numeric-output backstop. These pin that a miss is a STRUCTURED
// outcome — never a silent factor-1.0 — and that an error row's
// premium is withheld, not NaN.
import V54 from "./conformance/V54.unknown-key-error-policy.json";
import V55 from "./conformance/V55.unknown-key-default-policy.json";
import V56 from "./conformance/V56.unknown-key-refer-policy.json";
import V57 from "./conformance/V57.unresolved-output-backstop.json";
// V58 — Brief 81 (finding E8): compound AND conditions in one rule.
import V58 from "./conformance/V58.eligibility-compound-and.json";
// V59 — Brief 83 (TV-19): declared override supersedes the class-derived attribute.
import V59 from "./conformance/V59.class-attribute-override.json";
// V60 — Brief 83.4: a boolean input port coerces the wire's string spellings.
import V60 from "./conformance/V60.boolean-input-coercion.json";
import V61 from "./conformance/V61.interpolate-linear.json";
// V62 — Phase F (2026-07-17): the whole external record is coerced onto the
// declared ports at the run seam, so the appetite gate (a ctx.externalInputs
// reader) sees the SAME typed value the rating path rates.
import V62 from "./conformance/V62.eligibility-wire-string-inputs.json";
// V63 — Phase F residual (2026-07-17): a gate-ONLY variable has no input
// port to key the V62 coercion from; the rule's own boolean RHS types it
// at the same seam (ports, where one exists, always win).
import V63 from "./conformance/V63.eligibility-portless-gate-variable.json";
// V64 — FCA fca-2026-07-25 (S0): the knock-out-true vector. A workbook
// gate persists its boolean rule value as TEXT 'true'; a schema-typed
// caller sends JSON true. The comparator bridges the boolean/boolean-
// literal-string seam (the E3 widening, for booleans), so the filed
// hard-decline fires instead of silently rating Standard.
import V64 from "./conformance/V64.eligibility-workbook-string-knockout.json";
// P2 G20 — THE single source of wired vectors: the service parity suite
// LOADS from this manifest; this suite asserts its import list matches
// it exactly, so the two can never drift again (they sat 40 vs 41 for
// a month).
import MANIFEST from "./conformance/manifest.json";

interface JsonVector {
  readonly name: string;
  readonly description: string;
  readonly plan: Plan;
  readonly externalInputs: Record<string, unknown>;
  readonly expectedOutputs: Record<string, unknown>;
  /**
   * Optional class library entries (Brief 16 vectors). When present,
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
   * ADR-0056 — optional Law-2 assertions. `expectedRowStatus` pins the
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
  V64 as JsonVector,
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
  it("loads exactly 51 vectors (V1-V7 baseline + V8-V14 M1 additions (V15 cut with Detachment Brief 1) + V17 Brief 39 + V18 Phase H.4 + V19 Phase H.7 + V20 full-gate-cascade + V21 Brief 44 geographic dim + V22/V23 ADR-0028 derive.territory + V24 ADR-0035 derive.class_attribute + V32/V33/V34 Brief 52 input-dictionary metadata + eligibility gates + V35 ADR-0039 coverage-split 2-D table + V37/V38 Brief 54 tower-base-identity + min-premium-floor + V39/V40 ADR-0038 ZIP rollup + ungrouped tail + V41/V42/V43 Brief 55 canonical KS appetite gate submit/preferred/decline + V47 ADR-0044 round kind + V48 ADR-0044 lookup.multi wired per-key ports + V49 ADR-0044 exposure-rated tower + V50/V51 ADR-0044 banded-limit-range + predicate-gated factor + V52 ADR-0044 dual-input derived multi + V53 E03 derive.computed appetite field + V54/V55/V56/V57 ADR-0056 unknown-key policies error/default/refer + unresolved-output backstop + V58 Brief 81 compound-AND conditions + V59 Brief 83 class-attribute declared override + V60 Brief 83.4 boolean-input coercion + V62 Phase F wire-string record coercion at the run seam + V63 Phase F residual port-less gate variable typed from its rule's boolean RHS + V64 FCA workbook-string boolean knock-out)", () => {
    expect(VECTORS).toHaveLength(51);
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
      // ADR-0056 — Law-2 assertions (only when the vector declares them).
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
