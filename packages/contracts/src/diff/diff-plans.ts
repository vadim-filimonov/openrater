/**
 * `diffPlans(a, b)` — structural diff of two Plan objects.
 *
 * Pure + deterministic per Brief 12 P-CP4. Same inputs → byte-
 * identical output (verified by the conformance vectors).
 *
 * Algorithm (Brief 12 §6):
 *   1. Walk both plans' top-level fields in canonical order
 *      (PLAN_TOP_KEYS).
 *   2. For each field, diff the values:
 *      · Both undefined → unchanged
 *      · One side undefined → added/removed
 *      · Different primitives → changed leaf
 *      · Same primitive → unchanged leaf
 *      · Both arrays → diff per-item using array-specific rules
 *      · Both objects → diff per-key using canonical key order
 *   3. Roll up state: a non-leaf is "unchanged" only if EVERY child
 *      is unchanged; otherwise it's "changed".
 *   4. Aggregate counts across the whole tree into DiffSummary.
 *
 * No floating-point suppression (Brief 12 P-CP10 #3 — show all
 * deltas including epsilon). No reordering for "clarity" (P-CP10 #4).
 *
 * Pure. See `docs/design-briefs/comparison-primitive.md` §6.
 */

import type { Plan, PlanEdge, PlanNode } from "../plan-types";
import type { DiffNode, DiffSide, DiffSummary, PlanDiff } from "./types";
import {
  canonicalNodes,
  canonicalEdges,
  edgeKey,
  unionIds,
  unionKeys,
  PLAN_TOP_KEYS,
} from "./canonical";

/**
 * Compute the diff between two Plan objects.
 *
 * The `a` and `b` arguments are not mutated. The result is a
 * structured tree consumers can render as-is (Brief 12 §3 surface 2).
 *
 *   const diff = diffPlans(filedPlan, draftPlan);
 *   if (diff.summary.changed === 0 && diff.summary.added === 0 && diff.summary.removed === 0) {
 *     // Plans are identical.
 *   }
 *
 * Optional side metadata (`a.version`, `b.label`) flows into the
 * `DiffSide` on the returned `PlanDiff` for the UI's column headers.
 */
export function diffPlans(
  a: Plan,
  b: Plan,
  sides?: {
    readonly a?: Omit<DiffSide, "id">;
    readonly b?: Omit<DiffSide, "id">;
  },
): PlanDiff {
  const children: DiffNode[] = [];
  for (const key of PLAN_TOP_KEYS) {
    const childNode = diffPlanField(key, a, b);
    children.push(childNode);
  }
  const rootState = rollupState(children);
  const tree: DiffNode = {
    path: "",
    label: "Plan",
    state: rootState,
    children: Object.freeze(children),
  };
  return {
    a: { id: a.id, ...(sides?.a ?? {}) },
    b: { id: b.id, ...(sides?.b ?? {}) },
    tree,
    summary: aggregateSummary(tree),
  };
}

// ── Top-level field walker ──────────────────────────────────────────

/**
 * Diff one top-level Plan field by key. Returns a DiffNode for the
 * key's subtree (or leaf, depending on the field).
 */
function diffPlanField(key: string, a: Plan, b: Plan): DiffNode {
  const path = key;
  const label = key;
  const aVal = (a as unknown as Record<string, unknown>)[key];
  const bVal = (b as unknown as Record<string, unknown>)[key];

  // Specialized walkers for the structural fields:
  if (key === "nodes") {
    return diffNodesField(path, label, a.nodes, b.nodes);
  }
  if (key === "edges") {
    return diffEdgesField(path, label, a.edges, b.edges);
  }
  if (key === "citations") {
    return diffIdentifiableArray(
      path,
      label,
      a.citations ?? [],
      b.citations ?? [],
    );
  }
  if (key === "testBench") {
    return diffIdentifiableArray(
      path,
      label,
      a.testBench ?? [],
      b.testBench ?? [],
    );
  }

  // Everything else is a primitive/object field — diff generically.
  return diffValue(path, label, aVal, bVal);
}

