/**
 * <PlanCompareView> + <CompareTree> — structured A/B diff renderer.
 *
 * Brief 12 (Comparison primitive). Composes M1.5's diff library
 * shapes (PlanDiff, RunDiff, TraceDiff) into a single visual surface
 * the actuary uses to ask: what changed?
 *
 * Surface modes (one diff per render):
 *   - planDiff:  structural diff of two Plan objects
 *   - runDiff:   outputs + trace diff with rate impact
 *   - traceDiff: trace-only diff with first-divergence highlighted
 *
 * Layout:
 *   ┌─ Compare: A vs B ──────────────── ✕ ┐
 *   │  Mode: run-vs-run                    │
 *   │  Sample: ABC Restaurant LLC          │
 *   │  ─────────────────────────────────── │
 *   │  3 changed · 1 added · 0 removed     │
 *   │  +$190 (+3.7%)                       │
 *   │  ─────────────────────────────────── │
 *   │  ▼ Sections                          │
 *   │    ▼ Dimensions                      │
 *   │      ▼ class_factor                  │
 *   │        Row 91342: 1.20 → 1.35  +$235 │
 *   │  ─────────────────────────────────── │
 *   │  diverges here: step "class_factor"  │
 *   └──────────────────────────────────────┘
 *
 * Behavior:
 *   - Tree walks DiffNode recursively
 *   - Unchanged SUBTREES collapse into "= unchanged (N fields)"
 *     summary rows (Brief 12 P-CP8)
 *   - Click a summary row to expand it
 *   - Deep-link icon button on rows with `deeplink`
 *   - First-divergence callout (for TraceDiff) shows above the tree
 *     with a deep-link to the node
 *
 * Just CONTENT — no chrome. Caller wraps in Drawer or Modal.
 *
 * BEM:
 *   .rater-plan-compare-view
 *   .rater-plan-compare-view__header
 *   .rater-plan-compare-view__sides
 *   .rater-plan-compare-view__side-label
 *   .rater-plan-compare-view__separator
 *   .rater-plan-compare-view__divergence
 *   .rater-plan-compare-view__tree
 *   .rater-compare-tree__group
 *   .rater-compare-tree__group-toggle
 *   .rater-compare-tree__group-summary
 *   .rater-compare-tree__collapsed
 */

import { useCallback, useState } from "react";
import type {
  DiffDeeplink,
  DiffNode,
  PlanDiff,
  RunDiff,
  TraceDiff,
} from "@openrater/contracts";
import { ChevronRight, GitBranch } from "lucide-react";
import { CompareNode } from "../CompareNode/CompareNode";
import { DiffSummaryChip } from "../DiffSummaryChip/DiffSummaryChip";
import "./PlanCompareView.css";

export interface PlanCompareViewProps {
  /** Provide exactly ONE of these three. The presence determines the
   *  surface mode (plan / run / trace). */
  readonly planDiff?: PlanDiff;
  readonly runDiff?: RunDiff;
  readonly traceDiff?: TraceDiff;
  /** Fires when the user clicks a row's deep-link icon. The location
   *  comes from the DiffNode's `deeplink` field. */
  readonly onDeepLink?: (location: DiffDeeplink) => void;
  /** Optional sample-submission label for the header (e.g.,
   *  "ABC Restaurant LLC"). */
  readonly sampleLabel?: string;
}

export function PlanCompareView({
  planDiff,
  runDiff,
  traceDiff,
  onDeepLink,
  sampleLabel,
}: PlanCompareViewProps) {
  // Decide which mode + extract the root tree + summary + sides.
  const mode: "plan" | "run" | "trace" | null = planDiff
    ? "plan"
    : runDiff
      ? "run"
      : traceDiff
        ? "trace"
        : null;

  if (mode === null) {
    return (
      <div className="rater-plan-compare-view">
        <p className="rater-plan-compare-view__empty">
          No diff supplied. Pass `planDiff`, `runDiff`, or `traceDiff`.
        </p>
      </div>
    );
  }

  const sides = (planDiff ?? runDiff ?? traceDiff)!;
  const summary = (planDiff ?? runDiff ?? traceDiff)!.summary;
  const totalImpact = runDiff ? runDiff.total_impact : null;
  const firstDiverging =
    traceDiff?.firstDivergingNodeId ?? runDiff?.trace.firstDivergingNodeId ?? null;

  // For runDiff, two trees: outputs + trace. Render outputs first, then
  // trace (which itself is a DiffNode with children). For traceDiff,
  // just one tree. For planDiff, just one tree.
  const trees: { readonly title: string; readonly root: DiffNode }[] = [];
  if (planDiff) trees.push({ title: "Plan", root: planDiff.tree });
  if (runDiff) {
    trees.push({ title: "Outputs", root: runDiff.outputs });
    trees.push({ title: "Trace", root: runDiff.trace.tree });
  }
  if (traceDiff) trees.push({ title: "Trace", root: traceDiff.tree });

  return (
    <div className="rater-plan-compare-view">
      <header className="rater-plan-compare-view__header">
        <div className="rater-plan-compare-view__sides">
          <span className="rater-plan-compare-view__side-label">
            <span className="rater-plan-compare-view__side-pill">A</span>
            {sides.a.label ?? sides.a.id}
            {sides.a.version !== undefined ? (
              <span className="rater-plan-compare-view__side-version">
                v{sides.a.version}
              </span>
            ) : null}
          </span>
          <span className="rater-plan-compare-view__side-vs" aria-hidden>
            ↔
          </span>
          <span className="rater-plan-compare-view__side-label">
            <span className="rater-plan-compare-view__side-pill">B</span>
            {sides.b.label ?? sides.b.id}
            {sides.b.version !== undefined ? (
              <span className="rater-plan-compare-view__side-version">
                v{sides.b.version}
              </span>
            ) : null}
          </span>
        </div>
        <div className="rater-plan-compare-view__meta">
          <span className="rater-plan-compare-view__mode">
            mode: {mode}-vs-{mode}
          </span>
          {sampleLabel ? (
            <span className="rater-plan-compare-view__sample">
              Sample: {sampleLabel}
            </span>
          ) : null}
        </div>
      </header>

      <div className="rater-plan-compare-view__summary">
        <DiffSummaryChip summary={summary} totalImpact={totalImpact} />
      </div>

      {firstDiverging !== null ? (
        <div className="rater-plan-compare-view__divergence" role="note">
          <GitBranch size={14} aria-hidden />
          <span>
            Diverges at step{" "}
            <code className="rater-plan-compare-view__divergence-id">
              {firstDiverging}
            </code>
          </span>
        </div>
      ) : null}

      <div className="rater-plan-compare-view__tree">
        {trees.map(({ title, root }) => (
          <CompareTree
            key={title}
            title={title}
            root={root}
            {...(onDeepLink ? { onDeepLink } : {})}
          />
        ))}
      </div>
    </div>
  );
}

