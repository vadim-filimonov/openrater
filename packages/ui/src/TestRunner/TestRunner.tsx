/**
 * <TestRunner> — Rate Against Sample workbench.
 *
 * Plan-test-runner-hardening brief. The actuary's workbench for
 * trying a sample submission against the plan:
 *
 *     ┌── Rate Against Sample ───────────────────────────────────┐
 *     │  Sample inputs (JSON)                                     │
 *     │  ┌────────────────────────────────────────────────────┐  │
 *     │  │ {                                                   │  │
 *     │  │   "class_code": "c101",                            │  │
 *     │  │   "tiv": 250000                                     │  │
 *     │  │ }                                                   │  │
 *     │  └────────────────────────────────────────────────────┘  │
 *     │                                          [ Run ]         │
 *     ├───────────────────────────────────────────────────────────┤
 *     │  Result · Trace                                           │
 *     │   ─────────                                               │
 *     │   <TracePanel>                                            │
 *     │   ─────────                                               │
 *     │   [ Compare to previous run ▾ ]                          │
 *     └───────────────────────────────────────────────────────────┘
 *
 * Composes:
 *   - <TracePanel> for the result display
 *   - <PlanCompareView> for the compare-to-previous toggle
 *   - M2 primitives (Button)
 *   - @openrater/contracts diffRuns for the comparison
 *
 * Design choices:
 *   - The caller provides `onRun(inputs) => RunResult | Promise<RunResult>`
 *     — @openrater/ui doesn't import runtime directly (avoids circular
 *     dep with @openrater/contracts having any UI flavor)
 *   - Paste-mode JSON for V1; structured per-field forms come in M4
 *     when section editors wire up
 *   - Comparison stores the LAST successful run as "previous" so
 *     the user can iterate inputs and see the delta
 *
 * BEM:
 *   .rater-test-runner
 *   .rater-test-runner__section
 *   .rater-test-runner__section-title
 *   .rater-test-runner__inputs-area
 *   .rater-test-runner__inputs-textarea
 *   .rater-test-runner__inputs-error
 *   .rater-test-runner__actions
 *   .rater-test-runner__result
 *   .rater-test-runner__error
 *   .rater-test-runner__compare-toggle
 *   .rater-test-runner__empty
 */

import { useCallback, useMemo, useState } from "react";
import type { Plan, RunResult } from "@openrater/contracts";
import { diffRuns } from "@openrater/contracts";
import { Button } from "@openrater/design-system";
import { Play, AlertCircle, GitCompareArrows } from "lucide-react";
import { TracePanel } from "../TracePanel/TracePanel";
import { PlanCompareView } from "../PlanCompareView/PlanCompareView";
import "./TestRunner.css";

export interface TestRunnerProps {
  /** The plan being tested. Used for nodeLabels passed through to
   *  TracePanel. */
  readonly plan: Plan;
  /** Topological execution order for the trace cascade. Typically
   *  CompiledPlan.topoOrder. When omitted, lex sort. */
  readonly nodeOrder?: readonly string[];
  /** Map of nodeId → display label for the TracePanel cascade. */
  readonly nodeLabels?: Readonly<Record<string, string>>;
  /** Map of output-key → display label. */
  readonly outputLabels?: Readonly<Record<string, string>>;
  /**
   * Initial paste-mode JSON for the inputs textarea. When omitted,
   * a tiny placeholder template is shown.
   */
  readonly initialInputs?: Record<string, unknown>;
  /**
   * Caller-provided run handler. Receives the parsed externalInputs;
   * may return a RunResult OR a Promise<RunResult>. Errors are caught
   * by the runner and surfaced as a banner.
   */
  readonly onRun: (
    inputs: Record<string, unknown>,
  ) => RunResult | Promise<RunResult>;
}

interface RunnerState {
  readonly status: "idle" | "running" | "ok" | "error";
  readonly result: RunResult | null;
  /** The previous successful result — used for compare-to-previous. */
  readonly previousResult: RunResult | null;
  /** Error message when status="error" (parse error OR onRun threw). */
  readonly error: string | null;
}

const PLACEHOLDER_TEMPLATE = `{
  "class_code": "c101",
  "tiv": 250000
}`;

