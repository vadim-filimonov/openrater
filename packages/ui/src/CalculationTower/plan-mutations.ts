/**
 * plan-mutations — pure functions that mutate a TowerPlan.
 *
 * Per Brief 25.B.1. The TowerPlan from `stagesToTowerPlan` is the
 * "loaded" state; these helpers produce edited versions. The
 * route holds the edited plan in local state; "save" (via
 * `towerPlanToStages`) lands in the substrate-work follow-up.
 *
 * Every function is pure — it does not mutate its input plan. The
 * UI hands the new plan back via the appropriate callback and the
 * parent stores it.
 */

import type {
  AxisSource,
  ConstantDef,
  InventoryItem,
  ModelDef,
  Operator,
  Tower,
  TowerEntry,
  TowerGroup,
  TowerNode,
  TowerPlan,
  ValueChip,
} from "./types";

// ── id minting ──────────────────────────────────────────────

/**
 * Generate a stable-enough node id from a seed string + the plan's
 * existing nodes. Format: `<seed>_<n>` where n is the first
 * non-colliding integer.
 */
function nextId(seed: string, used: ReadonlyMap<string, unknown>): string {
  const safe = seed.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() || "node";
  if (!used.has(safe)) return safe;
  for (let n = 2; n < 9999; n += 1) {
    const candidate = `${safe}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${safe}_${Date.now()}`;
}

function nextGroupId(used: ReadonlyMap<string, unknown>): string {
  return nextId("grp", used);
}

// ── Inventory item → TowerNode ──────────────────────────────

/**
 * Convert an InventoryItem (rail row) into a TowerNode ready to
 * insert. The id is minted to avoid collisions; the value chip is
 * derived from the item's meta + the constant/model catalogs where
 * relevant.
 */
export function inventoryItemToNode(
  item: InventoryItem,
  opts: {
    readonly nodes: ReadonlyMap<string, TowerNode>;
    readonly constants?: ReadonlyMap<string, ConstantDef>;
    readonly models?: ReadonlyMap<string, ModelDef>;
  },
): TowerNode {
  const { nodes, constants, models } = opts;
  const id = nextId(`n_${item.id.replace(/:/g, "_")}`, nodes);

  // Default value chip per inventory kind
  let valueChip: ValueChip;
  let subtitle: string;
  let ref: TowerNode["ref"];

  switch (item.kind) {
    case "dimension": {
      // The item meta is often a data_type ("USD", "string", etc.)
      valueChip = item.meta
        ? { primary: item.meta, secondary: "from submission" }
        : { primary: "dimension" };
      subtitle = "Dimension lookup";
      const dimId = item.id.replace(/^dim:/, "");
      ref = { kind: "dimension", dimensionId: dimId };
      break;
    }
    case "constant": {
      const constId = item.id.replace(/^const:/, "");
      const constDef = constants?.get(constId);
      valueChip = constDef
        ? { primary: String(constDef.value), secondary: "scalar" }
        : { primary: item.meta ?? "scalar" };
      subtitle = "Constant · carrier-set";
      ref = {
        kind: "constant",
        constantId: constId,
        // Brief 70.1 — new inserts are TYPED at the door; the save
        // path never again depends on what the constant is named.
        ...(/lcm/i.test(constId) ? { role: "lcm" as const } : {}),
      };
      break;
    }
    case "model": {
      const modelId = item.id.replace(/^model:/, "");
      const modelDef = models?.get(modelId);
      const inputCount = modelDef?.inputs.length ?? 0;
      const range = modelDef?.outputRange;
      valueChip = {
        primary: `ML · ${inputCount} inp`,
        ...(range ? { secondary: `${range[0]} ↔ ${range[1]}` } : {}),
      };
      subtitle = `ML model${modelDef?.version ? ` · ${modelDef.version}` : ""}`;
      ref = { kind: "model", modelId };
      break;
    }
    case "gate": {
      valueChip = { primary: item.meta ?? "gate", secondary: "modifier" };
      subtitle = "Gate · modifier schedule";
      ref = { kind: "modifier", modifierStageId: item.id.replace(/^gate:/, "") };
      break;
    }
    case "tower-output": {
      const outputName = item.id.replace(/^out:/, "");
      valueChip = { primary: outputName, secondary: "reference" };
      subtitle = "Reference · other tower's output";
      ref = { kind: "tower-output", outputName };
      break;
    }
    case "math":
    default: {
      // Math operators don't drop as nodes — they're a different
      // category. The consumer should handle math-op drops as
      // operator changes, not insertions. We still produce a
      // generic node for resilience.
      valueChip = { primary: item.title, secondary: "math op" };
      subtitle = "Math operator";
      break;
    }
  }

  return {
    id,
    category: item.category,
    ...(item.subtype !== undefined ? { subtype: item.subtype } : {}),
    title: item.title,
    subtitle,
    valueChip,
    icon: item.icon,
    ...(ref !== undefined ? { ref } : {}),
  };
}

/**
 * Pick a sensible default operator for joining a newly-inserted
 * node with the one above it, based on the node's category.
 *
 * Per Brief 25 §5.7:
 *   transform / lookup / math / input → multiply
 *   loading (modifier / additive) → plus
 *   output → multiply (just for the join into output)
 */
export function defaultOperatorForNode(node: TowerNode): Operator {
  if (node.category === "loading" && node.subtype !== "modifier") return "plus";
  return "multiply";
}

// ── Tower lookup ─────────────────────────────────────────────

function findTowerIndex(plan: TowerPlan, towerId: string): number {
  return plan.towers.findIndex((t) => t.id === towerId);
}

function withUpdatedTower(plan: TowerPlan, idx: number, next: Tower): TowerPlan {
  const nextTowers = plan.towers.slice();
  nextTowers[idx] = next;
  return { ...plan, towers: nextTowers };
}

// ── Insert entry ─────────────────────────────────────────────

/**
 * Append a node + its joining operator to the end of the tower —
 * just before the output cap if one exists, otherwise at the end.
 */
export function insertNodeAtEnd(
  plan: TowerPlan,
  towerId: string,
  node: TowerNode,
  op: Operator = defaultOperatorForNode(node),
): TowerPlan {
  const idx = findTowerIndex(plan, towerId);
  if (idx < 0) return plan;
  const tower = plan.towers[idx]!;

  // Detect the output cap (last entry that's a node with category=output)
  let insertAt = tower.entries.length;
  const last = tower.entries[tower.entries.length - 1];
  if (last && last.kind === "node") {
    const lastNode = plan.nodes.get(last.nodeId);
    if (lastNode?.category === "output") insertAt = tower.entries.length - 1;
  }
  return insertNodeAtPosition(plan, towerId, insertAt, node, op);
}

/**
 * Insert a node at the given position (0 = top of tower).
 *
 * Tower entries are interleaved with operator ops:
 *   entries[0]   ← always present, no operator above
 *   ops[0] / entries[1]
 *   ops[1] / entries[2]
 *   ...
 *
 * If position == 0, no operator is added above the new entry; the
 * existing entries[0]'s operator (if any) shifts to become the
 * operator between the new entry and the OLD entries[0].
 */
export function insertNodeAtPosition(
  plan: TowerPlan,
  towerId: string,
  position: number,
  node: TowerNode,
  op: Operator,
): TowerPlan {
  const idx = findTowerIndex(plan, towerId);
  if (idx < 0) return plan;
  const tower = plan.towers[idx]!;
  const clampedPos = Math.max(0, Math.min(position, tower.entries.length));

  // Add node to the nodes map
  const newNodes = new Map(plan.nodes);
  newNodes.set(node.id, node);

  const newEntry: TowerEntry = { kind: "node", nodeId: node.id };
  const nextEntries = [
    ...tower.entries.slice(0, clampedPos),
    newEntry,
    ...tower.entries.slice(clampedPos),
  ];

  // Operator handling: if inserting in the middle, the new node
  // gets `op` joining it with the previous entry.
  let nextOps: Operator[];
  if (clampedPos === 0) {
    // New entry is now the top; the OLD top's incoming op stays
    // (it's now between the new entry and the old top — but logically
    // unchanged). Pre-pend a new op anyway so length stays consistent.
    nextOps = [op, ...tower.entryOps];
  } else {
    nextOps = [
      ...tower.entryOps.slice(0, clampedPos - 1),
      op,
      ...tower.entryOps.slice(clampedPos - 1),
    ];
  }
  // Trim ops to entries.length - 1 (safety)
  nextOps = nextOps.slice(0, nextEntries.length - 1);

  return {
    ...withUpdatedTower(plan, idx, {
      ...tower,
      entries: nextEntries,
      entryOps: nextOps,
    }),
    nodes: newNodes,
  };
}

// ── Delete entry ─────────────────────────────────────────────

/**
 * Remove the entry at the given index. If the entry above and the
 * entry below remain, the operator that was *above* the removed
 * entry is kept (the operator that was *below* it is dropped).
 */
export function deleteEntryAt(
  plan: TowerPlan,
  towerId: string,
  entryIndex: number,
): TowerPlan {
  const idx = findTowerIndex(plan, towerId);
  if (idx < 0) return plan;
  const tower = plan.towers[idx]!;
  if (entryIndex < 0 || entryIndex >= tower.entries.length) return plan;

  // Refuse to delete the OUTPUT node (last node) — that's a
  // structural element. Caller should call something else if they
  // really want to drop the output (rename it instead).
  const target = tower.entries[entryIndex];
  if (target?.kind === "node") {
    const node = plan.nodes.get(target.nodeId);
    if (node?.category === "output") return plan;
  }

  const nextEntries = [
    ...tower.entries.slice(0, entryIndex),
    ...tower.entries.slice(entryIndex + 1),
  ];

  // Drop the operator BELOW the removed entry (entryOps[entryIndex])
  // when there is one; otherwise drop the one ABOVE it.
  let nextOps: Operator[];
  if (entryIndex === 0) {
    // The removed entry was the top — drop ops[0] (was joining
    // entry 0 → entry 1).
    nextOps = tower.entryOps.slice(1);
  } else if (entryIndex === tower.entries.length - 1) {
    // The removed entry was the last — drop the last op.
    nextOps = tower.entryOps.slice(0, -1);
  } else {
    // Middle: drop the op that was joining the removed entry with
    // the one below (entryOps[entryIndex]).
    nextOps = [
      ...tower.entryOps.slice(0, entryIndex),
      ...tower.entryOps.slice(entryIndex + 1),
    ];
  }

  // Optionally trim the nodes map if no other entry references the
  // removed node (cheap GC).
  const nextNodes = new Map(plan.nodes);
  if (target?.kind === "node") {
    const stillReferenced = nextEntries.some(
      (e) => e.kind === "node" && e.nodeId === target.nodeId,
    );
    if (!stillReferenced) nextNodes.delete(target.nodeId);
  }

  return {
    ...withUpdatedTower(plan, idx, {
      ...tower,
      entries: nextEntries,
      entryOps: nextOps,
    }),
    nodes: nextNodes,
  };
}

/** Delete by node id — convenience over deleteEntryAt for click-x. */
export function deleteNodeById(plan: TowerPlan, nodeId: string): TowerPlan {
  for (let t = 0; t < plan.towers.length; t += 1) {
    const tower = plan.towers[t]!;
    const idx = tower.entries.findIndex(
      (e) => e.kind === "node" && e.nodeId === nodeId,
    );
    if (idx >= 0) {
      return deleteEntryAt(plan, tower.id, idx);
    }
    // Also check nodes inside groups.
    for (let g = 0; g < tower.entries.length; g += 1) {
      const entry = tower.entries[g]!;
      if (entry.kind === "group") {
        const group = plan.groups.get(entry.groupId);
        if (group && group.nodeIds.includes(nodeId)) {
          return deleteNodeFromGroup(plan, entry.groupId, nodeId);
        }
      }
    }
  }
  return plan;
}

function deleteNodeFromGroup(
  plan: TowerPlan,
  groupId: string,
  nodeId: string,
): TowerPlan {
  const group = plan.groups.get(groupId);
  if (!group) return plan;
  const nodeIdx = group.nodeIds.indexOf(nodeId);
  if (nodeIdx < 0) return plan;

  const nextNodeIds = group.nodeIds.filter((id) => id !== nodeId);
  // Drop the inner op above (or below) the removed node, same rules
  // as for top-level entries.
  let nextInnerOps: Operator[];
  if (nodeIdx === 0) {
    nextInnerOps = group.innerOps.slice(1);
  } else if (nodeIdx === group.nodeIds.length - 1) {
    nextInnerOps = group.innerOps.slice(0, -1);
  } else {
    nextInnerOps = [
      ...group.innerOps.slice(0, nodeIdx),
      ...group.innerOps.slice(nodeIdx + 1),
    ];
  }

  const nextGroups = new Map(plan.groups);
  // If only one node left, ungroup automatically (a group of 1 is
  // pointless).
  if (nextNodeIds.length <= 1) {
    // Find the tower + entry that contains this group
    for (let t = 0; t < plan.towers.length; t += 1) {
      const tower = plan.towers[t]!;
      const entryIdx = tower.entries.findIndex(
        (e) => e.kind === "group" && e.groupId === groupId,
      );
      if (entryIdx >= 0) {
        const replacementEntries: TowerEntry[] = nextNodeIds.length === 1
          ? [{ kind: "node", nodeId: nextNodeIds[0]! }]
          : [];
        const nextEntries = [
          ...tower.entries.slice(0, entryIdx),
          ...replacementEntries,
          ...tower.entries.slice(entryIdx + 1),
        ];
        // entryOps stays the same — same number of slots if we kept
        // one node; if we removed the whole group, drop one op.
        let nextOps = tower.entryOps.slice();
        if (replacementEntries.length === 0) {
          if (entryIdx === 0) nextOps = nextOps.slice(1);
          else if (entryIdx === tower.entries.length - 1)
            nextOps = nextOps.slice(0, -1);
          else
            nextOps = [
              ...nextOps.slice(0, entryIdx),
              ...nextOps.slice(entryIdx + 1),
            ];
        }
        nextGroups.delete(groupId);
        const nextNodes = new Map(plan.nodes);
        nextNodes.delete(nodeId);
        return {
          ...withUpdatedTower(plan, t, {
            ...tower,
            entries: nextEntries,
            entryOps: nextOps,
          }),
          groups: nextGroups,
          nodes: nextNodes,
        };
      }
    }
  }

  const nextGroup: TowerGroup = {
    ...group,
    nodeIds: nextNodeIds,
    innerOps: nextInnerOps,
  };
  nextGroups.set(groupId, nextGroup);
  const nextNodes = new Map(plan.nodes);
  nextNodes.delete(nodeId);
  return { ...plan, groups: nextGroups, nodes: nextNodes };
}

// ── Change operator ──────────────────────────────────────────

export function changeOperatorAt(
  plan: TowerPlan,
  towerId: string,
  opIndex: number,
  op: Operator,
): TowerPlan {
  const idx = findTowerIndex(plan, towerId);
  if (idx < 0) return plan;
  const tower = plan.towers[idx]!;
  if (opIndex < 0 || opIndex >= tower.entryOps.length) return plan;
  const nextOps = tower.entryOps.slice();
  nextOps[opIndex] = op;
  return withUpdatedTower(plan, idx, { ...tower, entryOps: nextOps });
}

// ── Group / Ungroup ──────────────────────────────────────────

/**
 * Wrap a contiguous run of nodes in a group. The indices refer to
 * entry positions in the tower; they must be contiguous and each
 * must be a node entry (not already a group).
 *
 * The group replaces the wrapped entries with a single group entry.
 * Inner operators (between the wrapped entries) move into the
 * group's innerOps; the operator BEFORE the first wrapped entry
 * (if any) becomes the operator joining the group with what's above.
 */
export function groupEntries(
  plan: TowerPlan,
  towerId: string,
  entryIndices: readonly number[],
  name?: string,
  /**
   * Brief 35 §−1 Q6 — when supplied, overrides every inner-op in
   * the new group to this operator. Used by the multi-select
   * toolbar's "Max" / "Min" / "Plus" actions: the user picks the
   * nodes + the reducer, and the group's interior becomes that
   * reduction. When omitted, the existing entryOps between the
   * wrapped indices are preserved verbatim (Brief 25 default).
   */
  innerOpOverride?: Operator,
): TowerPlan {
  if (entryIndices.length < 2) return plan;
  const sorted = entryIndices.slice().sort((a, b) => a - b);
  // Require contiguous
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! !== sorted[i - 1]! + 1) return plan;
  }
  const idx = findTowerIndex(plan, towerId);
  if (idx < 0) return plan;
  const tower = plan.towers[idx]!;

  // Check that all entries are nodes (not groups)
  const wrappedEntries: TowerEntry[] = [];
  for (const i of sorted) {
    const e = tower.entries[i];
    if (!e || e.kind !== "node") return plan;
    wrappedEntries.push(e);
  }

  const firstIdx = sorted[0]!;
  const lastIdx = sorted[sorted.length - 1]!;

  // Inner ops are entryOps[firstIdx .. lastIdx-1]. When the caller
  // passes an `innerOpOverride` (Max / Min / Plus toolbar actions),
  // every interior gap is replaced with that op so the group
  // computes a uniform reduction. Otherwise the existing operators
  // carry through verbatim (Brief 25 default — pure "wrap").
  const existingInnerOps: Operator[] = tower.entryOps.slice(firstIdx, lastIdx);
  const innerOps: Operator[] =
    innerOpOverride !== undefined
      ? existingInnerOps.map(() => innerOpOverride)
      : existingInnerOps;

  // Build the group
  const nodeIds = wrappedEntries.map(
    (e) => (e as { kind: "node"; nodeId: string }).nodeId,
  );
  const groupId = nextGroupId(plan.groups);
  const group: TowerGroup = {
    id: groupId,
    ...(name !== undefined ? { name } : {}),
    nodeIds,
    innerOps,
  };

  // Replace wrapped entries with single group entry
  const groupEntry: TowerEntry = { kind: "group", groupId };
  const nextEntries = [
    ...tower.entries.slice(0, firstIdx),
    groupEntry,
    ...tower.entries.slice(lastIdx + 1),
  ];

  // entryOps: drop the inner ops (firstIdx..lastIdx-1)
  // Keep op BEFORE firstIdx (entryOps[firstIdx-1] if it exists) +
  // op AFTER lastIdx (entryOps[lastIdx] if exists).
  const nextOps = [
    ...tower.entryOps.slice(0, firstIdx),
    ...tower.entryOps.slice(lastIdx),
  ];

  const nextGroups = new Map(plan.groups);
  nextGroups.set(groupId, group);

  return {
    ...withUpdatedTower(plan, idx, {
      ...tower,
      entries: nextEntries,
      entryOps: nextOps,
    }),
    groups: nextGroups,
  };
}

