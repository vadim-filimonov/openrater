/**
 * `diffTraces(a, b)` — per-step trace comparison with first-
 * divergence detection.
 *
 * Brief 12 P-CP9 — "diverges here ⇧" marker on the FIRST step where
 * outputs differ. The actuary debugging two runs jumps straight to
 * the root cause instead of reading through identical steps.
 *
 * Algorithm:
 *   1. Pair trace entries by their key (node id).
 *   2. Walk in canonical (lexicographic) node-id order.
 *   3. For each pair: diff their outputs.
 *   4. The FIRST step (in canonical order) whose outputs differ
 *      becomes `firstDivergingNodeId`.
 *
 * Why canonical (lex) order vs topological execution order?
 *   - Topological order requires re-deriving from the source plan
 *     (we don't have a CompiledPlan handle here, only the
 *     run-result trace records).
 *   - For determinism, lex order is sufficient + reproducible.
 *   - The UI can re-sort by topological order when it has the plan
 *     context; the substrate gives a deterministic ordering.
 *
 * Pure.
 */

import type { TraceEntry } from "../plan-types";
import type { DiffNode, DiffSide, RateImpact, TraceDiff } from "./types";
import { diffValue } from "./diff-plans";

/**
 * Compute the diff between two run traces.
 *
 *   const td = diffTraces(runA.trace, runB.trace);
 *   if (td.firstDivergingNodeId) {
 *     console.log(`Runs diverge at step '${td.firstDivergingNodeId}'`);
 *   }
 *
 * @param sides — optional DiffSide metadata for the UI's column
 *   headers (e.g., `{ a: { id: 'run_a', label: 'Draft v3' } }`).
 *
 * @param options — optional walk-order overrides.
 *   - `topoOrder`: when provided (e.g., from a CompiledPlan's
 *     `topoOrder`), the walker uses execution order rather than
 *     lex order for both step traversal AND first-divergence
 *     detection. This makes "firstDivergingNodeId" mean "first by
 *     execution," which is what the actuary expects (debugging
 *     question: "where in the cascade does B diverge from A?").
 *     Steps that appear in either trace but not in topoOrder are
 *     appended at the end in lex order — preserving completeness.
 *     When omitted, lex order is used (V1 baseline).
 */
export function diffTraces(
  a: Readonly<Record<string, TraceEntry>>,
  b: Readonly<Record<string, TraceEntry>>,
  sides?: {
    readonly a?: DiffSide;
    readonly b?: DiffSide;
  },
  options?: { readonly topoOrder?: readonly string[] },
): TraceDiff {
  const nodeIds = options?.topoOrder
    ? walkOrderFromTopo(a, b, options.topoOrder)
    : unionTraceIds(a, b);
  const children: DiffNode[] = [];
  let firstDivergingNodeId: string | null = null;
  let changed = 0;
  let added = 0;
  let removed = 0;
  let inspected = 0;

  for (const id of nodeIds) {
    const aEntry = a[id];
    const bEntry = b[id];
    const childPath = `trace.${id}`;
    const childLabel = `Step '${id}'`;
    if (aEntry === undefined && bEntry !== undefined) {
      children.push({
        path: childPath,
        label: childLabel,
        state: "added",
        b_value: bEntry,
      });
      added++;
      inspected++;
      continue;
    }
    if (bEntry === undefined && aEntry !== undefined) {
      children.push({
        path: childPath,
        label: childLabel,
        state: "removed",
        a_value: aEntry,
      });
      removed++;
      inspected++;
      continue;
    }
    if (aEntry !== undefined && bEntry !== undefined) {
      const stepDiff = diffTraceStep(childPath, childLabel, aEntry, bEntry);
      children.push(stepDiff);
      const stepStats = countLeafStats(stepDiff);
      changed += stepStats.changed;
      added += stepStats.added;
      removed += stepStats.removed;
      inspected += stepStats.inspected;

      // First-divergence detection on the OUTPUTS subtree specifically
      // — diffs in citation/explanation are bookkeeping, not data
      // divergence. The actuary cares about where the OUTPUTS differ.
      if (firstDivergingNodeId === null && hasOutputsDivergence(stepDiff)) {
        firstDivergingNodeId = id;
      }
    }
  }

  const tree: DiffNode = {
    path: "trace",
    label: "Trace",
    state: children.some((c) => c.state !== "unchanged")
      ? "changed"
      : "unchanged",
    children: Object.freeze(children),
  };
  return {
    a: sides?.a ?? { id: "a" },
    b: sides?.b ?? { id: "b" },
    tree,
    summary: { changed, added, removed, inspected },
    firstDivergingNodeId,
  };
}

// ── Per-step diff ───────────────────────────────────────────────────

