/**
 * Build-up ledger computation — Brief 48 §3.4 / phase 4.
 *
 * A tower is a multiplicative chain: `base × f₁ × f₂ × … × LCM`, floored
 * at a minimum. The build-up ledger is the *receipt*: the running total
 * after each line item (`$600 → $720 → … → $1,561`). This module turns a
 * tower + a per-node value resolver into that running margin.
 *
 * Design:
 *   - PURE. No scoring, no engine, no I/O. The caller injects a
 *     `resolveValue(node)` — at test time a fixture, at wire time a reader
 *     over the scored run trace + authored constants. This keeps the fold
 *     decoupled from *how* a value was obtained.
 *   - GENERIC (Genericity §0). The fold is arithmetic over the tower's
 *     own `entryOps`; it never branches on a product, coverage, or factor
 *     name. Strip the labels and the math is unchanged.
 *   - HONEST. If any needed value is unresolved, the running total goes
 *     `undefined` from that point and `scored` is false — the UI then
 *     shows the collapsed/unscored state (§4) rather than a fake number.
 *
 * Scope (v1): flat towers of `node` entries (the shape `stagesToTowerPlan`
 * emits for multiplicative chains). `group` entries are not expanded yet
 * (no cold-test tower uses them); they're skipped and force `scored=false`
 * so the ledger collapses rather than lying.
 */

import type { NodeCategory, Operator, Tower, TowerNode } from "./types";

/** One line of the build-up — a tower entry and the running total after it. */
export interface BuildUpStep {
  readonly nodeId: string;
  readonly category: NodeCategory;
  /**
   * This node's OWN value: the base dollars, a factor's `×` multiplier, a
   * constant's value. `undefined` when unresolved, or for the output cap
   * (which is the result, not a multiplier).
   */
  readonly value: number | undefined;
  /** Operator folding this node into the running total; `undefined` for the base + the cap. */
  readonly op: Operator | undefined;
  /** Running total AFTER folding this node. `undefined` once anything upstream is unresolved. */
  readonly running: number | undefined;
}

/** The full build-up for one tower. */
export interface TowerBuildUp {
  readonly steps: readonly BuildUpStep[];
  /** Final premium = the running total at the output cap (after `finalOp`). */
  readonly premium: number | undefined;
  /** True only when every folded value resolved AND a premium was produced. */
  readonly scored: boolean;
}

/** A node's resolved scalar for a given risk, or `undefined` if not scorable. */
export type ValueResolver = (node: TowerNode) => number | undefined;

/** Fold one node's value into the running total per the gap operator. */
function applyOp(
  a: number | undefined,
  op: Operator,
  b: number | undefined,
): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  switch (op) {
    case "multiply":
      return a * b;
    case "divide":
      return b === 0 ? undefined : a / b;
    case "plus":
      return a + b;
    case "minus":
      return a - b;
    case "max":
      return Math.max(a, b);
    case "min":
      return Math.min(a, b);
    case "round":
      // round is unary in practice (round the running total); b is ignored.
      return Math.round(a);
    case "pair":
      // `pair` is a structural grouping op, not arithmetic — pass through.
      return a;
    default:
      return undefined;
  }
}

/** Apply the tower's optional trailing unary op (e.g. a final round). */
function applyFinal(op: Operator | undefined, a: number): number {
  if (op === "round") return Math.round(a);
  return a;
}

/**
 * Compute the running-total build-up for a tower.
 *
 * Walks `tower.entries` top → bottom, folding each node into the running
 * total via the matching `tower.entryOps` gap operator. The first node is
 * the base (seeds the running total, no operator). The `output`-category
 * cap is NOT folded — it *is* the running total (the premium).
 */
export function computeTowerBuildUp(
  tower: Tower,
  nodesById: ReadonlyMap<string, TowerNode>,
  resolveValue: ValueResolver,
): TowerBuildUp {
  const steps: BuildUpStep[] = [];
  let running: number | undefined = undefined;
  let baseSeen = false;
  // Tracks whether anything we needed to fold was unresolved (or a group
  // entry was encountered). Either makes the build-up incomplete.
  let incomplete = false;

  tower.entries.forEach((entry, idx) => {
    if (entry.kind === "drop-slot") return; // transient UI affordance
    if (entry.kind === "group") {
      // v1 doesn't expand groups — be honest, don't fabricate a total.
      incomplete = true;
      return;
    }
    const node = nodesById.get(entry.nodeId);
    if (!node) {
      incomplete = true;
      return;
    }

    // The output cap is the answer, not a line item — it carries the
    // running total (the premium) but no multiplier of its own.
    if (node.category === "output") {
      steps.push({
        nodeId: node.id,
        category: node.category,
        value: undefined,
        op: undefined,
        running,
      });
      return;
    }

    const value = resolveValue(node);
    if (value === undefined) incomplete = true;

    if (!baseSeen) {
      // The base seeds the running total (no operator above it).
      baseSeen = true;
      running = value;
      steps.push({
        nodeId: node.id,
        category: node.category,
        value,
        op: undefined,
        running,
      });
      return;
    }

    // entryOps is indexed by gap: entryOps[idx-1] sits above entry idx.
    const op = tower.entryOps[idx - 1] ?? "multiply";
    running = applyOp(running, op, value);
    steps.push({
      nodeId: node.id,
      category: node.category,
      value,
      op,
      running,
    });
  });

  const premium =
    running === undefined ? undefined : applyFinal(tower.finalOp, running);
  const scored = !incomplete && premium !== undefined;

  return { steps, premium, scored };
}
