/**
 * <BookCostGuardrail> — the connector book's cost preview + confirm
 * (Brief 62.6 §5).
 *
 * A connector-sourced book is the one place Brief 62 spends real money: a
 * 2,000-policy run is 2,000 paid live calls. This strip makes that visible
 * and safe BEFORE the run:
 *
 *   - shows `rows × Σ cost_per_call = ~$X` (worst case; the per-run cache may
 *     lower it) and names the connectors + the row count it's pricing — so
 *     there is no silent sampling and no surprise invoice;
 *   - above a threshold, requires an explicit two-step confirm before any
 *     paid call fires;
 *   - while running, shows progress; when done, the actual cost rollup
 *     (summed from the snapshots) + how many calls fell back (§3).
 *
 * Pure + presentational. The fetch/cache/timeout/fallback is the consumer's
 * hook (`useCohortConnectorEvaluator`); this owns only the
 * preview → confirm → run → rollup affordance + its local confirm latch.
 */

import { useState } from "react";
import { Button } from "@openrater/design-system";
import { Coins, Play, ShieldAlert } from "lucide-react";
import { estimateBookCost, formatUsd, type ConnectorCostLine } from "./bookCost";
import "./BookCostGuardrail.css";

export interface BookCostRollup {
  /** Actual spend, summed from the snapshots the run wrote. */
  readonly costUsd: number;
  /** How many of the calls degraded to the fallback net (§3). */
  readonly fallbackCount: number;
  /** Distinct live calls actually made (after the per-run cache dedupe). */
  readonly callCount: number;
}

export interface BookCostGuardrailProps {
  /** Rows the book will price + score (state the exact count — no sampling). */
  readonly rowCount: number;
  /** The distinct connectors the plan's tail binds (with per-call price). */
  readonly connectors: readonly ConnectorCostLine[];
  /** Confirm-above-threshold ceiling in USD. Default $1.00. */
  readonly thresholdUsd?: number;
  /** True while the batch is in flight (disables Run, shows progress). */
  readonly isRunning?: boolean;
  /** Live progress while running. */
  readonly progress?: { readonly done: number; readonly total: number };
  /** The post-run cost rollup, or null until the book has run. */
  readonly rollup?: BookCostRollup | null;
  /** Fired once the user has confirmed (above threshold) or directly (below). */
  readonly onRun: () => void;
}

const DEFAULT_THRESHOLD_USD = 1.0;

export function BookCostGuardrail({
  rowCount,
  connectors,
  thresholdUsd = DEFAULT_THRESHOLD_USD,
  isRunning = false,
  progress,
  rollup = null,
  onRun,
}: BookCostGuardrailProps) {
  const [confirming, setConfirming] = useState(false);
  const { calls, estCostUsd } = estimateBookCost(rowCount, connectors);
  const overThreshold = estCostUsd > thresholdUsd;
  const connectorNames = connectors.map((c) => `${c.displayName} · ${c.version}`).join(", ");

  const handleRun = () => {
    if (overThreshold && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onRun();
  };

  return (
    <div className="rater-book-cost" role="group" aria-label="Book cost guardrail">
      <div className="rater-book-cost__head">
        <span className="rater-book-cost__icon" aria-hidden="true">
          <Coins size={15} />
        </span>
        <div className="rater-book-cost__summary">
          <span className="rater-book-cost__est">
            {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"} ×{" "}
            {connectors.length} {connectors.length === 1 ? "connector" : "connectors"} ={" "}
            <strong>{calls.toLocaleString()}</strong> live calls ·{" "}
            <strong>~{formatUsd(estCostUsd)}</strong>
          </span>
          <span className="rater-book-cost__sub">
            {connectorNames}. Re-scores replay the frozen snapshots — never the
            live API.
          </span>
        </div>

        {rollup ? (
          <div className="rater-book-cost__rollup" aria-live="polite">
            <span className="rater-book-cost__rollup-cost">{formatUsd(rollup.costUsd)} spent</span>
            <span className="rater-book-cost__rollup-meta">
              {rollup.callCount.toLocaleString()} calls
              {rollup.fallbackCount > 0 ? ` · ${rollup.fallbackCount} fell back` : ""}
            </span>
          </div>
        ) : isRunning ? (
          <span className="rater-book-cost__running" aria-live="polite">
            Running… {progress ? `${progress.done}/${progress.total}` : ""}
          </span>
        ) : (
          <Button
            variant={confirming ? "primary" : "ghost"}
            onClick={handleRun}
            disabled={calls === 0}
            icon={confirming ? <ShieldAlert size={14} /> : <Play size={14} />}
          >
            {confirming ? `Confirm ~${formatUsd(estCostUsd)}` : "Run book"}
          </Button>
        )}
      </div>

      {confirming && !isRunning && !rollup ? (
        <p className="rater-book-cost__confirm" role="alert">
          This will make up to {calls.toLocaleString()} paid live calls
          (~{formatUsd(estCostUsd)}, above the {formatUsd(thresholdUsd)} threshold).
          Click <strong>Confirm</strong> to run, or{" "}
          <button
            type="button"
            className="rater-book-cost__cancel"
            onClick={() => setConfirming(false)}
          >
            cancel
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
