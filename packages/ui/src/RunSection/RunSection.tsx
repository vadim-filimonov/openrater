/**
 * <RunSection> — the Test tab: rate one sample risk, see the premium
 * (V2_INTERFACE_SPEC §2.4; the Brief-63 payoff shape).
 *
 * The golden-path moment for an actuary or a CEO: a sample risk on the
 * left (seeded from the plan's representative values — every field
 * editable), the result on the right (the premium large and neutral,
 * the per-output build-out, an honest empty/error state). The
 * evaluated per-run trace renders RIGHT HERE — a collapsible "How
 * this was computed" region under the result (trace-panel brief §14,
 * audit P4-01); the Algorithm link opens the authored structure.
 *
 * §2B: pure presentation. The route owns the field state and the
 * project→compile→run pipeline (the same one Algorithm's Verify mode
 * uses), and the page's ONE primary — "Rate sample" in the plan
 * header — triggers the run (Enter in any field works too; the form
 * carries no second filled primary, per the one-primary law).
 */

import type { JSX } from "react";
import {
  ArrowRight,
  ChevronRight,
  FileDown,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button, EmptyState, Input, Segmented } from "@openrater/design-system";
import { TracePanel } from "../TracePanel/TracePanel";
import type { ServerRunTraceView } from "../TracePanel/serverRunTrace";
import "./run-section.css";

export interface RunField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** The representative default (shown as the reset target). */
  readonly placeholder?: string | undefined;
  /**
   * FCA #10 — the control the declared dtype earns. "boolean" renders
   * a Yes/No toggle ("true"/"false" values; "" = unset, so a required
   * gate answer is CHOSEN, never silently defaulted). Absent = text.
   */
  readonly control?: "text" | "boolean" | undefined;
}

export interface RunOutput {
  readonly field: string;
  readonly valueLabel: string;
}

export interface RunView {
  /**
   * "$4,731" — pre-formatted plan aggregate (`total_premium` when the
   * plan declares one, else the sum of the per-coverage outputs). See
   * deriveRunView.
   */
  readonly premiumLabel: string;
  /** Per-coverage rows in tower order (the aggregate is the headline). */
  readonly outputs: readonly RunOutput[];
  /** "ran just now" / "ran 14:32". */
  readonly ranAtLabel?: string | undefined;
  /**
   * Honest-scope note under the result — e.g. that the Test run is the
   * PLAN premium only (policy-level final adjustments apply at scoring).
   */
  readonly qualifier?: string | undefined;
}

export interface RunSectionProps {
  /** compileReady — when false the section renders the build nudge. */
  readonly ready: boolean;
  readonly blockingHint?: string | null | undefined;
  /** Deep-link to the first missing build step (from the checklist). */
  readonly onOpenBuild?: (() => void) | undefined;
  readonly fields: readonly RunField[];
  readonly onFieldChange: (key: string, value: string) => void;
  /** Reset every field to its representative default. */
  readonly onReset?: (() => void) | undefined;
  /** Run the sample (also fired by Enter inside the form). */
  readonly onRun: () => void;
  readonly running?: boolean | undefined;
  readonly result: RunView | null;
  readonly error?: string | null | undefined;
  /** Deep-link to the Algorithm tab (authored structure). */
  readonly onOpenAlgorithm?: (() => void) | undefined;
  /**
   * Trace-panel brief §14 (audit P4-01) — the evaluated per-run trace,
   * adapted from the persisted server run via `buildServerRunTraceView`.
   * Renders as a collapsible "How this was computed" region under the
   * result — and under a REFUSAL too (the failing step is the
   * diagnosis). Null/absent = no region (e.g. no run yet).
   */
  readonly traceView?: ServerRunTraceView | null | undefined;
  /**
   * Brief 95 D2 — where the seeded values came from ("Seeded from the
   * filing's verified example (TC-01)…"). Absent = the representative-
   * values line.
   */
  readonly seedHint?: string | undefined;
  /**
   * Brief 95 D1 — the plan's book-template CSV (headers = declared
   * inputs, one verified example row). Renders a plain download link in
   * the form head; the server sets Content-Disposition.
   */
  readonly bookTemplateUrl?: string | undefined;
  readonly testId?: string | undefined;
}

/** The collapsible evaluated-trace region (result + refusal branches). */
function RunTraceDisclosure({
  traceView,
  testId,
}: {
  readonly traceView: ServerRunTraceView;
  readonly testId: string;
}): JSX.Element | null {
  if (traceView.nodeOrder.length === 0) return null;
  return (
    <details className="rater-run__trace" data-testid={`${testId}-trace`}>
      <summary className="rater-run__trace-summary">
        <ChevronRight
          size={12}
          className="rater-run__trace-disclosure-icon"
          aria-hidden
        />
        {/* FCA #30 (finding 49) — name the UNIT: this counts EXECUTED
            nodes, which fan out per coverage; the Overview counts
            authored steps. Three bare numbers for one plan read as
            incoherence without the legend. */}
        <span
          title="Executed engine nodes — shared derivations fan out per coverage, so this exceeds the authored step count."
        >
          How this was computed · {traceView.nodeOrder.length} computed steps
        </span>
      </summary>
      <div className="rater-run__trace-body">
        <TracePanel
          run={traceView.run}
          nodeOrder={traceView.nodeOrder}
          nodeLabels={traceView.nodeLabels}
          groups={traceView.groups}
          withheldOutputs={traceView.withheldOutputs}
          {...(traceView.composed ? { composed: traceView.composed } : {})}
        />
      </div>
    </details>
  );
}