// ── Nodes ─────────────────────────────────────────────────────────────

function diffNodesField(
  parentPath: string,
  label: string,
  aNodes: readonly PlanNode[],
  bNodes: readonly PlanNode[],
): DiffNode {
  const sortedA = canonicalNodes(aNodes);
  const sortedB = canonicalNodes(bNodes);
  const ids = unionIds(sortedA, sortedB);
  const aById = new Map(sortedA.map((n) => [n.id, n]));
  const bById = new Map(sortedB.map((n) => [n.id, n]));
  const children: DiffNode[] = [];
  for (const id of ids) {
    const av = aById.get(id);
    const bv = bById.get(id);
    const path = `${parentPath}.${id}`;
    children.push(diffNodeEntry(path, id, av, bv));
  }
  return {
    path: parentPath,
    label,
    state: rollupState(children),
    children: Object.freeze(children),
  };
}

function diffNodeEntry(
  path: string,
  id: string,
  a: PlanNode | undefined,
  b: PlanNode | undefined,
): DiffNode {
  const label = `Node '${id}'`;
  if (a === undefined && b !== undefined) {
    return { path, label, state: "added", b_value: b };
  }
  if (b === undefined && a !== undefined) {
    return { path, label, state: "removed", a_value: a };
  }
  // Both present — diff their fields
  return diffObjectByKeys(
    path,
    label,
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>,
  );
}

// ── Edges ─────────────────────────────────────────────────────────────

function diffEdgesField(
  parentPath: string,
  label: string,
  aEdges: readonly PlanEdge[],
  bEdges: readonly PlanEdge[],
): DiffNode {
  const sortedA = canonicalEdges(aEdges);
  const sortedB = canonicalEdges(bEdges);
  const aByKey = new Map<string, PlanEdge>();
  const bByKey = new Map<string, PlanEdge>();
  for (const e of sortedA) aByKey.set(edgeKey(e), e);
  for (const e of sortedB) bByKey.set(edgeKey(e), e);
  const keys = [
    ...new Set<string>([...aByKey.keys(), ...bByKey.keys()]),
  ].sort();
  const children: DiffNode[] = [];
  for (const k of keys) {
    const a = aByKey.get(k);
    const b = bByKey.get(k);
    const path = `${parentPath}.${k}`;
    const labelText = `Edge ${k}`;
    if (a === undefined && b !== undefined) {
      children.push({ path, label: labelText, state: "added", b_value: b });
      continue;
    }
    if (b === undefined && a !== undefined) {
      children.push({ path, label: labelText, state: "removed", a_value: a });
      continue;
    }
    // Identical by key construction — both endpoints match exactly.
    // Edges have no internal state beyond from/to, so they're unchanged.
    children.push({ path, label: labelText, state: "unchanged" });
  }
  return {
    path: parentPath,
    label,
    state: rollupState(children),
    children: Object.freeze(children),
  };
}

// ── Citation / testBench arrays (identifiable by id) ─────────────────

function diffIdentifiableArray(
  parentPath: string,
  label: string,
  aArr: readonly { id: string }[],
  bArr: readonly { id: string }[],
): DiffNode {
  const ids = unionIds(aArr, bArr);
  const aById = new Map(aArr.map((x) => [x.id, x]));
  const bById = new Map(bArr.map((x) => [x.id, x]));
  const children: DiffNode[] = [];
  for (const id of ids) {
    const a = aById.get(id);
    const b = bById.get(id);
    const path = `${parentPath}.${id}`;
    if (a === undefined && b !== undefined) {
      children.push({
        path,
        label: `Entry '${id}'`,
        state: "added",
        b_value: b,
      });
      continue;
    }
    if (b === undefined && a !== undefined) {
      children.push({
        path,
        label: `Entry '${id}'`,
        state: "removed",
        a_value: a,
      });
      continue;
    }
    children.push(
      diffObjectByKeys(
        path,
        `Entry '${id}'`,
        a as unknown as Record<string, unknown>,
        b as unknown as Record<string, unknown>,
      ),
    );
  }
  return {
    path: parentPath,
    label,
    state: rollupState(children),
    children: Object.freeze(children),
  };
}

