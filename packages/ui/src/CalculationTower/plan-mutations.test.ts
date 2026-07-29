/**
 * plan-mutations — unit tests.
 *
 * Per Brief 25.B.1 §10. Pure logic; no React.
 */

import { describe, expect, it } from "vitest";
import {
  changeOperatorAt,
  defaultOperatorForNode,
  deleteEntryAt,
  deleteNodeById,
  groupEntries,
  insertNodeAtEnd,
  insertNodeAtPosition,
  inventoryItemToNode,
  renameNode,
  setChainBaseValue,
  setConstantValue,
  setFactorPredicate,
  setAxisSource,
  setTowerExposure,
  setRatingDimension,
  spawnTowersFromDim,
  ungroupEntry,
} from "./plan-mutations";
import { stagesToTowerPlan } from "./stages-to-tower-plan";
import type { InventoryItem, TowerNode, TowerPlan } from "./types";

// ── Fixture: a small 3-step tower (input × class × output) ────

function makePlan(): TowerPlan {
  return stagesToTowerPlan({
    stages: [
      {
        stage_id: "inp",
        sequence: 1,
        stage_kind: "input_node",
        display_name: "TIV",
        config_json: { field_name: "tiv_usd", data_type: "currency_usd" },
      },
      {
        stage_id: "ch_bld",
        sequence: 2,
        stage_kind: "multiplicative_chain",
        display_name: "BOP chain",
        config_json: {
          chains: [
            {
              name: "Building chain",
              base_input: "tiv_usd",
              exposure_input: "tiv_usd",
              output_field: "bld_premium",
              factor_lookups: [
                {
                  name: "Class factor",
                  factor_kind: "class_factor",
                  lookup_method: "direct",
                  dimensions: { class_code: "by-code" },
                },
              ],
            },
          ],
        },
      },
    ],
  });
}

const SAMPLE_NODE: TowerNode = {
  id: "n_new",
  category: "transform",
  title: "New factor",
  subtitle: "Lookup",
  valueChip: { primary: "test" },
  icon: "Tag",
};

// ── inventoryItemToNode ──────────────────────────────────────

describe("inventoryItemToNode", () => {
  it("converts a dimension inventory item into a node with the right ref", () => {
    const item: InventoryItem = {
      id: "dim:tiv",
      kind: "dimension",
      category: "input",
      title: "TIV",
      meta: "USD",
      icon: "DollarSign",
    };
    const node = inventoryItemToNode(item, { nodes: new Map() });
    expect(node.title).toBe("TIV");
    expect(node.category).toBe("input");
    expect(node.icon).toBe("DollarSign");
    expect(node.ref).toEqual({ kind: "dimension", dimensionId: "tiv" });
    expect(node.valueChip.primary).toBe("USD");
  });

  it("converts a constant inventory item using the catalog value", () => {
    const item: InventoryItem = {
      id: "const:LCM",
      kind: "constant",
      category: "math",
      subtype: "constant",
      title: "LCM",
      icon: "Target",
    };
    const constants = new Map([
      ["LCM", { id: "LCM", name: "LCM", value: 1.6 }],
    ]);
    const node = inventoryItemToNode(item, { nodes: new Map(), constants });
    expect(node.valueChip.primary).toBe("1.6");
    expect(node.ref).toEqual({
      kind: "constant",
      constantId: "LCM",
      // Brief 70.1 — inserts are typed at the door.
      role: "lcm",
    });
  });

  it("converts a model inventory item with input count + range", () => {
    const item: InventoryItem = {
      id: "model:disc",
      kind: "model",
      category: "lookup",
      subtype: "model",
      title: "Disc credit",
      icon: "Brain",
    };
    const models = new Map([
      [
        "disc",
        {
          id: "disc",
          name: "Disc credit",
          version: "v1",
          outputRange: [0.85, 1.05] as const,
          inputs: [
            { param: "fico", dtype: "number", required: true },
            { param: "class", dtype: "string", required: true },
          ] as const,
        },
      ],
    ]);
    const node = inventoryItemToNode(item, { nodes: new Map(), models });
    expect(node.valueChip.primary).toBe("ML · 2 inp");
    expect(node.valueChip.secondary).toBe("0.85 ↔ 1.05");
  });

  it("mints a non-colliding id", () => {
    const existing = new Map<string, TowerNode>([["n_dim_tiv", SAMPLE_NODE]]);
    const item: InventoryItem = {
      id: "dim:tiv",
      kind: "dimension",
      category: "input",
      title: "TIV",
      icon: "DollarSign",
    };
    const node = inventoryItemToNode(item, { nodes: existing });
    expect(node.id).not.toBe("n_dim_tiv");
  });
});

// ── insertNodeAtEnd ──────────────────────────────────────────

describe("insertNodeAtEnd", () => {
  it("inserts a node BEFORE the output cap (when one exists)", () => {
    const plan = makePlan();
    const tower = plan.towers[0]!;
    const beforeOutputs = tower.entries.length;
    const next = insertNodeAtEnd(plan, tower.id, SAMPLE_NODE);
    const newTower = next.towers[0]!;
    expect(newTower.entries.length).toBe(beforeOutputs + 1);
    // The output node should still be last
    const lastEntry = newTower.entries[newTower.entries.length - 1]!;
    expect(lastEntry.kind).toBe("node");
    const lastNode = next.nodes.get((lastEntry as { nodeId: string }).nodeId)!;
    expect(lastNode.category).toBe("output");
    // The new node is just before
    const insertedEntry = newTower.entries[newTower.entries.length - 2]!;
    expect(insertedEntry.kind).toBe("node");
    expect((insertedEntry as { nodeId: string }).nodeId).toBe("n_new");
  });

  it("uses the default operator (× for transform nodes, + for loadings)", () => {
    const plan = makePlan();
    const tower = plan.towers[0]!;
    const transformNode: TowerNode = { ...SAMPLE_NODE, category: "transform" };
    const next = insertNodeAtEnd(plan, tower.id, transformNode);
    const newTower = next.towers[0]!;
    // The op BEFORE the inserted node should be "multiply"
    const insertedAt = newTower.entries.length - 2;
    expect(newTower.entryOps[insertedAt - 1]).toBe("multiply");

    const loadingNode: TowerNode = {
      ...SAMPLE_NODE,
      id: "n_load",
      category: "loading",
    };
    const next2 = insertNodeAtEnd(plan, tower.id, loadingNode);
    const t2 = next2.towers[0]!;
    expect(t2.entryOps[t2.entries.length - 3]).toBe("plus");
  });
});

