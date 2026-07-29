/**
 * Diff library types — Brief 12 (Comparison primitive).
 *
 * Pure data shapes for plan diff, run diff, trace diff. The library
 * functions in this directory produce these shapes from two inputs
 * each; the @openrater/ui `<PlanCompareView>` primitive consumes
 * them verbatim.
 *
 * Determinism guarantee per Brief 12 P-CP4: same inputs → byte-
 * identical outputs. Achieved via canonical ordering (see
 * `canonical.ts`), no floating-point suppression (Brief 12 Q9 /
 * P-CP10 #3 — show all deltas including 0.0001), and deterministic
 * traversal.
 *
 * See `docs/design-briefs/comparison-primitive.md` §6 for the full
 * design + §11 for the audit semantics.
 */

/**
 * Diff state per node. Every DiffNode carries one of these.
 *
 *   unchanged — values are identical (a === b for primitives, or
 *               structural equality for objects/arrays)
 *   changed   — values differ (leaf-level)
 *   added     — present in b but not a (new in newer version)
 *   removed   — present in a but not b (removed in newer version)
 *
 * For non-leaf nodes (objects with children), state is the rollup:
 *   - "unchanged" if every child is unchanged
 *   - "changed" if any child differs (including added/removed)
 */
export type DiffState = "unchanged" | "changed" | "added" | "removed";

/**
 * Rate impact attached to a diff node. Computed only when:
 *   - Mode is run-vs-run OR proposed-vs-filed
 *   - A sample submission is bound
 *   - The diff node touches a factor that contributes to premium
 *
 * Brief 12 P-CP3 ("Rate impact when applicable"). Dollars are signed
 * (positive = increase under B, negative = decrease).
 */
export interface RateImpact {
  /** Signed dollar delta from A to B. */
  readonly dollars: number;
  /** Signed percentage delta from A to B. */
  readonly pct: number;
}

/**
 * Where this diff row's source field lives in the plan structure.
 * Drives the "deep-link from diff row to editor" affordance
 * (Brief 12 P-CP6).
 */
export interface DiffDeeplink {
  /** Spine section id (e.g., "dimensions", "classification"). */
  readonly section: string;
  /** Optional entity id within the section. */
  readonly entity?: string;
  /** Optional field within the entity. */
  readonly field?: string;
}

/**
 * One node in the diff tree. Hierarchical — non-leaf nodes have
 * children; leaf nodes have a_value + b_value.
 *
 * Path is dot-separated using keys (NOT array indices when the array
 * has identifiable entries like nodes-by-id; index syntax only for
 * truly opaque arrays). This makes paths stable across reorderings:
 *
 *   nodes.cls_factor.params.value       (stable across node reordering)
 *   edges[3].from.node                   (positional — edges have no id)
 */
export interface DiffNode {
  /** Dot-separated traversal path (e.g., "nodes.cls_factor.params.value"). */
  readonly path: string;
  /** Human-readable label for the row (e.g., "Node 'cls_factor' params.value"). */
  readonly label: string;
  /** Diff state. */
  readonly state: DiffState;
  /** Value in plan A. Present when state is "changed" or "removed". */
  readonly a_value?: unknown;
  /** Value in plan B. Present when state is "changed" or "added". */
  readonly b_value?: unknown;
  /** Children for non-leaf nodes. Empty for leaves. */
  readonly children?: readonly DiffNode[];
  /** Rate impact when computable. */
  readonly rate_impact?: RateImpact;
  /** Deep-link target. */
  readonly deeplink?: DiffDeeplink;
}

/**
 * Summary counts for a diff. Useful for the drawer header ("3
 * changed, 1 added, 0 removed") + the comparison view top chip.
 */
export interface DiffSummary {
  readonly changed: number;
  readonly added: number;
  readonly removed: number;
  /** Total nodes inspected (including unchanged). */
  readonly inspected: number;
}

/**
 * Identifier metadata for one side of a diff. Echoed back in the
 * diff result so the UI can label "A: BOP-WI v3 draft" vs
 * "B: BOP-WI v2 filed" without re-deriving from the source.
 */
export interface DiffSide<TId = string> {
  readonly id: TId;
  /** Optional version + human label for display. */
  readonly version?: number | string;
  readonly label?: string;
}

/**
 * Result of `diffPlans(a, b)`. Structural diff of two Plan objects.
 */
export interface PlanDiff {
  readonly a: DiffSide;
  readonly b: DiffSide;
  /** The root of the diff tree. Always present; "unchanged" when
   *  the two plans are byte-identical. */
  readonly tree: DiffNode;
  /** Aggregated counts. */
  readonly summary: DiffSummary;
}

/**
 * Result of `diffTraces(a, b)`. Per-step trace comparison.
 *
 * The tree is keyed by trace step id (node id). First-divergence
 * detection per Brief 12 P-CP9 lives in `firstDivergingNodeId`.
 */
export interface TraceDiff {
  readonly a: DiffSide;
  readonly b: DiffSide;
  /** Root of the trace diff tree (one child per step pair, plus
   *  added/removed children when steps differ between runs). */
  readonly tree: DiffNode;
  readonly summary: DiffSummary;
  /** Node id of the FIRST trace step where outputs diverge.
   *  `null` when traces are identical. Brief 12 P-CP9 — the
   *  debugging killer feature. */
  readonly firstDivergingNodeId: string | null;
}

/**
 * Result of `diffRuns(a, b)`. Full run comparison including outputs
 * + trace + per-step rate impact.
 */
export interface RunDiff {
  readonly a: DiffSide;
  readonly b: DiffSide;
  /** Outputs diff (one child per output key). */
  readonly outputs: DiffNode;
  /** Trace diff (delegates to diffTraces under the hood). */
  readonly trace: TraceDiff;
  /** Aggregated summary across BOTH outputs and trace. */
  readonly summary: DiffSummary;
  /** Total premium delta if computable (a + b both have a primary
   *  `total_premium` output). Null otherwise. */
  readonly total_impact: RateImpact | null;
}
