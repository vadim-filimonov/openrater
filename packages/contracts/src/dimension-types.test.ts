/**
 * Dimension contract tests.
 */

import { describe, it, expect } from "vitest";
import {
  isRatingInput,
  isStructural,
  isStandardDimension,
  isGeographicDimension,
  isClassificationDimension,
  normalizeDimension,
  resolveClassMapping,
  DEFAULT_DIMENSION_ROLE,
  DEFAULT_DIMENSION_TYPE,
  CLASS_MAPPING_DEFAULT_PATTERN,
  // Dimension shapes
  DEFAULT_DIMENSION_SHAPE,
  inferDimensionShape,
  isBandedDimension,
  isCategoricalDimension,
  validateBandedLevels,
  deriveBandsFromBreakpoints,
  resolveBandedLevel,
  resolveCategoricalLevel,
  type ClassMappingRule,
  type Dimension,
  type DimensionLevel,
} from "./dimension-types";

const ratingInputDim: Dimension = {
  id: "deductible",
  display_name: "Deductible",
  slug: "deductible",
  data_type: "currency",
  role: "rating-input",
};

const structuralDim: Dimension = {
  id: "peril",
  display_name: "Peril",
  slug: "peril",
  data_type: "enum",
  role: "structural",
  options: ["fire", "wind", "theft", "water"],
};

const bothDim: Dimension = {
  id: "class_code",
  display_name: "Class code",
  slug: "class_code",
  data_type: "string",
  role: "both",
};

describe("Dimension contract", () => {
  describe("isRatingInput", () => {
    it("returns true for 'rating-input' role", () => {
      expect(isRatingInput(ratingInputDim)).toBe(true);
    });

    it("returns true for 'both' role", () => {
      expect(isRatingInput(bothDim)).toBe(true);
    });

    it("returns false for 'structural' role", () => {
      expect(isRatingInput(structuralDim)).toBe(false);
    });

    it("accepts a partial dimension (Pick<role>)", () => {
      // Should compile + behave correctly with just { role }
      expect(isRatingInput({ role: "rating-input" })).toBe(true);
      expect(isRatingInput({ role: "structural" })).toBe(false);
    });
  });

  describe("isStructural", () => {
    it("returns true for 'structural' role", () => {
      expect(isStructural(structuralDim)).toBe(true);
    });

    it("returns true for 'both' role", () => {
      expect(isStructural(bothDim)).toBe(true);
    });

    it("returns false for 'rating-input' role", () => {
      expect(isStructural(ratingInputDim)).toBe(false);
    });
  });

  describe("normalizeDimension", () => {
    it("applies DEFAULT_DIMENSION_ROLE when role is absent", () => {
      const raw = {
        id: "x",
        display_name: "x",
        slug: "x",
        data_type: "string" as const,
      };
      const result = normalizeDimension(raw);
      expect(result.role).toBe(DEFAULT_DIMENSION_ROLE);
      expect(result.role).toBe("rating-input"); // current default
    });

    it("preserves an explicit role", () => {
      const raw = {
        id: "x",
        display_name: "x",
        slug: "x",
        data_type: "string" as const,
        role: "structural" as const,
      };
      const result = normalizeDimension(raw);
      expect(result.role).toBe("structural");
    });

    it("preserves all other fields", () => {
      const raw = {
        id: "x",
        display_name: "Display",
        slug: "slug",
        data_type: "enum" as const,
        description: "desc",
        options: ["a", "b"] as const,
      };
      const result = normalizeDimension(raw);
      expect(result).toMatchObject({
        id: "x",
        display_name: "Display",
        slug: "slug",
        data_type: "enum",
        description: "desc",
        options: ["a", "b"],
        role: DEFAULT_DIMENSION_ROLE,
      });
    });

    it("preserves enum options through normalization", () => {
      const raw = {
        id: "construction",
        display_name: "Construction",
        slug: "construction",
        data_type: "enum" as const,
        options: ["frame", "joisted-masonry", "non-combustible"] as const,
      };
      const result = normalizeDimension(raw);
      expect(result.options).toEqual([
        "frame",
        "joisted-masonry",
        "non-combustible",
      ]);
    });
  });

  describe("DEFAULT_DIMENSION_ROLE", () => {
    it("is 'rating-input' (the safer migration default)", () => {
      // Rating-input is safer because it implies the dimension comes
      // from policy data — the common case. Marking a structural
      // dim as rating-input shows it in the wrong UI bucket but
      // doesn't break the engine.
      expect(DEFAULT_DIMENSION_ROLE).toBe("rating-input");
    });
  });
});

// ============================================================================
// 24.A2 — Dimension subtype tests
// ============================================================================