// ── defaultOperatorForNode ───────────────────────────────────

describe("defaultOperatorForNode", () => {
  it("returns 'multiply' for transform, lookup, math, input, output", () => {
    for (const cat of ["transform", "lookup", "math", "input", "output"] as const) {
      const node = { ...SAMPLE_NODE, category: cat };
      expect(defaultOperatorForNode(node)).toBe("multiply");
    }
  });
  it("returns 'plus' for additive loading nodes", () => {
    const node = { ...SAMPLE_NODE, category: "loading" as const };
    expect(defaultOperatorForNode(node)).toBe("plus");
  });
  it("returns 'multiply' for modifier-subtype loading nodes", () => {
    const node = {
      ...SAMPLE_NODE,
      category: "loading" as const,
      subtype: "modifier" as const,
    };
    expect(defaultOperatorForNode(node)).toBe("multiply");
  });
});

// ── deleteEntryAt + deleteNodeById ───────────────────────────

describe("deleteEntryAt", () => {
  it("removes the entry and trims operators", () => {
    const plan = makePlan();
    const tower = plan.towers[0]!;
    const before = tower.entries.length;
    // Delete entry at index 1 (the class factor)
    const next = deleteEntryAt(plan, tower.id, 1);
    const newTower = next.towers[0]!;
    expect(newTower.entries.length).toBe(before - 1);
    expect(newTower.entryOps.length).toBe(newTower.entries.length - 1);
  });

  it("refuses to delete the output cap node", () => {
    const plan = makePlan();
    const tower = plan.towers[0]!;
    const lastIdx = tower.entries.length - 1;
    const next = deleteEntryAt(plan, tower.id, lastIdx);
    // Plan unchanged
    expect(next.towers[0]!.entries.length).toBe(tower.entries.length);
  });

  it("does nothing for invalid indices", () => {
    const plan = makePlan();
    expect(deleteEntryAt(plan, plan.towers[0]!.id, -1)).toBe(plan);
    expect(deleteEntryAt(plan, plan.towers[0]!.id, 9999)).toBe(plan);
  });
});

describe("deleteNodeById", () => {
  it("removes a top-level node by its id", () => {
    const plan = makePlan();
    const classNode = [...plan.nodes.values()].find(
      (n) => n.title === "Class factor",
    )!;
    const next = deleteNodeById(plan, classNode.id);
    expect(next.nodes.has(classNode.id)).toBe(false);
  });

  it("no-op when nodeId not found", () => {
    const plan = makePlan();
    const next = deleteNodeById(plan, "nope");
    expect(next).toBe(plan);
  });
});

// ── changeOperatorAt ─────────────────────────────────────────

describe("changeOperatorAt", () => {
  it("changes the operator at the given index", () => {
    const plan = makePlan();
    const tower = plan.towers[0]!;
    const next = changeOperatorAt(plan, tower.id, 0, "plus");
    expect(next.towers[0]!.entryOps[0]).toBe("plus");
  });

  it("does nothing for invalid indices", () => {
    const plan = makePlan();
    expect(changeOperatorAt(plan, plan.towers[0]!.id, -1, "plus")).toBe(plan);
    expect(changeOperatorAt(plan, plan.towers[0]!.id, 99, "plus")).toBe(plan);
  });
});

// ── groupEntries + ungroupEntry ──────────────────────────────

describe("groupEntries", () => {
  it("wraps a contiguous run of node entries into a group", () => {
    // Build a plan with more entries so we have something to group
    let plan = makePlan();
    plan = insertNodeAtEnd(plan, plan.towers[0]!.id, {
      ...SAMPLE_NODE,
      id: "n_terr",
      title: "Territory",
    });
    plan = insertNodeAtEnd(plan, plan.towers[0]!.id, {
      ...SAMPLE_NODE,
      id: "n_constr",
      title: "Construction",
    });
    // Now the tower has: input + class + terr + constr + output
    const tower = plan.towers[0]!;
    // Group entries 2 and 3 (terr + constr)
    const next = groupEntries(plan, tower.id, [2, 3], "Structural");
    const newTower = next.towers[0]!;
    // entries: input + class + group + output
    expect(newTower.entries.length).toBe(tower.entries.length - 1);
    const groupEntry = newTower.entries[2]!;
    expect(groupEntry.kind).toBe("group");
    const group = next.groups.get(
      (groupEntry as { kind: "group"; groupId: string }).groupId,
    )!;
    expect(group.name).toBe("Structural");
    expect(group.nodeIds).toHaveLength(2);
  });

  it("requires ≥ 2 contiguous indices", () => {
    const plan = makePlan();
    expect(groupEntries(plan, plan.towers[0]!.id, [1])).toBe(plan);
    expect(groupEntries(plan, plan.towers[0]!.id, [0, 2])).toBe(plan);
  });

  it("refuses to group an entry that's already a group", () => {
    let plan = makePlan();
    plan = insertNodeAtEnd(plan, plan.towers[0]!.id, {
      ...SAMPLE_NODE,
      id: "n_a",
    });
    plan = insertNodeAtEnd(plan, plan.towers[0]!.id, {
      ...SAMPLE_NODE,
      id: "n_b",
    });
    plan = groupEntries(plan, plan.towers[0]!.id, [1, 2], "g1");
    // Now entry 1 is the group; try to group [1, 2] again — entry 1
    // is a group, not a node, so refuse.
    const next = groupEntries(plan, plan.towers[0]!.id, [1, 2]);
    expect(next).toBe(plan);
  });
});

