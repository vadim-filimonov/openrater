/**
 * Tests for factorDraftToMutation — the FactorDraft → backend mutation
 * adapter that encodes ADR-0016's policy decision.
 *
 * Coverage:
 *   · Each of the 5 wired UI kinds produces the right mutation shape
 *   · 2 deferred kinds (lookup.range, formula) throw
 *   · Unset-kind draft throws
 *   · Defaults are applied correctly when context omits factorName /
 *     factorKindSlug / siblingStageId
 *   · The slugify + humanizeSlug helpers behave per their doc-comments
 *   · The emitted FactorLookup + AddStageRequest payloads pass their
 *     own Zod schemas (round-trip verification)
 */

import { describe, it, expect } from "vitest";
import {
  __internals,
  factorDraftToMutation,
  type FactorDraftAdapterContext,
  type FactorDraftMutation,
} from "./factorDraftAdapter";
import {
  factorLookupSchema,
  flatFactorConfigSchema,
} from "@openrater/contracts";

const BASE_CTX: FactorDraftAdapterContext = {
  chainStageId: "stage_chain_bldg",
  chainName: "BOP building chain",
  chainOutputPath: "stages.stage_chain_bldg.value",
};

// ---------------------------------------------------------------------------
// Defensive guards
// ---------------------------------------------------------------------------

describe("factorDraftToMutation — defensive guards", () => {
  it("throws when draft.kind is unset", () => {
    expect(() =>
      factorDraftToMutation({ kind: "" }, BASE_CTX),
    ).toThrow(/draft\.kind is unset/);
  });

  it("throws for the deferred lookup.range kind", () => {
    expect(() =>
      factorDraftToMutation({ kind: "lookup.range" }, BASE_CTX),
    ).toThrow(/lookup\.range editor not implemented/);
  });

  it("throws for the deferred formula kind", () => {
    expect(() =>
      factorDraftToMutation({ kind: "formula" }, BASE_CTX),
    ).toThrow(/formula editor not implemented/);
  });

  it("throws when constant.value is the empty string sentinel", () => {
    expect(() =>
      factorDraftToMutation(
        { kind: "constant", value: "", reason: "x" },
        BASE_CTX,
      ),
    ).toThrow(/non-numeric value/);
  });

  it("throws when flat_factor.factor is the empty string sentinel", () => {
    expect(() =>
      factorDraftToMutation(
        { kind: "flat_factor", factor: "", reason: "x" },
        BASE_CTX,
      ),
    ).toThrow(/non-numeric factor/);
  });
});

// ---------------------------------------------------------------------------
// lookup.direct → chain_row
// ---------------------------------------------------------------------------