const standardDim: Dimension = {
  id: "deductible",
  display_name: "Deductible",
  slug: "deductible",
  data_type: "currency",
  role: "rating-input",
  dimension_type: "standard",
};

const geographicDim: Dimension = {
  id: "territory",
  display_name: "Territory",
  slug: "territory",
  data_type: "string",
  role: "rating-input",
  dimension_type: "geographic",
  territory_schema_id: "meridian-demo-territories-v1",
};

const classificationDim: Dimension = {
  id: "class_code",
  display_name: "Class code",
  slug: "class_code",
  data_type: "string",
  role: "both",
  dimension_type: "classification",
  class_library_id: "meridian-demo-classes-v1",
  classification_mapping: [
    {
      input_pattern: "meridian cafe",
      canonical_class_code: "c101",
      notes: "Limited cooking",
    },
    {
      input_pattern: "meridian studio",
      canonical_class_code: "c104",
    },
    {
      input_pattern: CLASS_MAPPING_DEFAULT_PATTERN,
      canonical_class_code: "c101",
      notes: "Default catch-all",
    },
  ],
};

describe("Dimension subtypes — isStandardDimension", () => {
  it("returns true for explicit 'standard'", () => {
    expect(isStandardDimension(standardDim)).toBe(true);
  });

  it("returns true when dimension_type is absent (backwards compat)", () => {
    // Older dimensions lack the field; treat them as standard.
    expect(isStandardDimension({})).toBe(true);
  });

  it("returns false for geographic + classification", () => {
    expect(isStandardDimension(geographicDim)).toBe(false);
    expect(isStandardDimension(classificationDim)).toBe(false);
  });
});

describe("Dimension subtypes — isGeographicDimension", () => {
  it("returns true for explicit 'geographic'", () => {
    expect(isGeographicDimension(geographicDim)).toBe(true);
  });

  it("returns false for standard + classification + missing", () => {
    expect(isGeographicDimension(standardDim)).toBe(false);
    expect(isGeographicDimension(classificationDim)).toBe(false);
    expect(isGeographicDimension({})).toBe(false);
  });
});

describe("Dimension subtypes — isClassificationDimension", () => {
  it("returns true for explicit 'classification'", () => {
    expect(isClassificationDimension(classificationDim)).toBe(true);
  });

  it("returns false for standard + geographic + missing", () => {
    expect(isClassificationDimension(standardDim)).toBe(false);
    expect(isClassificationDimension(geographicDim)).toBe(false);
    expect(isClassificationDimension({})).toBe(false);
  });
});

describe("Dimension subtypes — normalizeDimension", () => {
  it("applies DEFAULT_DIMENSION_TYPE when missing", () => {
    const raw = {
      id: "x",
      display_name: "x",
      slug: "x",
      data_type: "string" as const,
    };
    const result = normalizeDimension(raw);
    expect(result.dimension_type).toBe(DEFAULT_DIMENSION_TYPE);
    expect(result.dimension_type).toBe("standard");
  });

  it("preserves an explicit dimension_type", () => {
    const raw = {
      id: "t",
      display_name: "Territory",
      slug: "territory",
      data_type: "string" as const,
      dimension_type: "geographic" as const,
      territory_schema_id: "wi-v1",
    };
    const result = normalizeDimension(raw);
    expect(result.dimension_type).toBe("geographic");
    expect(result.territory_schema_id).toBe("wi-v1");
  });

  it("preserves class_library_id + classification_mapping", () => {
    const mapping: readonly ClassMappingRule[] = [
      { input_pattern: "x", canonical_class_code: "1" },
    ];
    const raw = {
      id: "c",
      display_name: "Class",
      slug: "class",
      data_type: "string" as const,
      dimension_type: "classification" as const,
      class_library_id: "meridian-demo",
      classification_mapping: mapping,
    };
    const result = normalizeDimension(raw);
    expect(result.dimension_type).toBe("classification");
    expect(result.class_library_id).toBe("meridian-demo");
    expect(result.classification_mapping).toEqual(mapping);
  });
});