describe("ungroupEntry", () => {
  it("expands a group entry back into its node entries", () => {
    let plan = makePlan();
    plan = insertNodeAtEnd(plan, plan.towers[0]!.id, {
      ...SAMPLE_NODE,
      id: "n_a",
    });
    plan = insertNodeAtEnd(plan, plan.towers[0]!.id, {
      ...SAMPLE_NODE,
      id: "n_b",
    });
    // Tower: input + class + n_a + n_b + output (5 entries)
    plan = groupEntries(plan, plan.towers[0]!.id, [2, 3], "g1");
    // Tower: input + class + GROUP + output (4 entries)
    const groupedTower = plan.towers[0]!;
    expect(groupedTower.entries.length).toBe(4);
    // Ungroup
    const next = ungroupEntry(plan, plan.towers[0]!.id, 2);
    expect(next.towers[0]!.entries.length).toBe(5);
    expect(next.groups.size).toBe(0);
  });

  it("no-op when the index is not a group entry", () => {
    const plan = makePlan();
    expect(ungroupEntry(plan, plan.towers[0]!.id, 0)).toBe(plan);
  });
});

// ── renameNode ───────────────────────────────────────────────

// ── setRatingDimension ───────────────────────────────────────

describe("setRatingDimension", () => {
  it("updates the plan's ratingDimension field", () => {
    const plan = makePlan();
    const next = setRatingDimension(plan, "coverage");
    expect(next.ratingDimension).toBe("coverage");
  });

  it("does not mutate the input plan", () => {
    const plan = makePlan();
    const before = plan.ratingDimension;
    setRatingDimension(plan, "lob");
    expect(plan.ratingDimension).toBe(before);
  });
});

describe("renameNode", () => {
  it("updates the node's title", () => {
    const plan = makePlan();
    const outputNode = [...plan.nodes.values()].find(
      (n) => n.category === "output",
    )!;
    const next = renameNode(plan, outputNode.id, "BI_premium");
    expect(next.nodes.get(outputNode.id)?.title).toBe("BI_premium");
  });

  it("no-op when nodeId not found", () => {
    const plan = makePlan();
    expect(renameNode(plan, "nope", "anything")).toBe(plan);
  });
});

// ── ADR-0047 — edit a carrier constant (the LCM) value ───────

describe("setConstantValue", () => {
  function planWithLcm(value: number | null): TowerPlan {
    return stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch",
          config_json: {
            output_total_field: "premium",
            chains: [
              {
                name: "Building chain",
                base_input: "literal.base_value",
                base_value: 1,
                factor_lookups: [],
                lcm:
                  value !== null
                    ? { factor_kind: "lcm", value }
                    : { factor_kind: "lcm", input_path: "form_input.lcm" },
                exposure_input: "form_input.tiv",
                exposure_unit_divisor: 100,
                output_field: "premium",
              },
            ],
          },
        },
      ],
    });
  }

  it("sets the authored value + chip on a constant node", () => {
    const plan = planWithLcm(null);
    const lcmNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "constant",
    )!;
    const next = setConstantValue(plan, lcmNode.id, 1.401);
    const updated = next.nodes.get(lcmNode.id)!;
    expect(updated.ref).toMatchObject({ kind: "constant", value: 1.401 });
    expect(updated.valueChip.primary).toBe("× 1.401");
  });

  it("clears the value (reverts to the scalar placeholder) on null", () => {
    const plan = planWithLcm(1.401);
    const lcmNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "constant",
    )!;
    const next = setConstantValue(plan, lcmNode.id, null);
    const updated = next.nodes.get(lcmNode.id)!;
    expect(updated.ref).toMatchObject({ kind: "constant", value: null });
    expect(updated.valueChip.primary).toBe("scalar");
  });

  it("no-ops on a non-constant node + an unknown id (pure)", () => {
    const plan = planWithLcm(1.401);
    const outputNode = [...plan.nodes.values()].find(
      (n) => n.category === "output",
    )!;
    expect(setConstantValue(plan, outputNode.id, 2)).toBe(plan);
    expect(setConstantValue(plan, "missing", 2)).toBe(plan);
  });
});

// ── ADR-0047 — gate a factor with a predicate ────────────────

describe("setFactorPredicate", () => {
  it("sets + clears a gate on a factor-table node", () => {
    const plan = makePlan();
    const facNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "factor-table",
    )!;
    const set = setFactorPredicate(plan, facNode.id, {
      path: "form_input.sprinklered",
      equals: true,
    });
    expect(set.nodes.get(facNode.id)!.ref).toMatchObject({
      kind: "factor-table",
      predicate: { path: "form_input.sprinklered", equals: true },
    });
    const cleared = setFactorPredicate(set, facNode.id, null);
    expect(
      (cleared.nodes.get(facNode.id)!.ref as { predicate?: unknown })
        .predicate,
    ).toBeUndefined();
  });

  it("no-ops on a non-factor-table node + unknown id (pure)", () => {
    const plan = makePlan();
    const outputNode = [...plan.nodes.values()].find(
      (n) => n.category === "output",
    )!;
    expect(
      setFactorPredicate(plan, outputNode.id, { path: "x", equals: 1 }),
    ).toBe(plan);
    expect(
      setFactorPredicate(plan, "missing", { path: "x", equals: 1 }),
    ).toBe(plan);
  });
});

