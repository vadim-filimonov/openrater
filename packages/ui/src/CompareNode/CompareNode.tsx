/**
 * <CompareNode> — single row in the structured diff tree.
 *
 * Brief 12. Renders one DiffNode from the M1.5 diff library:
 *
 *     ▸ class_factor                            (header row, children)
 *
 *     Factor value: 1.20 → 1.35  +12.5%        (leaf — changed)
 *     New row "91342" added                    (leaf — added)
 *     Row "98765" removed                      (leaf — removed)
 *     = unchanged (3 fields)                   (collapsed identical
 *                                                subtree)
 *
 * The actuary's eye lands on what differs; identical subtrees
 * collapse into a single "= unchanged (N)" row per Brief 12 P-CP8.
 *
 * Behavior:
 *   - state="changed" → label + a_value + → arrow + b_value + rate
 *     impact (when present); deep-link icon on the right
 *   - state="added" → "Added" tag + b_value preview
 *   - state="removed" → "Removed" tag + a_value preview
 *   - state="unchanged" with children → renders as a "= unchanged
 *     (N fields)" collapsed pill (consumer collapses; see
 *     <CompareTree>)
 *
 * This component renders ONE row + nothing else. Recursive tree
 * walking + collapse-when-unchanged logic lives in <CompareTree>.
 *
 * BEM:
 *   .rater-compare-node
 *   .rater-compare-node--{changed|added|removed|unchanged}
 *   .rater-compare-node__indent
 *   .rater-compare-node__state-icon
 *   .rater-compare-node__label
 *   .rater-compare-node__values
 *   .rater-compare-node__a-value
 *   .rater-compare-node__b-value
 *   .rater-compare-node__arrow
 *   .rater-compare-node__deep-link
 */

import type { DiffDeeplink, DiffNode } from "@openrater/contracts";
import { Equal, Minus, Plus, ArrowRight } from "lucide-react";
import { IconButton } from "@openrater/design-system";
import { formatValue } from "../TraceStep/TraceStep";
import { RateImpactBadge } from "../RateImpactBadge/RateImpactBadge";
import "./CompareNode.css";

export interface CompareNodeProps {
  readonly node: DiffNode;
  /** Indentation depth (0-indexed). The component renders an indent
   *  spacer of this many levels. Consumer (<CompareTree>) sets this. */
  readonly depth: number;
  /** Fires when the user clicks the row's deep-link icon (when the
   *  node has a `deeplink`). */
  readonly onDeepLink?: (location: DiffDeeplink) => void;
}

function StateIcon({ state }: { state: DiffNode["state"] }) {
  switch (state) {
    case "added":
      return <Plus size={12} aria-hidden />;
    case "removed":
      return <Minus size={12} aria-hidden />;
    case "changed":
      return <ArrowRight size={12} aria-hidden />;
    case "unchanged":
      return <Equal size={12} aria-hidden />;
  }
}

export function CompareNode({ node, depth, onDeepLink }: CompareNodeProps) {
  return (
    <div
      className={`rater-compare-node rater-compare-node--${node.state}`}
      data-path={node.path}
      style={{ paddingLeft: `${depth * 16}px` }}
    >
      <span className="rater-compare-node__state-icon" aria-hidden>
        <StateIcon state={node.state} />
      </span>
      <span className="rater-compare-node__label">{node.label}</span>
      <span className="rater-compare-node__values">
        {node.state === "changed" ? (
          <>
            <span className="rater-compare-node__a-value">
              {formatValue(node.a_value)}
            </span>
            <span className="rater-compare-node__arrow" aria-hidden>
              →
            </span>
            <span className="rater-compare-node__b-value">
              {formatValue(node.b_value)}
            </span>
          </>
        ) : null}
        {node.state === "added" ? (
          <span className="rater-compare-node__b-value">
            {formatValue(node.b_value)}
          </span>
        ) : null}
        {node.state === "removed" ? (
          <span className="rater-compare-node__a-value">
            {formatValue(node.a_value)}
          </span>
        ) : null}
      </span>
      {node.rate_impact ? (
        <RateImpactBadge impact={node.rate_impact} />
      ) : null}
      {node.deeplink && onDeepLink ? (
        <IconButton
          icon={<ArrowRight size={12} />}
          aria-label={`Go to ${node.label}`}
          variant="ghost"
          size="xs"
          onClick={() => onDeepLink(node.deeplink!)}
          className="rater-compare-node__deep-link"
        />
      ) : null}
    </div>
  );
}