describe("Dimension subtypes — resolveClassMapping", () => {
  const rules: readonly ClassMappingRule[] = [
    { input_pattern: "meridian cafe", canonical_class_code: "c101" },
    { input_pattern: "meridian studio", canonical_class_code: "c104" },
    {
      input_pattern: CLASS_MAPPING_DEFAULT_PATTERN,
      canonical_class_code: "c101",
    },
  ];

  it("returns the matching canonical for an exact input", () => {
    expect(resolveClassMapping(rules, "meridian cafe")).toBe("c101");
    expect(resolveClassMapping(rules, "meridian studio")).toBe("c104");
  });

  it("is case-insensitive + trims whitespace", () => {
    expect(resolveClassMapping(rules, "  MERIDIAN CAFE ")).toBe("c101");
    expect(resolveClassMapping(rules, "Meridian Studio")).toBe("c104");
  });

  it("falls back to the default rule when no exact match", () => {
    expect(resolveClassMapping(rules, "no such input")).toBe("c101");
  });

  it("returns null when no rule matches and no default is set", () => {
    const noDefault: readonly ClassMappingRule[] = [
      { input_pattern: "x", canonical_class_code: "1" },
    ];
    expect(resolveClassMapping(noDefault, "y")).toBe(null);
  });

  it("returns null for empty/missing rules", () => {
    expect(resolveClassMapping([], "x")).toBe(null);
    expect(resolveClassMapping(undefined, "x")).toBe(null);
  });

  it("prefers explicit rules over the default", () => {
    // Default rule first in the list shouldn't intercept exact matches.
    const reordered: readonly ClassMappingRule[] = [
      {
        input_pattern: CLASS_MAPPING_DEFAULT_PATTERN,
        canonical_class_code: "DEFAULT",
      },
      { input_pattern: "meridian cafe", canonical_class_code: "c101" },
    ];
    expect(resolveClassMapping(reordered, "meridian cafe")).toBe("c101");
    expect(resolveClassMapping(reordered, "unknown")).toBe("DEFAULT");
  });
});

describe("Dimension subtypes — DEFAULT_DIMENSION_TYPE", () => {
  it("is 'standard' (the safer migration default)", () => {
    // Standard is the safer default because most legacy dimensions
    // ARE plain variables. Misclassifying a geographic / classification
    // dim as standard means it opens a plain editor; doesn't break.
    expect(DEFAULT_DIMENSION_TYPE).toBe("standard");
  });
});

describe("Dimension subtypes — CLASS_MAPPING_DEFAULT_PATTERN", () => {
  it("is the literal '__default__' sentinel", () => {
    expect(CLASS_MAPPING_DEFAULT_PATTERN).toBe("__default__");
  });
});

// ============================================================================
// Dimension shape tests
// ============================================================================

describe("Dimension v2 (26.P0) — DEFAULT_DIMENSION_SHAPE", () => {
  it("is 'categorical'", () => {
    expect(DEFAULT_DIMENSION_SHAPE).toBe("categorical");
  });
});

describe("Dimension v2 (26.P0) — inferDimensionShape", () => {
  it("returns the explicit shape when set", () => {
    expect(inferDimensionShape({ shape: "banded" })).toBe("banded");
    expect(inferDimensionShape({ shape: "geographic" })).toBe("geographic");
    expect(inferDimensionShape({ shape: "categorical" })).toBe("categorical");
  });

  it("infers geographic from dimension_type", () => {
    expect(inferDimensionShape({ dimension_type: "geographic" })).toBe(
      "geographic",
    );
  });

  it("infers categorical from classification dimension_type", () => {
    expect(inferDimensionShape({ dimension_type: "classification" })).toBe(
      "categorical",
    );
  });

  it("defaults to categorical for standard / missing", () => {
    expect(inferDimensionShape({ dimension_type: "standard" })).toBe(
      "categorical",
    );
    expect(inferDimensionShape({})).toBe("categorical");
  });

  it("explicit shape wins over dimension_type", () => {
    // A future "rebanded classification" is bizarre but the explicit
    // shape wins so the engine doesn't silently disagree with the UI.
    expect(
      inferDimensionShape({ shape: "banded", dimension_type: "classification" }),
    ).toBe("banded");
  });
});

describe("Dimension v2 (26.P0) — isBandedDimension / isCategoricalDimension", () => {
  it("isBandedDimension returns true only for banded", () => {
    expect(isBandedDimension({ shape: "banded" })).toBe(true);
    expect(isBandedDimension({ shape: "categorical" })).toBe(false);
    expect(isBandedDimension({})).toBe(false);
  });

  it("isCategoricalDimension returns true for categorical + default", () => {
    expect(isCategoricalDimension({ shape: "categorical" })).toBe(true);
    expect(isCategoricalDimension({})).toBe(true);
    expect(isCategoricalDimension({ shape: "banded" })).toBe(false);
    expect(isCategoricalDimension({ shape: "geographic" })).toBe(false);
  });
});

