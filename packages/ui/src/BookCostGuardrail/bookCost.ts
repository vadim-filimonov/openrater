/**
 * Book cost estimate — the pure math behind the connector book guardrail
 * (Brief 62.6 §5). A connector-sourced book makes one paid live call per
 * (row × connector); this prices it BEFORE the run so there are no surprise
 * invoices.
 *
 * Pure. No React, no I/O. The per-run cache (identical rows don't pay twice)
 * is the hook's concern (`useCohortConnectorEvaluator`); this is the worst-
 * case ceiling the guardrail shows up front.
 */

/** One connector the plan's tail binds, with its per-call price. */
export interface ConnectorCostLine {
  readonly connectorId: string;
  readonly displayName: string;
  readonly version: string;
  /** `ConnectorManifest.cost_per_call_usd` (0 for a free/keyless connector). */
  readonly costPerCallUsd: number;
}

export interface BookCostEstimate {
  /** Worst-case live calls = rows × connectors (before the per-run cache). */
  readonly calls: number;
  /** Worst-case spend = rows × Σ cost_per_call. */
  readonly estCostUsd: number;
}

/**
 * The worst-case book cost: every row calls every bound connector once.
 * The per-run cache may lower the actual spend (identical insureds dedupe),
 * so this is an upper bound — never an under-estimate (no surprise invoices).
 */
export function estimateBookCost(
  rowCount: number,
  connectors: readonly ConnectorCostLine[],
): BookCostEstimate {
  const rows = Math.max(0, Math.floor(rowCount));
  const perRow = connectors.reduce((sum, c) => sum + Math.max(0, c.costPerCallUsd), 0);
  return { calls: rows * connectors.length, estCostUsd: rows * perRow };
}

/** Format a USD amount for the guardrail (4 dp under $1 so a $0.012/call
 *  connector reads honestly; whole-cent above). */
export function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return `$${amount.toFixed(digits)}`;
}