// ── ADR-0047 — set a 2-D factor table's secondary-axis source ─

describe("setAxisSource", () => {
  it("sets, then clears, a per-axis source on a factor-table node", () => {
    const plan = makePlan();
    const facNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "factor-table",
    )!;
    const set = setAxisSource(plan, facNode.id, "grp", {
      source: "literal",
      value: "group_c",
    });
    expect(
      (set.nodes.get(facNode.id)!.ref as { axisSources?: unknown })
        .axisSources,
    ).toEqual({ grp: { source: "literal", value: "group_c" } });
    // Clearing the only override drops axisSources entirely.
    const cleared = setAxisSource(set, facNode.id, "grp", null);
    expect(
      (cleared.nodes.get(facNode.id)!.ref as { axisSources?: unknown })
        .axisSources,
    ).toBeUndefined();
  });

  it("no-ops on a non-factor-table node (pure)", () => {
    const plan = makePlan();
    const outputNode = [...plan.nodes.values()].find(
      (n) => n.category === "output",
    )!;
    expect(
      setAxisSource(plan, outputNode.id, "grp", {
        source: "literal",
        value: "x",
      }),
    ).toBe(plan);
  });
});

// ── ADR-0047 — axis source + predicate coexist on one factor node ──
// (regression: setFactorPredicate must not clobber axisSources, and
// vice-versa — found in PR-5 browser verification.)

describe("factor axis source + predicate coexist", () => {
  function factorNodeId(plan: TowerPlan): string {
    return [...plan.nodes.values()].find((n) => n.ref?.kind === "factor-table")!
      .id;
  }
  const AXIS = { source: "literal", value: "group_c" } as const;
  const PRED = { path: "form_input.sprinklered", equals: true } as const;

  it("setFactorPredicate preserves an existing axis source", () => {
    const plan = makePlan();
    const id = factorNodeId(plan);
    const both = setFactorPredicate(setAxisSource(plan, id, "grp", AXIS), id, PRED);
    const ref = both.nodes.get(id)!.ref as {
      axisSources?: unknown;
      predicate?: unknown;
    };
    expect(ref.axisSources).toEqual({ grp: AXIS });
    expect(ref.predicate).toEqual(PRED);
  });

  it("setAxisSource preserves an existing predicate", () => {
    const plan = makePlan();
    const id = factorNodeId(plan);
    const both = setAxisSource(setFactorPredicate(plan, id, PRED), id, "grp", AXIS);
    const ref = both.nodes.get(id)!.ref as {
      axisSources?: unknown;
      predicate?: unknown;
    };
    expect(ref.predicate).toEqual(PRED);
    expect(ref.axisSources).toEqual({ grp: AXIS });
  });
});

// ── Round-trip / property checks ─────────────────────────────

describe("mutation purity", () => {
  it("does not mutate the input plan on insert", () => {
    const plan = makePlan();
    const beforeJson = JSON.stringify({
      entries: plan.towers[0]!.entries,
      entryOps: plan.towers[0]!.entryOps,
    });
    insertNodeAtEnd(plan, plan.towers[0]!.id, SAMPLE_NODE);
    const afterJson = JSON.stringify({
      entries: plan.towers[0]!.entries,
      entryOps: plan.towers[0]!.entryOps,
    });
    expect(afterJson).toBe(beforeJson);
  });

  it("does not mutate the input plan on delete", () => {
    const plan = makePlan();
    const beforeJson = JSON.stringify({
      entries: plan.towers[0]!.entries,
      entryOps: plan.towers[0]!.entryOps,
    });
    deleteEntryAt(plan, plan.towers[0]!.id, 1);
    const afterJson = JSON.stringify({
      entries: plan.towers[0]!.entries,
      entryOps: plan.towers[0]!.entryOps,
    });
    expect(afterJson).toBe(beforeJson);
  });

  it("insert + delete is identity (round-trip)", () => {
    const plan = makePlan();
    const beforeLen = plan.towers[0]!.entries.length;
    const inserted = insertNodeAtPosition(
      plan,
      plan.towers[0]!.id,
      1,
      SAMPLE_NODE,
      "multiply",
    );
    expect(inserted.towers[0]!.entries.length).toBe(beforeLen + 1);
    const restored = deleteEntryAt(inserted, plan.towers[0]!.id, 1);
    expect(restored.towers[0]!.entries.length).toBe(beforeLen);
  });
});

// ── insertNodeAtPosition ─────────────────────────────────────

describe("insertNodeAtPosition", () => {
  it("inserts at position 0 (top of tower)", () => {
    const plan = makePlan();
    const next = insertNodeAtPosition(
      plan,
      plan.towers[0]!.id,
      0,
      SAMPLE_NODE,
      "multiply",
    );
    const newEntry = next.towers[0]!.entries[0]!;
    expect(newEntry.kind).toBe("node");
    expect((newEntry as { nodeId: string }).nodeId).toBe(SAMPLE_NODE.id);
  });

  it("inserts at the middle and keeps ops consistent", () => {
    const plan = makePlan();
    const tower = plan.towers[0]!;
    const beforeLen = tower.entries.length;
    const next = insertNodeAtPosition(
      plan,
      tower.id,
      2,
      SAMPLE_NODE,
      "plus",
    );
    expect(next.towers[0]!.entries.length).toBe(beforeLen + 1);
    expect(next.towers[0]!.entryOps.length).toBe(beforeLen);
    expect(next.towers[0]!.entryOps[1]).toBe("plus");
  });
});