describe("Dimension v2 (26.P0) — validateBandedLevels", () => {
  const goodBands: readonly DimensionLevel[] = [
    { kind: "banded", id: "L1", label: "New", lo: 0, hi: 5 },
    { kind: "banded", id: "L2", label: "Modern", lo: 5, hi: 15 },
    { kind: "banded", id: "L3", label: "Older", lo: 15, hi: 50 },
  ];

  it("returns null for a valid contiguous list", () => {
    expect(validateBandedLevels(goodBands)).toBeNull();
  });

  it("flags empty list", () => {
    expect(validateBandedLevels([])).toMatch(/at least one band/i);
  });

  it("flags non-banded level mixed in", () => {
    const bad: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: 5 },
      { kind: "categorical", id: "X", label: "x", aliases: [] },
    ];
    expect(validateBandedLevels(bad)).toMatch(/expected kind 'banded'/);
  });

  it("flags reversed or zero-width band", () => {
    const reversed: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "rev", lo: 10, hi: 5 },
    ];
    expect(validateBandedLevels(reversed)).toMatch(
      /strictly less than/,
    );
  });

  it("flags gap between adjacent bands", () => {
    const gapped: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: 5 },
      // Gap: hi=5 ≠ lo=10
      { kind: "banded", id: "L2", label: "b", lo: 10, hi: 20 },
    ];
    expect(validateBandedLevels(gapped)).toMatch(/gap or overlap/);
  });

  it("flags overlap between adjacent bands", () => {
    const overlapping: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: 10 },
      { kind: "banded", id: "L2", label: "b", lo: 5, hi: 20 },
    ];
    expect(validateBandedLevels(overlapping)).toMatch(/gap or overlap/);
  });

  it("allows -Infinity on the first band only", () => {
    const ok: readonly DimensionLevel[] = [
      {
        kind: "banded",
        id: "L1",
        label: "open",
        lo: Number.NEGATIVE_INFINITY,
        hi: 5,
      },
      { kind: "banded", id: "L2", label: "b", lo: 5, hi: 10 },
    ];
    expect(validateBandedLevels(ok)).toBeNull();

    const bad: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: 5 },
      {
        kind: "banded",
        id: "L2",
        label: "open-mid",
        lo: Number.NEGATIVE_INFINITY,
        hi: 10,
      },
    ];
    expect(validateBandedLevels(bad)).toMatch(/open lower bound/);
  });

  // Platform-test finding E5 — levels persisted through levels_json
  // carry null for open ends (JSON has no Infinity). The validator +
  // resolver must treat null exactly like the matching infinity.
  it("accepts null open ends at the tails and resolves through them (E5)", () => {
    const nullEnds: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "low", lo: null, hi: 5 },
      { kind: "banded", id: "L2", label: "mid", lo: 5, hi: 10 },
      { kind: "banded", id: "L3", label: "top", lo: 10, hi: null },
    ];
    expect(validateBandedLevels(nullEnds)).toBeNull();
    expect(resolveBandedLevel(nullEnds, -1_000_000)).toBe("L1");
    expect(resolveBandedLevel(nullEnds, 7)).toBe("L2");
    expect(resolveBandedLevel(nullEnds, 1_000_000)).toBe("L3");
  });

  it("rejects a null open end that is not at its tail (E5)", () => {
    const midNullHi: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: null },
      { kind: "banded", id: "L2", label: "b", lo: 5, hi: 10 },
    ];
    expect(validateBandedLevels(midNullHi)).toMatch(/open upper bound/);

    const midNullLo: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: 5 },
      { kind: "banded", id: "L2", label: "b", lo: null, hi: 10 },
    ];
    expect(validateBandedLevels(midNullLo)).toMatch(/open lower bound/);
  });

  it("allows +Infinity on the last band only", () => {
    const ok: readonly DimensionLevel[] = [
      { kind: "banded", id: "L1", label: "a", lo: 0, hi: 5 },
      {
        kind: "banded",
        id: "L2",
        label: "open-end",
        lo: 5,
        hi: Number.POSITIVE_INFINITY,
      },
    ];
    expect(validateBandedLevels(ok)).toBeNull();

    const bad: readonly DimensionLevel[] = [
      {
        kind: "banded",
        id: "L1",
        label: "open-mid",
        lo: 0,
        hi: Number.POSITIVE_INFINITY,
      },
      { kind: "banded", id: "L2", label: "b", lo: 5, hi: 10 },
    ];
    // Two issues: open mid + gap. validateBandedLevels returns the
    // first encountered — gap-or-overlap fires first because
    // adjacency is checked before the +Infinity position rule on
    // non-last bands. Both are detectable; the user fixes one then
    // re-validates. We just assert _something_ is reported.
    expect(validateBandedLevels(bad)).not.toBeNull();
  });
});

