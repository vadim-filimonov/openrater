/**
 * <TracePanel> + <TraceCascade> — render a RunResult.
 *
 * Brief 3 (Trace panel). The load-bearing audit surface. Every
 * premium the actuary defends to a regulator gets explained here.
 *
 *   <TracePanel
 *     run={result}
 *     nodeOrder={compiled.topoOrder}
 *     nodeLabels={planNodeLabels}
 *   />
 *
 * Structure:
 *   - Header: as-of date + total premium (when present) + duration
 *   - Outputs section: key:value rows for RunResult.outputs
 *   - Cascade section: TraceStep[] rendered in execution order
 *     (topoOrder when supplied; lex sort otherwise)
 *   - Empty state when trace is empty
 *
 * Embedded vs drawer:
 *   - V1 TracePanel is JUST CONTENT (no chrome). Callers either
 *     render it inside a <Drawer> (for the right-side panel pattern)
 *     OR drop it directly into section #13 (Trace).
 *
 * Future composition (lands later):
 *   - LOB grouping (Brief 17): when plan.lines.length > 1, group
 *     steps by their CoverageChain.lob_tag — defer until the
 *     CoverageChain entity surface is wired (M4)
 *   - First-divergence highlighting (Brief 12): expose
 *     `highlightedNodeId` for trace-vs-trace mode — already
 *     supported by the TraceStep prop
 *
 * BEM:
 *   .rater-trace-panel
 *   .rater-trace-panel__header
 *   .rater-trace-panel__as-of
 *   .rater-trace-panel__duration
 *   .rater-trace-panel__total
 *   .rater-trace-panel__total-label
 *   .rater-trace-panel__total-value
 *   .rater-trace-panel__section
 *   .rater-trace-panel__section-title
 *   .rater-trace-panel__outputs
 *   .rater-trace-panel__output-row
 *   .rater-trace-panel__cascade
 *   .rater-trace-panel__empty
 */

import { useMemo } from "react";
import type { RunResult } from "@openrater/contracts";
import { TraceStep, formatValue } from "../TraceStep/TraceStep";
import { CitationLink } from "../CitationLink/CitationLink";
import type { ServerComposedLike, TraceGroup } from "./serverRunTrace";
import "./TracePanel.css";

export interface TracePanelProps {
  /** The run result to render. */
  readonly run: RunResult;
  /**
   * Execution order of trace step ids. When supplied (typically from
   * `CompiledPlan.topoOrder`), steps render in topological order —
   * the actuary reads the cascade top-down as the engine executed it.
   * When omitted, the panel falls back to lexicographic sort.
   *
   * Steps in `run.trace` but NOT in `nodeOrder` are appended at the
   * end (lex-sorted) so nothing is dropped.
   */
  readonly nodeOrder?: readonly string[];
  /**
   * Optional map from nodeId → display label. The actuary's section
   * editors typically have human labels for nodes (e.g.,
   * "class_factor" → "Construction class factor"); pass them through
   * so the trace reads naturally. When a key is missing, the step
   * falls back to the nodeId.
   */
  readonly nodeLabels?: Readonly<Record<string, string>>;
  /**
   * Optional output-key → display label map (e.g.,
   * "total_premium" → "Total premium"). Falls back to the raw key.
   */
  readonly outputLabels?: Readonly<Record<string, string>>;
  /**
   * Optional highlighted node id (e.g., the first-divergence marker
   * from `diffTraces`).
   */
  readonly highlightedNodeId?: string | null;
  /**
   * Empty-state text override. Defaults to "No trace — the plan
   * hasn't been executed against a sample yet."
   */
  readonly emptyText?: string;
  /**
   * §14 (audit P4-01) — optional titled sections for the cascade
   * (Inputs / Derived values / per-coverage Build-up / Appetite /
   * Outputs), typically from `buildServerRunTraceView`. Steps in the
   * trace that no group claims are NEVER dropped — they render in an
   * appended "Other steps" section, execution-ordered. When omitted,
   * the cascade renders exactly as before (one flat section).
   */
  readonly groups?: readonly TraceGroup[];
  /**
   * §14 / ADR-0056 — declared output fields a refused run WITHHELD.
   * Each renders in the Outputs section as "—  withheld", and while
   * any output is withheld the featured header total is suppressed —
   * a partial chain value must never headline as THE premium (Law 2).
   */
  readonly withheldOutputs?: readonly string[];
  /**
   * §14 — the G4 build-up (rolled subtotal → Final-adjustments steps
   * → filed premium) from the persisted run's `composed`. Renders as
   * a "Final adjustments" section after the cascade; the filed
   * premium is the section's total row.
   */
  readonly composed?: ServerComposedLike;
}

/**
 * Build the ordered list of (nodeId, entry) pairs for rendering.
 * Pure + deterministic given the inputs.
 */
