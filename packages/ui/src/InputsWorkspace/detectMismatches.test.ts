/**
 * detectMismatches + alias-write-back tests — Brief 38 PR 38.4.
 *
 * Covers:
 *   - Categorical detection (id/label/alias resolution + soft/hard)
 *   - Banded detection (numeric range membership + nearest-band suggestion)
 *   - alias_overrides precedence
 *   - applyAliasOverride / removeAliasOverride immutability
 *   - appendDimAlias idempotence (no double-append)
 *   - hasHardMismatch + mismatchedInputIds projections
 *   - Brief 38 J2 user journey end-to-end (WOOD → Frame)
 */

import { describe, it, expect } from "vitest";
import type { Dimension } from "@openrater/contracts";

import {
  appendDimAlias,
  applyAliasOverride,
  detectMismatches,
  hasHardMismatch,
  mismatchedInputIds,
  removeAliasOverride,
  type AliasOverrides,
} from "./detectMismatches";
import type { RequiredInputEntry } from "./ColumnMappingTable";

// ─────────────────────────────────────────────────────────────────
// Fixtures
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
      aliases: ["wood frame", "lumber"],
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
    {
      kind: "banded",
      id: "30_plus",
      label: "30+ yrs",
      lo: 30,
      hi: Number.POSITIVE_INFINITY,
    },
  ],
};

const ALL_DIMS = [constructionDim, buildingAgeDim] as const;

const CONSTRUCTION_INPUT: RequiredInputEntry = {
  id: "construction",
  name: "construction",
  category: "dimensions",
  dimSlug: "construction",
};

const BUILDING_AGE_INPUT: RequiredInputEntry = {
  id: "building_age",
  name: "building_age",
  category: "dimensions",
  dimSlug: "building_age",
};

// ─────────────────────────────────────────────────────────────────
// detectMismatches — categorical happy path
// ─────────────────────────────────────────────────────────────────

describe("detectMismatches — categorical", () => {
  it("returns empty array when every value resolves to a dim level", () => {
    const rows = [
      { CONSTR: "Frame" },
      { CONSTR: "Masonry" },
      { CONSTR: "frame" }, // case-insensitive id match
      { CONSTR: "BRICK" }, // alias
    ];
    const mismatches = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
    );
    expect(mismatches).toEqual([]);
  });

  it("flags a single unknown value as a mismatch", () => {
    const rows = [
      { CONSTR: "Frame" },
      { CONSTR: "WOOD" }, // not a known alias
      { CONSTR: "Frame" },
    ];
    const mismatches = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
    );
    expect(mismatches).toHaveLength(1);
    const m = mismatches[0]!;
    expect(m.inputId).toBe("construction");
    expect(m.dimSlug).toBe("construction");
    expect(m.columnName).toBe("CONSTR");
    expect(m.dimShape).toBe("categorical");
    expect(m.mismatchedValues).toHaveLength(1);
    expect(m.mismatchedValues[0]?.value).toBe("WOOD");
    expect(m.mismatchedValues[0]?.rowCount).toBe(1);
  });

  it("counts rows per distinct mismatched value + sorts by count desc", () => {
    const rows = [
      { CONSTR: "WOOD" },
      { CONSTR: "WOOD" },
      { CONSTR: "WOOD" },
      { CONSTR: "GARBAGE" },
    ];
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
    )[0]!;
    expect(m.mismatchedValues).toHaveLength(2);
    expect(m.mismatchedValues[0]?.value).toBe("WOOD");
    expect(m.mismatchedValues[0]?.rowCount).toBe(3);
    expect(m.mismatchedValues[1]?.value).toBe("GARBAGE");
    expect(m.mismatchedValues[1]?.rowCount).toBe(1);
  });

  it("ignores null + empty values when counting mismatches", () => {
    const rows = [
      { CONSTR: "Frame" },
      { CONSTR: "" },
      { CONSTR: null },
      { CONSTR: undefined },
    ];
    const mismatches = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
    );
    expect(mismatches).toEqual([]);
  });

  it("respects maxSampleRows cap (only inspects first N rows)", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      CONSTR: i < 5 ? "WOOD" : "Frame",
    }));
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
      undefined,
      { maxSampleRows: 100 },
    )[0]!;
    // First 5 rows are "WOOD"; rest are Frame within the 100-row
    // window. So rowCount === 5.
    expect(m.mismatchedValues[0]?.rowCount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────
// detectMismatches — severity
// ─────────────────────────────────────────────────────────────────

describe("detectMismatches — severity", () => {
  it("scores 'wood' against 'Frame' (similar) as SOFT", () => {
    // "wood" vs "Frame" — Levenshtein normalized similarity is ~0.4;
    // but vs "lumber" (a Frame alias) it's higher. The closest match
    // for "wood" is "wood frame" (an alias) → similarity ~0.4-0.5.
    // Adjust softThreshold so this test is deterministic.
    const rows = [{ CONSTR: "wood" }];
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
      undefined,
      { softThreshold: 0.3 }, // intentionally low so "wood" qualifies
    )[0]!;
    expect(m.severity).toBe("soft");
    expect(m.mismatchedValues[0]?.suggestions.length).toBeGreaterThan(0);
    expect(m.mismatchedValues[0]?.suggestions[0]?.label).toBe("Frame");
  });

  it("flags totally-disjoint values as HARD", () => {
    const rows = [{ CONSTR: "xyzpqrstuvw" }];
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
    )[0]!;
    expect(m.severity).toBe("hard");
  });

  it("HARD overrides SOFT — one bad value taints the whole mismatch", () => {
    const rows = [
      { CONSTR: "frame_typo" }, // similar to Frame → SOFT
      { CONSTR: "xyzpqrstuvw" }, // disjoint → HARD
    ];
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
    )[0]!;
    expect(m.severity).toBe("hard");
  });
});

