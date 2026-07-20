/**
 * useCohortConnectorEvaluator — the BATCH connector evaluator + cost
 * guardrail state for a plan's cohort book (Brief 62.6 PR3 §5).
 *
 * Where `useConnectorEvaluator` (PR2) pre-fetches ONE insured's connector
 * IRPM, a cohort book makes one paid live call PER ROW. This hook:
 *
 *   - collects the tail's `{connector_id, version}` refs;
 *   - GATES the paid calls behind `enabled` (the cost guardrail flips it on
 *     an explicit confirm — no call fires on mount);
 *   - per-run cache: fires one `invokeConnector` per DISTINCT
 *     `(connector_id, version, row-features-hash)` — identical insureds don't
 *     pay twice (§5);
 *   - 5 s per-call timeout; a failed/late call degrades to a `net: 0`
 *     fallback carrying the reason (§3) — never a silent 1.0, never a throw;
 *   - rolls up the actual spend (Σ `cost_usd` from the snapshots) + the
 *     fallback count for the guardrail.
 *
 * It returns a SYNC `ConnectorEvaluator` keyed by (connector, version, row
 * hash); `applyCohortPolicyTail` calls it per row with that row's features,
 * so each policy gets its own live net, traced + replayable. Before the book
 * is run (or while it loads) the evaluator returns a `net: 0` "book not run"
 * fallback so the cohort tail never throws on an unresolved connector source.
 *
 * The engine stays source-blind — this is pure pre-fetch + lookup glue.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type {
  ConnectorEvaluation,
  ConnectorEvaluator,
  PolicyAdjustment,
} from "@openrater/contracts";
import type { BookCostRollup, ConnectorCostLine } from "@openrater/ui";
import { invokeConnector, type ConnectorInfo } from "../api/connectors";
import { collectConnectorRefs, netFromOutputs } from "./useConnectorEvaluator";

const CALL_TIMEOUT_MS = 5000;

/** A stable hash of a row's features (the per-run cache key, §5). Sorted keys
 *  so insured field order never splits the cache. */
export function hashFeatures(features: Readonly<Record<string, unknown>>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(features).sort()) sorted[k] = features[k];
  return JSON.stringify(sorted);
}

/** One distinct paid call the book will make: a connector ref × a row. */
export interface BookCall {
  readonly connector_id: string;
  readonly version: string;
  readonly featuresHash: string;
  readonly features: Readonly<Record<string, unknown>>;
}

/**
 * The distinct paid calls = connector refs × distinct row-feature-hashes (the
 * per-run cache, §5): identical insureds collapse to a single call, so a book
 * of 2,000 rows where 50 are duplicates pays for 1,950, not 2,000. Pure +
 * exported for test.
 */
export function distinctBookCalls(
  refs: readonly { readonly connector_id: string; readonly version: string }[],
  rows: readonly Readonly<Record<string, unknown>>[],
): BookCall[] {
  const seen = new Set<string>();
  const out: BookCall[] = [];
  for (const r of refs) {
    for (const features of rows) {
      const featuresHash = hashFeatures(features);
      const key = `${r.connector_id}@${r.version}#${featuresHash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ connector_id: r.connector_id, version: r.version, featuresHash, features });
    }
  }
  return out;
}

/** Race an invoke against a 5 s timeout so a hung connector can't stall the
 *  book — the loser rejects → the row degrades to the fallback (§3). */
function invokeWithTimeout(connectorId: string, features: Record<string, unknown>) {
  return Promise.race([
    invokeConnector(connectorId, features),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`connector timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS),
    ),
  ]);
}

export interface UseCohortConnectorEvaluatorResult {
  /** Resolves each row's connector IRPM (undefined when the tail binds none). */
  readonly connectorEvaluator: ConnectorEvaluator | undefined;
  /** True when the tail binds at least one connector source. */
  readonly hasConnectorSource: boolean;
  /** The distinct connectors bound, with per-call price — for the guardrail. */
  readonly connectorLines: readonly ConnectorCostLine[];
  /** True while the gated batch is in flight. */
  readonly isRunning: boolean;
  /** Live progress over the distinct calls. */
  readonly progress: { readonly done: number; readonly total: number };
  /** The post-run cost rollup (null until the book has run + settled). */
  readonly rollup: BookCostRollup | null;
}