// ── CompareTree ─────────────────────────────────────────────────

export interface CompareTreeProps {
  /** Section header (e.g., "Outputs", "Trace", "Plan"). */
  readonly title: string;
  /** The root DiffNode whose children are walked recursively. */
  readonly root: DiffNode;
  readonly onDeepLink?: (location: DiffDeeplink) => void;
  /** Initial expansion depth — depths below this auto-collapse. V1
   *  default: 2 (top-level + one nested level visible). */
  readonly initialExpandDepth?: number;
}

interface FlatRow {
  readonly kind: "node";
  readonly node: DiffNode;
  readonly depth: number;
  readonly pathChain: string;
}

interface CollapsedRow {
  readonly kind: "collapsed";
  readonly count: number; // child leaves rolled up
  readonly depth: number;
  readonly parentPath: string;
  readonly parentLabel: string;
}

type RowItem = FlatRow | CollapsedRow;

/**
 * Walk a DiffNode tree into a flat list of rows, collapsing subtrees
 * that are entirely "unchanged". Returns:
 *   - "node" rows for any leaf OR for any non-leaf subtree containing
 *     a change
 *   - "collapsed" rows for unchanged subtrees (shows "= unchanged (N)")
 *
 * Expansion state is a Set of paths that the user has manually
 * expanded — when a collapsed row is in that set, it's expanded
 * and walked normally.
 */
function flattenForRender(
  root: DiffNode,
  depth: number,
  expandedPaths: ReadonlySet<string>,
): readonly RowItem[] {
  const rows: RowItem[] = [];
  // Root itself is always rendered when not the top "Plan" wrapper.
  // We push every node we visit; children come after.
  rows.push({ kind: "node", node: root, depth, pathChain: root.path });
  if (!root.children || root.children.length === 0) return rows;
  for (const child of root.children) {
    if (child.state === "unchanged" && !expandedPaths.has(child.path)) {
      // Roll up to a single "= unchanged (N)" row. N = the count of
      // descendant leaves (not just direct children).
      const leafCount = countLeaves(child);
      rows.push({
        kind: "collapsed",
        count: leafCount,
        depth: depth + 1,
        parentPath: child.path,
        parentLabel: child.label,
      });
    } else {
      rows.push(...flattenForRender(child, depth + 1, expandedPaths));
    }
  }
  return rows;
}

function countLeaves(node: DiffNode): number {
  if (!node.children || node.children.length === 0) return 1;
  let n = 0;
  for (const c of node.children) n += countLeaves(c);
  return n;
}

export function CompareTree({
  title,
  root,
  onDeepLink,
}: CompareTreeProps) {
  // Pre-expanded paths the user has clicked. Persisting per-tree
  // session-only — losing on close is fine for V1.
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const rows = flattenForRender(root, 0, expandedPaths);

  return (
    <section className="rater-compare-tree" aria-label={title}>
      <h3 className="rater-compare-tree__group-title">{title}</h3>
      <div className="rater-compare-tree__rows">
        {rows.map((row, i) =>
          row.kind === "node" ? (
            <CompareNode
              key={`${row.pathChain}-${i}`}
              node={row.node}
              depth={row.depth}
              {...(onDeepLink ? { onDeepLink } : {})}
            />
          ) : (
            <button
              key={`collapsed-${row.parentPath}-${i}`}
              type="button"
              className="rater-compare-tree__collapsed"
              style={{ paddingLeft: `${row.depth * 16}px` }}
              onClick={() => toggleExpand(row.parentPath)}
              aria-label={`Expand ${row.parentLabel} (${row.count} unchanged fields)`}
            >
              <ChevronRight size={12} aria-hidden />
              <span className="rater-compare-tree__collapsed-label">
                {row.parentLabel}
              </span>
              <span className="rater-compare-tree__collapsed-hint">
                = unchanged ({row.count} field{row.count === 1 ? "" : "s"})
              </span>
            </button>
          ),
        )}
      </div>
    </section>
  );
}
