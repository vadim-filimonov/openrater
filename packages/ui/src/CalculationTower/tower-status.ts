/**
 * <CalculationTower> — Brief 35.9 PR 35.9.1.
 *
 * Per-tower status substrate. Classifies a tower as `empty | draft |
 * complete` based on its entry shape. The status drives:
 *
 *   - Per-tab dot color in <TowerTabBar> (Gap 9 from Brief 35.8 audit)
 *   - Sibling-status roll-up in <AssembleInspector> (Gap 12)
 *
 * Status definition (v1):
 *   · **empty**     — zero substantive entries. A tower with only the
 *                     structural output-cap node (auto-added by every
 *                     converter) reads as empty. Drop-slot entries are
 *                     UI-only and don't count.
 *   · **draft**     — has ≥1 substantive (non-output) entry. This is
 *                     the default working state — most towers spend
 *                     their lifetime here.
 *   · **complete**  — explicit-only in v1. There's no auto-derivation
 *                     path yet because "ready to ship" requires
 *                     business judgement (factor coverage, citation
 *                     completeness, eligibility-gate matches, etc.).
 *                     A future "Mark complete" affordance writes a
 *                     `Tower.completedAt?` field; the helper reads
 *                     that field when present.
 *
 * The helper is pure (Tower in, status out) so it composes cleanly
 * with React.memo + caller-side memoization. No side effects, no
 * IO, no hooks.
 *
 * Brief 35.9 only adds the auto-empty / auto-draft branches; the
 * auto-complete branch lands when the "Mark complete" UX is
 * designed (deferred to a follow-up brief).
 */

import type { Tower, TowerEntry, TowerGroup, TowerNode } from "./types";

/**
 * The three states a tower can be in.
 *
 * Maps 1:1 onto the tab-dot color rule in <TowerTabBar>:
 *   empty    → zinc-600 (placeholder)
 *   draft    → cat-loading (orange — "in progress")
 *   complete → cat-math (emerald — "ready")
 */
export type TowerStatus = "empty" | "draft" | "complete";

/**
 * Decide whether a tower entry counts as "substantive" — i.e., it
 * represents user-authored work rather than structural scaffolding.
 *
 *   - `node` entries count IF the underlying node is non-output.
 *     Output-cap nodes (category === "output") are auto-added by
 *     every converter and don't represent work.
 *   - `group` entries always count (groups wrap user-authored
 *     siblings; can't be auto-added).
 *   - `drop-slot` entries never count (UI-only placeholders).
 *
 * Exported separately so callers can spot-check a single entry
 * without computing the full tower status (e.g., for a node-edit
 * undo gate).
 */
export function isSubstantiveEntry(
  entry: TowerEntry,
  nodesById: ReadonlyMap<string, TowerNode>,
): boolean {
  if (entry.kind === "drop-slot") return false;
  if (entry.kind === "group") return true;
  // node — defer to the underlying node's category.
  const node = nodesById.get(entry.nodeId);
  if (!node) return false; // dangling ref — treat as non-substantive
  return node.category !== "output";
}

/**
 * Compute the status of a single tower.
 *
 * Requires `nodesById` so we can resolve `entry.nodeId` references
 * to check `node.category`. Typically the caller passes
 * `plan.nodes` from a `TowerPlan`.
 *
 * Behavior:
 *   1. If `tower.completedAt` is set (future field) → `"complete"`.
 *      Not exercised in v1 — reserved for the "Mark complete"
 *      affordance. The runtime check is duck-typed (`as unknown`)
 *      so today's Tower shape compiles cleanly.
 *   2. Else if any entry is substantive → `"draft"`.
 *   3. Else → `"empty"`.
 *
 * Pure — no side effects, deterministic.
 */
export function computeTowerStatus(
  tower: Tower,
  nodesById: ReadonlyMap<string, TowerNode>,
): TowerStatus {
  // Future "Mark complete" field — duck-typed read for forward compat.
  // When the substrate lands `Tower.completedAt?: string`, this line
  // starts surfacing the complete state automatically.
  const completedAt = (tower as unknown as { completedAt?: string })
    .completedAt;
  if (completedAt !== undefined) return "complete";

  const hasSubstantive = tower.entries.some((e) =>
    isSubstantiveEntry(e, nodesById),
  );
  return hasSubstantive ? "draft" : "empty";
}

/**
 * E12 — will this tower actually PRICE a premium?
 *
 * A tower is "scoreable" iff the save converter (`towerPlanToStages` →
 * `projectTowerToChain`) would emit a real `multiplicative_chain` for it.
 * That happens iff the tower carries either:
 *
 *   · ≥1 factor-table node (`ref.kind === "factor-table"`), OR
 *   · a `chain-base` node with a committed literal (`ref.baseValue !== null`).
 *
 * This is DISTINCT from `computeTowerStatus`: a fresh "Start single-coverage
 * build" tower has a `chain-base` node (category `math` → "substantive" →
 * `"draft"` status) AND an output cap, yet until the actuary commits a base
 * rate it projects to ZERO chain stages. The content-dirty signal then sees
 * no change and nothing persists — the actuary builds a visible tower that
 * silently saves nothing scoreable. This predicate names that gap so the UI
 * can prompt "set a base rate or add a factor" instead of letting the tower
 * read as quietly-saved-and-done.
 *
 * Kept in lockstep with `projectTowerToChain`'s null guard — if that guard
 * changes (e.g. a new "real chain" trigger), update this together. The
 * single-coverage scoring test pins the two against each other.
 *
 * Pure — Tower in, boolean out. `groupsById` is optional; when omitted a
 * group entry is treated as price-capable (a grouped run is authored work
 * that, in practice, always carries a factor). Pass `plan.groups` for the
 * exact check.
 */
export function towerWillPrice(
  tower: Tower,
  nodesById: ReadonlyMap<string, TowerNode>,
  groupsById?: ReadonlyMap<string, TowerGroup>,
): boolean {
  const nodePrices = (node: TowerNode | undefined): boolean => {
    const ref = node?.ref;
    if (!ref) return false;
    if (ref.kind === "factor-table") return true;
    if (ref.kind === "chain-base" && ref.baseValue !== null) return true;
    return false;
  };
  for (const entry of tower.entries) {
    if (entry.kind === "node") {
      if (nodePrices(nodesById.get(entry.nodeId))) return true;
      continue;
    }
    if (entry.kind === "group") {
      const group = groupsById?.get(entry.groupId);
      if (!group) return true; // conservative: an authored group prices
      if (group.nodeIds.some((id) => nodePrices(nodesById.get(id)))) return true;
    }
  }
  return false;
}

/**
 * Compute statuses for every tower in a plan, keyed by `tower.id`.
 *
 * Convenience for consumers that need to render the sibling-status
 * roll-up in <AssembleInspector> — pass the full map to <TowerTab[]>
 * builders without re-computing per-tab.
 */
export function computeAllTowerStatuses(
  towers: readonly Tower[],
  nodesById: ReadonlyMap<string, TowerNode>,
): ReadonlyMap<string, TowerStatus> {
  const out = new Map<string, TowerStatus>();
  for (const t of towers) {
    out.set(t.id, computeTowerStatus(t, nodesById));
  }
  return out;
}