describe("Dimension v2 (26.P0) — deriveBandsFromBreakpoints", () => {
  it("produces N-1 bands from N breakpoints", () => {
    const bands = deriveBandsFromBreakpoints([0, 5, 15, 30, 50]);
    expect(bands).toHaveLength(4);
    expect(bands[0]).toMatchObject({ lo: 0, hi: 5 });
    expect(bands[1]).toMatchObject({ lo: 5, hi: 15 });
    expect(bands[3]).toMatchObject({ lo: 30, hi: 50 });
  });

  it("auto-labels with em-dash", () => {
    const bands = deriveBandsFromBreakpoints([0, 5, 15]);
    expect(bands[0]!.label).toBe("0–5");
    expect(bands[1]!.label).toBe("5–15");
  });

  it("accepts custom labels", () => {
    const bands = deriveBandsFromBreakpoints(
      [0, 5, 15],
      ["New", "Modern"],
    );
    expect(bands[0]!.label).toBe("New");
    expect(bands[1]!.label).toBe("Modern");
  });

  it("falls back to auto-label for empty custom labels", () => {
    const bands = deriveBandsFromBreakpoints([0, 5, 15], ["New", ""]);
    expect(bands[0]!.label).toBe("New");
    expect(bands[1]!.label).toBe("5–15");
  });

  it("renders ±∞ in labels for open ends", () => {
    const bands = deriveBandsFromBreakpoints([
      Number.NEGATIVE_INFINITY,
      0,
      50,
      Number.POSITIVE_INFINITY,
    ]);
    expect(bands[0]!.label).toBe("−∞–0");
    expect(bands[2]!.label).toBe("50–+∞");
  });

  it("produces stable ids based on bounds (relabel-safe)", () => {
    const a = deriveBandsFromBreakpoints([0, 5, 15]);
    const b = deriveBandsFromBreakpoints([0, 5, 15], ["x", "y"]);
    expect(a[0]!.id).toBe(b[0]!.id);
    expect(a[1]!.id).toBe(b[1]!.id);
  });

  it("throws for less than 2 breakpoints", () => {
    expect(() => deriveBandsFromBreakpoints([0])).toThrow(/≥ 2 breakpoints/);
    expect(() => deriveBandsFromBreakpoints([])).toThrow(/≥ 2 breakpoints/);
  });

  it("throws for non-ascending breakpoints", () => {
    expect(() => deriveBandsFromBreakpoints([0, 5, 3])).toThrow(
      /strictly ascending/,
    );
    expect(() => deriveBandsFromBreakpoints([0, 5, 5])).toThrow(
      /strictly ascending/,
    );
  });

  it("derived bands validate", () => {
    const bands = deriveBandsFromBreakpoints([0, 5, 15, 30, 50]);
    expect(validateBandedLevels(bands)).toBeNull();
  });
});

describe("Dimension v2 (26.P0) — resolveBandedLevel", () => {
  const bands: readonly DimensionLevel[] = [
    { kind: "banded", id: "L1", label: "New", lo: 0, hi: 5 },
    { kind: "banded", id: "L2", label: "Modern", lo: 5, hi: 15 },
    {
      kind: "banded",
      id: "L3",
      label: "Vintage",
      lo: 50,
      hi: Number.POSITIVE_INFINITY,
    },
  ];

  it("resolves values inside a band", () => {
    expect(resolveBandedLevel(bands, 2)).toBe("L1");
    expect(resolveBandedLevel(bands, 4.99)).toBe("L1");
    expect(resolveBandedLevel(bands, 5)).toBe("L2");
    expect(resolveBandedLevel(bands, 14.99)).toBe("L2");
  });

  it("uses half-open [lo, hi) — boundary belongs to upper band", () => {
    // 5 belongs to L2 (lo=5), not L1 (hi=5).
    expect(resolveBandedLevel(bands, 5)).toBe("L2");
  });

  it("resolves +Infinity upper band", () => {
    expect(resolveBandedLevel(bands, 100)).toBe("L3");
    expect(resolveBandedLevel(bands, 1_000_000)).toBe("L3");
  });

  it("returns null for gap (15..50 in this list)", () => {
    expect(resolveBandedLevel(bands, 20)).toBeNull();
  });

  it("ignores non-banded levels", () => {
    const mixed: readonly DimensionLevel[] = [
      ...bands,
      { kind: "categorical", id: "X", label: "x", aliases: [] },
    ];
    expect(resolveBandedLevel(mixed, 2)).toBe("L1");
  });
});

