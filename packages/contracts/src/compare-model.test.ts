/**
 * compare-model tests (FCA fca-2026-07-25 #24).
 *
 * The fixture reproduces the audited Prairie State scenario
 * (findings 74 + 102): five territories T1–T5 with IDENTICAL factors
 * on both sides, while Buffalo moved T3→T4 and Dodge moved T4→T3 —
 * each county keyed BOTH by name and FIPS (the dual-key county
 * workbook convention). The pre-fix rollup said "unchanged"; the
 * pre-fix detail counted "2 cheaper · 2 costlier" (4 for 2) and
 * headlined "31019". These tests pin the fixed arithmetic:
 * membership is first-class, aliases collapse, names lead.
 */

import { describe, it, expect } from "vitest";

import {
  cellDelta,
  compareFacts,
  coveragePresence,
  membershipDelta,
  pairTables,
  territoryVerdict,
  type CompareDimLike,
  type CompareStageLike,
  type CompareTableLike,
} from "./compare-model";

const T_FACTORS: Record<string, number> = {
  T1: 0.9,
  T2: 0.95,
  T3: 1.0,
  T4: 1.1,
  T5: 1.2,
};

function geoDim(assign: Readonly<Record<string, string>>): CompareDimLike {
  const members = new Map<string, string[]>();
  for (const [member, territory] of Object.entries(assign)) {
    const list = members.get(territory);
    if (list === undefined) members.set(territory, [member]);
    else list.push(member);
  }
  return {
    slug: "territory",
    display_name: "Territory factor",
    dimension_type: "geographic",
    geo_territories: [...members.entries()].map(([id, m]) => ({
      id,
      label: id,
      members: m,
    })),
    levels: [],
  };
}

const table = (cells: Record<string, number>): CompareTableLike => ({
  table_id: "ft_terr",
  slug: "territory_factor",
  display_name: "Territory factor",
  cells,
});

// Both counties dual-keyed: name + FIPS. Custer stays put (control).
const A_ASSIGN = {
  Buffalo: "T3",
  "31019": "T3",
  Dodge: "T4",
  "31053": "T4",
  Custer: "T5",
  "31041": "T5",
};
const B_ASSIGN = {
  Buffalo: "T4",
  "31019": "T4",
  Dodge: "T3",
  "31053": "T3",
  Custer: "T5",
  "31041": "T5",
};

describe("membershipDelta — the rollup's missing fact (findings 74/102)", () => {
  it("counts TWO reassigned counties (not four), names leading", () => {
    const delta = membershipDelta(geoDim(A_ASSIGN), geoDim(B_ASSIGN));
    expect(delta).not.toBeNull();
    expect(delta!.rawMovedCount).toBe(4); // the honest pre-collapse figure
    expect(delta!.reassigned).toHaveLength(2);
    expect(delta!.reassigned.map((r) => r.member)).toEqual([
      "Buffalo",
      "Dodge",
    ]);
    expect(delta!.reassigned[0]).toEqual({
      member: "Buffalo",
      fromTerritory: "T3",
      toTerritory: "T4",
    });
  });

  it("single-shape member sets (ZIP grain) never collapse", () => {
    const a = geoDim({ "68510": "T1", "68512": "T1", "68516": "T2" });
    const b = geoDim({ "68510": "T2", "68512": "T2", "68516": "T2" });
    const delta = membershipDelta(a, b);
    expect(delta!.reassigned).toHaveLength(2);
    expect(delta!.reassigned.map((r) => r.member).sort()).toEqual([
      "68510",
      "68512",
    ]);
  });

  it("a dual-keyed group with a single-keyed straggler counts max(shapes)", () => {
    // Buffalo dual-keyed, 31049 (Custer's FIPS) single-keyed — both
    // T3→T4: three raw movers, two real counties.
    const a = geoDim({ Buffalo: "T3", "31019": "T3", "31049": "T3" });
    const b = geoDim({ Buffalo: "T4", "31019": "T4", "31049": "T4" });
    const delta = membershipDelta(a, b);
    expect(delta!.rawMovedCount).toBe(3);
    expect(delta!.reassigned).toHaveLength(2);
    // The name leads. WHICH digit key fills the second slot is
    // arbitrary — the plan carries no name↔FIPS link — so the
    // contract pins the count and the name, not the digit pick.
    const members = delta!.reassigned.map((r) => r.member);
    expect(members).toContain("Buffalo");
    expect(members.filter((m) => /^\d+$/.test(m))).toHaveLength(1);
  });

  it("null when either side has no grouping", () => {
    expect(membershipDelta(geoDim({}), geoDim(A_ASSIGN))).toBeNull();
  });
});