export function RunSection({
  ready,
  blockingHint,
  onOpenBuild,
  fields,
  onFieldChange,
  onReset,
  onRun,
  running = false,
  result,
  error,
  onOpenAlgorithm,
  traceView,
  seedHint,
  bookTemplateUrl,
  testId = "rater-run-section",
}: RunSectionProps): JSX.Element {
  if (!ready) {
    return (
      <div className="rater-run rater-run--empty" data-testid={testId}>
        <EmptyState
          icon={<Play size={24} />}
          title="Finish the build first"
          description={
            blockingHint ??
            "The plan needs inputs, factor tables, and a rating algorithm before it can rate a risk."
          }
        >
          {onOpenBuild ? (
            <Button variant="ghost" size="sm" onClick={onOpenBuild}>
              Open the build checklist
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="rater-run" data-testid={testId}>
      {/* ── the sample risk ───────────────────────────────────────── */}
      <form
        className="rater-run__panel rater-run__form"
        onSubmit={(e) => {
          e.preventDefault();
          onRun();
        }}
      >
        <div className="rater-run__panel-head">
          <h2 className="rater-run__eyebrow">Sample risk</h2>
          <div className="rater-run__panel-tools">
            {bookTemplateUrl ? (
              <a
                className="rater-run__book-template"
                href={bookTemplateUrl}
                data-testid={`${testId}-book-template`}
                aria-label="Download the book template (CSV)"
              >
                <FileDown size={12} aria-hidden />
                Book template
              </a>
            ) : null}
            {onReset ? (
              <Button
                variant="plain"
                size="xs"
                icon={<RotateCcw />}
                onClick={onReset}
              >
                Reset
              </Button>
            ) : null}
          </div>
        </div>
        <p className="rater-run__hint">
          {seedHint ??
            "Seeded from the plan's representative values — edit any " +
              "field, then press Enter or Rate sample."}
        </p>
        {fields.length === 0 ? (
          <p className="rater-run__waiting">
            This plan's inputs all carry defaults — run as-is. Declared
            inputs appear here as editable fields.
          </p>
        ) : null}
        <div className="rater-run__fields">
          {fields.map((f) =>
            f.control === "boolean" ? (
              // FCA #10 — a declared bool gets a real Yes/No control.
              // "" (unset) selects neither: an eligibility answer is
              // the user's to give, never a fabricated default.
              <div key={f.key} className="rater-run__field">
                <span className="rater-run__field-label">{f.label}</span>
                <Segmented
                  size="md"
                  ariaLabel={f.label}
                  value={
                    f.value === "true" || f.value === "yes"
                      ? "true"
                      : f.value === "false" || f.value === "no"
                        ? "false"
                        : ""
                  }
                  onChange={(v) => onFieldChange(f.key, v)}
                  items={[
                    { value: "true", label: "Yes" },
                    { value: "false", label: "No" },
                  ]}
                />
              </div>
            ) : (
              <label key={f.key} className="rater-run__field">
                <span className="rater-run__field-label">{f.label}</span>
                <Input
                  inputSize="sm"
                  value={f.value}
                  placeholder={f.placeholder}
                  onChange={(e) => onFieldChange(f.key, e.target.value)}
                  aria-label={f.label}
                />
              </label>
            ),
          )}
        </div>
        {/* Enter submits; the visible run trigger is the page primary. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      {/* ── the result ────────────────────────────────────────────── */}
      <section className="rater-run__panel rater-run__result">
        <div className="rater-run__panel-head">
          <h2 className="rater-run__eyebrow">Result</h2>
          {result?.ranAtLabel ? (
            <span className="rater-run__ranat">{result.ranAtLabel}</span>
          ) : null}
        </div>
        {error ? (
          <>
            <p className="rater-run__error" role="alert">
              {error}
            </p>
            {/* §14 — a refusal's trace is the diagnosis: the failing
                step carries its named issue; outputs stay withheld. */}
            {traceView ? (
              <RunTraceDisclosure traceView={traceView} testId={testId} />
            ) : null}
          </>
        ) : running ? (
          <p className="rater-run__waiting">Rating…</p>
        ) : result ? (
          <>
            <p className="rater-run__premium" data-testid={`${testId}-premium`}>
              {result.premiumLabel}
            </p>
            <ul className="rater-run__outputs">
              {result.outputs.map((o) => (
                <li key={o.field} className="rater-run__output">
                  <code className="rater-run__output-field">{o.field}</code>
                  <span className="rater-run__output-value">
                    {o.valueLabel}
                  </span>
                </li>
              ))}
            </ul>
            {result.qualifier ? (
              <p className="rater-run__qualifier">{result.qualifier}</p>
            ) : null}
            {traceView ? (
              <RunTraceDisclosure traceView={traceView} testId={testId} />
            ) : null}
            {onOpenAlgorithm ? (
              <Button
                variant="plain"
                size="xs"
                iconAfter={<ArrowRight />}
                onClick={onOpenAlgorithm}
              >
                Open the algorithm
              </Button>
            ) : null}
          </>
        ) : (
          <p className="rater-run__waiting">
            Not run yet — press Enter in the form or Rate sample above.
          </p>
        )}
      </section>
    </div>
  );
}
