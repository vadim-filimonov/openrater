/**
 * Brief 44 PR 44.7 — territoryOps pure-function tests.
 */
import { describe, expect, it } from "vitest";
import {
  addLevelToTerritory,
  createTerritory,
  deleteTerritory,
  removeLevelFromTerritory,
  renameTerritory,
  territoryByLevel,
  ungroupedLevelIds,
  type GeoTerritory,
} from "./territoryOps";

const TERRS: readonly GeoTerritory[] = [
  { id: "mke_metro", label: "Milwaukee metro", members: ["55079", "55133"] },
  { id: "mad_metro", label: "Madison metro", members: ["55025"] },
];

describe("addLevelToTerritory", () => {
  it("appends to the target territory's members", () => {
    const out = addLevelToTerritory(TERRS, "55089", "mke_metro");
    expect(out[0]!.members).toContain("55089");
    expect(out[0]!.members).toHaveLength(3);
  });

  it("moves a level when it already belongs to another territory", () => {
    const out = addLevelToTerritory(TERRS, "55079", "mad_metro");
    expect(out[0]!.members).not.toContain("55079"); // removed from MKE
    expect(out[1]!.members).toContain("55079"); // added to MAD
  });

  it("is a no-op when the level is already in the target", () => {
    const out = addLevelToTerritory(TERRS, "55079", "mke_metro");
    expect(out[0]!.members).toEqual(["55079", "55133"]);
  });

  it("is a no-op when the target territory doesn't exist", () => {
    const out = addLevelToTerritory(TERRS, "55001", "missing");
    expect(out).toEqual(TERRS);
  });
});

describe("removeLevelFromTerritory", () => {
  it("removes the level from the target territory", () => {
    const out = removeLevelFromTerritory(TERRS, "55079", "mke_metro");
    expect(out[0]!.members).not.toContain("55079");
  });

  it("is a no-op when the level isn't a member", () => {
    const out = removeLevelFromTerritory(TERRS, "55001", "mke_metro");
    expect(out[0]!.members).toEqual(["55079", "55133"]);
  });
});

describe("createTerritory", () => {
  it("appends a new empty territory with a slug id", () => {
    const { territories, newId } = createTerritory(TERRS, "Northern WI");
    expect(newId).toBe("northern_wi");
    expect(territories).toHaveLength(3);
    const fresh = territories[2]!;
    expect(fresh.label).toBe("Northern WI");
    expect(fresh.members).toEqual([]);
  });

  it("uniquifies on collision", () => {
    const dupe: readonly GeoTerritory[] = [
      { id: "milwaukee_metro", label: "Milwaukee metro", members: [] },
    ];
    const { newId } = createTerritory(dupe, "Milwaukee metro");
    expect(newId).toBe("milwaukee_metro_2");
  });

  it("falls back to 'New territory' when label is blank", () => {
    const { territories, newId } = createTerritory(TERRS, "");
    // Cold-test M9 — blank-label buckets use the uniform `territory_N`
    // scheme starting at 1 (the FIRST default bucket is `territory_1`,
    // not the bare `territory` it used to be).
    expect(newId).toBe("territory_1");
    expect(territories[2]!.label).toBe("New territory");
  });

  it("numbers consecutive blank buckets territory_1, _2, _3 … (M9)", () => {
    // Five "+ New territory" clicks on a fresh dim should mint a tidy,
    // consistent sequence — the exact T1–T5 scenario in the cold test.
    let terrs: readonly GeoTerritory[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { territories, newId } = createTerritory(terrs, "");
      terrs = territories;
      ids.push(newId);
    }
    expect(ids).toEqual([
      "territory_1",
      "territory_2",
      "territory_3",
      "territory_4",
      "territory_5",
    ]);
  });

  it("fills the first free territory_N slot after a deletion (M9)", () => {
    // Create 1,2,3 then delete 2; the next blank bucket reuses
    // territory_2 (lowest free index) rather than jumping to _4.
    let terrs: readonly GeoTerritory[] = [];
    for (let i = 0; i < 3; i += 1) {
      terrs = createTerritory(terrs, "").territories;
    }
    terrs = deleteTerritory(terrs, "territory_2");
    const { newId } = createTerritory(terrs, "");
    expect(newId).toBe("territory_2");
  });

  it("does not collide a named bucket with the territory_N scheme", () => {
    // A user-named bucket that slugs to `territory_2` should still
    // uniquify against an existing `territory_2` default bucket.
    const seeded: readonly GeoTerritory[] = [
      { id: "territory_2", label: "New territory", members: [] },
    ];
    const { newId } = createTerritory(seeded, "Territory 2");
    expect(newId).toBe("territory_2_2");
  });
});

describe("deleteTerritory", () => {
  it("removes the territory by id", () => {
    const out = deleteTerritory(TERRS, "mke_metro");
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("mad_metro");
  });

  it("is a no-op when the id doesn't exist", () => {
    const out = deleteTerritory(TERRS, "missing");
    expect(out).toHaveLength(2);
  });
});

describe("renameTerritory", () => {
  it("renames the label but keeps the id stable", () => {
    const out = renameTerritory(TERRS, "mke_metro", "Greater Milwaukee");
    expect(out[0]!.id).toBe("mke_metro");
    expect(out[0]!.label).toBe("Greater Milwaukee");
  });
});

describe("ungroupedLevelIds + territoryByLevel", () => {
  const ALL = ["55001", "55025", "55079", "55089", "55133"];

  it("ungroupedLevelIds returns levels not in any territory", () => {
    expect(ungroupedLevelIds(ALL, TERRS)).toEqual(["55001", "55089"]);
  });

  it("territoryByLevel maps each member to its containing territory", () => {
    const map = territoryByLevel(TERRS);
    expect(map.get("55079")).toBe("mke_metro");
    expect(map.get("55025")).toBe("mad_metro");
    expect(map.has("55001")).toBe(false); // ungrouped
  });
});