describe("territoryVerdict — canonical member counts (finding 102's 4-for-2)", () => {
  it("audit scenario: identical factors, two moves → 1 cheaper · 1 costlier, Buffalo headlined", () => {
    const v = territoryVerdict(
      geoDim(A_ASSIGN),
      table(T_FACTORS),
      geoDim(B_ASSIGN),
      table(T_FACTORS),
    );
    expect(v).not.toBeNull();
    // 3 real counties (6 raw keys) shared.
    expect(v!.shared).toBe(3);
    expect(v!.identical).toBe(1); // Custer
    expect(v!.cheaperInB).toBe(1); // Dodge T4→T3 (1.10→1.00)
    expect(v!.costlierInB).toBe(1); // Buffalo T3→T4 (1.00→1.10)
    expect(v!.reassigned.map((r) => r.member)).toEqual(["Buffalo", "Dodge"]);
    // The headline mover is the NAME key, never its FIPS twin.
    expect(v!.largest!.member).toBe("Buffalo");
    expect(v!.largest!.from).toBeCloseTo(1.0, 9);
    expect(v!.largest!.to).toBeCloseTo(1.1, 9);
    expect(v!.largest!.pct).toBeCloseTo(10, 6);
  });

  it("a factor change without membership change still counts once per county", () => {
    const bTable = table({ ...T_FACTORS, T5: 1.3 }); // Custer's territory
    const v = territoryVerdict(
      geoDim(A_ASSIGN),
      table(T_FACTORS),
      geoDim(A_ASSIGN),
      bTable,
    );
    expect(v!.costlierInB).toBe(1); // Custer once, not twice
    expect(v!.reassigned).toHaveLength(0);
    expect(v!.largest!.member).toBe("Custer");
  });
});

describe("coveragePresence — retired towers surface (finding 76)", () => {
  const chainStage = (
    id: string,
    chains: { name?: string; coverage_value?: string; output_field?: string }[],
  ): CompareStageLike => ({
    stage_id: id,
    stage_kind: "multiplicative_chain",
    config_json: { chains },
  });

  it("a tower present only in A is enumerated by label", () => {
    const aStages = [
      chainStage("s1", [
        { name: "GL premium", coverage_value: "gl", output_field: "gl_premium" },
        {
          name: "PSM-GL-407 tools endorsement",
          coverage_value: "tools",
          output_field: "tools_premium",
        },
      ]),
    ];
    const bStages = [
      chainStage("s1", [
        { name: "GL premium", coverage_value: "gl", output_field: "gl_premium" },
      ]),
    ];
    const presence = coveragePresence(aStages, bStages);
    expect(presence.onlyA).toEqual(["PSM-GL-407 tools endorsement"]);
    expect(presence.onlyB).toEqual([]);
  });

  it("identical chain sets → empty on both sides; non-chain stages ignored", () => {
    const stages = [
      chainStage("s1", [{ name: "GL", coverage_value: "gl" }]),
      { stage_id: "g", stage_kind: "eligibility_gate", config_json: {} },
    ];
    const presence = coveragePresence(stages, stages);
    expect(presence.onlyA).toEqual([]);
    expect(presence.onlyB).toEqual([]);
  });
});

describe("compareFacts — the committee rollup (finding 74's false negative)", () => {
  it("identical cells + moved members → territoryReassignments populated, tables unchanged", () => {
    const facts = compareFacts(
      [geoDim(A_ASSIGN)],
      [table(T_FACTORS)],
      [geoDim(B_ASSIGN)],
      [table(T_FACTORS)],
    );
    // The factor table genuinely didn't change…
    expect(facts.changedTables).toBe(0);
    // …but the rollup now carries the assignment fact first-class.
    expect(facts.territoryReassignments).toHaveLength(1);
    const t = facts.territoryReassignments[0]!;
    expect(t.dim).toBe("Territory factor");
    expect(t.count).toBe(2);
    expect(t.moves.map((m) => m.member)).toEqual(["Buffalo", "Dodge"]);
  });

  it("carries coverage presence when stages are supplied", () => {
    const aStages: CompareStageLike[] = [
      {
        stage_id: "s1",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [{ name: "Tools", coverage_value: "tools" }],
        },
      },
    ];
    const facts = compareFacts([], [], [], [], aStages, []);
    expect(facts.onlyACoverages).toEqual(["Tools"]);
    expect(facts.onlyBCoverages).toEqual([]);
  });

  it("ported basics: pairing by slug, cell deltas, level joins/leaves", () => {
    const a = [table({ T1: 1.0 })];
    const b = [table({ T1: 1.05 })];
    const facts = compareFacts([], a, [], b);
    expect(facts.sharedTables).toBe(1);
    expect(facts.changedTables).toBe(1);
    expect(facts.biggest).toMatchObject({ key: "T1", from: 1.0, to: 1.05 });

    const { pairs } = pairTables(a, b);
    expect(pairs).toHaveLength(1);
    expect(cellDelta(a[0]!.cells, b[0]!.cells).changed).toBe(1);
  });
});