export function useCohortConnectorEvaluator(params: {
  readonly adjustments: readonly PolicyAdjustment[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly connectors: readonly ConnectorInfo[];
  /** The cost-guardrail gate — true once the user confirms the run. */
  readonly enabled: boolean;
}): UseCohortConnectorEvaluatorResult {
  const { adjustments, rows, connectors, enabled } = params;

  const refs = useMemo(() => collectConnectorRefs(adjustments), [adjustments]);
  const hasConnectorSource = refs.length > 0;

  // The connector catalog (cost + display name) for the bound refs — drives
  // the guardrail's cost preview.
  const connectorLines = useMemo<ConnectorCostLine[]>(() => {
    return refs.map((r) => {
      const info = connectors.find((c) => c.connector_id === r.connector_id);
      return {
        connectorId: r.connector_id,
        displayName: info?.display_name ?? r.connector_id,
        version: r.version,
        costPerCallUsd: info?.cost_per_call_usd ?? 0,
      };
    });
  }, [refs, connectors]);

  // The distinct paid calls = refs × distinct row-feature-hashes (the per-run
  // cache: identical rows collapse to one call).
  const calls = useMemo<BookCall[]>(
    () => (hasConnectorSource ? distinctBookCalls(refs, rows) : []),
    [refs, rows, hasConnectorSource],
  );

  const queries = useQueries({
    queries: calls.map((c) => ({
      queryKey: ["cohort-connector-irpm", c.connector_id, c.version, c.featuresHash] as const,
      queryFn: () => invokeWithTimeout(c.connector_id, { ...c.features }),
      enabled,
      retry: false,
      staleTime: Infinity, // a frozen snapshot per (connector, version, row) — the per-run cache
    })),
  });

  const settled = queries.filter((q) => !q.isPending || !enabled).length;
  const isRunning = enabled && calls.length > 0 && queries.some((q) => q.isPending);
  const allSettled = enabled && calls.length > 0 && queries.every((q) => !q.isPending);

  const connectorEvaluator = useMemo<ConnectorEvaluator | undefined>(() => {
    if (!hasConnectorSource) return undefined;
    // Map each distinct (connector, version, row-hash) → its evaluation.
    const byKey = new Map<string, ConnectorEvaluation>();
    calls.forEach((c, i) => {
      const key = `${c.connector_id}@${c.version}#${c.featuresHash}`;
      const q = queries[i];
      if (!enabled) {
        byKey.set(key, { net: 0, version: c.version, fallback_reason: "book not run yet" });
      } else if (q?.data) {
        byKey.set(key, {
          net: netFromOutputs(q.data.outputs),
          version: c.version,
          snapshot_id: q.data.snapshot_id,
          cost_usd: q.data.cost_usd,
        });
      } else if (q?.isPending) {
        byKey.set(key, { net: 0, version: c.version, fallback_reason: "fetching…" });
      } else {
        const reason = q?.error instanceof Error ? q.error.message : "connector call failed";
        byKey.set(key, { net: 0, version: c.version, fallback_reason: reason });
      }
    });
    return (ref, features) => {
      const key = `${ref.connector_id}@${ref.version}#${hashFeatures(features)}`;
      return (
        byKey.get(key) ?? {
          net: 0,
          version: ref.version,
          fallback_reason: enabled ? "row not pre-fetched" : "book not run yet",
        }
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConnectorSource, calls, enabled, ...queries.map((q) => q.status)]);

  const rollup = useMemo<BookCostRollup | null>(() => {
    if (!allSettled) return null;
    let costUsd = 0;
    let fallbackCount = 0;
    let callCount = 0;
    calls.forEach((_c, i) => {
      const q = queries[i];
      if (q?.data) {
        costUsd += q.data.cost_usd;
        callCount += 1;
      } else {
        fallbackCount += 1;
      }
    });
    return { costUsd, fallbackCount, callCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSettled, calls, ...queries.map((q) => q.status)]);

  return {
    connectorEvaluator,
    hasConnectorSource,
    connectorLines,
    isRunning,
    progress: { done: settled, total: calls.length },
    rollup,
  };
}