// ── Brief 35 PR 35.3 — spawnTowersFromDim ───────────────────

const COVERAGE_DIM = {
  slug: "coverage",
  levels: [
    { id: "building", label: "Building" },
    { id: "bpp", label: "BPP" },
    { id: "bi", label: "BI" },
    { id: "gl", label: "GL" },
  ],
} as const;

describe("spawnTowersFromDim — Brief 35 PR 35.3", () => {
  it("creates one tower per level, in order", () => {
    const plan = makePlan();
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    expect(next.towers).toHaveLength(4);
    expect(next.towers.map((t) => t.ratingDimensionValue)).toEqual([
      "building",
      "bpp",
      "bi",
      "gl",
    ]);
  });

  it("pins the plan's ratingDimension + ratingDimensionValues to the dim", () => {
    const plan = makePlan();
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    expect(next.ratingDimension).toBe("coverage");
    expect(next.ratingDimensionValues).toEqual([
      "building",
      "bpp",
      "bi",
      "gl",
    ]);
  });

  it("names each tower `<level.label> premium`", () => {
    const plan = makePlan();
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    expect(next.towers.map((t) => t.name)).toEqual([
      "Building premium",
      "BPP premium",
      "BI premium",
      "GL premium",
    ]);
  });

  it("sets outputField = `<slug(levelId)>_premium` (Brief 35 §−1 Q7)", () => {
    const plan = makePlan();
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    expect(next.towers.map((t) => t.outputField)).toEqual([
      "building_premium",
      "bpp_premium",
      "bi_premium",
      "gl_premium",
    ]);
  });

  it("slugifies non-alphanumeric level ids cleanly", () => {
    const dim = {
      slug: "territory",
      levels: [
        { id: "Zone A-1", label: "Zone A-1" },
        { id: "Zone B/2", label: "Zone B/2" },
      ],
    };
    const next = spawnTowersFromDim(makePlan(), dim);
    expect(next.towers.map((t) => t.outputField)).toEqual([
      "zone_a_1_premium",
      "zone_b_2_premium",
    ]);
  });

  it("each tower seeds base-rate + LCM + output-cap entries joined by × (N20 / F09)", () => {
    const plan = makePlan();
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    for (const tower of next.towers) {
      // N20/F09 — the scaffold is [base, LCM, cap] joined by ×, identical to a
      // reloaded or add-coverage tower (F09 scaffold parity).
      expect(tower.entries).toHaveLength(3);
      const baseNode = next.nodes.get(
        (tower.entries[0] as { nodeId: string }).nodeId,
      );
      // F01 — split-born towers seed the identity base 1.0 so every coverage is
      // a valid, persistable chain immediately (a base-unset tower would project
      // base_input:"" and 422 the batched save, dropping sibling towers).
      expect(baseNode!.ref).toEqual({ kind: "chain-base", baseValue: 1 });
      const lcmNode = next.nodes.get(
        (tower.entries[1] as { nodeId: string }).nodeId,
      );
      expect(lcmNode!.ref).toEqual({
        kind: "constant",
        constantId: "LCM",
        role: "lcm",
        value: null,
      });
      expect(tower.entries[2]!.kind).toBe("node");
      expect(tower.entryOps).toEqual(["multiply", "multiply"]);
    }
  });

  it("registers the output-cap node in plan.nodes with category=output + outputField ref", () => {
    const plan = makePlan();
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    for (const tower of next.towers) {
      // Cap is the THIRD entry now ([base, LCM, cap]).
      const capId = (tower.entries[2] as { nodeId: string }).nodeId;
      const capNode = next.nodes.get(capId);
      expect(capNode).toBeTruthy();
      expect(capNode!.category).toBe("output");
      expect(capNode!.ref).toEqual({
        kind: "output",
        outputField: tower.outputField,
      });
    }
  });

  it("mints stable, distinct tower ids", () => {
    const next = spawnTowersFromDim(makePlan(), COVERAGE_DIM);
    const ids = next.towers.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("tower_coverage_building");
    expect(ids[3]).toBe("tower_coverage_gl");
  });

  it("does not mutate the input plan", () => {
    const plan = makePlan();
    const beforeTowers = plan.towers;
    const beforeNodes = plan.nodes;
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    expect(plan.towers).toBe(beforeTowers);
    expect(plan.nodes).toBe(beforeNodes);
    expect(next).not.toBe(plan);
  });

  it("preserves existing plan.nodes entries (older tower-internal nodes remain)", () => {
    const plan = makePlan();
    const originalSize = plan.nodes.size;
    const next = spawnTowersFromDim(plan, COVERAGE_DIM);
    // 12 new nodes added (a base + an LCM + an output-cap per spawned tower,
    // N20/F09); none removed. COVERAGE_DIM has 4 levels → 4 × 3.
    expect(next.nodes.size).toBe(originalSize + 12);
    for (const [id, node] of plan.nodes) {
      expect(next.nodes.get(id)).toBe(node);
    }
  });

  it("throws on an empty levels array (caller should have filtered)", () => {
    expect(() =>
      spawnTowersFromDim(makePlan(), { slug: "coverage", levels: [] }),
    ).toThrow(/no levels/);
  });

  it("replaces the previous spawn — does not append on re-spawn", () => {
    const plan = makePlan();
    const once = spawnTowersFromDim(plan, COVERAGE_DIM);
    const twice = spawnTowersFromDim(once, {
      slug: "peril",
      levels: [
        { id: "fire", label: "Fire" },
        { id: "wind", label: "Wind" },
      ],
    });
    expect(twice.towers).toHaveLength(2);
    expect(twice.ratingDimension).toBe("peril");
    expect(twice.ratingDimensionValues).toEqual(["fire", "wind"]);
    // The old `coverage`-keyed output caps stay in the nodes map
    // (preservation guarantee; pruning is a separate concern).
    expect(twice.nodes.size).toBeGreaterThanOrEqual(once.nodes.size);
  });
});