/** Expand a group entry back into its constituent nodes. */
export function ungroupEntry(
  plan: TowerPlan,
  towerId: string,
  entryIndex: number,
): TowerPlan {
  const idx = findTowerIndex(plan, towerId);
  if (idx < 0) return plan;
  const tower = plan.towers[idx]!;
  const entry = tower.entries[entryIndex];
  if (!entry || entry.kind !== "group") return plan;
  const group = plan.groups.get(entry.groupId);
  if (!group) return plan;

  const expanded: TowerEntry[] = group.nodeIds.map((nodeId) => ({
    kind: "node",
    nodeId,
  }));
  const nextEntries = [
    ...tower.entries.slice(0, entryIndex),
    ...expanded,
    ...tower.entries.slice(entryIndex + 1),
  ];
  // Inject the group's innerOps where the group was.
  const nextOps = [
    ...tower.entryOps.slice(0, entryIndex),
    ...group.innerOps,
    ...tower.entryOps.slice(entryIndex),
  ];

  const nextGroups = new Map(plan.groups);
  nextGroups.delete(entry.groupId);

  return {
    ...withUpdatedTower(plan, idx, {
      ...tower,
      entries: nextEntries,
      entryOps: nextOps,
    }),
    groups: nextGroups,
  };
}

// ── Rating dimension declaration (25.B.2) ───────────────────