function buildOrderedSteps(
  trace: RunResult["trace"],
  nodeOrder?: readonly string[],
): readonly { readonly nodeId: string; readonly entry: RunResult["trace"][string] }[] {
  const present = new Set(Object.keys(trace));
  const out: { nodeId: string; entry: RunResult["trace"][string] }[] = [];
  if (nodeOrder) {
    for (const id of nodeOrder) {
      if (present.has(id) && trace[id]) {
        out.push({ nodeId: id, entry: trace[id]! });
        present.delete(id);
      }
    }
  }
  // Append any leftover trace ids (lex-sorted for determinism)
  const tail = Array.from(present).sort();
  for (const id of tail) {
    if (trace[id]) out.push({ nodeId: id, entry: trace[id]! });
  }
  return out;
}

/**
 * Pick the "total premium"-style output value to feature in the
 * panel header. Looks for a few canonical names; otherwise falls
 * back to the first numeric output. Pure.
 */
function pickFeaturedOutput(
  outputs: Record<string, unknown>,
): { key: string; value: number } | null {
  const preferred = ["total_premium", "premium", "total", "factor"];
  for (const k of preferred) {
    const v = outputs[k];
    if (typeof v === "number" && Number.isFinite(v)) return { key: k, value: v };
  }
  // Fall back to first numeric output
  for (const [k, v] of Object.entries(outputs)) {
    if (typeof v === "number" && Number.isFinite(v)) return { key: k, value: v };
  }
  return null;
}

/**
 * Slice the ordered steps into the caller's groups + an appended
 * "Other steps" section for anything unclaimed (never drop a step).
 * Pure; preserves the incoming execution order inside every section.
 */
function buildGroupedSections(
  ordered: readonly { readonly nodeId: string; readonly entry: RunResult["trace"][string] }[],
  groups: readonly TraceGroup[],
): readonly {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly { readonly nodeId: string; readonly entry: RunResult["trace"][string] }[];
}[] {
  const byId = new Map(ordered.map((s) => [s.nodeId, s]));
  const claimed = new Set<string>();
  const sections: {
    id: string;
    title: string;
    steps: { nodeId: string; entry: RunResult["trace"][string] }[];
  }[] = [];
  for (const group of groups) {
    const steps: { nodeId: string; entry: RunResult["trace"][string] }[] = [];
    for (const nodeId of group.nodeIds) {
      const step = byId.get(nodeId);
      if (step && !claimed.has(nodeId)) {
        steps.push(step);
        claimed.add(nodeId);
      }
    }
    if (steps.length > 0) {
      sections.push({ id: group.id, title: group.title, steps });
    }
  }
  const leftovers = ordered.filter((s) => !claimed.has(s.nodeId));
  if (leftovers.length > 0) {
    sections.push({
      id: "other",
      title: "Other steps",
      steps: [...leftovers],
    });
  }
  return sections;
}

