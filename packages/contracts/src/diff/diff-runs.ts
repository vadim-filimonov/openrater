/**
 * `diffRuns(a, b)` — full run comparison.
 *
 * Brief 12 (Comparison primitive) — combines:
 *   - Output diff (one DiffNode per output key)
 *   - Trace diff (via diffTraces; first-divergence detection)
 *   - Total premium impact (if both runs produced `total_premium`)
 *
 * Pure. Same inputs → byte-identical output per Brief 12 P-CP4.
 */

import type { RunResult } from "../plan-types";
import { diffValue } from "./diff-plans";
import { diffTraces } from "./diff-traces";
import type { DiffNode, DiffSide, RateImpact, RunDiff } from "./types";

/**
 * Compute the diff between two RunResult objects.
 *
 *   const rd = diffRuns(runA, runB);
 *   console.log(`Premium impact: ${rd.total_impact?.dollars} (${rd.total_impact?.pct}%)`);
 *   console.log(`First divergence: ${rd.trace.firstDivergingNodeId}`);
 *
 * Per Brief 12 §6 (Diff algorithm — RunDiff path).
 *
 * @param options — optional walk-order overrides. When `topoOrder`
 *   is provided (from a CompiledPlan), the trace walker uses
 *   execution order for both traversal AND first-divergence — the
 *   actuary's debugging question "where in the cascade does B
 *   diverge?" gets a meaningful answer rather than lex-first.
 */
export function diffRuns(
  a: RunResult,
  b: RunResult,
  sides?: {
    readonly a?: DiffSide;
    readonly b?: DiffSide;
  },
  options?: { readonly topoOrder?: readonly string[] },
): RunDiff {
  const outputsNode = diffOutputsTree(a.outputs, b.outputs);
  const trace = diffTraces(a.trace, b.trace, sides, options);
  const summary = {
    changed:
      countLeafsByState(outputsNode, "changed") + trace.summary.changed,
    added: countLeafsByState(outputsNode, "added") + trace.summary.added,
    removed:
      countLeafsByState(outputsNode, "removed") + trace.summary.removed,
    inspected:
      countLeafsByState(outputsNode, "any") + trace.summary.inspected,
  };
  return {
    a: sides?.a ?? { id: "a" },
    b: sides?.b ?? { id: "b" },
    outputs: outputsNode,
    trace,
    summary,
    total_impact: computeTotalImpact(a.outputs, b.outputs),
  };
}

// ── Outputs subtree ─────────────────────────────────────────────────

/**
 * Diff two outputs records, decorating numeric leaves with
 * rate_impact for the UI.
 */
function diffOutputsTree(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): DiffNode {
  const node = diffValue("outputs", "Outputs", a, b);
  return decorateOutputLeaves(node, a, b);
}

function decorateOutputLeaves(
  node: DiffNode,
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): DiffNode {
  if (!node.children || node.children.length === 0) return node;
  const decorated = node.children.map((child) => {
    // Top-level output keys are direct children of "outputs"
    if (child.state !== "changed") return child;
    const av = a[child.label];
    const bv = b[child.label];
    if (typeof av === "number" && typeof bv === "number") {
      return { ...child, rate_impact: numericImpact(av, bv) };
    }
    return child;
  });
  return { ...node, children: Object.freeze(decorated) };
}

// ── Total premium impact ────────────────────────────────────────────

/**
 * Extract the "total_premium" delta when both runs have it. The
 * convention is that the top-level output named `total_premium`
 * carries the plan-level premium (see Brief 17 P-ML7).
 *
 * Returns null when either side is missing the field or it's not
 * a finite number.
 */
function computeTotalImpact(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): RateImpact | null {
  const av = a["total_premium"];
  const bv = b["total_premium"];
  if (
    typeof av !== "number" ||
    !Number.isFinite(av) ||
    typeof bv !== "number" ||
    !Number.isFinite(bv)
  ) {
    return null;
  }
  return numericImpact(av, bv);
}

function numericImpact(av: number, bv: number): RateImpact {
  const dollars = bv - av;
  const pct = av === 0 ? 0 : (dollars / av) * 100;
  return { dollars, pct };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Count leaves by state ("any" returns total inspected).
 */
function countLeafsByState(
  node: DiffNode,
  state: "changed" | "added" | "removed" | "any",
): number {
  let count = 0;
  walk(node);
  function walk(n: DiffNode): void {
    if (n.children && n.children.length > 0) {
      for (const c of n.children) walk(c);
    } else {
      if (state === "any" || n.state === state) count++;
    }
  }
  return count;
}