/**
 * Set the plan's rating dimension. This is the dimension that
 * splits the chains into per-value towers (e.g., Coverage splits
 * into BI / Liab / Bld / BPP).
 *
 * Note: this only updates the TowerPlan's top-level
 * `ratingDimension` field. The per-tower `ratingDimensionValue`
 * comes from each chain's `coverage_value` config field, which is
 * set at chain authoring time (or by an explicit chain-edit flow).
 *
 * If no chain has coverage_value set, declaring a rating dim won't
 * populate the segmented control — the converter has nothing to
 * project. Callers should hint to the user that chains need
 * coverage_value to participate in the split.
 */
export function setRatingDimension(
  plan: TowerPlan,
  ratingDimension: string,
): TowerPlan {
  return { ...plan, ratingDimension };
}

// ── Brief 35 PR 35.7 follow-up — duplicate node ─────────────

/**
 * Duplicate a node by id. Inserts a clone of the source node
 * immediately after the original entry (keeps the existing op
 * before the original; mints a `multiply` op between the
 * original and the new clone).
 *
 * No-op when:
 *   · Node isn't found in plan.nodes
 *   · The source node isn't placed in any tower (orphan)
 *   · The source entry's tower can't be located
 *
 * Pure — returns a new plan.
 */
export function duplicateNode(plan: TowerPlan, nodeId: string): TowerPlan {
  const source = plan.nodes.get(nodeId);
  if (!source) return plan;

  // Find the tower + entry index for this node.
  let towerIdx = -1;
  let entryIdx = -1;
  for (let i = 0; i < plan.towers.length; i += 1) {
    const t = plan.towers[i]!;
    const j = t.entries.findIndex(
      (e) => e.kind === "node" && e.nodeId === nodeId,
    );
    if (j >= 0) {
      towerIdx = i;
      entryIdx = j;
      break;
    }
  }
  if (towerIdx < 0 || entryIdx < 0) return plan;
  const tower = plan.towers[towerIdx]!;

  // Mint a new id + a structurally-identical clone.
  const newId = nextId(`${nodeId}_copy`, plan.nodes);
  const clone: TowerNode = { ...source, id: newId };
  const nextNodes = new Map(plan.nodes);
  nextNodes.set(newId, clone);

  // Insert clone right after the original. Insert a `multiply` op
  // between original + clone (the natural default for chained
  // factors; user can re-pick via the coin popover).
  const nextEntries = [
    ...tower.entries.slice(0, entryIdx + 1),
    { kind: "node" as const, nodeId: newId },
    ...tower.entries.slice(entryIdx + 1),
  ];
  // entryOps[k] is the operator between entries[k] and entries[k+1].
  // Inserting at position entryIdx+1 means we add an op at
  // entryOps[entryIdx] (between original + clone) — the existing
  // entryOps[entryIdx] (which was between original + next-entry)
  // shifts right by one.
  const nextEntryOps = [
    ...tower.entryOps.slice(0, entryIdx),
    "multiply" as Operator,
    ...tower.entryOps.slice(entryIdx),
  ];

  return {
    ...withUpdatedTower(plan, towerIdx, {
      ...tower,
      entries: nextEntries,
      entryOps: nextEntryOps,
    }),
    nodes: nextNodes,
  };
}