// ── Brief 35 PR 35.6 — Total tower ───────────────────────────

import {
  addTotalTower,
  getPerLevelTowers,
  isTotalTower,
  removeTotalTower,
  shouldShowTotalTower,
  TOTAL_TOWER_ID,
  TOTAL_TOWER_OUTPUT_FIELD,
} from "./plan-mutations";

describe("Total tower — helpers + trigger (Brief 35 §7)", () => {
  function planWithCoverageTowers(): TowerPlan {
    return spawnTowersFromDim(makePlan(), COVERAGE_DIM);
  }

  it("isTotalTower returns true only for the Total tower id", () => {
    const plan = addTotalTower(planWithCoverageTowers());
    const totalTower = plan.towers.find((t) => t.id === TOTAL_TOWER_ID);
    const buildingTower = plan.towers.find(
      (t) => t.id === "tower_coverage_building",
    );
    expect(isTotalTower(totalTower!)).toBe(true);
    expect(isTotalTower(buildingTower!)).toBe(false);
  });

  it("getPerLevelTowers excludes the Total tower", () => {
    const plan = addTotalTower(planWithCoverageTowers());
    const perLevel = getPerLevelTowers(plan);
    expect(perLevel.length).toBe(4); // Building / BPP / BI / GL
    expect(perLevel.some(isTotalTower)).toBe(false);
  });

  it("shouldShowTotalTower returns false when < 2 per-level towers", () => {
    const plan = spawnTowersFromDim(makePlan(), {
      slug: "coverage",
      levels: [{ id: "building", label: "Building" }],
    });
    expect(shouldShowTotalTower(plan)).toBe(false);
  });

  it("shouldShowTotalTower returns true when ≥2 per-level towers exist + all have entries", () => {
    const plan = planWithCoverageTowers();
    // spawnTowersFromDim seeds each tower with an output-cap entry,
    // so they all have entries.length ≥ 1.
    expect(shouldShowTotalTower(plan)).toBe(true);
  });

  it("shouldShowTotalTower returns false if any per-level tower has zero entries", () => {
    const plan = planWithCoverageTowers();
    const blanked: TowerPlan = {
      ...plan,
      towers: plan.towers.map((t, i) =>
        i === 0 ? { ...t, entries: [], entryOps: [] } : t,
      ),
    };
    expect(shouldShowTotalTower(blanked)).toBe(false);
  });

  it("shouldShowTotalTower ignores the Total tower itself in the trigger check", () => {
    const plan = addTotalTower(planWithCoverageTowers());
    expect(shouldShowTotalTower(plan)).toBe(true);
  });
});

describe("addTotalTower / removeTotalTower", () => {
  function planWithCoverageTowers(): TowerPlan {
    return spawnTowersFromDim(makePlan(), COVERAGE_DIM);
  }

  it("addTotalTower appends a Total tower with TOTAL_TOWER_ID + sum output field", () => {
    const before = planWithCoverageTowers();
    const after = addTotalTower(before);
    expect(after.towers.length).toBe(before.towers.length + 1);
    const total = after.towers.find((t) => t.id === TOTAL_TOWER_ID);
    expect(total).toBeTruthy();
    expect(total!.outputField).toBe(TOTAL_TOWER_OUTPUT_FIELD);
    expect(total!.name).toBe("Total premium");
    expect(total!.ratingDimensionValue).toBeUndefined();
  });

  it("addTotalTower registers a Sigma output-cap node in plan.nodes", () => {
    const after = addTotalTower(planWithCoverageTowers());
    const total = after.towers.find((t) => t.id === TOTAL_TOWER_ID);
    const capId = (total!.entries[0] as { nodeId: string }).nodeId;
    const cap = after.nodes.get(capId);
    expect(cap).toBeTruthy();
    expect(cap!.category).toBe("output");
    expect(cap!.icon).toBe("Sigma");
    expect(cap!.ref).toEqual({
      kind: "output",
      outputField: TOTAL_TOWER_OUTPUT_FIELD,
    });
  });

  it("addTotalTower is idempotent — calling twice returns the same plan", () => {
    const once = addTotalTower(planWithCoverageTowers());
    const twice = addTotalTower(once);
    expect(twice).toBe(once); // exact reference equality (no clone)
  });

  it("addTotalTower does NOT mutate the input plan", () => {
    const before = planWithCoverageTowers();
    const beforeTowers = before.towers;
    addTotalTower(before);
    expect(before.towers).toBe(beforeTowers);
  });

  it("removeTotalTower strips the Total tower + its output-cap node", () => {
    const planWithTotal = addTotalTower(planWithCoverageTowers());
    const totalCapId = (
      planWithTotal.towers.find((t) => t.id === TOTAL_TOWER_ID)!.entries[0] as {
        nodeId: string;
      }
    ).nodeId;
    const after = removeTotalTower(planWithTotal);
    expect(after.towers.find((t) => t.id === TOTAL_TOWER_ID)).toBeUndefined();
    expect(after.nodes.get(totalCapId)).toBeUndefined();
  });

  it("removeTotalTower is idempotent — calling on a plan without Total returns it unchanged", () => {
    const before = planWithCoverageTowers();
    const after = removeTotalTower(before);
    expect(after).toBe(before);
  });

  it("preserves per-level towers + their nodes through add → remove → add", () => {
    const start = planWithCoverageTowers();
    const startNodeIds = new Set(start.nodes.keys());
    const added = addTotalTower(start);
    const removed = removeTotalTower(added);
    const readded = addTotalTower(removed);
    // The 4 per-level towers + their cap nodes survive.
    for (const id of startNodeIds) {
      expect(readded.nodes.get(id)).toBe(start.nodes.get(id));
    }
    expect(getPerLevelTowers(readded).length).toBe(4);
  });
});

