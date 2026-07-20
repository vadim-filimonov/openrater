/**
 * useConnectorEvaluator — builds a client-side `ConnectorEvaluator` for a
 * tail's connector-sourced IRPM steps (Brief 62.6).
 *
 * The IRPM resolver is SYNCHRONOUS (composePolicy runs in one pass) but a
 * connector is a LIVE async HTTP call. So — as with any injected evaluator
 * pre-fetches model versions — this hook collects the `{connector_id,
 * version}` refs from the Final-adjustments tail, fires one
 * `invoke_connector` per distinct ref (the API Lab call, which writes the
 * append-only replay snapshot + returns the cost), and returns a SYNC
 * `ConnectorEvaluator` that maps each cached response → `{ net, version,
 * snapshot_id, cost_usd }`. The engine stays source-blind.
 *
 * Failure governance (62.6 §3): a failed/errored call degrades to a
 * `net: 0` fallback carrying a `fallback_reason` (surfaced in the trace) —
 * never a silent 1.0, never a thrown score.
 *
 * v1 output-role mapping (`irpm_net`): the net % is the connector's first
 * numeric output port. `irpm_sections` (the 6 ports) is a follow-up.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type {
  ConnectorEvaluation,
  ConnectorEvaluator,
  PolicyAdjustment,
} from "@openrater/contracts";
import { invokeConnector } from "../api/connectors";

export interface ConnRef {
  readonly connector_id: string;
  readonly version: string;
}

/** The distinct `connector` sources referenced by the tail (schedule_rating
 *  / endorsement carry an IRPM source). */
export function collectConnectorRefs(adjustments: readonly PolicyAdjustment[]): ConnRef[] {
  const seen = new Set<string>();
  const refs: ConnRef[] = [];
  for (const adj of adjustments) {
    const source =
      adj.kind === "schedule_rating" || adj.kind === "endorsement" ? adj.source : undefined;
    if (source && source.from === "connector") {
      const key = `${source.connector_id}@${source.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ connector_id: source.connector_id, version: source.version });
      }
    }
  }
  return refs;
}

/** The net % = the connector's first numeric output port (v1 `irpm_net`). */
export function netFromOutputs(outputs: Readonly<Record<string, unknown>>): number {
  const values = Object.values(outputs);
  const numeric = values.find((v) => typeof v === "number");
  if (typeof numeric === "number") return numeric;
  const coerced = Number(values[0]);
  return Number.isFinite(coerced) ? coerced : 0;
}

/** One connector ref's resolved call state — the data subset of a react-query
 *  result this hook needs (kept narrow so the builder is pure + testable). */
export interface ConnQueryState {
  readonly data?: { readonly outputs: Readonly<Record<string, unknown>>; readonly snapshot_id: string; readonly cost_usd: number };
  readonly error?: unknown;
}

/**
 * The PURE core (extracted for unit testing): map each ref's resolved call to
 * a `ConnectorEvaluation` — success → `{ net, version, snapshot_id, cost_usd }`,
 * failure → a `net: 0` fallback carrying the reason (62.6 §3, never a silent
 * 1.0, never a throw). Returns a sync `ConnectorEvaluator` the engine injects.
 */
export function buildConnectorEvaluator(
  refs: readonly ConnRef[],
  states: readonly ConnQueryState[],
): ConnectorEvaluator {
  const byId = new Map<string, ConnectorEvaluation>();
  refs.forEach((r, i) => {
    const s = states[i];
    if (s?.data) {
      byId.set(r.connector_id, {
        net: netFromOutputs(s.data.outputs),
        version: r.version,
        snapshot_id: s.data.snapshot_id,
        cost_usd: s.data.cost_usd,
      });
    } else {
      const reason = s?.error instanceof Error ? s.error.message : "connector call failed";
      byId.set(r.connector_id, { net: 0, version: r.version, fallback_reason: reason });
    }
  });
  return (ref) =>
    byId.get(ref.connector_id) ?? {
      net: 0,
      version: ref.version,
      fallback_reason: "connector not pre-fetched",
    };
}

export interface UseConnectorEvaluatorResult {
  /** The evaluator, or undefined when there are no connector refs / loading. */
  readonly connectorEvaluator: ConnectorEvaluator | undefined;
  readonly isLoading: boolean;
}

export function useConnectorEvaluator(
  adjustments: readonly PolicyAdjustment[],
  features: Readonly<Record<string, unknown>>,
): UseConnectorEvaluatorResult {
  const refs = useMemo(() => collectConnectorRefs(adjustments), [adjustments]);
  // The invoke inputs are the insured's fields; re-key the queries when they
  // change so a different insured re-invokes (+ writes a fresh snapshot).
  const featuresKey = useMemo(() => JSON.stringify(features), [features]);

  const queries = useQueries({
    queries: refs.map((r) => ({
      queryKey: ["connector-irpm", r.connector_id, r.version, featuresKey] as const,
      queryFn: () => invokeConnector(r.connector_id, features),
      retry: false,
    })),
  });

  const isLoading = refs.length > 0 && queries.some((q) => q.isPending);

  const connectorEvaluator = useMemo<ConnectorEvaluator | undefined>(() => {
    if (refs.length === 0 || queries.some((q) => q.isPending)) return undefined;
    // Build from the narrow {data?, error?} view of each query (the pure core).
    return buildConnectorEvaluator(
      refs,
      queries.map((q) => ({
        ...(q.data ? { data: q.data } : {}),
        ...(q.error ? { error: q.error } : {}),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, featuresKey, ...queries.map((q) => q.status)]);

  return { connectorEvaluator, isLoading };
}