// ── Output rename ───────────────────────────────────────────

/**
 * Rename a node (typically used for output nodes — gives the
 * tower's result a stable name). Also updates the title.
 */
export function renameNode(
  plan: TowerPlan,
  nodeId: string,
  newTitle: string,
): TowerPlan {
  const node = plan.nodes.get(nodeId);
  if (!node) return plan;
  const nextNodes = new Map(plan.nodes);
  nextNodes.set(nodeId, { ...node, title: newTitle });
  return { ...plan, nodes: nextNodes };
}

// ── Cold-test L30 — edit a chain's literal base rate ────────

/**
 * Format a base-rate scalar for the `chain-base` node's value chip.
 * Mirrors `formatBaseValue` in stages-to-tower-plan.ts (kept local to
 * avoid a load↔mutation import edge). Whole dollars render without
 * decimals; fractional bases (rate-per-unit) keep 2 places.
 */
function formatBaseValueChip(value: number): string {
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/**
 * Cold-test L30 — set (or clear) the literal base rate on a
 * `chain-base` node. This is the editable base-rate affordance: the
 * ASSEMBLE inspector's number field calls this on change, the route
 * stores the new plan, and `towerPlanToStages` reverse-projects the
 * value onto `ChainSpec.base_value`.
 *
 * No-op when:
 *   · the node id isn't found, or
 *   · the node isn't a `chain-base` ref (we don't repurpose other
 *     node kinds into base nodes).
 *
 * Pass `null` to clear the literal (the chip reverts to the "Set base
 * rate" prompt + the chain loses its `base_value` on next save).
 *
 * Pure — returns a new plan.
 */
export function setChainBaseValue(
  plan: TowerPlan,
  nodeId: string,
  value: number | null,
): TowerPlan {
  const node = plan.nodes.get(nodeId);
  if (!node || node.ref?.kind !== "chain-base") return plan;
  const nextNodes = new Map(plan.nodes);
  const nextChip: ValueChip =
    value !== null
      ? { primary: formatBaseValueChip(value), secondary: "base rate" }
      : { primary: "Set base rate", secondary: "tap to edit" };
  nextNodes.set(nodeId, {
    ...node,
    valueChip: nextChip,
    ref: { kind: "chain-base", baseValue: value },
  });
  return { ...plan, nodes: nextNodes };
}

/**
 * ADR-0047 / Brief 54 — set (or clear) the authored scalar on a carrier-
 * constant node (the LCM). Mirrors `setChainBaseValue`: the value lives on
 * the `constant` ref; the save converter reverse-projects it onto
 * `ChainSpec.lcm.value`, so the projector applies it AFTER the 3-dp rate
 * round (folding the LCM into the base rounds at the wrong point — KS-10
 * 1216 vs the 1210 oracle).
 *
 * No-ops unless the node is a `constant` ref. Pass `null` to clear (the
 * chain reverts to the legacy column-driven LCM on next save). Preserves an
 * existing `overridable` flag.
 *
 * Pure — returns a new plan.
 */
export function setConstantValue(
  plan: TowerPlan,
  nodeId: string,
  value: number | null,
): TowerPlan {
  const node = plan.nodes.get(nodeId);
  if (!node || node.ref?.kind !== "constant") return plan;
  const nextNodes = new Map(plan.nodes);
  const nextChip: ValueChip =
    value !== null
      ? { primary: `× ${value}`, secondary: "carrier-set" }
      : { primary: "scalar", secondary: "carrier-set" };
  nextNodes.set(nodeId, {
    ...node,
    valueChip: nextChip,
    ref: {
      kind: "constant",
      constantId: node.ref.constantId,
      ...(node.ref.role !== undefined ? { role: node.ref.role } : {}),
      value,
      ...(node.ref.overridable === true ? { overridable: true } : {}),
    },
  });
  return { ...plan, nodes: nextNodes };
}

/**
 * ADR-0047 / ADR-0044 D6 — set (or clear) the gate on a factor-table node.
 * The predicate round-trips onto `FactorLookup.predicate`; the projector
 * gates the looked-up factor through a `branch` (predicate true → the
 * factor; false → the multiplicative identity 1.0). E.g. the sprinkler
 * credit `{ path: "form_input.sprinklered", equals: true }`.
 *
 * No-ops unless the node is a `factor-table` ref. Pass `null` to clear (the
 * factor then always applies). Pure — returns a new plan.
 */
export function setFactorPredicate(
  plan: TowerPlan,
  nodeId: string,
  predicate: { path: string; equals: boolean | number | string } | null,
): TowerPlan {
  const node = plan.nodes.get(nodeId);
  if (!node || node.ref?.kind !== "factor-table") return plan;
  const nextNodes = new Map(plan.nodes);
  nextNodes.set(nodeId, {
    ...node,
    ref: {
      kind: "factor-table",
      tableId: node.ref.tableId,
      ...(predicate ? { predicate } : {}),
      // Preserve sibling axis sources — symmetric with setAxisSource
      // preserving the predicate (else editing one clobbers the other on
      // the same factor node).
      ...(node.ref.axisSources ? { axisSources: node.ref.axisSources } : {}),
    },
  });
  return { ...plan, nodes: nextNodes };
}

/**
 * ADR-0047 — set (or clear) the source for ONE secondary axis of a
 * factor-table node. The override round-trips onto
 * `factor_lookups[].dimensions[axis]`; the projector then resolves the axis
 * from a literal key / a computed sum / a derived (class) attribute / a form
 * column instead of clamping the 2-D lookup to the neutral 1.0.
 *
 * No-ops unless the node is a `factor-table` ref. Pass `null` to clear the
 * override (the axis reverts to a default form_input binding on save).
 * Preserves the node's other axis overrides + predicate. Pure.
 */
export function setAxisSource(
  plan: TowerPlan,
  nodeId: string,
  axis: string,
  source: AxisSource | null,
): TowerPlan {
  const node = plan.nodes.get(nodeId);
  if (!node || node.ref?.kind !== "factor-table") return plan;
  const nextNodes = new Map(plan.nodes);
  const nextAxisSources: Record<string, AxisSource> = {};
  for (const [k, v] of Object.entries(node.ref.axisSources ?? {})) {
    if (k !== axis) nextAxisSources[k] = v;
  }
  if (source) nextAxisSources[axis] = source;
  const hasAny = Object.keys(nextAxisSources).length > 0;
  nextNodes.set(nodeId, {
    ...node,
    ref: {
      kind: "factor-table",
      tableId: node.ref.tableId,
      ...(node.ref.predicate ? { predicate: node.ref.predicate } : {}),
      ...(hasAny ? { axisSources: nextAxisSources } : {}),
    },
  });
  return { ...plan, nodes: nextNodes };
}

/**
 * ADR-0047 — set the exposure base on a tower (affordance a): the exposure
 * input field, the unit divisor, and the per-account `apply_exposure` flag.
 * These reverse-project onto the chainSpec's `exposure_input` /
 * `exposure_unit_divisor` / `apply_exposure` (coverage towers auto-apply in
 * the projector, PR #325; the flag is load-bearing only for per-account
 * towers). A patch key with a nullish/invalid value clears that field; an
 * absent key leaves it. No-ops if the tower id isn't found. Pure.
 */
export function setTowerExposure(
  plan: TowerPlan,
  towerId: string,
  patch: {
    readonly exposureInput?: string | null;
    readonly exposureUnitDivisor?: number | null;
    readonly applyExposure?: boolean | null;
  },
): TowerPlan {
  const idx = plan.towers.findIndex((t) => t.id === towerId);
  if (idx < 0) return plan;
  const next = { ...plan.towers[idx]! } as {
    -readonly [K in keyof Tower]: Tower[K];
  };
  if ("exposureInput" in patch) {
    const v = patch.exposureInput?.trim();
    if (v) next.exposureInput = v;
    else delete next.exposureInput;
  }
  if ("exposureUnitDivisor" in patch) {
    const v = patch.exposureUnitDivisor;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      next.exposureUnitDivisor = v;
    } else {
      delete next.exposureUnitDivisor;
    }
  }
  if ("applyExposure" in patch) {
    if (typeof patch.applyExposure === "boolean") {
      next.applyExposure = patch.applyExposure;
    } else {
      delete next.applyExposure;
    }
  }
  const nextTowers = [...plan.towers];
  nextTowers[idx] = next;
  return { ...plan, towers: nextTowers };
}

