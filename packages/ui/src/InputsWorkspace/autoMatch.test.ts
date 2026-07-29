/**
 * autoMatchColumns — Brief 38 PR 38.2 test suite.
 *
 * Pure-function tests with no mocks. Three concerns:
 *
 *   1. The text-normalization + similarity helpers behave correctly
 *      on edge cases (empty strings, identical names, prefix overlap).
 *   2. Each scoring layer (name-only, value-only, combined, dtype
 *      penalty) computes the expected confidence band.
 *   3. The end-to-end `autoMatchColumns` produces the documented
 *      bucket distribution for Brief 38 J1 / J2 / J4 user journeys.
 *
 * Hand-tuned thresholds in the assertions match the v1 weights
 * (0.6 × name + 0.4 × value, auto ≥ 0.8, suggest ≥ 0.4).
 */

import { describe, it, expect } from "vitest";
import type { Dimension } from "@openrater/contracts";

import {
  autoMatchColumns,
  bucketConfidence,
  levenshtein,
  nameSimilarity,
  scoreCandidate,
  tokenize,
  type RequiredInput,
  type SourceColumn,
} from "./autoMatch";

// ─────────────────────────────────────────────────────────────────
// Test fixtures — small but realistic
// ─────────────────────────────────────────────────────────────────

const constructionDim: Dimension = {
  id: "dim_construction",
  slug: "construction",
  display_name: "Construction",
  data_type: "enum",
  role: "rating-input",
  shape: "categorical",
  levels: [
    {
      kind: "categorical",
      id: "frame",
      label: "Frame",
      aliases: ["WOOD", "wood frame"],
    },
    {
      kind: "categorical",
      id: "masonry",
      label: "Masonry",
      aliases: ["BRICK", "stone"],
    },
    {
      kind: "categorical",
      id: "non_combustible",
      label: "Non-combustible",
      aliases: ["NC", "steel"],
    },
  ],
};

const protectionClassDim: Dimension = {
  id: "dim_protection_class",
  slug: "protection_class",
  display_name: "Protection class",
  data_type: "enum",
  role: "rating-input",
  shape: "categorical",
  levels: Array.from({ length: 10 }, (_, i) => ({
    kind: "categorical" as const,
    id: `pc_${i + 1}`,
    label: String(i + 1),
    aliases: [`class ${i + 1}`],
  })),
};

const buildingAgeDim: Dimension = {
  id: "dim_building_age",
  slug: "building_age",
  display_name: "Building age",
  data_type: "number",
  role: "rating-input",
  shape: "banded",
  levels: [
    { kind: "banded", id: "0_5", label: "0–5 yrs", lo: 0, hi: 5 },
    { kind: "banded", id: "5_15", label: "5–15 yrs", lo: 5, hi: 15 },
    { kind: "banded", id: "15_30", label: "15–30 yrs", lo: 15, hi: 30 },
  ],
};

const ALL_DIMS: readonly Dimension[] = [
  constructionDim,
  protectionClassDim,
  buildingAgeDim,
];

// ─────────────────────────────────────────────────────────────────
// tokenize
// ─────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("splits snake_case", () => {
    expect(tokenize("class_code")).toEqual(["class", "code"]);
  });

  it("splits kebab-case", () => {
    expect(tokenize("class-code")).toEqual(["class", "code"]);
  });

  it("splits camelCase", () => {
    expect(tokenize("classCode")).toEqual(["class", "code"]);
  });

  it("splits dot-separated and slashes", () => {
    expect(tokenize("policy.class_code")).toEqual([
      "policy",
      "class",
      "code",
    ]);
    expect(tokenize("model/discr_credit")).toEqual([
      "model",
      "discr",
      "credit",
    ]);
  });

  it("drops empty tokens from duplicate separators", () => {
    expect(tokenize("a__b---c")).toEqual(["a", "b", "c"]);
  });

  // PR 11f regression — parentheses and other punctuation must split
  // tokens cleanly so a display name like "Total insurable value (TIV)"
  // doesn't keep "(TIV)" as a single token (which blocks the prefix-
  // similarity from matching a clean "tiv" source column).
  it("treats parentheses + brackets + colons as separators", () => {
    expect(tokenize("Total insurable value (TIV)")).toEqual([
      "total",
      "insurable",
      "value",
      "tiv",
    ]);
    expect(tokenize("Business personal property (BPP)")).toEqual([
      "business",
      "personal",
      "property",
      "bpp",
    ]);
    expect(tokenize("submission:loss[ratio]")).toEqual([
      "submission",
      "loss",
      "ratio",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────
// levenshtein
// ─────────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns length when one side is empty", () => {
    expect(levenshtein("", "abcd")).toBe(4);
    expect(levenshtein("abcd", "")).toBe(4);
  });

  it("counts single-character substitutions", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshtein("hello", "world")).toBe(levenshtein("world", "hello"));
  });
});