/**
 * Diff a pair of trace entries that share a node id. Walks the
 * structural fields of TraceEntry (kindId, inputs, outputs, citation,
 * explanation, error).
 */
function diffTraceStep(
  path: string,
  label: string,
  a: TraceEntry,
  b: TraceEntry,
): DiffNode {
  const fields: DiffNode[] = [];
  for (const key of [
    "kindId",
    "inputs",
    "outputs",
    "citation",
    "explanation",
    "error",
  ] as const) {
    const childPath = `${path}.${key}`;
    const childLabel = key;
    const aVal = (a as unknown as Record<string, unknown>)[key];
    const bVal = (b as unknown as Record<string, unknown>)[key];
    const childNode = diffValue(childPath, childLabel, aVal, bVal);
    // Decorate the outputs subtree with rate impact when both sides
    // have numeric outputs of the same key.
    if (key === "outputs") {
      fields.push(decorateOutputsWithImpact(childNode, a, b));
    } else {
      fields.push(childNode);
    }
  }
  return {
    path,
    label,
    state: fields.some((c) => c.state !== "unchanged") ? "changed" : "unchanged",
    children: Object.freeze(fields),
  };
}

/**
 * Walk the outputs subtree and attach `rate_impact` to leaves where
 * both sides are numeric. The impact is a SIGNED dollar delta + a
 * percent delta (relative to A's value, when A is non-zero).
 *
 * For run-vs-run debugging this is the killer feature — each step's
 * row shows "+$235 (+4.5%)" or "−$45 (−0.8%)" inline.
 */
function decorateOutputsWithImpact(
  outputsNode: DiffNode,
  a: TraceEntry,
  b: TraceEntry,
): DiffNode {
  if (!outputsNode.children || outputsNode.children.length === 0) {
    return outputsNode;
  }
  const decorated: DiffNode[] = outputsNode.children.map((child) => {
    if (child.state !== "changed") return child;
    const av = a.outputs[child.label];
    const bv = b.outputs[child.label];
    if (typeof av === "number" && typeof bv === "number") {
      return { ...child, rate_impact: numericImpact(av, bv) };
    }
    return child;
  });
  return { ...outputsNode, children: Object.freeze(decorated) };
}

function numericImpact(av: number, bv: number): RateImpact {
  const dollars = bv - av;
  // Percent is relative to A; when A is 0, we report 0 to avoid
  // division-by-zero (the dollar delta is still meaningful).
  const pct = av === 0 ? 0 : (dollars / av) * 100;
  return { dollars, pct };
}

// ── Outputs-divergence detection (for first-divergence marker) ───

function hasOutputsDivergence(stepDiff: DiffNode): boolean {
  if (!stepDiff.children) return false;
  const outputsField = stepDiff.children.find((c) => c.label === "outputs");
  if (!outputsField) return false;
  return outputsField.state !== "unchanged";
}

// ── Helpers ──────────────────────────────────────────────────────────

function unionTraceIds(
  a: Readonly<Record<string, TraceEntry>>,
  b: Readonly<Record<string, TraceEntry>>,
): string[] {
  const set = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  return [...set].sort();
}

/**
 * Build a walk order using the supplied topological order, then
 * appending any trace ids not present in topoOrder (lex-sorted, to
 * keep the tail deterministic).
 *
 * Useful when one trace contains a step that was removed in the
 * other plan version, or when topoOrder reflects only one plan's
 * node set.
 */
function walkOrderFromTopo(
  a: Readonly<Record<string, TraceEntry>>,
  b: Readonly<Record<string, TraceEntry>>,
  topo: readonly string[],
): string[] {
  const present = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const inTopo = new Set<string>();
  const out: string[] = [];
  for (const id of topo) {
    if (present.has(id) && !inTopo.has(id)) {
      out.push(id);
      inTopo.add(id);
    }
  }
  const tail: string[] = [];
  for (const id of present) {
    if (!inTopo.has(id)) tail.push(id);
  }
  tail.sort();
  return [...out, ...tail];
}

/**
 * Count leaf changed/added/removed/inspected within a subtree.
 * Mirrors the aggregator in diff-plans but local to a step.
 */
function countLeafStats(node: DiffNode): {
  changed: number;
  added: number;
  removed: number;
  inspected: number;
} {
  let changed = 0;
  let added = 0;
  let removed = 0;
  let inspected = 0;
  walk(node);
  function walk(n: DiffNode): void {
    if (n.children && n.children.length > 0) {
      for (const c of n.children) walk(c);
    } else {
      inspected++;
      if (n.state === "changed") changed++;
      else if (n.state === "added") added++;
      else if (n.state === "removed") removed++;
    }
  }
  return { changed, added, removed, inspected };
}