// ── Generic value walker ────────────────────────────────────────────

/**
 * Diff two unknown values. Handles primitives, plain objects, arrays
 * (positionally), null/undefined.
 *
 * For objects: diff per key using canonical key order.
 * For arrays of opaque entries: positional diff with bracket-syntax
 * paths (e.g., `edges[3]`).
 */
export function diffValue(
  path: string,
  label: string,
  a: unknown,
  b: unknown,
): DiffNode {
  // Both undefined: unchanged
  if (a === undefined && b === undefined) {
    return { path, label, state: "unchanged" };
  }
  if (a === undefined) {
    return { path, label, state: "added", b_value: b };
  }
  if (b === undefined) {
    return { path, label, state: "removed", a_value: a };
  }
  // Both present — type-driven diff:
  if (isPlainObject(a) && isPlainObject(b)) {
    return diffObjectByKeys(path, label, a, b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return diffArrayPositional(path, label, a, b);
  }
  // Primitives (or mixed types — string vs number, etc.)
  if (valuesEqual(a, b)) {
    return { path, label, state: "unchanged" };
  }
  return { path, label, state: "changed", a_value: a, b_value: b };
}

function diffObjectByKeys(
  path: string,
  label: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): DiffNode {
  const keys = unionKeys(a, b);
  const children: DiffNode[] = [];
  for (const k of keys) {
    const childPath = path === "" ? k : `${path}.${k}`;
    children.push(diffValue(childPath, k, a[k], b[k]));
  }
  return {
    path,
    label,
    state: rollupState(children),
    children: Object.freeze(children),
  };
}

function diffArrayPositional(
  path: string,
  label: string,
  a: readonly unknown[],
  b: readonly unknown[],
): DiffNode {
  const len = Math.max(a.length, b.length);
  const children: DiffNode[] = [];
  for (let i = 0; i < len; i++) {
    const childPath = `${path}[${i}]`;
    const childLabel = `[${i}]`;
    children.push(diffValue(childPath, childLabel, a[i], b[i]));
  }
  return {
    path,
    label,
    state: rollupState(children),
    children: Object.freeze(children),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Strict equality with NaN-aware comparison. NaN !== NaN under ===,
 * but two NaN values in plan params should be diffed as equal (a
 * "missing" value that the actuary represents as NaN should not
 * spuriously trip the diff).
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
  }
  return false;
}

/**
 * Roll up child diff states to the parent. "unchanged" only when
 * EVERY child is unchanged; otherwise "changed". (Added/removed
 * roll up to "changed" at the parent — the parent itself exists in
 * both A and B; only its contents changed.)
 */
function rollupState(children: readonly DiffNode[]): "unchanged" | "changed" {
  for (const c of children) {
    if (c.state !== "unchanged") return "changed";
  }
  return "unchanged";
}

/**
 * Recursively count diff states across a tree to produce a
 * DiffSummary. Counts LEAVES only — non-leaf "changed" rollups are
 * structural and shouldn't double-count.
 */
function aggregateSummary(root: DiffNode): DiffSummary {
  let changed = 0;
  let added = 0;
  let removed = 0;
  let inspected = 0;
  walk(root);
  function walk(n: DiffNode): void {
    if (n.children && n.children.length > 0) {
      for (const c of n.children) walk(c);
    } else {
      // Leaf
      inspected++;
      if (n.state === "changed") changed++;
      else if (n.state === "added") added++;
      else if (n.state === "removed") removed++;
    }
  }
  return { changed, added, removed, inspected };
}