// ── Brief 35 PR 35.3 — spawn N per-level towers from a dim ──

/**
 * Slug-cased identifier suitable for an `outputField` field name.
 * Lowercases, replaces non-alphanumeric with `_`, collapses runs.
 */
function slugifyForOutputField(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_")
    || "level";
}

/** Per-level chip used to spawn a tower; mirrors the brief's wire shape. */
export interface DimLevelSpawnSpec {
  readonly id: string;
  readonly label: string;
}

/** Compact spec for the dim driving the spawn. */
export interface DimSpawnSpec {
  /** Slug — becomes the tower-plan's ratingDimension (e.g., "coverage"). */
  readonly slug: string;
  /** Level set — one per spawned tower. Must be non-empty. */
  readonly levels: readonly DimLevelSpawnSpec[];
}

/**
 * Brief 35 §−1 Q1 + Q8 lock: drop a parametrized dim onto the
 * spawn zone → N per-level towers materialize, one per `dim.levels`.
 * Each tower:
 *
 *   · `id` — `tower_{dimSlug}_{levelId}` (stable across spawns).
 *   · `ratingDimensionValue` — the level's id (Brief 25 carry).
 *   · `name` — `"{level.label} premium"` (display name; user-editable
 *     via `renameNode` on the output cap).
 *   · `outputField` — `"{slug(levelId)}_premium"` (Brief 35 §−1 Q7).
 *   · `entries` — a single output-cap node entry. The Brief 25
 *     guarantee that the output cap is always last + present is
 *     honored; subsequent factor / constant / model drops insert
 *     above the cap via `insertNodeAtPosition`.
 *
 * The plan's `ratingDimension` is set to `dim.slug`, and
 * `ratingDimensionValues` is replaced with the new level ids (the
 * call is "spawn" — it REPLACES the current per-level set rather
 * than appending, matching the brief's intent that a fresh dim drop
 * resets the canvas).
 *
 * Pure: returns a new plan. Throws if `dim.levels` is empty (caller
 * is expected to have filtered unparametrized dims at drop time via
 * `validateDrop`'s `ctx.dimHasLevels` check).
 *
 * Existing tower nodes / groups / constants / models are PRESERVED
 * in the plan's maps — but only the new tower entries reference
 * them. Older tower-internal nodes become orphans; the user can
 * choose to re-wire them (future PR) or they'll be pruned by a
 * future plan-compaction sweep. Spawn does not delete history.
 */