describe("Dimension v2 (26.P0) — resolveCategoricalLevel", () => {
  const levels: readonly DimensionLevel[] = [
    {
      kind: "categorical",
      id: "c101",
      label: "Meridian Cafe",
      aliases: ["Cafe", "Meridian Cafe", "demo cafe"],
    },
    {
      kind: "categorical",
      id: "c102",
      label: "Meridian Studio",
      aliases: ["Studio", "Meridian Studio", "MS"],
    },
  ];

  it("resolves an exact alias match", () => {
    expect(resolveCategoricalLevel(levels, "Cafe")).toBe("c101");
    expect(resolveCategoricalLevel(levels, "MS")).toBe("c102");
  });

  it("is case-insensitive and trimmed", () => {
    expect(resolveCategoricalLevel(levels, "  ms  ")).toBe("c102");
    expect(resolveCategoricalLevel(levels, "MERIDIAN STUDIO")).toBe("c102");
  });

  it("matches the level's own id as an implicit alias", () => {
    expect(resolveCategoricalLevel(levels, "c101")).toBe("c101");
  });

  it("returns null when no level claims the input", () => {
    expect(resolveCategoricalLevel(levels, "Skydiving")).toBeNull();
  });

  it("ignores non-categorical levels", () => {
    const mixed: readonly DimensionLevel[] = [
      ...levels,
      { kind: "banded", id: "L1", label: "x", lo: 0, hi: 5 },
    ];
    expect(resolveCategoricalLevel(mixed, "Cafe")).toBe("c101");
  });
});

describe("Dimension v2 (26.P0) — Dimension fields are optional + backwards-compat", () => {
  it("a pre-26 dimension without shape/levels remains valid", () => {
    const d: Dimension = {
      id: "construction",
      display_name: "Construction",
      slug: "construction",
      data_type: "enum",
      role: "rating-input",
      options: ["frame", "joisted-masonry", "non-combustible"],
    };
    // Type-check: this assignment must compile (shape/levels optional).
    expect(d.shape).toBeUndefined();
    expect(d.levels).toBeUndefined();
    // Inferred shape via helper.
    expect(inferDimensionShape(d)).toBe("categorical");
  });

  it("a v2 banded dimension carries shape + levels", () => {
    const d: Dimension = {
      id: "building_age",
      display_name: "Building Age",
      slug: "building_age",
      data_type: "number",
      role: "rating-input",
      shape: "banded",
      levels: deriveBandsFromBreakpoints(
        [0, 5, 15, 30, 50, Number.POSITIVE_INFINITY],
        ["New", "Modern", "Standard", "Older", "Vintage"],
      ),
    };
    expect(d.shape).toBe("banded");
    expect(d.levels).toHaveLength(5);
    expect(d.levels![0]).toMatchObject({ kind: "banded", label: "New" });
    expect(isBandedDimension(d)).toBe(true);
  });

  it("PDF reservation fields are optional", () => {
    const d: Dimension = {
      id: "x",
      display_name: "x",
      slug: "x",
      data_type: "string",
      role: "rating-input",
      draft_status: "extracted",
      source_pdf_url: "https://example.com/meridian-demo-circular.pdf",
      source_page: 31,
    };
    expect(d.draft_status).toBe("extracted");
    expect(d.source_page).toBe(31);
  });
});

// ============================================================================
// Composite dimension tests
// ============================================================================

import {
  isCompositeDimension,
  resolveCompositeLevel,
  validateCompositeDimension,
  compositeLevelCount,
  COMPOSITE_LEVEL_SEPARATOR,
} from "./dimension-types";

const buildingAgeDim: Dimension = {
  id: "building_age",
  display_name: "Building Age",
  slug: "building_age",
  data_type: "number",
  role: "rating-input",
  shape: "banded",
  levels: [
    { kind: "banded", id: "band_0_5", label: "New", lo: 0, hi: 5 },
    { kind: "banded", id: "band_5_15", label: "Modern", lo: 5, hi: 15 },
    { kind: "banded", id: "band_15_30", label: "Standard", lo: 15, hi: 30 },
    { kind: "banded", id: "band_30_50", label: "Older", lo: 30, hi: 50 },
    {
      kind: "banded",
      id: "band_50_inf",
      label: "Vintage",
      lo: 50,
      hi: Number.POSITIVE_INFINITY,
    },
  ],
};

const classCodeDim: Dimension = {
  id: "class_code",
  display_name: "Class code",
  slug: "class_code",
  data_type: "string",
  role: "rating-input",
  shape: "categorical",
  levels: [
    {
      kind: "categorical",
      id: "c101",
      label: "Meridian Cafe",
      aliases: ["Cafe", "Meridian Cafe"],
    },
    {
      kind: "categorical",
      id: "c202",
      label: "Meridian Workshop",
      aliases: ["Workshop", "Meridian Workshop"],
    },
    {
      kind: "categorical",
      id: "c102",
      label: "Meridian Studio",
      aliases: ["Studio"],
    },
  ],
};