// ── Brief 45 follow-up B4 — addEmptyTower ────────────────────

import { addEmptyTower } from "./plan-mutations";

describe("addEmptyTower — Brief 45 follow-up B4", () => {
  it("appends a single tower with the given name + outputField", () => {
    const plan = makePlan();
    const before = plan.towers.length;
    const next = addEmptyTower(plan, {
      name: "D&O premium",
      outputField: "do_premium",
    });
    expect(next.towers.length).toBe(before + 1);
    const added = next.towers[next.towers.length - 1]!;
    expect(added.name).toBe("D&O premium");
    expect(added.outputField).toBe("do_premium");
  });

  it("registers an output-cap node bound to the outputField", () => {
    const next = addEmptyTower(makePlan(), {
      name: "GL premium",
      outputField: "gl_premium",
    });
    const tower = next.towers[next.towers.length - 1]!;
    // Cap is the THIRD entry now ([base, LCM, cap] — F09 scaffold parity).
    const capId = (tower.entries[2] as { nodeId: string }).nodeId;
    const cap = next.nodes.get(capId);
    expect(cap).toBeTruthy();
    expect(cap!.category).toBe("output");
    expect(cap!.ref).toEqual({
      kind: "output",
      outputField: "gl_premium",
    });
  });

  it("seeds entries with base-rate + LCM + cap, joined by × (N20 / F09)", () => {
    const next = addEmptyTower(makePlan(), {
      name: "D&O premium",
      outputField: "do_premium",
    });
    const tower = next.towers[next.towers.length - 1]!;
    // [base, LCM, cap] — identical scaffold to the coverage-split path (F09).
    expect(tower.entries).toHaveLength(3);
    // First entry is the editable base rate. F01 — it seeds the identity 1.0 so
    // the fresh tower is a valid, persistable chain immediately; the author can
    // still edit it.
    const baseNode = next.nodes.get(
      (tower.entries[0] as { nodeId: string }).nodeId,
    );
    expect(baseNode!.ref).toEqual({ kind: "chain-base", baseValue: 1 });
    expect(baseNode!.title).toBe("Base rate");
    const lcmNode = next.nodes.get(
      (tower.entries[1] as { nodeId: string }).nodeId,
    );
    expect(lcmNode!.ref).toMatchObject({ role: "lcm", value: null });
    expect(tower.entries[2]!.kind).toBe("node");
    expect(tower.entryOps).toEqual(["multiply", "multiply"]);
  });

  it("mints a unique tower id derived from outputField", () => {
    const next = addEmptyTower(makePlan(), {
      name: "D&O premium",
      outputField: "do_premium",
    });
    const tower = next.towers[next.towers.length - 1]!;
    expect(tower.id).toBe("tower_do_premium");
  });

  it("appends a numeric suffix on tower-id collision", () => {
    // makePlan() seeds the plan with a single default tower; the two
    // empty-tower appends land at indices 1 + 2.
    const first = addEmptyTower(makePlan(), {
      name: "D&O premium",
      outputField: "do_premium",
    });
    const second = addEmptyTower(first, {
      name: "D&O premium",
      outputField: "do_premium",
    });
    const appended = second.towers.slice(-2).map((t) => t.id);
    expect(appended).toEqual(["tower_do_premium", "tower_do_premium_2"]);
  });

  it("does NOT mutate the input plan (purity)", () => {
    const before = makePlan();
    const beforeTowers = before.towers;
    const beforeNodes = before.nodes;
    addEmptyTower(before, {
      name: "D&O premium",
      outputField: "do_premium",
    });
    expect(before.towers).toBe(beforeTowers);
    expect(before.nodes).toBe(beforeNodes);
  });

  it("preserves existing per-level towers + their nodes", () => {
    const start = spawnTowersFromDim(makePlan(), COVERAGE_DIM);
    const startNodeIds = new Set(start.nodes.keys());
    const after = addEmptyTower(start, {
      name: "Manual tower",
      outputField: "manual_premium",
    });
    // 4 spawned towers stay, 1 new tower appended
    expect(after.towers.length).toBe(5);
    // Every pre-existing node survives (same reference)
    for (const id of startNodeIds) {
      expect(after.nodes.get(id)).toBe(start.nodes.get(id));
    }
  });

  it("attaches ratingDimensionValue when provided (rating-dim slot binding)", () => {
    const next = addEmptyTower(makePlan(), {
      name: "D&O premium",
      outputField: "do_premium",
      ratingDimensionValue: "professional",
    });
    const tower = next.towers[next.towers.length - 1]!;
    expect(tower.ratingDimensionValue).toBe("professional");
  });

  it("omits ratingDimensionValue when not provided", () => {
    const next = addEmptyTower(makePlan(), {
      name: "D&O premium",
      outputField: "do_premium",
    });
    const tower = next.towers[next.towers.length - 1]!;
    expect(tower.ratingDimensionValue).toBeUndefined();
  });
});

// ── Platform-test E1 — matchCoverageLevel ────────────────────

import { matchCoverageLevel } from "./plan-mutations";