/**
 * Mint the unset `chain-base` node a fresh tower starts with — the
 * first-class editable base-rate affordance (cold-test N20). The chip
 * prompts "Set base rate · tap to edit" until the actuary sets a value
 * via the inspector (`setChainBaseValue`). Mirrors the load-path shape
 * in `stages-to-tower-plan.ts`, so a tower created in-session and one
 * re-hydrated from the substrate are byte-identical.
 *
 * Mutates `nodes` (adds the minted node) and returns it. Caller wires
 * it as the FIRST tower entry (the leftmost multiplicand: base × …).
 */
function makeChainBaseNode(
  outputField: string,
  nodes: Map<string, TowerNode>,
  // F01 — a tower whose base is unset projects to `base_input: ""`, which the
  // substrate rejects (`ChainSpec.base_input` min_length≥1). The batched
  // multiplicative_chain save then 422s and the client drops the offending
  // tower, so a multi-coverage split silently loses every base-unset coverage on
  // reload. Seed the identity rate 1.0 (matching the LCM identity-default
  // precedent) so every fresh tower is immediately a valid, persistable chain;
  // the actuary edits it like any other scalar. Callers that genuinely want an
  // unset base pass `null` explicitly.
  seedBaseValue: number | null = 1,
): TowerNode {
  const id = nextId(`base_${outputField}`, nodes);
  const seeded = seedBaseValue !== null;
  const node: TowerNode = {
    id,
    category: "math",
    subtype: "constant",
    title: "Base rate",
    subtitle: "Base rate · authored constant",
    valueChip: seeded
      ? { primary: String(seedBaseValue), secondary: "starting rate" }
      : { primary: "Set base rate", secondary: "tap to edit" },
    icon: "DollarSign",
    ref: { kind: "chain-base", baseValue: seedBaseValue },
  };
  nodes.set(id, node);
  return node;
}

/**
 * F09 — seed the carrier-LCM constant node so every freshly-created tower shows
 * the same Base × … × LCM scaffold a saved-then-reloaded tower does (the
 * projector adds a default LCM to every chain anyway; without seeding the node,
 * a split-born tower that had round-tripped showed an LCM row while a
 * just-added one did not — confusing scaffold drift). Mirrors the node
 * stages-to-tower-plan materializes on load (role "lcm", value null = the
 * carrier-set default that reads form_input.lcm).
 */