const compositeDim: Dimension = {
  id: "building_age_x_class",
  display_name: "Building Age × Class",
  slug: "building_age_x_class",
  data_type: "string",
  role: "rating-input",
  shape: "composite",
  axes: ["building_age", "class_code"],
};

const nestedComposite: Dimension = {
  id: "nested",
  display_name: "Nested",
  slug: "nested",
  data_type: "string",
  role: "rating-input",
  shape: "composite",
  axes: ["building_age_x_class", "class_code"],
};

function makeRegistry(...dims: Dimension[]): ReadonlyMap<string, Dimension> {
  return new Map(dims.map((d) => [d.slug, d]));
}

describe("DimensionShape includes composite", () => {
  it("inferDimensionShape returns 'composite' when set explicitly", () => {
    expect(inferDimensionShape(compositeDim)).toBe("composite");
  });

  it("isCompositeDimension returns true only for composite shape", () => {
    expect(isCompositeDimension(compositeDim)).toBe(true);
    expect(isCompositeDimension(buildingAgeDim)).toBe(false);
    expect(isCompositeDimension(classCodeDim)).toBe(false);
    expect(isCompositeDimension({})).toBe(false);
  });

  it("COMPOSITE_LEVEL_SEPARATOR is the mid-dot character", () => {
    expect(COMPOSITE_LEVEL_SEPARATOR).toBe("·");
  });
});

describe("resolveCompositeLevel", () => {
  const registry = makeRegistry(buildingAgeDim, classCodeDim, compositeDim);

  it("resolves both axes + concatenates with mid-dot", () => {
    const result = resolveCompositeLevel(compositeDim, registry, {
      building_age: 17,
      class_code: "Cafe",
    });
    expect(result).toBe("band_15_30·c101");
  });

  it("resolves alias on categorical axis", () => {
    const result = resolveCompositeLevel(compositeDim, registry, {
      building_age: 2,
      class_code: "Workshop", // matches alias
    });
    expect(result).toBe("band_0_5·c202");
  });

  it("returns null when an axis has no input", () => {
    const result = resolveCompositeLevel(compositeDim, registry, {
      building_age: 17,
      // class_code missing
    });
    expect(result).toBeNull();
  });

  it("returns null when an axis input is undefined", () => {
    const result = resolveCompositeLevel(compositeDim, registry, {
      building_age: 17,
      class_code: undefined,
    });
    expect(result).toBeNull();
  });

  it("returns null when banded axis input is non-numeric", () => {
    const result = resolveCompositeLevel(compositeDim, registry, {
      building_age: "abc",
      class_code: "Cafe",
    });
    expect(result).toBeNull();
  });

  it("returns null when an axis input doesn't resolve to a level", () => {
    const result = resolveCompositeLevel(compositeDim, registry, {
      building_age: 17,
      class_code: "Skydiving", // not in any alias list
    });
    expect(result).toBeNull();
  });

  it("returns null when an axis slug references a missing dim", () => {
    const orphanedComposite: Dimension = {
      ...compositeDim,
      axes: ["building_age", "nonexistent_dim"],
    };
    const result = resolveCompositeLevel(orphanedComposite, registry, {
      building_age: 17,
      nonexistent_dim: "anything",
    });
    expect(result).toBeNull();
  });

  it("returns null when an axis itself is composite (v1 nesting blocked)", () => {
    const nestedRegistry = makeRegistry(
      buildingAgeDim,
      classCodeDim,
      compositeDim,
      nestedComposite,
    );
    const result = resolveCompositeLevel(nestedComposite, nestedRegistry, {
      building_age_x_class: "band_15_30·c101",
      class_code: "Cafe",
    });
    expect(result).toBeNull();
  });

  it("returns null when shape is not 'composite'", () => {
    const result = resolveCompositeLevel(
      { shape: "categorical", axes: ["a", "b"] } as unknown as Dimension,
      registry,
      { a: 1, b: 2 },
    );
    expect(result).toBeNull();
  });

  it("returns null when axes has fewer than 2 entries", () => {
    const result = resolveCompositeLevel(
      { shape: "composite", axes: ["building_age"] } as unknown as Dimension,
      registry,
      { building_age: 17 },
    );
    expect(result).toBeNull();
  });

  it("returns null when axes is missing", () => {
    const result = resolveCompositeLevel(
      { shape: "composite" } as unknown as Dimension,
      registry,
      {},
    );
    expect(result).toBeNull();
  });

  it("handles geographic axis by treating input as already-resolved territory id (v1)", () => {
    const geoDim: Dimension = {
      id: "territory",
      display_name: "Territory",
      slug: "territory",
      data_type: "string",
      role: "rating-input",
      shape: "geographic",
      levels: [],
    };
    const composite: Dimension = {
      ...compositeDim,
      axes: ["building_age", "territory"],
    };
    const result = resolveCompositeLevel(
      composite,
      makeRegistry(buildingAgeDim, geoDim),
      { building_age: 17, territory: "WI-001" },
    );
    expect(result).toBe("band_15_30·WI-001");
  });
});

