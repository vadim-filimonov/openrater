/**
 * Tests for factorLookupToDraft — the M4.3.9 reverse adapter.
 *
 * Covers each backend lookup_method's mapping to a FactorDraft, plus
 * the round-trip via factorDraftToMutation for the wired UI kinds.
 */

import { describe, it, expect } from "vitest";
import type { FactorLookup } from "@openrater/contracts";
import { factorLookupToDraft } from "./factorLookupToDraft";
import { factorDraftToMutation } from "./factorDraftAdapter";

const baseLookup: Omit<FactorLookup, "lookup_method" | "dimensions"> = {
  name: "Test factor",
  factor_kind: "test_factor",
  table: "rate_factors",
  citation_rule: "",
  citation_page: "",
  description_template: "Test: ×{value}",
};

describe("factorLookupToDraft — direct", () => {
  it("maps lookup_method=direct + one dim → lookup.direct draft", () => {
    const lookup: FactorLookup = {
      ...baseLookup,
      factor_kind: "construction_factors",
      lookup_method: "direct",
      dimensions: {
        construction_class: { source: "form_input", path: "construction_class" },
      },
    };
    const draft = factorLookupToDraft(lookup);
    expect(draft).toEqual({
      kind: "lookup.direct",
      dimension_id: "construction_class",
      factor_table_id: "construction_factors",
    });
  });

  it("maps a class_code dim → lookup.direct (NOT lookup.classification)", () => {
    // Per the file-level docstring: reverse-mapping to
    // lookup.classification would re-prompt the user for a class
    // that gets discarded. Reverse to lookup.direct is honest.
    const lookup: FactorLookup = {
      ...baseLookup,
      factor_kind: "class_factor",
      lookup_method: "direct",
      dimensions: {
        class_code: { source: "form_input", path: "class_code" },
      },
    };
    const draft = factorLookupToDraft(lookup);
    expect(draft.kind).toBe("lookup.direct");
    if (draft.kind === "lookup.direct") {
      expect(draft.dimension_id).toBe("class_code");
      expect(draft.factor_table_id).toBe("class_factor");
    }
  });

  it("handles empty dimensions → empty dimension_id", () => {
    const lookup: FactorLookup = {
      ...baseLookup,
      lookup_method: "direct",
      dimensions: {},
    };
    const draft = factorLookupToDraft(lookup);
    expect(draft.kind).toBe("lookup.direct");
    if (draft.kind === "lookup.direct") {
      expect(draft.dimension_id).toBe("");
    }
  });
});

describe("factorLookupToDraft — deferred range kinds", () => {
  it("maps lookup_method=interpolated → lookup.range placeholder (Brief 34 PR 34.7)", () => {
    // Brief 34 PR 34.7 removed `curve.evaluate` from the UI side; the
    // legacy `interpolated` lookup_method on the wire format now maps
    // to the banded-lookup placeholder (closest UI equivalent — 1-D
    // banded factor tables are the new curve viz).
    const lookup: FactorLookup = {
      ...baseLookup,
      factor_kind: "ded_curve_2026",
      lookup_method: "interpolated",
      dimensions: {
        tiv: { source: "form_input", path: "tiv" },
      },
    };
    const draft = factorLookupToDraft(lookup);
    expect(draft).toEqual({ kind: "lookup.range" });
  });

  it("maps lookup_method=binned → lookup.range placeholder", () => {
    const lookup: FactorLookup = {
      ...baseLookup,
      lookup_method: "binned",
      dimensions: { tiv: { source: "form_input", path: "tiv" } },
    };
    const draft = factorLookupToDraft(lookup);
    expect(draft).toEqual({ kind: "lookup.range" });
  });

  it("maps lookup_method=bracketed → lookup.range placeholder", () => {
    const lookup: FactorLookup = {
      ...baseLookup,
      lookup_method: "bracketed",
      dimensions: { tiv: { source: "form_input", path: "tiv" } },
    };
    const draft = factorLookupToDraft(lookup);
    expect(draft).toEqual({ kind: "lookup.range" });
  });
});

describe("factorLookupToDraft — round-trip", () => {
  // Round-trip: lookup → draft → mutation → lookup', then assert
  // lookup' has the same lookup_method + dimensions + factor_kind
  // as the original. The forward adapter synthesizes defaults
  // (description_template, citation_*, name) so those don't
  // round-trip 1:1 unless the context supplies overrides.
  const CTX = {
    chainStageId: "stage_x",
    chainName: "Chain X",
    chainOutputPath: "stages.stage_x.value",
  };

  it("round-trips a lookup.direct factor", () => {
    const original: FactorLookup = {
      ...baseLookup,
      factor_kind: "construction_factors",
      lookup_method: "direct",
      dimensions: {
        construction_class: { source: "form_input", path: "construction_class" },
      },
    };
    const draft = factorLookupToDraft(original);
    const mutation = factorDraftToMutation(draft, CTX);
    expect(mutation.target).toBe("chain_row");
    if (mutation.target === "chain_row") {
      expect(mutation.factorLookup.lookup_method).toBe("direct");
      expect(mutation.factorLookup.factor_kind).toBe("construction_factors");
      expect(mutation.factorLookup.dimensions).toEqual({
        construction_class: {
          source: "form_input",
          path: "construction_class",
        },
      });
    }
  });

  it("round-trips a class-keyed direct lookup (recovers as lookup.direct)", () => {
    const original: FactorLookup = {
      ...baseLookup,
      factor_kind: "bpp_class_factor",
      lookup_method: "direct",
      dimensions: {
        class_code: { source: "form_input", path: "class_code" },
      },
    };
    const draft = factorLookupToDraft(original);
    expect(draft.kind).toBe("lookup.direct");
    const mutation = factorDraftToMutation(draft, CTX);
    if (mutation.target === "chain_row") {
      expect(mutation.factorLookup.lookup_method).toBe("direct");
      expect(mutation.factorLookup.factor_kind).toBe("bpp_class_factor");
      expect(mutation.factorLookup.dimensions).toEqual({
        class_code: { source: "form_input", path: "class_code" },
      });
    }
  });
});

describe("factorLookupToDraft · unknown_key_policy round-trip (ADR-0056)", () => {
  it("seeds the draft from an authored policy so an edit doesn't reset it", () => {
    const draft = factorLookupToDraft({
      name: "Construction",
      factor_kind: "construction_factor",
      table: "rate_factors",
      lookup_method: "direct",
      dimensions: {
        construction_class: { source: "form_input", path: "construction_class" },
      },
      citation_rule: "",
      citation_page: "",
      description_template: "x",
      unknown_key_policy: { mode: "default", value: 1.1 },
    } as never);
    expect(draft).toEqual({
      kind: "lookup.direct",
      dimension_id: "construction_class",
      factor_table_id: "construction_factor",
      unknown_key_policy: { mode: "default", value: 1.1 },
    });
  });
});