describe("matchCoverageLevel — E1 stamp at Add-coverage time", () => {
  const LEVELS = ["building", "bpp", "liability"] as const;

  it("matches a plain level name", () => {
    expect(matchCoverageLevel("Building", LEVELS)).toBe("building");
    expect(matchCoverageLevel("BPP", LEVELS)).toBe("bpp");
  });

  it("drops a trailing 'premium' before matching", () => {
    expect(matchCoverageLevel("Building premium", LEVELS)).toBe("building");
    expect(matchCoverageLevel("Liability Premium", LEVELS)).toBe("liability");
  });

  it("slugs separators the way level ids are slugged", () => {
    expect(
      matchCoverageLevel(" business  personal-property ", [
        "business_personal_property",
      ]),
    ).toBe("business_personal_property");
  });

  it("returns undefined on anything that is not an EXACT level match", () => {
    // Prefix/superset names must NOT guess a level.
    expect(
      matchCoverageLevel("Liability and Medical premium", LEVELS),
    ).toBeUndefined();
    expect(matchCoverageLevel("Equipment breakdown", LEVELS)).toBeUndefined();
    expect(matchCoverageLevel("", LEVELS)).toBeUndefined();
    expect(matchCoverageLevel("premium", LEVELS)).toBeUndefined();
  });

  it("stamps addEmptyTower so the new tower binds its rating-dim slot", () => {
    const next = addEmptyTower(makePlan(), {
      name: "Building premium",
      outputField: "building_premium",
      ratingDimensionValue: matchCoverageLevel("Building premium", LEVELS),
    });
    const tower = next.towers[next.towers.length - 1]!;
    expect(tower.ratingDimensionValue).toBe("building");
  });

  it("passes a miss through as an unbound tower (no throw, no stamp)", () => {
    const next = addEmptyTower(makePlan(), {
      name: "Equipment breakdown",
      outputField: "eb_premium",
      ratingDimensionValue: matchCoverageLevel("Equipment breakdown", LEVELS),
    });
    const tower = next.towers[next.towers.length - 1]!;
    expect(tower.ratingDimensionValue).toBeUndefined();
  });
});

// ── Cold-test L30 — setChainBaseValue ────────────────────────

describe("setChainBaseValue", () => {
  /** A 2-node tower: chain-base node → output cap. */
  function planWithBaseNode(baseValue: number | null): TowerPlan {
    const baseNode: TowerNode = {
      id: "base_do",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      valueChip:
        baseValue !== null
          ? { primary: `$${baseValue}`, secondary: "base rate" }
          : { primary: "Set base rate", secondary: "tap to edit" },
      icon: "DollarSign",
      ref: { kind: "chain-base", baseValue },
    };
    const output: TowerNode = {
      id: "out_do",
      category: "output",
      title: "do_premium",
      valueChip: { primary: "currency" },
      icon: "Circle",
      ref: { kind: "output", outputField: "do_premium" },
    };
    return {
      ratingDimension: "coverage",
      ratingDimensionValues: [],
      towers: [
        {
          id: "tower_do",
          name: "D&O",
          outputField: "do_premium",
          entries: [
            { kind: "node", nodeId: "base_do" },
            { kind: "node", nodeId: "out_do" },
          ],
          entryOps: ["multiply"],
        },
      ],
      nodes: new Map([
        ["base_do", baseNode],
        ["out_do", output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
  }

  it("sets the literal value + refreshes the value chip", () => {
    const next = setChainBaseValue(planWithBaseNode(null), "base_do", 600);
    const node = next.nodes.get("base_do")!;
    expect(node.ref).toEqual({ kind: "chain-base", baseValue: 600 });
    expect(node.valueChip.primary).toBe("$600");
    expect(node.valueChip.secondary).toBe("base rate");
  });

  it("clears the literal when passed null", () => {
    const next = setChainBaseValue(planWithBaseNode(600), "base_do", null);
    const node = next.nodes.get("base_do")!;
    expect(node.ref).toEqual({ kind: "chain-base", baseValue: null });
    expect(node.valueChip.primary).toBe("Set base rate");
  });

  it("formats fractional bases with 2 decimals", () => {
    const next = setChainBaseValue(planWithBaseNode(null), "base_do", 1.74);
    expect(next.nodes.get("base_do")!.valueChip.primary).toBe("$1.74");
  });

  it("is a no-op for a non-chain-base node", () => {
    const plan = planWithBaseNode(600);
    const next = setChainBaseValue(plan, "out_do", 999);
    expect(next).toBe(plan); // same reference — untouched
  });

  it("is a no-op for an unknown node id", () => {
    const plan = planWithBaseNode(600);
    const next = setChainBaseValue(plan, "nope", 999);
    expect(next).toBe(plan);
  });

  it("does not mutate the input plan", () => {
    const plan = planWithBaseNode(null);
    setChainBaseValue(plan, "base_do", 600);
    // Original node untouched.
    expect(
      (plan.nodes.get("base_do")!.ref as { baseValue: number | null })
        .baseValue,
    ).toBeNull();
  });
});

describe("setTowerExposure", () => {
  it("sets the exposure base (input / divisor / apply) on a tower", () => {
    const plan = makePlan();
    const towerId = plan.towers[0]!.id;
    const next = setTowerExposure(plan, towerId, {
      exposureInput: "annual_revenue",
      exposureUnitDivisor: 1000,
      applyExposure: true,
    });
    const t = next.towers[0]!;
    expect(t.exposureInput).toBe("annual_revenue");
    expect(t.exposureUnitDivisor).toBe(1000);
    expect(t.applyExposure).toBe(true);
  });

  it("clears a field on nullish + no-ops on an unknown tower id", () => {
    const plan = makePlan();
    const towerId = plan.towers[0]!.id;
    const set = setTowerExposure(plan, towerId, {
      exposureInput: "annual_revenue",
      applyExposure: true,
    });
    const cleared = setTowerExposure(set, towerId, { exposureInput: null });
    expect(cleared.towers[0]!.exposureInput).toBeUndefined();
    expect(cleared.towers[0]!.applyExposure).toBe(true);
    expect(setTowerExposure(plan, "nope", { applyExposure: true })).toBe(plan);
  });
});