export function TracePanel({
  run,
  nodeOrder,
  nodeLabels,
  outputLabels,
  highlightedNodeId,
  emptyText = "No trace — the plan hasn't been executed against a sample yet.",
  groups,
  withheldOutputs,
  composed,
}: TracePanelProps) {
  const ordered = useMemo(
    () => buildOrderedSteps(run.trace, nodeOrder),
    [run.trace, nodeOrder],
  );
  const featured = useMemo(
    () => pickFeaturedOutput(run.outputs),
    [run.outputs],
  );
  const allOutputs = useMemo(() => Object.entries(run.outputs), [run.outputs]);
  const withheld = withheldOutputs ?? [];
  const sections = useMemo(
    () => (groups && groups.length > 0 ? buildGroupedSections(ordered, groups) : null),
    [ordered, groups],
  );

  if (ordered.length === 0 && allOutputs.length === 0 && withheld.length === 0) {
    return (
      <div className="rater-trace-panel">
        <div className="rater-trace-panel__empty">{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="rater-trace-panel">
      <header className="rater-trace-panel__header">
        <div className="rater-trace-panel__meta">
          {run.as_of ? (
            <span className="rater-trace-panel__as-of">As of {run.as_of}</span>
          ) : null}
          <span className="rater-trace-panel__duration">
            {run.durationMs > 0 ? `${run.durationMs} ms · ` : ""}
            {ordered.length} steps
          </span>
        </div>
        {/* Law 2 — while ANY declared output is withheld, no number
            headlines: a partial chain value is not THE premium. */}
        {featured && withheld.length === 0 ? (
          <div className="rater-trace-panel__total">
            <span className="rater-trace-panel__total-label">
              {outputLabels?.[featured.key] ?? featured.key.replace(/_/g, " ")}
            </span>
            <span className="rater-trace-panel__total-value">
              {formatValue(featured.value)}
            </span>
          </div>
        ) : null}
      </header>

      {allOutputs.length > 0 || withheld.length > 0 ? (
        <section className="rater-trace-panel__section">
          <h3 className="rater-trace-panel__section-title">Outputs</h3>
          <div className="rater-trace-panel__outputs">
            {allOutputs.map(([k, v]) => (
              <div key={k} className="rater-trace-panel__output-row">
                <span className="rater-trace-panel__output-key">
                  {outputLabels?.[k] ?? k}
                </span>
                <span className="rater-trace-panel__output-value">
                  {formatValue(v)}
                </span>
              </div>
            ))}
            {withheld.map((k) => (
              <div key={`withheld-${k}`} className="rater-trace-panel__output-row">
                <span className="rater-trace-panel__output-key">
                  {outputLabels?.[k] ?? k}
                </span>
                <span className="rater-trace-panel__output-value rater-trace-panel__output-value--withheld">
                  — withheld
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {sections ? (
        sections.map((section) => (
          <section key={section.id} className="rater-trace-panel__section">
            <h3 className="rater-trace-panel__section-title">
              {section.title}
            </h3>
            <TraceCascade
              steps={section.steps}
              {...(nodeLabels !== undefined ? { nodeLabels } : {})}
              {...(highlightedNodeId !== undefined && highlightedNodeId !== null
                ? { highlightedNodeId }
                : {})}
            />
          </section>
        ))
      ) : ordered.length > 0 ? (
        <section className="rater-trace-panel__section">
          <h3 className="rater-trace-panel__section-title">
            Cascade ({ordered.length} step{ordered.length === 1 ? "" : "s"})
          </h3>
          <TraceCascade
            steps={ordered}
            {...(nodeLabels !== undefined ? { nodeLabels } : {})}
            {...(highlightedNodeId !== undefined && highlightedNodeId !== null
              ? { highlightedNodeId }
              : {})}
          />
        </section>
      ) : null}

      {composed ? (
        <section className="rater-trace-panel__section">
          <h3 className="rater-trace-panel__section-title">
            Final adjustments
          </h3>
          <div className="rater-trace-panel__composed">
            <div className="rater-trace-panel__composed-row">
              <span className="rater-trace-panel__composed-label">
                Plan subtotal
              </span>
              <span className="rater-trace-panel__composed-value">
                {formatValue(composed.subtotal)}
              </span>
            </div>
            {(composed.adjustments ?? []).map((step) => (
              <div
                key={step.id}
                className={[
                  "rater-trace-panel__composed-row",
                  step.applied === false
                    ? "rater-trace-panel__composed-row--skipped"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="rater-trace-panel__composed-label">
                  {step.id.replace(/_/g, " ")}
                  {step.detail ? (
                    <span className="rater-trace-panel__composed-detail">
                      {step.detail}
                    </span>
                  ) : null}
                  {step.citation ? (
                    <span className="rater-trace-panel__composed-citation">
                      <CitationLink citation={step.citation} />
                    </span>
                  ) : null}
                </span>
                <span className="rater-trace-panel__composed-value">
                  {step.applied === false
                    ? "not applied"
                    : typeof step.before === "number" &&
                        typeof step.after === "number"
                      ? `${formatValue(step.before)} → ${formatValue(step.after)}`
                      : formatValue(step.after)}
                </span>
              </div>
            ))}
            <div className="rater-trace-panel__composed-row rater-trace-panel__composed-row--total">
              <span className="rater-trace-panel__composed-label">
                Filed premium
              </span>
              <span className="rater-trace-panel__composed-value">
                {formatValue(composed.final)}
              </span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── TraceCascade ────────────────────────────────────────────────

export interface TraceCascadeProps {
  /** Pre-ordered list of trace steps. */
  readonly steps: readonly {
    readonly nodeId: string;
    readonly entry: RunResult["trace"][string];
  }[];
  readonly nodeLabels?: Readonly<Record<string, string>>;
  readonly highlightedNodeId?: string;
}

/**
 * Lightweight orderer + renderer. Separate from TracePanel so a
 * caller can render JUST the cascade (no header/outputs) when they
 * already own that chrome (e.g., in section #13 with its own
 * section header).
 */
export function TraceCascade({
  steps,
  nodeLabels,
  highlightedNodeId,
}: TraceCascadeProps) {
  return (
    <div className="rater-trace-panel__cascade">
      {steps.map(({ nodeId, entry }) => {
        const label = nodeLabels?.[nodeId];
        return (
          <TraceStep
            key={nodeId}
            nodeId={nodeId}
            entry={entry}
            {...(label !== undefined ? { label } : {})}
            highlighted={highlightedNodeId === nodeId}
          />
        );
      })}
    </div>
  );
}

// Export pure helpers so consumers + tests can reuse.
export { buildOrderedSteps, pickFeaturedOutput };