function makeLcmNode(
  outputField: string,
  nodes: Map<string, TowerNode>,
): TowerNode {
  const id = nextId(`const_lcm_${outputField}`, nodes);
  const node: TowerNode = {
    id,
    category: "math",
    subtype: "constant",
    title: "LCM",
    subtitle: "Constant · carrier-set",
    valueChip: { primary: "scalar", secondary: "carrier-set" },
    icon: "Target",
    ref: { kind: "constant", constantId: "LCM", role: "lcm", value: null },
  };
  nodes.set(id, node);
  return node;
}

export function spawnTowersFromDim(
  plan: TowerPlan,
  dim: DimSpawnSpec,
): TowerPlan {
  if (dim.levels.length === 0) {
    throw new Error(
      `spawnTowersFromDim: dim "${dim.slug}" has no levels — drop should have been guarded upstream`,
    );
  }

  const nextNodes = new Map(plan.nodes);
  const towers: Tower[] = [];
  const ratingDimensionValues: string[] = [];

  for (const level of dim.levels) {
    const outputFieldSlug = slugifyForOutputField(level.id);
    const outputField = `${outputFieldSlug}_premium`;
    const towerId = `tower_${dim.slug}_${level.id}`;
    const capId = nextId(`out_${outputField}`, nextNodes);
    // F10 — a coverage level with no display label produced a tower named
    // " premium" (leading space). Fall back to the level id so every split-born
    // tower has a legible name.
    const levelName = level.label?.trim() ? level.label : level.id;

    // Output cap node — sits at the bottom of every tower (Brief 25
    // shape contract). The tower's `outputField` is mirrored on the
    // node's value chip + ref so the trace + the inspector can pull
    // a consistent name.
    const capNode: TowerNode = {
      id: capId,
      category: "output",
      title: levelName,
      valueChip: {
        primary: outputField,
        secondary: "money",
      },
      icon: "Circle",
      ref: { kind: "output", outputField },
    };
    nextNodes.set(capId, capNode);

    // Seed the editable base-rate node as the first multiplicand
    // (cold-test N20 — a tower with no base node can't price) + the carrier LCM
    // (F09 — scaffold parity with reloaded + add-coverage towers).
    const baseNode = makeChainBaseNode(outputField, nextNodes);
    const lcmNode = makeLcmNode(outputField, nextNodes);

    towers.push({
      id: towerId,
      ratingDimensionValue: level.id,
      name: `${levelName} premium`,
      outputField,
      entries: [
        { kind: "node", nodeId: baseNode.id },
        { kind: "node", nodeId: lcmNode.id },
        { kind: "node", nodeId: capId },
      ],
      entryOps: ["multiply", "multiply"],
    });
    ratingDimensionValues.push(level.id);
  }

  return {
    ...plan,
    ratingDimension: dim.slug,
    ratingDimensionValues,
    towers,
    nodes: nextNodes,
  };
}

// ── Brief 45 follow-up B4 — Empty tower (no spawn dim) ───────

/**
 * Brief 45 follow-up B4 — add a single empty tower to the plan.
 *
 * Use case: a plan with no parametrized rating dim to drag into the
 * spawn zone (e.g. a single-product plan that rates one premium).
 * Without this helper the user has no way to materialize a tower
 * from a clean canvas.
 *
 * The tower's `name` is a plain display label (e.g. "Premium"); the
 * `outputField` is the published terminal value. The tower body is a
 * single output-cap node; the user wires up the chain manually from
 * there (drag factors / constants / dims onto the tower body).
 *
 * Pure: returns a new plan. Tower id is minted to avoid
 * collisions; existing towers / nodes / groups / constants are
 * preserved.
 */
export function addEmptyTower(
  plan: TowerPlan,
  params: {
    /**
     * Display name for the tower + the output-cap node title
     * (e.g. "Premium"). A plain label — the user can rename it.
     */
    readonly name: string;
    /**
     * Output field id. The runtime cap node uses this to publish
     * the tower's terminal value; the substrate stage's `outputs`
     * mirrors it. Convention: snake-case, suffixed `_premium`
     * (e.g., `do_premium`, `gl_premium`).
     */
    readonly outputField: string;
    /**
     * Optional rating-dim binding. When the plan IS using a
     * `coverage`-style rating dim, pass the level id so the tower
     * sits in the right slot. For fixed-LOB plans (no rating dim)
     * leave undefined. (`| undefined` so callers can pass a
     * `matchCoverageLevel(...)` miss straight through under
     * exactOptionalPropertyTypes.)
     */
    readonly ratingDimensionValue?: string | undefined;
  },
): TowerPlan {
  // Mint a unique tower id derived from the outputField. Falls
  // back to `tower_n` with a numeric suffix on collision.
  const usedTowerIds = new Set(plan.towers.map((t) => t.id));
  const seed = `tower_${params.outputField
    .replace(/[^a-z0-9_-]/gi, "_")
    .toLowerCase() || "empty"}`;
  let towerId = seed;
  for (let n = 2; usedTowerIds.has(towerId) && n < 9999; n += 1) {
    towerId = `${seed}_${n}`;
  }

  const nextNodes = new Map(plan.nodes);
  const capId = nextId(`out_${params.outputField}`, nextNodes);
  const capNode: TowerNode = {
    id: capId,
    category: "output",
    title: params.name,
    valueChip: {
      primary: params.outputField,
      secondary: "money",
    },
    icon: "Circle",
    ref: { kind: "output", outputField: params.outputField },
  };
  nextNodes.set(capId, capNode);

  // Seed the editable base-rate node as the first multiplicand so a
  // fresh tower can price (cold-test N20 — the CTA path previously
  // created an output-only tower with no reachable base rate) + the carrier LCM
  // (F09 — identical scaffold to the coverage-split path).
  const baseNode = makeChainBaseNode(params.outputField, nextNodes);
  const lcmNode = makeLcmNode(params.outputField, nextNodes);

  const tower: Tower = {
    id: towerId,
    name: params.name,
    outputField: params.outputField,
    entries: [
      { kind: "node", nodeId: baseNode.id },
      { kind: "node", nodeId: lcmNode.id },
      { kind: "node", nodeId: capId },
    ],
    entryOps: ["multiply", "multiply"],
    ...(params.ratingDimensionValue !== undefined
      ? { ratingDimensionValue: params.ratingDimensionValue }
      : {}),
  };

  return {
    ...plan,
    towers: [...plan.towers, tower],
    nodes: nextNodes,
  };
}