describe("factorDraftToMutation — lookup.direct", () => {
  const draft = {
    kind: "lookup.direct",
    dimension_id: "construction_class",
    factor_table_id: "construction_factors",
  } as const;

  it("produces a chain_row mutation with lookup_method='direct'", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.target).toBe("chain_row");
    expect(m.chainStageId).toBe("stage_chain_bldg");
    expect(m.factorLookup.lookup_method).toBe("direct");
  });

  it("encodes factor_table_id as factor_kind (per scoping doc §7)", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.factorLookup.factor_kind).toBe("construction_factors");
  });

  it("declares the dimension as a form_input binding", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.factorLookup.dimensions).toEqual({
      construction_class: {
        source: "form_input",
        path: "construction_class",
      },
    });
  });

  it("derives the display name from the dimension slug when factorName is absent", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.factorLookup.name).toBe("Construction class factor");
  });

  it("honors factorName + factorKindSlug overrides from context", () => {
    const m = factorDraftToMutation(draft, {
      ...BASE_CTX,
      factorName: "BOP construction",
      factorKindSlug: "construction_factor",
    }) as Extract<FactorDraftMutation, { target: "chain_row" }>;
    expect(m.factorLookup.name).toBe("BOP construction");
    expect(m.factorLookup.factor_kind).toBe("construction_factor");
  });

  it("emits a FactorLookup that round-trips through factorLookupSchema", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(() => factorLookupSchema.parse(m.factorLookup)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// lookup.classification → chain_row
// ---------------------------------------------------------------------------

describe("factorDraftToMutation — lookup.classification", () => {
  const draft = {
    kind: "lookup.classification",
    class_code: "1234",
  } as const;

  it("produces a chain_row mutation keyed on class_code", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.target).toBe("chain_row");
    expect(m.factorLookup.lookup_method).toBe("direct");
    expect(m.factorLookup.dimensions).toEqual({
      class_code: { source: "form_input", path: "class_code" },
    });
  });

  it("uses 'class_factor' as the default factor_kind", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.factorLookup.factor_kind).toBe("class_factor");
  });

  it("uses 'Class factor' as the default display name", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(m.factorLookup.name).toBe("Class factor");
  });

  it("emits a FactorLookup that round-trips through factorLookupSchema", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "chain_row" }
    >;
    expect(() => factorLookupSchema.parse(m.factorLookup)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// constant → sibling_stage (flat_factor)
// ---------------------------------------------------------------------------

describe("factorDraftToMutation — constant", () => {
  const draft = {
    kind: "constant",
    value: 0.95,
    reason: "Sprinkler credit per WI BOP §22.3",
  } as const;

  it("produces a sibling_stage mutation of kind flat_factor", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    expect(m.target).toBe("sibling_stage");
    expect(m.siblingStageKind).toBe("flat_factor");
  });

  it("uses the chain output path as the flat_factor's input_path", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    const cfg = m.config as Record<string, unknown>;
    expect(cfg["input_path"]).toBe("stages.stage_chain_bldg.value");
  });

  it("captures the constant value as the flat_factor's factor", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    const cfg = m.config as Record<string, unknown>;
    expect(cfg["factor"]).toBe(0.95);
  });

  it("uses draft.reason as the citation_rule", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    const cfg = m.config as Record<string, unknown>;
    expect(cfg["citation_rule"]).toBe("Sprinkler credit per WI BOP §22.3");
  });

  it("derives the display name from draft.reason when factorName is absent", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    expect(m.displayName).toBe("Sprinkler credit per WI BOP §22.3");
  });

  it("falls back to 'Constant' when reason + factorName are both empty", () => {
    const m = factorDraftToMutation(
      { kind: "constant", value: 0.95, reason: "" },
      BASE_CTX,
    ) as Extract<FactorDraftMutation, { target: "sibling_stage" }>;
    expect(m.displayName).toBe("Constant");
  });

  it("derives a slug-safe stage_id from the display name", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    expect(m.stageId).toBe("sprinkler_credit_per_wi_bop_22_3");
  });

  it("honors siblingStageId + insertAfterStageId overrides from context", () => {
    const m = factorDraftToMutation(draft, {
      ...BASE_CTX,
      siblingStageId: "stage_sprinkler_credit",
      insertAfterStageId: "stage_chain_bldg",
    }) as Extract<FactorDraftMutation, { target: "sibling_stage" }>;
    expect(m.stageId).toBe("stage_sprinkler_credit");
    expect(m.insertAfterStageId).toBe("stage_chain_bldg");
  });

  it("emits a FlatFactorConfig that round-trips through flatFactorConfigSchema", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    expect(() => flatFactorConfigSchema.parse(m.config)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// flat_factor → sibling_stage (flat_factor)
// ---------------------------------------------------------------------------

describe("factorDraftToMutation — flat_factor", () => {
  const draft = {
    kind: "flat_factor",
    factor: 1.05,
    reason: "IRPM loss-experience credit",
  } as const;

  it("produces a sibling_stage mutation of kind flat_factor", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    expect(m.target).toBe("sibling_stage");
    expect(m.siblingStageKind).toBe("flat_factor");
  });

  it("uses 'flat_factor' as the default factor_kind", () => {
    const m = factorDraftToMutation(draft, BASE_CTX) as Extract<
      FactorDraftMutation,
      { target: "sibling_stage" }
    >;
    const cfg = m.config as Record<string, unknown>;
    expect(cfg["factor_kind"]).toBe("flat_factor");
  });

  it("falls back to 'Flat factor' when reason is empty", () => {
    const m = factorDraftToMutation(
      { kind: "flat_factor", factor: 1.05, reason: "" },
      BASE_CTX,
    ) as Extract<FactorDraftMutation, { target: "sibling_stage" }>;
    expect(m.displayName).toBe("Flat factor");
  });
});

// ---------------------------------------------------------------------------
// slugify + humanizeSlug helpers
// ---------------------------------------------------------------------------

describe("slugify (internal helper)", () => {
  const { slugify } = __internals;

  it("lowercases + underscores spaces", () => {
    expect(slugify("Sprinkler credit")).toBe("sprinkler_credit");
  });

  it("collapses runs of non-alphanumeric characters", () => {
    expect(slugify("  Foo!!!Bar---Baz  ")).toBe("foo_bar_baz");
  });

  it("returns 'factor' for inputs that slugify to empty", () => {
    expect(slugify("   ")).toBe("factor");
    expect(slugify("§§§")).toBe("factor");
  });
});

describe("humanizeSlug (internal helper)", () => {
  const { humanizeSlug } = __internals;

  it("converts underscores to spaces and sentence-cases", () => {
    expect(humanizeSlug("construction_class")).toBe("Construction class");
  });

  it("normalizes dots + hyphens too", () => {
    expect(humanizeSlug("ded.curve.2026")).toBe("Ded curve 2026");
    expect(humanizeSlug("hair-care-svc")).toBe("Hair care svc");
  });

  it("returns 'Factor' for inputs that humanize to empty", () => {
    expect(humanizeSlug("")).toBe("Factor");
    expect(humanizeSlug("___")).toBe("Factor");
  });
});

// ══════════════════════════════════════════════════════════════════
// ADR-0056 — unknown-key policy threads draft → wire (and back)
// ══════════════════════════════════════════════════════════════════

describe("factorDraftToMutation · unknown_key_policy (ADR-0056)", () => {
  const ctx = {
    chainStageId: "chain_1",
    chainName: "Chain",
    chainOutputPath: "stages.chain_1.value",
  };

  it("omits the field for absent/error (error IS the schema default)", () => {
    for (const unknown_key_policy of [
      undefined,
      { mode: "error" as const },
    ]) {
      const m = factorDraftToMutation(
        {
          kind: "lookup.direct",
          dimension_id: "construction_class",
          factor_table_id: "construction_factor",
          ...(unknown_key_policy ? { unknown_key_policy } : {}),
        },
        ctx,
      );
      if (m.target !== "chain_row") throw new Error("expected chain_row");
      expect("unknown_key_policy" in m.factorLookup).toBe(false);
    }
  });

  it("writes default(x) with its authored value", () => {
    const m = factorDraftToMutation(
      {
        kind: "lookup.direct",
        dimension_id: "construction_class",
        factor_table_id: "construction_factor",
        unknown_key_policy: { mode: "default", value: 1.25 },
      },
      ctx,
    );
    if (m.target !== "chain_row") throw new Error("expected chain_row");
    expect(m.factorLookup.unknown_key_policy).toEqual({
      mode: "default",
      value: 1.25,
    });
  });

  it("writes refer", () => {
    const m = factorDraftToMutation(
      {
        kind: "lookup.direct",
        dimension_id: "construction_class",
        factor_table_id: "construction_factor",
        unknown_key_policy: { mode: "refer" },
      },
      ctx,
    );
    if (m.target !== "chain_row") throw new Error("expected chain_row");
    expect(m.factorLookup.unknown_key_policy).toEqual({ mode: "refer" });
  });
});
