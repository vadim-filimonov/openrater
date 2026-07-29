/**
 * <TraceStep> — single trace entry row.
 *
 * Brief 3 (trace panel) — renders one node's execution evidence:
 *
 *     ● class_factor · lookup.classification          1.32
 *     ──────────────────────────────────────────────
 *     Classified 73912 (Bowling Centers) → 1.32
 *     ISO BP-2024-RLC §3.4
 *     ▸ inputs · 1                                            ▾
 *
 * Layout:
 *   - Header: node label + kind id (muted) + headline output value
 *   - Explanation line (actuary-language, from kind.explainStep)
 *   - Citation (when present)
 *   - Inputs disclosure (collapsed by default; expand for the full
 *     I/O record)
 *   - Error banner (inline, when entry.error is set)
 *
 * The "headline output value" is the FIRST output port's value
 * rendered prominently — for most kinds this is the meaningful
 * factor / amount the step produced. When the output is a map, we
 * try to show the most-likely-meaningful key (value | result |
 * factor). Falls back to outputs count if nothing meaningful.
 *
 * BEM:
 *   .rater-trace-step
 *   .rater-trace-step--errored                (error banner present)
 *   .rater-trace-step--highlighted            (caller-driven, e.g.,
 *                                             diff first-divergence)
 *   .rater-trace-step__header
 *   .rater-trace-step__node-label
 *   .rater-trace-step__kind-id
 *   .rater-trace-step__headline
 *   .rater-trace-step__explanation
 *   .rater-trace-step__citation
 *   .rater-trace-step__inputs                 (the disclosure)
 *   .rater-trace-step__inputs-summary         (the disclosure trigger)
 *   .rater-trace-step__io-table               (table inside disclosure)
 *   .rater-trace-step__error
 */

import type { TraceEntry } from "@openrater/contracts";
import { AlertCircle, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CitationLink } from "../CitationLink/CitationLink";
import "./TraceStep.css";

export interface TraceStepProps {
  /** The node id this step represents (key from RunResult.trace). */
  readonly nodeId: string;
  /** The trace entry record. */
  readonly entry: TraceEntry;
  /** Optional display label override (defaults to nodeId). Common
   *  use: the consuming surface passes `plan.nodes.find(n => n.id ===
   *  nodeId)?.label ?? nodeId`. */
  readonly label?: string;
  /** Visual highlight (e.g., first-divergence marker in trace-vs-trace
   *  comparison from Brief 12). */
  readonly highlighted?: boolean;
  /** When true the inputs disclosure starts expanded. Default false. */
  readonly defaultExpanded?: boolean;
}

/**
 * Pick the most-likely-meaningful output value to show inline. Most
 * kinds output { value: X } or { result: X } or { factor: X }; we
 * pick the first match. Falls back to the first key in arbitrary
 * order. Returns null when outputs is empty.
 */
function pickHeadlineOutput(
  outputs: Record<string, unknown>,
): { key: string; value: unknown } | null {
  const keys = Object.keys(outputs);
  if (keys.length === 0) return null;
  // The preferred list determines what TraceStep shows as the headline.
  // `premium_out` covers endorsement.{factor,additive,sublimit} —
  // each emits an `attached` boolean + a `premium_out` number; without
  // the override the scalar finder would pick `attached` (boolean)
  // instead of the modified premium, which is the load-bearing
  // signal for the actuary.
  const preferred = [
    "value",
    "result",
    "factor",
    "tier",
    "premium_out",
    "premium",
  ];
  for (const k of preferred) {
    if (k in outputs) return { key: k, value: outputs[k] };
  }
  // Skip metadata-y keys like "applied_categories" that are full objects.
  const scalar = keys.find((k) => {
    const v = outputs[k];
    return (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean"
    );
  });
  if (scalar) return { key: scalar, value: outputs[scalar] };
  return { key: keys[0]!, value: outputs[keys[0]!] };
}

/** Format any value for display in the trace. Pure. */
function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "number") {
    // Numeric values: 4-decimal precision for factors; thousands
    // separator for big numbers.
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 1000 ? v.toLocaleString() : v.toFixed(4);
  }
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  // Objects / arrays: short JSON representation
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return String(v);
  }
}

export function TraceStep({
  nodeId,
  entry,
  label,
  highlighted = false,
  defaultExpanded = false,
}: TraceStepProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headline = pickHeadlineOutput(entry.outputs);
  const inputCount = Object.keys(entry.inputs).length;
  const outputCount = Object.keys(entry.outputs).length;
  const hasError = entry.error !== undefined;

  return (
    <div
      className={[
        "rater-trace-step",
        hasError ? "rater-trace-step--errored" : null,
        highlighted ? "rater-trace-step--highlighted" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={nodeId}
    >
      <header className="rater-trace-step__header">
        <div className="rater-trace-step__label-block">
          <span className="rater-trace-step__node-label">
            {label ?? nodeId}
          </span>
          <span className="rater-trace-step__kind-id">{entry.kindId}</span>
        </div>
        {headline && !hasError ? (
          <span className="rater-trace-step__headline" aria-label={`Output ${headline.key}: ${formatValue(headline.value)}`}>
            {formatValue(headline.value)}
          </span>
        ) : null}
      </header>

      {entry.explanation ? (
        <p className="rater-trace-step__explanation">{entry.explanation}</p>
      ) : null}

      {entry.citation ? (
        <div className="rater-trace-step__citation">
          <CitationLink citation={entry.citation} />
        </div>
      ) : null}

      {hasError ? (
        <div className="rater-trace-step__error" role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>{entry.error!.message}</span>
        </div>
      ) : null}

      {(inputCount > 0 || outputCount > 1) ? (
        <details
          className="rater-trace-step__inputs"
          open={expanded}
          onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
        >
          <summary className="rater-trace-step__inputs-summary">
            <ChevronRight
              size={12}
              className="rater-trace-step__disclosure-icon"
              aria-hidden
            />
            <span>
              {inputCount} input{inputCount === 1 ? "" : "s"}
              {outputCount > 1 ? `, ${outputCount} outputs` : ""}
            </span>
          </summary>
          <div className="rater-trace-step__io-table">
            {inputCount > 0 ? (
              <table>
                <caption className="rater-trace-step__io-caption">Inputs</caption>
                <tbody>
                  {Object.entries(entry.inputs).map(([k, v]) => (
                    <tr key={`in-${k}`}>
                      <th scope="row">{k}</th>
                      <td>{formatValue(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {outputCount > 1 ? (
              <table>
                <caption className="rater-trace-step__io-caption">Outputs</caption>
                <tbody>
                  {Object.entries(entry.outputs).map(([k, v]) => (
                    <tr key={`out-${k}`}>
                      <th scope="row">{k}</th>
                      <td>{formatValue(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// Export the pure helpers so other primitives + tests can reuse them.
export { pickHeadlineOutput, formatValue };