export function TestRunner({
  plan,
  nodeOrder,
  nodeLabels,
  outputLabels,
  initialInputs,
  onRun,
}: TestRunnerProps) {
  const [inputsText, setInputsText] = useState<string>(
    initialInputs ? JSON.stringify(initialInputs, null, 2) : PLACEHOLDER_TEMPLATE,
  );
  const [state, setState] = useState<RunnerState>({
    status: "idle",
    result: null,
    previousResult: null,
    error: null,
  });
  const [showCompare, setShowCompare] = useState(false);

  const runDiff = useMemo(() => {
    if (!showCompare || !state.result || !state.previousResult) return null;
    return diffRuns(state.previousResult, state.result, {
      a: { id: "previous", label: "Previous run" },
      b: { id: "current", label: "Current run" },
    });
  }, [showCompare, state.result, state.previousResult]);

  const handleRun = useCallback(async () => {
    // Parse JSON
    let parsed: Record<string, unknown>;
    try {
      const parsed_unknown = JSON.parse(inputsText) as unknown;
      if (
        parsed_unknown === null ||
        typeof parsed_unknown !== "object" ||
        Array.isArray(parsed_unknown)
      ) {
        throw new Error("Inputs must be a JSON object.");
      }
      parsed = parsed_unknown as Record<string, unknown>;
    } catch (parseErr) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      }));
      return;
    }

    // Run
    setState((prev) => ({ ...prev, status: "running", error: null }));
    try {
      const result = await onRun(parsed);
      setState((prev) => ({
        status: "ok",
        result,
        // The previous result becomes whatever was JUST the result
        // (if any). Promotes the actuary's iteration pattern: edit
        // inputs → run → see new vs last.
        previousResult: prev.result,
        error: null,
      }));
    } catch (runErr) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: runErr instanceof Error ? runErr.message : String(runErr),
      }));
    }
  }, [inputsText, onRun]);

  const inputsHasError = state.status === "error" && state.result === null;

  return (
    <div className="rater-test-runner">
      <section className="rater-test-runner__section">
        <h3 className="rater-test-runner__section-title">
          Sample inputs (JSON)
        </h3>
        <div className="rater-test-runner__inputs-area">
          <textarea
            className={[
              "rater-test-runner__inputs-textarea",
              inputsHasError ? "rater-test-runner__inputs-textarea--error" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            value={inputsText}
            onChange={(e) => setInputsText(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            aria-label="Sample inputs JSON"
            aria-invalid={inputsHasError || undefined}
            rows={8}
          />
          {inputsHasError && state.error ? (
            <div className="rater-test-runner__inputs-error" role="alert">
              <AlertCircle size={14} aria-hidden />
              <span>{state.error}</span>
            </div>
          ) : null}
        </div>
        <div className="rater-test-runner__actions">
          <Button
            type="button"
            variant="primary"
            size="md"
            icon={<Play size={14} />}
            onClick={handleRun}
            loading={state.status === "running"}
            disabled={state.status === "running"}
          >
            {state.status === "ok" || state.status === "error"
              ? "Re-run"
              : "Run"}
          </Button>
          {state.previousResult ? (
            <Button
              type="button"
              variant="ghost"
              size="md"
              icon={<GitCompareArrows size={14} />}
              onClick={() => setShowCompare((v) => !v)}
              disabled={!state.result}
            >
              {showCompare ? "Hide comparison" : "Compare to previous"}
            </Button>
          ) : null}
        </div>
      </section>

      {state.status === "error" && state.result !== null ? (
        // Run-time error after a previous OK; keep the prior result
        // visible but surface the failure inline.
        <div className="rater-test-runner__error" role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>Run failed: {state.error}</span>
        </div>
      ) : null}

      {state.status === "ok" && state.result ? (
        <section className="rater-test-runner__section rater-test-runner__result">
          {showCompare && runDiff ? (
            <PlanCompareView runDiff={runDiff} />
          ) : (
            <TracePanel
              run={state.result}
              {...(nodeOrder !== undefined ? { nodeOrder } : {})}
              {...(nodeLabels !== undefined ? { nodeLabels } : {})}
              {...(outputLabels !== undefined ? { outputLabels } : {})}
            />
          )}
        </section>
      ) : state.status === "idle" ? (
        <div className="rater-test-runner__empty">
          Edit the inputs above + click <strong>Run</strong> to see the trace
          for {plan.name}.
        </div>
      ) : null}
    </div>
  );
}