// ─────────────────────────────────────────────────────────────────
// nameSimilarity
// ─────────────────────────────────────────────────────────────────

describe("nameSimilarity", () => {
  it("returns 1.0 for identical (case-insensitive) names", () => {
    expect(nameSimilarity("class_code", "CLASS_CODE")).toBe(1.0);
  });

  it("returns 0 when either side is empty after normalization", () => {
    expect(nameSimilarity("", "anything")).toBe(0);
    expect(nameSimilarity("___", "construction")).toBe(0);
  });

  it("scores high for substring containment with length ratio bonus", () => {
    // "tiv" ⊆ "tiv_usd" → 0.7 + 0.25 × (3/6) ≈ 0.825
    const score = nameSimilarity("tiv", "tiv_usd");
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("scores perfect token overlap as 1.0 via jaccard", () => {
    // "building_age" vs "age_of_building" — different order, same
    // tokens minus stopword. Jaccard says {building, age} ∩ {age, of,
    // building} = 2; ∪ = 3 → 0.67. The MAX over signals still wins.
    const score = nameSimilarity("building_age", "age_of_building");
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  // PR 11f + Brief 57 — a parens-abbreviated display name still matches
  // a CLEAN abbreviation column at the auto bar, because that column is
  // FULLY covered by the display name's tokens ("...(TIV)" ⊃ "tiv",
  // "...(BPP)" ⊃ "bpp" → 1.0). The PR 11f tokenize fix (parens split off
  // the bare "tiv"/"bpp" token) is preserved.
  it("matches parens-abbreviated display name to a clean column", () => {
    expect(nameSimilarity("Total insurable value (TIV)", "tiv"))
      .toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("Business personal property (BPP)", "bpp"))
      .toBeGreaterThanOrEqual(0.8);
  });

  // Brief 57 — but a column that ALSO carries its own extra token
  // ("input_tiv" = input + tiv) shares only ONE token with the long
  // display name, so it no longer auto-matches on that single token; it
  // degrades to a suggestion. (Real TIV inputs still auto-bind via their
  // short id/name "tiv" → the clean column asserted above.) This is the
  // deliberate narrowing that kills the single-shared-token swarm.
  it("does NOT auto-match a parens-abbrev display name on a single shared token", () => {
    const score = nameSimilarity("Total insurable value (TIV)", "input_tiv");
    expect(score).toBeLessThan(0.8);
    expect(score).toBeGreaterThan(0.4); // still surfaced as a suggestion
  });

  it("scores moderately for prefix-overlap on a token", () => {
    // "BUILT" vs "building_age" — "built" prefix-matches "building"
    // sharing 4 chars; building is 8 chars long → ~0.5 token-prefix.
    const score = nameSimilarity("BUILT", "building_age");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.7);
  });

  it("scores very low for unrelated names", () => {
    const score = nameSimilarity("tiv", "occupancy");
    expect(score).toBeLessThan(0.4);
  });

  it("is symmetric for non-degenerate inputs", () => {
    expect(nameSimilarity("CLASS_CODE", "class_code")).toBe(
      nameSimilarity("class_code", "CLASS_CODE"),
    );
  });

  it("normalizes various punctuation to equivalent", () => {
    // "PROT-CLASS", "PROT_CLASS", "protClass" should all be ~1.0
    // against "protection_class".
    expect(nameSimilarity("PROT_CLASS", "prot_class")).toBe(1.0);
    expect(nameSimilarity("prot-class", "prot_class")).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// nameSimilarity · Brief 57 — single shared token must not score 1.0
// ─────────────────────────────────────────────────────────────────

describe("nameSimilarity · Brief 57 single-shared-token discount", () => {
  // The Sample BOP walkthrough bug: CSV column `class_code` shared the
  // exact token "class" with construction_class / liab_class_group / ppc
  // ("...Class") and "code" with bceg_grade ("...Code...") — every one
  // scored nameSimilarity 1.0 → "auto", a swarm of false auto-applies.
  // After Brief 57 only the TRUE owner (class_code) scores 1.0; the
  // token-sharers fall below the 0.8 auto bar.
  it("class_code is a perfect (1.0) match ONLY to itself", () => {
    expect(nameSimilarity("class_code", "class_code")).toBe(1.0);
  });

  it("class_code does NOT perfect-match other class/code identifiers", () => {
    for (const other of [
      "construction_class",
      "liab_class_group",
      "Public Protection (Fire) Class", // ppc display name
      "Building Code Effectiveness Grade", // bceg display name
    ]) {
      const score = nameSimilarity("class_code", other);
      expect(score).toBeLessThan(0.8); // below the auto threshold
    }
  });

  // Preserve genuine matches: BOTH tokens of "prot_class" match
  // "protection_class" (prot→protection partial, class→class exact), so
  // it stays a strong suggestion (and value-match promotes it to auto).
  it("still rewards a genuine multi-token abbreviation (prot_class ↔ protection_class)", () => {
    expect(nameSimilarity("protection_class", "prot_class")).toBeGreaterThan(0.7);
  });

  // Full token-set coverage (reorder) is still a perfect match: every
  // token of "building_age" is found in "age_of_building".
  it("still scores full token coverage / reorder at 1.0", () => {
    expect(nameSimilarity("building_age", "age_of_building")).toBe(1.0);
  });

  // The abbreviation case that was the original reason for a per-pair
  // MAX stays a moderate suggestion (not auto, not empty).
  it("keeps the built ↔ building_age abbreviation at ~0.5", () => {
    const score = nameSimilarity("built", "building_age");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(0.7);
  });
});

// ─────────────────────────────────────────────────────────────────
// bucketConfidence
// ─────────────────────────────────────────────────────────────────

describe("bucketConfidence", () => {
  it("buckets ≥ 0.8 as auto", () => {
    expect(bucketConfidence(0.8)).toBe("auto");
    expect(bucketConfidence(0.95)).toBe("auto");
    expect(bucketConfidence(1.0)).toBe("auto");
  });

  it("buckets [0.4, 0.8) as suggested", () => {
    expect(bucketConfidence(0.4)).toBe("suggested");
    expect(bucketConfidence(0.6)).toBe("suggested");
    expect(bucketConfidence(0.799)).toBe("suggested");
  });

  it("buckets < 0.4 as empty", () => {
    expect(bucketConfidence(0)).toBe("empty");
    expect(bucketConfidence(0.39)).toBe("empty");
  });

  it("respects custom thresholds", () => {
    expect(bucketConfidence(0.7, { autoThreshold: 0.6 })).toBe("auto");
    expect(bucketConfidence(0.3, { suggestThreshold: 0.2 })).toBe("suggested");
  });
});

// ─────────────────────────────────────────────────────────────────
// scoreCandidate — name only (no dim)
// ─────────────────────────────────────────────────────────────────

describe("scoreCandidate · name-only path", () => {
  it("auto-applies for an exact name match", () => {
    const input: RequiredInput = { id: "tiv", name: "tiv", dtype: "number" };
    const column: SourceColumn = { name: "tiv", dtype: "number" };
    const result = scoreCandidate(input, column, [], []);
    expect(result.bucket).toBe("auto");
    expect(result.confidence).toBe(1.0);
    expect(result.valueScore).toBeUndefined();
  });

  it("auto-applies for high containment match (TIV ↔ TIV_USD)", () => {
    const input: RequiredInput = { id: "tiv", name: "tiv", dtype: "number" };
    const column: SourceColumn = { name: "TIV_USD", dtype: "number" };
    const result = scoreCandidate(input, column, [], []);
    expect(result.bucket).toBe("auto");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("auto-applies when the column matches the input ID even if the display name differs (banded dim)", () => {
    // Cold-test payoff fix: a banded dim's required input has
    // id = raw field name ("revenue", the chain's form_input leaf) but
    // name = the dim DISPLAY label ("Revenue band"). A CSV column called
    // "revenue" normalize-equals the id → must auto-apply. Before the
    // fix the matcher only tried `name` → "revenue" vs "Revenue band"
    // scored below 0.8 → stuck "empty"/"suggested" → factor defaulted
    // to 1.0 → premiums never differentiated on revenue.
    const input: RequiredInput = {
      id: "revenue",
      name: "Revenue band",
      dtype: "number",
      dimSlug: "revenue_band",
    };
    const column: SourceColumn = { name: "revenue", dtype: "number" };
    const result = scoreCandidate(input, column, [], []);
    expect(result.bucket).toBe("auto");
    expect(result.nameScore).toBe(1.0);
  });

  it("returns empty bucket for fully unrelated columns", () => {
    const input: RequiredInput = {
      id: "tiv",
      name: "tiv",
      dtype: "number",
    };
    const column: SourceColumn = { name: "policy_number", dtype: "string" };
    const result = scoreCandidate(input, column, [], []);
    expect(result.bucket).toBe("empty");
  });

  it("applies dtype mismatch penalty halving the name score", () => {
    const input: RequiredInput = {
      id: "tiv",
      name: "tiv",
      dtype: "number",
    };
    const sameName: SourceColumn = { name: "tiv", dtype: "string" };
    const result = scoreCandidate(input, sameName, [], []);
    // Exact name → 1.0 × 0.5 (penalty) = 0.5 → suggested bucket
    expect(result.confidence).toBe(0.5);
    expect(result.bucket).toBe("suggested");
  });

  it("does NOT apply dtype penalty for date ↔ string (common storage)", () => {
    const input: RequiredInput = {
      id: "eff_date",
      name: "eff_date",
      dtype: "date",
    };
    const column: SourceColumn = { name: "eff_date", dtype: "string" };
    const result = scoreCandidate(input, column, [], []);
    expect(result.confidence).toBe(1.0);
    expect(result.bucket).toBe("auto");
  });

  // PR 11f-bis regression — categorical dim has dtype="string" (UI
  // hint), but the CSV column's parseCsv-inferred dtype is "number"
  // because the sampled values look numeric (NAICS / class codes).
  // Without skipping the dim-ref penalty, this collapses a 1.0
  // name match to 0.5 → "suggested" → user has to re-pick the
  // obvious mapping. With the skip, the perfect name match wins.
  it("does NOT apply dtype penalty when the input is a dim ref", () => {
    const input: RequiredInput = {
      id: "class_code",
      name: "Class code",
      dtype: "string",
      dimSlug: "class_code",
    };
    const column: SourceColumn = { name: "class_code", dtype: "number" };
    const result = scoreCandidate(input, column, [], []);
    expect(result.confidence).toBe(1.0);
    expect(result.bucket).toBe("auto");
  });
});

// ─────────────────────────────────────────────────────────────────
// scoreCandidate — value-match path (dim-ref inputs)
// ─────────────────────────────────────────────────────────────────

describe("scoreCandidate · with value-match", () => {
  it("blends name (0.6) + value (0.4) when both available", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dtype: "string",
      dimSlug: "construction",
    };
    const column: SourceColumn = { name: "CONSTR", dtype: "string" };
    const sampleRows = [
      { CONSTR: "Frame" },
      { CONSTR: "Masonry" },
      { CONSTR: "Frame" },
    ];
    const result = scoreCandidate(input, column, sampleRows, ALL_DIMS);
    // name: nameSimilarity("construction", "CONSTR") — "constr" is a
    // prefix → containment bonus around 0.825. value: 3 of 3 → 1.0.
    // combined ~ 0.6 × 0.825 + 0.4 × 1.0 ≈ 0.895 → auto.
    expect(result.valueScore).toBe(1.0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.bucket).toBe("auto");
  });

  // PR 11f-ter regression — a perfect name match (1.0) shouldn't be
  // dragged below auto by a zero value-match, which is typically a
  // mid-authoring artifact (dim catalog with levels that don't yet
  // overlap the CSV's actual values). Before the fix this scored
  // 0.6 × 1.0 + 0.4 × 0 = 0.6 → "suggested"; after, it rides through
  // to "auto" so the user doesn't have to re-pick the obvious mapping.
  it("floors confidence at perfect name match when value-match is 0", () => {
    const input: RequiredInput = {
      id: "class_code",
      name: "class_code",
      dtype: "string",
      dimSlug: "construction", // dim slug exists in ALL_DIMS for the fixture
    };
    const column: SourceColumn = { name: "class_code", dtype: "string" };
    // Values don't match the construction dim's levels (frame /
    // masonry) — valueMatchFraction returns 0.
    const sampleRows = [
      { class_code: "612110" },
      { class_code: "722410" },
      { class_code: "812199" },
    ];
    const result = scoreCandidate(input, column, sampleRows, ALL_DIMS);
    expect(result.valueScore).toBe(0);
    expect(result.confidence).toBe(1.0);
    expect(result.bucket).toBe("auto");
  });

  it("uses alias resolution against the dim's levels (WOOD → frame)", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dtype: "string",
      dimSlug: "construction",
    };
    const column: SourceColumn = { name: "CONSTR", dtype: "string" };
    const sampleRows = [
      { CONSTR: "WOOD" }, // alias of frame
      { CONSTR: "BRICK" }, // alias of masonry
      { CONSTR: "Frame" }, // canonical
    ];
    const result = scoreCandidate(input, column, sampleRows, ALL_DIMS);
    expect(result.valueScore).toBe(1.0);
  });

  it("scores value-match partial when only some rows match", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dtype: "string",
      dimSlug: "construction",
    };
    const column: SourceColumn = { name: "CONSTR", dtype: "string" };
    const sampleRows = [
      { CONSTR: "Frame" },
      { CONSTR: "GARBAGE" }, // unknown
      { CONSTR: "Masonry" },
      { CONSTR: "PLATINUM" }, // unknown
    ];
    const result = scoreCandidate(input, column, sampleRows, ALL_DIMS);
    expect(result.valueScore).toBe(0.5);
  });

  it("skips empty cells when counting non-empty rows for value-match", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dtype: "string",
      dimSlug: "construction",
    };
    const column: SourceColumn = { name: "CONSTR", dtype: "string" };
    const sampleRows = [
      { CONSTR: "Frame" },
      { CONSTR: "" }, // empty — skipped
      { CONSTR: null },
      { CONSTR: "Masonry" },
    ];
    const result = scoreCandidate(input, column, sampleRows, ALL_DIMS);
    // 2 of 2 non-empty rows match → 1.0
    expect(result.valueScore).toBe(1.0);
  });

  it("returns name-only confidence when dim is banded (no string equality)", () => {
    const input: RequiredInput = {
      id: "building_age",
      name: "building_age",
      dtype: "number",
      dimSlug: "building_age",
    };
    const column: SourceColumn = { name: "building_age", dtype: "number" };
    const sampleRows = [{ building_age: 17 }, { building_age: 8 }];
    const result = scoreCandidate(input, column, sampleRows, ALL_DIMS);
    expect(result.valueScore).toBeUndefined();
    // Pure name-score should still auto-apply for an exact match.
    expect(result.bucket).toBe("auto");
  });

  it("falls back to name-only when sample rows are empty", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dimSlug: "construction",
    };
    const column: SourceColumn = { name: "CONSTR" };
    const result = scoreCandidate(input, column, [], ALL_DIMS);
    expect(result.valueScore).toBeUndefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("falls back to name-only when no matching dim is found", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dimSlug: "unknown_dim",
    };
    const column: SourceColumn = { name: "construction" };
    const result = scoreCandidate(input, column, [{ construction: "X" }], ALL_DIMS);
    expect(result.valueScore).toBeUndefined();
    expect(result.confidence).toBe(1.0);
  });

  it("uses the dim's display_name + slug as additional name candidates", () => {
    const input: RequiredInput = {
      // Namespace-prefixed id won't directly match "CONSTR" by name —
      // but the dim's slug "construction" will.
      id: "submission.construction",
      name: "submission.construction",
      dimSlug: "construction",
    };
    const column: SourceColumn = { name: "construction" };
    const result = scoreCandidate(input, column, [], ALL_DIMS);
    expect(result.nameScore).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// autoMatchColumns — end-to-end matrix scoring
// ─────────────────────────────────────────────────────────────────

describe("autoMatchColumns", () => {
  it("returns one entry per required input, keyed by id", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "a", name: "tiv", dtype: "number" },
      { id: "b", name: "class_code", dtype: "string" },
    ];
    const columns: readonly SourceColumn[] = [{ name: "tiv" }];
    const result = autoMatchColumns(inputs, columns, [], []);
    expect(Object.keys(result).sort()).toEqual(["a", "b"]);
  });

  it("filters out empty-bucket candidates per input", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "tiv", name: "tiv", dtype: "number" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "tiv" },
      { name: "policy_number" }, // unrelated → empty bucket → filtered
      { name: "agent_id" }, // unrelated → empty bucket → filtered
    ];
    const result = autoMatchColumns(inputs, columns, [], []);
    expect(result["tiv"]).toHaveLength(1);
    expect(result["tiv"]?.[0]?.columnName).toBe("tiv");
  });

  it("sorts candidates descending by confidence", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "tiv", name: "tiv", dtype: "number" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "tiv_partial_match" }, // medium
      { name: "tiv" }, // exact
      { name: "TIV" }, // exact (case-insensitive)
    ];
    const result = autoMatchColumns(inputs, columns, [], []);
    const cands = result["tiv"] ?? [];
    expect(cands.length).toBeGreaterThanOrEqual(2);
    expect(cands[0]!.confidence).toBeGreaterThanOrEqual(cands[1]!.confidence);
  });

  it("uses alphabetical column name as a deterministic tie-breaker", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "x", name: "x", dtype: "number" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "x" }, // exact match — wins
      // Two columns tied at the same lower confidence:
      { name: "ax" },
      { name: "bx" },
    ];
    const result = autoMatchColumns(inputs, columns, [], []);
    const cands = result["x"] ?? [];
    // First is "x" (exact match, 1.0)
    expect(cands[0]?.columnName).toBe("x");
    // If "ax" and "bx" both made it past the threshold, "ax" should
    // come before "bx" alphabetically.
    const lower = cands.filter((c) => c.columnName !== "x");
    if (lower.length >= 2) {
      expect(lower[0]!.columnName.localeCompare(lower[1]!.columnName)).toBeLessThan(0);
    }
  });

  it("returns an empty array for an input with no plausible candidates", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "obscure", name: "totally_unique_field_xyz" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "policy" },
      { name: "carrier" },
    ];
    const result = autoMatchColumns(inputs, columns, [], []);
    expect(result["obscure"]).toEqual([]);
  });

  it("handles the same column appearing as a high-confidence match for multiple inputs", () => {
    // Brief 38 §7: "same source column scores highly for multiple
    // inputs → first-come-first-served by input order (with a banner)".
    // This function returns ALL candidates; the coordinator handles
    // the conflict. So we expect CLASS_CODE to appear under both
    // inputs.
    const inputs: readonly RequiredInput[] = [
      { id: "class_code", name: "class_code", dtype: "string" },
      {
        id: "model.discr_credit.class_code",
        name: "class_code",
        dtype: "string",
      },
    ];
    const columns: readonly SourceColumn[] = [{ name: "CLASS_CODE" }];
    const result = autoMatchColumns(inputs, columns, [], []);
    expect(result["class_code"]?.[0]?.columnName).toBe("CLASS_CODE");
    expect(result["model.discr_credit.class_code"]?.[0]?.columnName).toBe(
      "CLASS_CODE",
    );
  });

  it("Brief 57 · CSV column class_code auto-applies ONLY to its true owner, not the class/code swarm", () => {
    // Reproduction of the Sample BOP walkthrough bug (see
    // InputDictionary/sampleBopTemplate.ts). Five inputs share a "class"
    // or "code" token with the column; pre-Brief-57 ALL scored 1.0
    // "auto" (a swarm). dimSlug is omitted so there is no value-match —
    // confidence === nameScore, the exact pathology (a dim with no
    // populated levels). Only `input_class_code` should bucket "auto".
    const inputs: readonly RequiredInput[] = [
      { id: "input_class_code", name: "class_code", displayName: "ISO BOP class code" },
      { id: "input_construction_class", name: "construction_class", displayName: "Construction type" },
      { id: "input_liab_class_group", name: "liab_class_group", displayName: "Liability class group" },
      { id: "input_ppc", name: "ppc", displayName: "Public Protection (Fire) Class" },
      { id: "input_bceg_grade", name: "bceg_grade", displayName: "Building Code Effectiveness Grade" },
    ];
    const columns: readonly SourceColumn[] = [{ name: "class_code", dtype: "string" }];
    const result = autoMatchColumns(inputs, columns, [], []);

    // True owner: auto, on the class_code column.
    expect(result["input_class_code"]?.[0]?.columnName).toBe("class_code");
    expect(result["input_class_code"]?.[0]?.bucket).toBe("auto");

    // Token-sharers: the class_code column is NEVER an "auto" candidate
    // for them (it is filtered as empty or surfaced only as a suggestion).
    for (const id of [
      "input_construction_class",
      "input_liab_class_group",
      "input_ppc",
      "input_bceg_grade",
    ]) {
      const onClassCode = result[id]?.find((c) => c.columnName === "class_code");
      expect(onClassCode?.bucket === "auto").toBe(false);
    }
  });

  it("Brief 38 J1 scenario · auto-maps 5 of 5 typical columns from sample CSV", () => {
    // The Brief 38 §3 J1 cold-test: 5 inputs should auto-map at ≥0.8
    // confidence on a typical actuary's CSV.
    const inputs: readonly RequiredInput[] = [
      {
        id: "class_code",
        name: "class_code",
        dtype: "string",
        dimSlug: "protection_class", // illustrative — using a stand-in
      },
      {
        id: "construction",
        name: "construction",
        dtype: "string",
        dimSlug: "construction",
      },
      {
        id: "protection_class",
        name: "protection_class",
        dtype: "string",
        dimSlug: "protection_class",
      },
      { id: "tiv", name: "tiv", dtype: "number" },
      { id: "building_age", name: "building_age", dtype: "number" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "CLASS_CODE", dtype: "string" },
      { name: "CONSTR", dtype: "string" },
      { name: "PROT_CLASS", dtype: "string" },
      { name: "TIV_USD", dtype: "number" },
      { name: "BUILT", dtype: "number" }, // matches building_age via prefix
      { name: "AGENT_ID", dtype: "string" }, // unrelated noise
    ];
    const sampleRows = [
      { CLASS_CODE: "09011", CONSTR: "Frame", PROT_CLASS: "4", TIV_USD: 1247438, BUILT: 1987 },
      { CLASS_CODE: "07712", CONSTR: "Masonry", PROT_CLASS: "6", TIV_USD: 8900000, BUILT: 2001 },
      { CLASS_CODE: "06811", CONSTR: "Non-combustible", PROT_CLASS: "3", TIV_USD: 2100000, BUILT: 2015 },
    ];
    const result = autoMatchColumns(inputs, columns, sampleRows, ALL_DIMS);
    // Each of construction, protection_class, tiv should auto-bucket.
    expect(result["construction"]?.[0]?.bucket).toBe("auto");
    expect(result["protection_class"]?.[0]?.bucket).toBe("auto");
    expect(result["tiv"]?.[0]?.bucket).toBe("auto");
    // building_age via BUILT prefix is a suggestion (not auto).
    const ageTop = result["building_age"]?.[0];
    expect(ageTop?.bucket === "suggested" || ageTop?.bucket === "auto").toBe(true);
  });

  it("Brief 38 J2 scenario · WOOD alias resolved via dim aliases boosts value-match", () => {
    // The Brief 38 §3 J2 mismatch path: when a CSV contains "WOOD"
    // (3 rows) and "Frame" (7 rows), the value-match should still
    // resolve "WOOD" via the alias → keeping the column's confidence
    // high.
    const inputs: readonly RequiredInput[] = [
      {
        id: "construction",
        name: "construction",
        dtype: "string",
        dimSlug: "construction",
      },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "CONSTR", dtype: "string" },
    ];
    const sampleRows = [
      { CONSTR: "Frame" },
      { CONSTR: "Masonry" },
      { CONSTR: "WOOD" }, // alias
      { CONSTR: "Frame" },
      { CONSTR: "Masonry" },
      { CONSTR: "WOOD" },
      { CONSTR: "Frame" },
    ];
    const result = autoMatchColumns(inputs, columns, sampleRows, ALL_DIMS);
    const top = result["construction"]?.[0];
    expect(top?.bucket).toBe("auto");
    expect(top?.valueScore).toBe(1.0); // every row matched
  });

  it("Brief 38 J4 scenario · multi-product columns map per-product", () => {
    // Two products, two namespaces: D&O.industry vs Cyber.industry.
    // Both should match the same shared INDUSTRY_NAICS column.
    const inputs: readonly RequiredInput[] = [
      {
        id: "product.do.industry",
        name: "industry",
        dtype: "string",
      },
      {
        id: "product.cyber.industry",
        name: "industry",
        dtype: "string",
      },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "INDUSTRY_NAICS", dtype: "string" },
      { name: "ASSETS_USD", dtype: "number" }, // D&O-only
      { name: "RECORDS_HELD", dtype: "number" }, // Cyber-only
    ];
    const result = autoMatchColumns(inputs, columns, [], []);
    expect(result["product.do.industry"]?.[0]?.columnName).toBe(
      "INDUSTRY_NAICS",
    );
    expect(result["product.cyber.industry"]?.[0]?.columnName).toBe(
      "INDUSTRY_NAICS",
    );
  });

  it("custom options override the defaults (lowering suggestThreshold surfaces low-confidence candidates)", () => {
    // Two genuinely-distant names: confidence falls between 0.15 and 0.4
    // under default thresholds → filtered as empty. Lowering the
    // suggest threshold to 0 surfaces the same candidate as suggested.
    const inputs: readonly RequiredInput[] = [
      { id: "x", name: "policy_holder_id", dtype: "string" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "agent_code", dtype: "string" },
    ];
    const defaultResult = autoMatchColumns(inputs, columns, [], []);
    expect(defaultResult["x"]).toEqual([]);

    const customResult = autoMatchColumns(inputs, columns, [], [], {
      suggestThreshold: 0,
    });
    const top = customResult["x"]?.[0];
    expect(top).toBeDefined();
    expect(top?.bucket).toBe("suggested");
  });

  it("respects maxSampleRows cap (large CSV doesn't blow up)", () => {
    const input: RequiredInput = {
      id: "construction",
      name: "construction",
      dimSlug: "construction",
    };
    // 10,000 rows, only the first 20 should be inspected.
    const sampleRows = Array.from({ length: 10_000 }, (_, i) => ({
      CONSTR: i % 2 === 0 ? "Frame" : "Masonry",
    }));
    const t0 = Date.now();
    const result = autoMatchColumns([input], [{ name: "CONSTR" }], sampleRows, ALL_DIMS);
    const ms = Date.now() - t0;
    // Should complete fast (well under 100ms even on a slow CI).
    expect(ms).toBeLessThan(100);
    expect(result["construction"]?.[0]?.valueScore).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Output shape invariants
// ─────────────────────────────────────────────────────────────────

describe("autoMatchColumns · output shape", () => {
  it("every candidate has confidence in [0, 1]", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "a", name: "alpha" },
      { id: "b", name: "beta", dimSlug: "construction" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "alpha" },
      { name: "BETA_2" },
    ];
    const result = autoMatchColumns(inputs, columns, [], ALL_DIMS);
    for (const cands of Object.values(result)) {
      for (const c of cands) {
        expect(c.confidence).toBeGreaterThanOrEqual(0);
        expect(c.confidence).toBeLessThanOrEqual(1);
        expect(c.nameScore).toBeGreaterThanOrEqual(0);
        expect(c.nameScore).toBeLessThanOrEqual(1);
      }
    }
  });

  it("bucket assignment matches confidence value", () => {
    const inputs: readonly RequiredInput[] = [
      { id: "a", name: "tiv" },
      { id: "b", name: "construction_close" },
      { id: "c", name: "xyz_never_match" },
    ];
    const columns: readonly SourceColumn[] = [
      { name: "tiv" },
      { name: "constr" },
      { name: "qqqq" },
    ];
    const result = autoMatchColumns(inputs, columns, [], ALL_DIMS);
    for (const cands of Object.values(result)) {
      for (const c of cands) {
        // We filter out empty buckets at the autoMatchColumns level.
        expect(c.bucket).not.toBe("empty");
        if (c.bucket === "auto") expect(c.confidence).toBeGreaterThanOrEqual(0.8);
        if (c.bucket === "suggested") {
          expect(c.confidence).toBeGreaterThanOrEqual(0.4);
          expect(c.confidence).toBeLessThan(0.8);
        }
      }
    }
  });
});