describe("validateCompositeDimension", () => {
  const registry = makeRegistry(buildingAgeDim, classCodeDim, compositeDim);

  it("returns null for a valid composite", () => {
    expect(validateCompositeDimension(compositeDim, registry)).toBeNull();
  });

  it("rejects shape !== 'composite'", () => {
    expect(
      validateCompositeDimension(
        { shape: "categorical", axes: ["a", "b"] } as unknown as Dimension,
        registry,
      ),
    ).toMatch(/shape='composite'/);
  });

  it("rejects fewer than 2 axes", () => {
    expect(
      validateCompositeDimension(
        { shape: "composite", axes: ["building_age"] } as unknown as Dimension,
        registry,
      ),
    ).toMatch(/at least 2 axes/);
  });

  it("rejects missing axes", () => {
    expect(
      validateCompositeDimension(
        { shape: "composite" } as unknown as Dimension,
        registry,
      ),
    ).toMatch(/at least 2 axes/);
  });

  it("rejects duplicate axes", () => {
    expect(
      validateCompositeDimension(
        {
          shape: "composite",
          axes: ["building_age", "building_age"],
        } as unknown as Dimension,
        registry,
      ),
    ).toMatch(/appears more than once/);
  });

  it("rejects axis slug that's not in the registry", () => {
    expect(
      validateCompositeDimension(
        {
          shape: "composite",
          axes: ["building_age", "nonexistent_dim"],
        } as unknown as Dimension,
        registry,
      ),
    ).toMatch(/doesn't exist in this plan/);
  });

  it("rejects nested composite axis (v1)", () => {
    const nestedRegistry = makeRegistry(
      buildingAgeDim,
      classCodeDim,
      compositeDim,
    );
    expect(
      validateCompositeDimension(
        {
          shape: "composite",
          axes: ["building_age_x_class", "class_code"],
        } as unknown as Dimension,
        nestedRegistry,
      ),
    ).toMatch(/Nested composites/);
  });
});

describe("compositeLevelCount", () => {
  const registry = makeRegistry(buildingAgeDim, classCodeDim, compositeDim);

  it("returns the cartesian product of axis level counts", () => {
    expect(compositeLevelCount(compositeDim, registry)).toBe(5 * 3);
  });

  it("returns 0 for non-composite shape", () => {
    expect(
      compositeLevelCount(
        { shape: "categorical", axes: ["a", "b"] } as unknown as Dimension,
        registry,
      ),
    ).toBe(0);
  });

  it("returns 0 for invalid composite (missing axes)", () => {
    expect(
      compositeLevelCount(
        { shape: "composite" } as unknown as Dimension,
        registry,
      ),
    ).toBe(0);
  });

  it("returns 0 for composite with missing axis dim", () => {
    expect(
      compositeLevelCount(
        {
          shape: "composite",
          axes: ["building_age", "nonexistent_dim"],
        } as unknown as Dimension,
        registry,
      ),
    ).toBe(0);
  });

  it("returns 0 when any axis has 0 levels", () => {
    const emptyDim: Dimension = {
      id: "empty",
      display_name: "empty",
      slug: "empty",
      data_type: "string",
      role: "rating-input",
      shape: "categorical",
      levels: [],
    };
    expect(
      compositeLevelCount(
        {
          shape: "composite",
          axes: ["building_age", "empty"],
        } as unknown as Dimension,
        makeRegistry(buildingAgeDim, emptyDim),
      ),
    ).toBe(0);
  });

  it("handles 3-axis composites (product of 3 counts)", () => {
    const thirdDim: Dimension = {
      id: "third",
      display_name: "third",
      slug: "third",
      data_type: "string",
      role: "rating-input",
      shape: "categorical",
      levels: [
        { kind: "categorical", id: "a", label: "a", aliases: [] },
        { kind: "categorical", id: "b", label: "b", aliases: [] },
      ],
    };
    expect(
      compositeLevelCount(
        {
          shape: "composite",
          axes: ["building_age", "class_code", "third"],
        } as unknown as Dimension,
        makeRegistry(buildingAgeDim, classCodeDim, thirdDim),
      ),
    ).toBe(5 * 3 * 2); // 30
  });
});