// ─────────────────────────────────────────────────────────────────
// detectMismatches — banded
// ─────────────────────────────────────────────────────────────────

describe("detectMismatches — banded", () => {
  it("returns empty when all numeric values fit some band", () => {
    const rows = [
      { BUILT: 3 }, // in [0, 5)
      { BUILT: 8 }, // in [5, 15)
      { BUILT: 25 }, // in [15, 30)
      { BUILT: 100 }, // in [30, +Inf)
    ];
    const mismatches = detectMismatches(
      [BUILDING_AGE_INPUT],
      { building_age: "BUILT" },
      rows,
      ALL_DIMS,
    );
    expect(mismatches).toEqual([]);
  });

  it("flags numeric values outside all bands (negative)", () => {
    const rows = [
      { BUILT: 3 },
      { BUILT: -5 }, // out of range
      { BUILT: -5 },
    ];
    const m = detectMismatches(
      [BUILDING_AGE_INPUT],
      { building_age: "BUILT" },
      rows,
      ALL_DIMS,
    )[0]!;
    expect(m.dimShape).toBe("banded");
    expect(m.mismatchedValues).toHaveLength(1);
    expect(m.mismatchedValues[0]?.value).toBe("-5");
    expect(m.mismatchedValues[0]?.rowCount).toBe(2);
    // Suggestion: nearest band (0_5 at distance 5).
    expect(m.mismatchedValues[0]?.suggestions[0]?.canonicalLevelId).toBe("0_5");
  });

  it("treats non-numeric strings in a banded column as HARD mismatches", () => {
    const rows = [{ BUILT: "not_a_number" }];
    const m = detectMismatches(
      [BUILDING_AGE_INPUT],
      { building_age: "BUILT" },
      rows,
      ALL_DIMS,
    )[0]!;
    expect(m.severity).toBe("hard");
    expect(m.mismatchedValues[0]?.suggestions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// detectMismatches — derived ratio (@ratio:num/den) — Brief 45 K8
// ─────────────────────────────────────────────────────────────────

describe("detectMismatches — derived ratio mappings", () => {
  it("skips inputs whose mapping is a @ratio: sentinel (no mismatch produced)", () => {
    // The banded `building_age` input is driven by a ratio. The raw
    // component columns (total_expenses=750000, revenue=1000000) would
    // never fit a [0,30) age band, but because the mapping is a ratio
    // assertion, detection must skip it entirely.
    const rows = [
      { total_expenses: 750000, revenue: 1000000 },
      { total_expenses: 250000, revenue: 1000000 },
    ];
    const mismatches = detectMismatches(
      [BUILDING_AGE_INPUT],
      { building_age: "@ratio:total_expenses/revenue" },
      rows,
      ALL_DIMS,
    );
    expect(mismatches).toEqual([]);
  });

  it("does not attempt to read a row column named like the sentinel", () => {
    // Even if a row literally had a "@ratio:…" key, the input must be
    // skipped before any row lookup — proving we never index by it.
    const rows = [
      { "@ratio:total_expenses/revenue": "not_a_band_value" } as Record<
        string,
        unknown
      >,
    ];
    const mismatches = detectMismatches(
      [BUILDING_AGE_INPUT],
      { building_age: "@ratio:total_expenses/revenue" },
      rows,
      ALL_DIMS,
    );
    expect(mismatches).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// detectMismatches — alias_overrides precedence
// ─────────────────────────────────────────────────────────────────

describe("detectMismatches — alias_overrides precedence", () => {
  it("alias_overrides resolve a value that would otherwise be a mismatch", () => {
    const overrides: AliasOverrides = {
      construction: { WOOD: "frame" },
    };
    const rows = [{ CONSTR: "WOOD" }, { CONSTR: "Frame" }];
    const mismatches = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
      overrides,
    );
    expect(mismatches).toEqual([]);
  });

  it("alias_overrides for a non-existent level are ignored (defensive)", () => {
    const overrides: AliasOverrides = {
      construction: { WOOD: "made_up_level_id" },
    };
    const rows = [{ CONSTR: "WOOD" }];
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
      overrides,
    )[0]!;
    expect(m).toBeDefined();
    expect(m.mismatchedValues[0]?.value).toBe("WOOD");
  });
});

// ─────────────────────────────────────────────────────────────────
// detectMismatches — skipped shapes + edge cases
// ─────────────────────────────────────────────────────────────────

describe("detectMismatches — edge cases", () => {
  it("skips inputs without a dimSlug", () => {
    const input: RequiredInputEntry = {
      id: "tiv",
      name: "tiv",
      category: "inputs",
      // no dimSlug
    };
    const m = detectMismatches(
      [input],
      { tiv: "TIV_USD" },
      [{ TIV_USD: 1000 }],
      ALL_DIMS,
    );
    expect(m).toEqual([]);
  });

  it("skips inputs whose column isn't mapped", () => {
    const m = detectMismatches(
      [CONSTRUCTION_INPUT],
      {}, // empty column map
      [{ CONSTR: "WOOD" }],
      ALL_DIMS,
    );
    expect(m).toEqual([]);
  });

  it("skips inputs whose dim isn't in the dimensions list", () => {
    const input: RequiredInputEntry = {
      id: "x",
      name: "x",
      category: "dimensions",
      dimSlug: "unknown_dim",
    };
    const m = detectMismatches(
      [input],
      { x: "X" },
      [{ X: "anything" }],
      ALL_DIMS,
    );
    expect(m).toEqual([]);
  });

  it("validates geographic dims against the canonical acceptance domain (ADR-0038, the F3 fix)", () => {
    // The KS cold-test shape: ZIP levels rolled into territories t1/t2.
    // NOTE the live-bug `shape: "categorical"` — inferDimensionShape still
    // routes it as geographic (the misroute is exactly what F3 was). The
    // acceptance domain = the ZIPs ∪ the active territory ids, so a policy
    // CSV carrying EITHER the territory (t1/t2) OR a raw ZIP resolves with
    // no mismatch — zero "add custom level" workaround.
    const geoDim: Dimension = {
      id: "zip", // identity frozen to granularity (the leak; fixed in P3/P4)
      slug: "zip",
      display_name: "Territory",
      data_type: "string",
      role: "rating-input",
      dimension_type: "geographic",
      shape: "categorical",
      levels: [
        { kind: "categorical", id: "66101", label: "KC 66101", aliases: [] },
        { kind: "categorical", id: "67201", label: "Wichita 67201", aliases: [] },
      ],
      geo_territories: [
        { id: "t1", label: "Kansas City metro", members: ["66101"] },
        { id: "t2", label: "Rest of state", members: ["67201"] },
      ],
    };
    const input: RequiredInputEntry = {
      id: "territory",
      name: "territory",
      category: "dimensions",
      dimSlug: "zip",
    };
    // Territory ids (t1/t2) AND a raw ZIP (66101) all resolve → NO mismatch,
    // NO "not in the dim's levels — Score blocked".
    expect(
      detectMismatches(
        [input],
        { territory: "TERR" },
        [{ TERR: "t1" }, { TERR: "t2" }, { TERR: "66101" }],
        [geoDim],
      ),
    ).toEqual([]);

    // A value in no territory + no level → a SOFT (non-blocking) mismatch: it
    // scores at the lookup's 1.0 default (ADR-0028 "surface, don't silently
    // 1.0"); it must NOT hard-block the batch.
    const bad = detectMismatches(
      [input],
      { territory: "TERR" },
      [{ TERR: "99999" }],
      [geoDim],
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]?.dimShape).toBe("geographic");
    expect(bad[0]?.severity).toBe("soft");
    expect(hasHardMismatch(bad)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// alias-write-back helpers
// ─────────────────────────────────────────────────────────────────

describe("applyAliasOverride", () => {
  it("creates a new override on an empty input", () => {
    const out = applyAliasOverride({}, "construction", "WOOD", "frame");
    expect(out).toEqual({ construction: { WOOD: "frame" } });
  });

  it("appends to an existing dim's overrides", () => {
    const input: AliasOverrides = {
      construction: { WOOD: "frame" },
    };
    const out = applyAliasOverride(input, "construction", "BRICK", "masonry");
    expect(out).toEqual({
      construction: { WOOD: "frame", BRICK: "masonry" },
    });
  });

  it("does not mutate the input (immutable)", () => {
    const input: AliasOverrides = { construction: { WOOD: "frame" } };
    applyAliasOverride(input, "construction", "BRICK", "masonry");
    expect(input).toEqual({ construction: { WOOD: "frame" } });
  });

  it("preserves other dims' overrides untouched", () => {
    const input: AliasOverrides = {
      construction: { WOOD: "frame" },
      quality_grade: { raw_q1: "q1" },
    };
    const out = applyAliasOverride(input, "construction", "BRICK", "masonry");
    expect(out.quality_grade).toBe(input.quality_grade);
  });
});

describe("removeAliasOverride", () => {
  it("removes one entry, leaving siblings intact", () => {
    const input: AliasOverrides = {
      construction: { WOOD: "frame", BRICK: "masonry" },
    };
    const out = removeAliasOverride(input, "construction", "WOOD");
    expect(out).toEqual({ construction: { BRICK: "masonry" } });
  });

  it("drops the dim entry entirely when no overrides remain", () => {
    const input: AliasOverrides = {
      construction: { WOOD: "frame" },
    };
    const out = removeAliasOverride(input, "construction", "WOOD");
    expect(out).toEqual({});
  });

  it("returns the same reference when the entry doesn't exist (no-op)", () => {
    const input: AliasOverrides = { construction: { WOOD: "frame" } };
    const out = removeAliasOverride(input, "construction", "NOT_THERE");
    expect(out).toBe(input);
  });
});

describe("appendDimAlias", () => {
  it("appends a new alias to the named level", () => {
    const out = appendDimAlias(constructionDim, "frame", "WOOD");
    const frameLevel = out.levels?.find((l) => l.id === "frame");
    expect(
      frameLevel?.kind === "categorical" ? frameLevel.aliases : [],
    ).toContain("WOOD");
  });

  it("returns the SAME dim reference when alias already present (case-insensitive)", () => {
    const out = appendDimAlias(constructionDim, "frame", "wood frame");
    expect(out).toBe(constructionDim);
    // Different casing also matches.
    expect(appendDimAlias(constructionDim, "frame", "WOOD FRAME")).toBe(
      constructionDim,
    );
  });

  it("returns the SAME dim reference when the alias equals the level id or label", () => {
    expect(appendDimAlias(constructionDim, "frame", "Frame")).toBe(
      constructionDim,
    );
    expect(appendDimAlias(constructionDim, "frame", "FRAME")).toBe(
      constructionDim,
    );
  });

  it("ignores unknown level ids (defensive)", () => {
    const out = appendDimAlias(constructionDim, "made_up_id", "WOOD");
    expect(out).toBe(constructionDim);
  });

  it("does not mutate the input dim", () => {
    const originalLevels = constructionDim.levels;
    appendDimAlias(constructionDim, "frame", "WOOD_NEW");
    expect(constructionDim.levels).toBe(originalLevels);
  });
});

// ─────────────────────────────────────────────────────────────────
// Projections
// ─────────────────────────────────────────────────────────────────

describe("hasHardMismatch + mismatchedInputIds", () => {
  it("hasHardMismatch returns true when any severity is hard", () => {
    const mismatches = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      [{ CONSTR: "totally_random_xyz" }],
      ALL_DIMS,
    );
    expect(hasHardMismatch(mismatches)).toBe(true);
  });

  it("hasHardMismatch returns false on empty + soft-only lists", () => {
    expect(hasHardMismatch([])).toBe(false);
  });

  it("mismatchedInputIds projects to a Set of input.ids", () => {
    const mismatches = detectMismatches(
      [CONSTRUCTION_INPUT, BUILDING_AGE_INPUT],
      { construction: "CONSTR", building_age: "BUILT" },
      [{ CONSTR: "WOOD", BUILT: -5 }],
      ALL_DIMS,
    );
    const ids = mismatchedInputIds(mismatches);
    expect(ids.has("construction")).toBe(true);
    expect(ids.has("building_age")).toBe(true);
    expect(ids.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// Brief 38 J2 end-to-end — WOOD → Frame
// ─────────────────────────────────────────────────────────────────

describe("Brief 38 J2 — WOOD → Frame end-to-end", () => {
  it("detects + suggests + applies + re-detects empty", () => {
    // Step 1: 3 rows with WOOD, 4 with Frame.
    const rows = [
      { CONSTR: "Frame" },
      { CONSTR: "Frame" },
      { CONSTR: "WOOD" },
      { CONSTR: "Frame" },
      { CONSTR: "WOOD" },
      { CONSTR: "Frame" },
      { CONSTR: "WOOD" },
    ];

    // Step 2: detect.
    const initial = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      ALL_DIMS,
      undefined,
      { softThreshold: 0.3 },
    );
    expect(initial).toHaveLength(1);
    const mismatch = initial[0]!;
    expect(mismatch.mismatchedValues[0]?.value).toBe("WOOD");
    expect(mismatch.mismatchedValues[0]?.rowCount).toBe(3);
    expect(mismatch.severity).toBe("soft");
    const top = mismatch.mismatchedValues[0]!.suggestions[0]!;
    expect(top.label).toBe("Frame");

    // Step 3: apply.
    const nextOverrides = applyAliasOverride(
      {},
      mismatch.dimSlug,
      mismatch.mismatchedValues[0]!.value,
      top.canonicalLevelId,
    );
    const nextDim = appendDimAlias(
      constructionDim,
      top.canonicalLevelId,
      mismatch.mismatchedValues[0]!.value,
    );

    // Step 4: re-detect against both the override AND the updated dim.
    const remaining = detectMismatches(
      [CONSTRUCTION_INPUT],
      { construction: "CONSTR" },
      rows,
      [nextDim, buildingAgeDim],
      nextOverrides,
    );
    expect(remaining).toEqual([]);
  });
});