/**
 * Platform-test E1 (second half) — match a user-typed coverage name to
 * one of the plan's rating-dimension level ids, so "+ Add coverage" can
 * stamp `ratingDimensionValue` (→ the chain's `coverage_value`) at
 * creation. With the stamp, 2-D coverage-sliced factor tables resolve
 * for the new chain instead of silently skipping the coverage axis.
 *
 * Conservative by design: the slug ("Building premium" → `building`,
 * trailing "premium" dropped) must EXACTLY match an existing level id —
 * anything else returns undefined rather than guessing ("Liability and
 * Medical premium" → `liability_and_medical` ≠ `liability` → no stamp).
 */
export function matchCoverageLevel(
  name: string,
  ratingDimensionValues: readonly string[],
): string | undefined {
  const candidate = name
    .trim()
    .toLowerCase()
    .replace(/\s+premium$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return candidate !== "" && ratingDimensionValues.includes(candidate)
    ? candidate
    : undefined;
}

// ── Brief 35 PR 35.6 — Total tower ───────────────────────────

/**
 * Stable id for the Total tower. Brief 35 §7 — auto-aggregates the
 * per-level chains via `chain.dim_sum`. Lives at a known id so the
 * UI can detect it without scanning + so the converter can map
 * round-trip with the substrate's `chain.dim_sum` stage.
 */
export const TOTAL_TOWER_ID = "tower_total";

/**
 * Default output field name for the Total tower. Brief 35 §7.
 * Mirrors the `DEFAULT_DIM_SUM_OUTPUT_FIELD` constant from
 * `@openrater/contracts`'s `chain.dim_sum` kind (kept in sync at the UI
 * layer rather than imported across packages — @openrater/ui doesn't
 * pull from contracts at runtime).
 */
export const TOTAL_TOWER_OUTPUT_FIELD = "total_premium";

/** Returns true when the tower is the Total tower (id match). */
export function isTotalTower(tower: Tower): boolean {
  return tower.id === TOTAL_TOWER_ID;
}

/**
 * Returns the per-level towers in the plan — excludes the Total
 * tower. Convenience so the Total card can iterate over what it
 * sums without manually filtering.
 */
export function getPerLevelTowers(plan: TowerPlan): readonly Tower[] {
  return plan.towers.filter((t) => !isTotalTower(t));
}

/**
 * Brief 35 §7.1 — Total tab trigger: auto-shows when ≥2 per-level
 * towers exist AND each has at least one terminal node (i.e., the
 * tower can produce a non-degenerate output).
 *
 * Pure boolean derivation from the plan; the Assemble workspace
 * calls this on every plan-state change to decide whether to mount
 * the Total tab + the Total tower card.
 */
export function shouldShowTotalTower(plan: TowerPlan): boolean {
  const perLevel = getPerLevelTowers(plan);
  if (perLevel.length < 2) return false;
  for (const tower of perLevel) {
    if (tower.entries.length === 0) return false;
  }
  return true;
}

/**
 * Add a Total tower to the plan. Idempotent — calling on a plan
 * that already has a Total tower returns the plan unchanged.
 *
 * The Total tower is a thin shell:
 *   · id:                      `TOTAL_TOWER_ID`
 *   · ratingDimensionValue:    undefined (Total ≠ a level)
 *   · name:                    "Total premium"
 *   · outputField:             `TOTAL_TOWER_OUTPUT_FIELD`
 *   · entries:                 single output-cap node
 *   · entryOps:                empty
 *
 * The substrate-side `chain.dim_sum` stage that aggregates the
 * per-level outputs is the converter's responsibility (Brief 35
 * PR 35.6 follow-up); this helper only manages the UI projection.
 */
export function addTotalTower(plan: TowerPlan): TowerPlan {
  if (plan.towers.some(isTotalTower)) return plan;

  const nextNodes = new Map(plan.nodes);
  const capId = nextId(`out_${TOTAL_TOWER_OUTPUT_FIELD}`, nextNodes);
  const capNode: TowerNode = {
    id: capId,
    category: "output",
    title: "Total premium",
    valueChip: {
      primary: TOTAL_TOWER_OUTPUT_FIELD,
      secondary: "money",
    },
    icon: "Sigma",
    ref: { kind: "output", outputField: TOTAL_TOWER_OUTPUT_FIELD },
  };
  nextNodes.set(capId, capNode);

  const totalTower: Tower = {
    id: TOTAL_TOWER_ID,
    name: "Total premium",
    outputField: TOTAL_TOWER_OUTPUT_FIELD,
    entries: [{ kind: "node", nodeId: capId }],
    entryOps: [],
  };

  return {
    ...plan,
    towers: [...plan.towers, totalTower],
    nodes: nextNodes,
  };
}

/**
 * Remove the Total tower from the plan. Idempotent — calling on a
 * plan without a Total tower returns it unchanged.
 *
 * Also prunes the Total's output-cap node from the nodes map so
 * the plan doesn't accumulate dead nodes when the user clears
 * one tower + drops to 1 per-level (which flips
 * shouldShowTotalTower back to false).
 */
export function removeTotalTower(plan: TowerPlan): TowerPlan {
  const totalTower = plan.towers.find(isTotalTower);
  if (!totalTower) return plan;
  const towers = plan.towers.filter((t) => !isTotalTower(t));
  // Prune the cap node(s) the Total tower referenced.
  const removedNodeIds = new Set<string>();
  for (const entry of totalTower.entries) {
    if (entry.kind === "node") {
      removedNodeIds.add(entry.nodeId);
    }
  }
  const nextNodes = new Map(plan.nodes);
  for (const id of removedNodeIds) {
    nextNodes.delete(id);
  }
  return { ...plan, towers, nodes: nextNodes };
}
