/**
 * Brief 44 PR 44.2 — geo seed unit tests.
 */
import { describe, it, expect } from "vitest";

import {
  COUNTY_SEED,
  STATE_CODES,
  STATE_LABEL_BY_CODE,
  STATE_SEED,
  getLevelsForScope,
  previewLevelCount,
  resolveScopeStates,
} from "./geoLevelSeeds";

describe("STATE_SEED", () => {
  it("has 51 entries (50 states + DC)", () => {
    expect(STATE_SEED).toHaveLength(51);
  });

  it("every entry is categorical-shape with USPS-style id", () => {
    for (const s of STATE_SEED) {
      expect(s.kind).toBe("categorical");
      expect(s.id).toMatch(/^[A-Z]{2}$/);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    expect(new Set(STATE_CODES).size).toBe(STATE_CODES.length);
  });

  it("includes Wisconsin + DC + the four most-populated states", () => {
    expect(STATE_LABEL_BY_CODE.WI).toBe("Wisconsin");
    expect(STATE_LABEL_BY_CODE.DC).toBe("District of Columbia");
    expect(STATE_LABEL_BY_CODE.CA).toBe("California");
    expect(STATE_LABEL_BY_CODE.TX).toBe("Texas");
    expect(STATE_LABEL_BY_CODE.NY).toBe("New York");
    expect(STATE_LABEL_BY_CODE.FL).toBe("Florida");
  });
});

describe("COUNTY_SEED (v1 = WI only)", () => {
  it("WI has 72 counties (Brief 44 cold-test CT-2)", () => {
    expect(COUNTY_SEED.WI).toBeDefined();
    expect(COUNTY_SEED.WI).toHaveLength(72);
  });

  it("every WI county uses FIPS-5 starting with 55", () => {
    for (const c of COUNTY_SEED.WI!) {
      expect(c.id).toMatch(/^55\d{3}$/);
      expect(c.label).toMatch(/County$/);
    }
  });

  it("Milwaukee + Dane + Brown have well-known FIPS codes", () => {
    const wi = COUNTY_SEED.WI!;
    expect(wi.find((c) => c.id === "55079")?.label).toBe("Milwaukee County");
    expect(wi.find((c) => c.id === "55025")?.label).toBe("Dane County");
    expect(wi.find((c) => c.id === "55009")?.label).toBe("Brown County");
  });

  it("other states are absent (will be empty in v1)", () => {
    expect(COUNTY_SEED.CA).toBeUndefined();
    expect(COUNTY_SEED.NY).toBeUndefined();
  });
});

describe("resolveScopeStates", () => {
  it("national scope returns all 51 codes", () => {
    expect(resolveScopeStates({ kind: "national" })).toEqual(STATE_CODES);
  });

  it("subset scope returns exactly the picked states", () => {
    expect(
      resolveScopeStates({ kind: "subset", states: ["WI", "MN"] }),
    ).toEqual(["WI", "MN"]);
  });
});

describe("getLevelsForScope", () => {
  it("state + WI subset → 1 level (the state itself)", () => {
    const levels = getLevelsForScope("state", {
      kind: "subset",
      states: ["WI"],
    });
    expect(levels).toHaveLength(1);
    expect(levels[0]).toEqual({
      kind: "categorical",
      id: "WI",
      label: "Wisconsin",
    });
  });

  it("state + national → 51 levels", () => {
    const levels = getLevelsForScope("state", { kind: "national" });
    expect(levels).toHaveLength(51);
  });

  it("county + WI subset → 72 levels (WI counties)", () => {
    const levels = getLevelsForScope("county", {
      kind: "subset",
      states: ["WI"],
    });
    expect(levels).toHaveLength(72);
    expect(levels.every((l) => l.id.startsWith("55"))).toBe(true);
  });

  it("county + unbundled state → empty list (escape hatch via Add custom)", () => {
    // v1 ships WI only; CA returns empty.
    const levels = getLevelsForScope("county", {
      kind: "subset",
      states: ["CA"],
    });
    expect(levels).toEqual([]);
  });

  it("county + mixed (WI + CA) → only WI counties surface in v1", () => {
    const levels = getLevelsForScope("county", {
      kind: "subset",
      states: ["WI", "CA"],
    });
    expect(levels).toHaveLength(72);
  });

  it("zip granularity → empty list in v1 (PR 44.4 lazy-loads)", () => {
    const levels = getLevelsForScope("zip", { kind: "national" });
    expect(levels).toEqual([]);
  });

  it("level order is stable regardless of input scope.states order", () => {
    const a = getLevelsForScope("state", {
      kind: "subset",
      states: ["NY", "CA"],
    });
    const b = getLevelsForScope("state", {
      kind: "subset",
      states: ["CA", "NY"],
    });
    expect(a).toEqual(b);
    // Alphabetical-by-code: CA before NY.
    expect(a).toHaveLength(2);
    expect(a[0]?.id).toBe("CA");
    expect(a[1]?.id).toBe("NY");
  });
});

describe("previewLevelCount", () => {
  it("matches getLevelsForScope().length for each granularity", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures span several scope shapes; the second tuple slot is deliberately untyped
    const cases: Array<["state" | "county" | "zip", any]> = [
      ["state", { kind: "national" }],
      ["state", { kind: "subset", states: ["WI", "MN", "IL"] }],
      ["county", { kind: "subset", states: ["WI"] }],
      ["county", { kind: "subset", states: ["WI", "MN"] }],
      ["zip", { kind: "national" }],
    ];
    for (const [g, s] of cases) {
      expect(previewLevelCount(g, s)).toBe(getLevelsForScope(g, s).length);
    }
  });
});
