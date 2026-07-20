/**
 * Brief 43 PR 43.6.a — Scored-result persistence bridge.
 *
 * The Inputs workspace runs `executePlanBatch` over a user-uploaded
 * CSV; the Analytics workspace needs that output to drive the
 * chart + map. Until a backend cache is available, we plumb the result
 * through `localStorage` keyed by plan id —
 * matches the existing per-plan persistence convention (dimensions,
 * factor tables, etc per ADR-0027).
 *
 * Three pure helpers:
 *
 *   · `toScoredBatchResult({rows, results, premiumColumn, lossColumn?})`
 *     — coalesce the Inputs workspace's `(rows, RunResult[])` pair
 *     into the shape the chart + map read. Pure; no side effects.
 *
 *   · `persistScoredResult(planId, result)` — JSON.stringify + save
 *     to `localStorage["{prefix}:{planId}"]`. Silent no-op when
 *     localStorage is unavailable (SSR) or throws (quota / mode).
 *
 *   · `loadScoredResult(planId)` — return the parsed value or `null`.
 *     Validates the shape lightly so a stale / corrupted entry
 *     surfaces as "no data" rather than crashing the chart.
 *
 * Storage key: `raterlabs:analytics:scored-result:{planId}` — namespaced
 * to avoid collisions with other OpenRater surfaces and make a future cleanup
 * sweep trivial.
 */

import {
  executePlanBatch,
  type Plan,
  type EligibilityTier,
} from "@openrater/contracts";
import type {
  AnalyticsScoredRow,
  OutputColumnSpec,
  ScoredBatchResult,
} from "./exhibit-math";

const STORAGE_KEY_PREFIX = "raterlabs:analytics:scored-result:" as const;

function storageKey(planId: string): string {
  return STORAGE_KEY_PREFIX + planId;
}

// ──────────────────────────────────────────────────────────────────
// Persistence
// ──────────────────────────────────────────────────────────────────

/**
 * Save a scored batch to per-plan localStorage. Silent no-op on
 * any failure (storage disabled, quota exceeded, private browsing,
 * SSR) — the chart simply continues showing its empty state.
 */
export function persistScoredResult(
  planId: string,
  result: ScoredBatchResult,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(planId), JSON.stringify(result));
  } catch {
    /* non-fatal — see jsdoc */
  }
}

/**
 * Read the persisted scored batch for a plan. Returns null when
 * absent OR when the stored value fails light shape validation
 * (defends against schema drift + corrupted JSON).
 */
export function loadScoredResult(
  planId: string,
): ScoredBatchResult | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey(planId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<ScoredBatchResult>;
  if (
    typeof p.scoredAt !== "string" ||
    typeof p.rowCount !== "number" ||
    typeof p.premiumColumn !== "string" ||
    !Array.isArray(p.rows)
  ) {
    return null;
  }
  return parsed as ScoredBatchResult;
}

/**
 * Clear the persisted scored batch for a plan. Useful when:
 *   · The plan's substrate changed materially (factor tables,
 *     dimensions) and the cached result is stale
 *   · A test needs a clean slate
 *   · The user wants to re-score
 *
 * Silent no-op on storage failure.
 */
export function clearScoredResult(planId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(planId));
  } catch {
    /* non-fatal */
  }
}

// ──────────────────────────────────────────────────────────────────
// Builder
// ──────────────────────────────────────────────────────────────────

export interface ToScoredBatchResultArgs {
  /**
   * Raw input rows (typically from the uploaded CSV). Each row's
   * keys are the source columns; values are the cell strings or
   * numbers as parsed. Stored verbatim on the persisted row so the
   * slice math can read by column name.
   */
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Per-row run results from `executePlanBatch`. Length must match
   * `rows` 1-to-1 — `results[i].outputs` becomes `row[i].outputs`.
   */
  readonly results: ReadonlyArray<{
    readonly outputs: Record<string, unknown>;
    /** Brief 55 — the run's resolved eligibility verdict. Surfaced as an
     *  `eligibility_tier` output column on the scored row (CSV-exportable
     *  + sliceable). Absent/null for plans with no appetite gate. */
    readonly eligibility_tier?: EligibilityTier | null;
  }>;
  /**
   * Which output field carries the premium (e.g. `final_premium`,
   * `do_premium`). Required — the chart's `total` / `avg` / `lr` /
   * `rate_change` KPIs all depend on it.
   */
  readonly premiumColumn: string;
  /** Optional loss column for the `lr` KPI. */
  readonly lossColumn?: string;
  /** Override timestamp (mostly for tests). Defaults to `Date.now()`. */
  readonly scoredAt?: string;
  /**
   * Brief 51 L2 — the plan's REAL declared output columns (money tower
   * outputs + the declared plan total). Resolved by the consumer from
   * the runtime plan's `output` nodes at score time so Analytics binds
   * KPIs to actual outputs, not a `*_premium` name guess. Optional.
   */
  readonly outputColumns?: readonly OutputColumnSpec[];
  /**
   * Brief 43 §6.1 / ADR-0041 Phase 2 — content fingerprint of the
   * scoring substrate at score time (see `computeScoringFingerprint`).
   */
  readonly planFingerprint?: string;
}

/**
 * Coalesce `(rows, RunResult[])` into the persisted shape the chart
 * + map read. Pure function — no localStorage I/O, no validation
 * (the persister handles that). Length mismatch between `rows` and
 * `results` is tolerated: each row's outputs default to `{}` so the
 * KPI math degrades to "no data" for that row rather than throwing.
 */
export function toScoredBatchResult(
  args: ToScoredBatchResultArgs,
): ScoredBatchResult {
  const {
    rows,
    results,
    premiumColumn,
    lossColumn,
    scoredAt,
    outputColumns,
    planFingerprint,
  } = args;
  const scoredRows: AnalyticsScoredRow[] = rows.map((row, i) => {
    const r = results[i];
    const tier = r?.eligibility_tier;
    // ADR-0056 — persist the error facet the same way Brief 55 persists
    // the tier: as an output column, ONLY when it fired. An error row's
    // premium output is already withheld by the engine, so totals stay
    // honest; this column lets exports + Analytics name the facet.
    const rowStatus = (r as { row_status?: "ok" | "error" } | undefined)
      ?.row_status;
    const extra: Record<string, unknown> = {
      // Brief 55 — surface the eligibility verdict as a scored OUTPUT
      // column so it rides into the CSV export + is sliceable in
      // Analytics. Only when the run produced one (a plan with an
      // appetite gate); gate-less plans are unchanged.
      ...(tier != null ? { eligibility_tier: tier } : {}),
      ...(rowStatus === "error" ? { row_status: rowStatus } : {}),
    };
    return {
      inputs: row as Record<string, unknown>,
      outputs:
        Object.keys(extra).length > 0
          ? { ...(r?.outputs ?? {}), ...extra }
          : (r?.outputs ?? {}),
    };
  });
  return {
    scoredAt: scoredAt ?? new Date().toISOString(),
    rowCount: scoredRows.length,
    rows: scoredRows,
    premiumColumn,
    ...(lossColumn !== undefined ? { lossColumn } : {}),
    ...(outputColumns !== undefined ? { outputColumns } : {}),
    ...(planFingerprint !== undefined ? { planFingerprint } : {}),
  };
}

// ──────────────────────────────────────────────────────────────────
// Scoring fingerprint (Brief 43 §6.1 / ADR-0041 Phase 2)
// ──────────────────────────────────────────────────────────────────

/**
 * A short, deterministic, order-independent fingerprint of everything
 * that determines a scored premium: the plan's stages (their
 * `config_json`), its dimensions (slug + level ids), and its factor-
 * table cells. Captured at score time + recomputed when Analytics
 * loads; a mismatch means the rating algorithm changed since the book
 * was scored, so the displayed exhibits are stale.
 *
 * Pure. Sorted by stable keys (stage_id / dim slug / ft id / cell key)
 * so re-ordering doesn't churn the hash; values use `JSON.stringify`
 * which is byte-stable for the same in-session object graph. Not a
 * cryptographic hash — collisions are astronomically unlikely for the
 * "did anything change?" question and irrelevant to correctness (a
 * collision just means we miss a stale prompt, never a wrong premium).
 */
export function computeScoringFingerprint(
  stages: ReadonlyArray<{
    readonly stage_id: string;
    readonly stage_kind: string;
    readonly config_json?: unknown;
  }>,
  dims: ReadonlyArray<{
    readonly slug?: string;
    readonly id?: string;
    readonly levels?: ReadonlyArray<{ readonly id: string }>;
  }>,
  cells: ReadonlyMap<string, ReadonlyMap<string, number>> | undefined,
  // G21 — everything ELSE that changes a premium must flip the stale chip.
  // Stages+dims+cells alone missed the policy tail, the mapping's grouping
  // + roll-up declarations, and the (read-only legacy) geo transformers —
  // an edit to any of them changed scores while the fingerprint said
  // "current". Optional so hash-shape tests stay valid; LIVE callers pass
  // the same extras at score time and at compare time.
  extras?: {
    readonly policyTail?: readonly unknown[];
    readonly groupingConfig?: unknown;
    readonly rollupFields?: readonly unknown[];
    readonly geoTransformers?: Readonly<Record<string, string>>;
  },
): string {
  const byFirst = (a: readonly [string, unknown], b: readonly [string, unknown]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

  const s = stages
    .map(
      (st) =>
        [st.stage_id, `${st.stage_kind}:${stableStringify(st.config_json)}`] as const,
    )
    .sort(byFirst);
  const d = dims
    .map(
      (dim) =>
        [dim.slug ?? dim.id ?? "", (dim.levels ?? []).map((l) => l.id).sort().join(",")] as const,
    )
    .sort(byFirst);
  const c = cells
    ? [...cells.entries()]
        .map(
          ([ft, m]) =>
            [ft, [...m.entries()].sort(byFirst).map(([k, v]) => `${k}=${v}`).join(",")] as const,
        )
        .sort(byFirst)
    : [];
  // Absent and empty hash identically (`""`), so pre-G21 fingerprints only
  // shift for plans where one of these actually carries content — a
  // tail-less plan's persisted results don't all go stale on upgrade.
  const t =
    extras?.policyTail && extras.policyTail.length > 0
      ? stableStringify(extras.policyTail)
      : "";
  const g =
    extras?.groupingConfig != null ? stableStringify(extras.groupingConfig) : "";
  const r =
    extras?.rollupFields && extras.rollupFields.length > 0
      ? stableStringify(extras.rollupFields)
      : "";
  const x =
    extras?.geoTransformers && Object.keys(extras.geoTransformers).length > 0
      ? stableStringify(extras.geoTransformers)
      : "";

  return djb2(
    t === "" && g === "" && r === "" && x === ""
      ? // Byte-identical to the pre-G21 payload when no extras carry
        // content — upgrade doesn't invalidate existing fingerprints.
        JSON.stringify({ s, d, c })
      : JSON.stringify({ s, d, c, t, g, r, x }),
  );
}

/** Stable JSON.stringify with sorted object keys (recursive). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** djb2 string hash → base36. Compact, fast, non-cryptographic. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  // >>> 0 → unsigned; base36 keeps it short.
  return (h >>> 0).toString(36);
}

// ──────────────────────────────────────────────────────────────────
// Snapshot body → runtime Plan projection (Brief 43 §4)
// ──────────────────────────────────────────────────────────────────

// Relocated to the PURE `snapshot-plan` module so server-side consumers
// (the scoring service's plan_id resolution, ADR-0049 A8) can import it
// without this file's window-bound localStorage helpers entering a Node
// type-graph. Re-exported here so browser call sites are unchanged.
export {
  snapshotBodyToProjection,
  snapshotBodyToRuntimePlan,
  snapshotBodyInputMapping,
  snapshotBodyPolicyTail,
} from "./snapshot-plan";

// ──────────────────────────────────────────────────────────────────
// Per-snapshot re-rate (PR 43.6.d)
// ──────────────────────────────────────────────────────────────────

export interface RerateSnapshotRowsArgs {
  /**
   * The runtime Plan to re-rate. A snapshot's stored `body` is the
   * *substrate* shape, not a runtime Plan — project it through
   * `snapshotBodyToRuntimePlan` FIRST. The engine compiles
   * `plan.nodes`, so the runtime shape (typed `Plan`) must be passed
   * here, never the raw snapshot body.
   */
  readonly plan: Plan;
  /**
   * Input rows to score the plan against. Typically the same rows the
   * live draft was scored against — that's what makes the baseline-vs-
   * draft comparison meaningful (same population, two rating
   * algorithms).
   */
  readonly liveRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Premium column for the resulting ScoredBatchResult. */
  readonly premiumColumn: string;
  /** Optional loss column for the `lr` KPI. */
  readonly lossColumn?: string;
  /** Override timestamp for tests. Defaults to `Date.now()`. */
  readonly scoredAt?: string;
}

/**
 * Brief 43 §4 — re-rate a runtime Plan against live input rows.
 *
 * Returns a `ScoredBatchResult` shaped like what the Inputs
 * workspace produces — drop-in compatible with the chart + map
 * primitives via `baselineResult` / `comparisonResult` props.
 *
 * Pure function: no I/O, no localStorage. Consumers memoize the
 * result by `snapshot_id` (the snapshot is immutable, so re-rating
 * the same plan against the same rows produces the same output).
 *
 * Throws when `executePlanBatch` rejects the plan — the caller
 * (typically `AnalyticsWorkspaceMount`) catches it and surfaces the
 * failure as a non-blocking toast (from an effect, not during
 * render) while keeping the empty state.
 */
export function rerateSnapshotRows(
  args: RerateSnapshotRowsArgs,
): ScoredBatchResult {
  const { plan, liveRows, premiumColumn, lossColumn, scoredAt } = args;
  const results = executePlanBatch(
    plan,
    liveRows as ReadonlyArray<Record<string, unknown>>,
  );
  return toScoredBatchResult({
    rows: liveRows,
    results: results.map((r) => ({
      outputs: r.outputs,
      ...(r.eligibility_tier != null
        ? { eligibility_tier: r.eligibility_tier }
        : {}),
    })),
    premiumColumn,
    ...(lossColumn !== undefined ? { lossColumn } : {}),
    ...(scoredAt !== undefined ? { scoredAt } : {}),
  });
}

// ──────────────────────────────────────────────────────────────────
// Export scored CSV (PR 43.7)
// ──────────────────────────────────────────────────────────────────

/** RFC-4180 cell escape — same shape as the Inputs workspace exporter. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Brief 43 PR 43.7 — Serialize a `ScoredBatchResult` to a CSV string.
 *
 * Layout: union of input columns (left) + union of output columns
 * (right), in encounter order. One row per scored row. Missing
 * values render as empty cells; commas / quotes / newlines RFC-4180
 * escape via double-quote wrapping.
 *
 * Pure — no I/O, no DOM. The caller triggers the download.
 */
export interface BuildAnalyticsScoredCsvOptions {
  /**
   * G-6 — Optional baseline (filed-snapshot) re-rate to emit
   * side-by-side with the draft. When set, the CSV layout is:
   *
   *   inputs | baseline_{outCol} | draft_{outCol} | delta_pct_{outCol}
   *
   * `delta_pct_{outCol}` is `(draft - baseline) / baseline` rounded
   * to 4 decimal places. When baseline value is missing or zero,
   * the delta cell is empty (CSV-friendly null).
   *
   * Row alignment: matches by row INDEX in `result.rows` (which is
   * the source-CSV row order). The two results are expected to
   * have been scored against the same input row sequence — the
   * existing `rerateSnapshotRows` produces this shape by
   * construction.
   *
   * When `baselineResult` is omitted (or its rowCount doesn't
   * match `result.rowCount`), the export falls back to the
   * single-side layout (the pre-G-6 behavior).
   */
  readonly baselineResult?: ScoredBatchResult;
  /**
   * G-6 — Column-name prefixes for the side-by-side mode. Defaults
   * to `{baseline: "baseline_", draft: "draft_", delta: "delta_pct_"}`.
   * Consumers can override for filed-rate language ("filed_",
   * "proposed_", etc.).
   */
  readonly sidePrefixes?: {
    readonly baseline?: string;
    readonly draft?: string;
    readonly delta?: string;
  };
}

export function buildAnalyticsScoredCsv(
  result: ScoredBatchResult,
  options: BuildAnalyticsScoredCsvOptions = {},
): string {
  const inputCols: string[] = [];
  const outputCols: string[] = [];
  const inputSeen = new Set<string>();
  const outputSeen = new Set<string>();
  for (const row of result.rows) {
    for (const k of Object.keys(row.inputs)) {
      if (!inputSeen.has(k)) {
        inputSeen.add(k);
        inputCols.push(k);
      }
    }
    for (const k of Object.keys(row.outputs)) {
      if (!outputSeen.has(k)) {
        outputSeen.add(k);
        outputCols.push(k);
      }
    }
  }

  // G-6 — Side-by-side mode. Only activates when a baseline is
  // supplied AND the row counts match (defensive — mismatched
  // shapes would emit garbage; fall back to single-side).
  const baseline = options.baselineResult;
  const sideBySide =
    baseline !== undefined && baseline.rowCount === result.rowCount;

  if (sideBySide) {
    const baselinePrefix = options.sidePrefixes?.baseline ?? "baseline_";
    const draftPrefix = options.sidePrefixes?.draft ?? "draft_";
    const deltaPrefix = options.sidePrefixes?.delta ?? "delta_pct_";

    // Union the two side's output columns so we don't drop a column
    // that only baseline emitted (e.g. a deprecated output kept in
    // the filed snapshot but removed from the draft).
    const baselineOutputCols: string[] = [];
    const baselineOutputSeen = new Set<string>();
    for (const row of baseline.rows) {
      for (const k of Object.keys(row.outputs)) {
        if (!baselineOutputSeen.has(k)) {
          baselineOutputSeen.add(k);
          baselineOutputCols.push(k);
        }
      }
    }
    const unionOutputCols: string[] = [...outputCols];
    for (const k of baselineOutputCols) {
      if (!outputSeen.has(k)) unionOutputCols.push(k);
    }

    const header = [
      ...inputCols,
      ...unionOutputCols.map((k) => `${baselinePrefix}${k}`),
      ...unionOutputCols.map((k) => `${draftPrefix}${k}`),
      ...unionOutputCols.map((k) => `${deltaPrefix}${k}`),
    ];
    const lines: string[] = [header.map(csvEscape).join(",")];
    for (let i = 0; i < result.rows.length; i += 1) {
      const draftRow = result.rows[i]!;
      const baselineRow = baseline.rows[i];
      const cells: string[] = [];
      for (const k of inputCols) cells.push(csvEscape(draftRow.inputs[k]));
      // baseline side
      for (const k of unionOutputCols) {
        cells.push(csvEscape(baselineRow?.outputs[k]));
      }
      // draft side
      for (const k of unionOutputCols) {
        cells.push(csvEscape(draftRow.outputs[k]));
      }
      // delta_pct = (draft - baseline) / baseline; empty when not numeric or baseline=0
      for (const k of unionOutputCols) {
        const baseVal = toNum(baselineRow?.outputs[k]);
        const draftVal = toNum(draftRow.outputs[k]);
        if (
          baseVal === null ||
          draftVal === null ||
          baseVal === 0 ||
          !Number.isFinite(baseVal) ||
          !Number.isFinite(draftVal)
        ) {
          cells.push("");
          continue;
        }
        const delta = (draftVal - baseVal) / baseVal;
        cells.push(csvEscape(Math.round(delta * 10000) / 10000));
      }
      lines.push(cells.join(","));
    }
    return lines.join("\n");
  }

  // Single-side (default / pre-G-6 behavior).
  const header = [...inputCols, ...outputCols];
  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const row of result.rows) {
    const cells: string[] = [];
    for (const k of inputCols) cells.push(csvEscape(row.inputs[k]));
    for (const k of outputCols) cells.push(csvEscape(row.outputs[k]));
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

// Small local helper for the delta math (avoids importing from
// exhibit-math just for one type-coerce).
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Brief 43 §−1.Q6 lock — auto-generated filename:
 *
 *   `{plan_slug}_scored_{ISO 8601 timestamp}.csv`
 *
 * Colons in the timestamp are replaced with hyphens so the file
 * works on Windows + macOS Finder without escaping. `plan_slug`
 * defaults to "plan" when blank/undefined.
 */
export function analyticsScoredCsvFilename(
  planSlug: string | null | undefined,
  scoredAt: string,
): string {
  const slug = planSlug && planSlug.length > 0 ? planSlug : "plan";
  // ISO 8601 with `:` swapped for `-` is still parseable by humans
  // but file-system friendly.
  const safeTimestamp = scoredAt.replace(/:/g, "-").replace(/\.\d+/, "");
  return `${slug}_scored_${safeTimestamp}.csv`;
}

/**
 * Resolve which output field name to use as the premium column — the
 * PLAN-TOTAL premium, not a single coverage's. A multi-tower plan
 * emits one `{coverage}_premium` output per tower and then (when a
 * `round` plan-tail stage is authored) an aggregate `total_premium`
 * output, which `stagesToRuntimePlan` appends AFTER the per-tower
 * outputs. Picking the first output here fed a single coverage (e.g.
 * `building_premium`) into the Inputs policy list, Score-all
 * persistence, and the Analytics KPIs (V4 plan G1).
 *
 * Resolution order:
 *   1. An output named exactly `total_premium` / `final_premium`
 *      (the aggregate's default + the single-LOB convention).
 *   2. The LAST money-typed output — the projector emits the plan
 *      total after the per-tower premiums, and its trace outputs
 *      (factors, sublimits, contributions) are never `money`.
 *   3. The first output with a fieldName (echo plans + hand-authored
 *      plans without fieldType metadata — the old behavior).
 *
 * ⚠️ NOT SAFE ALONE (93.4). Leg 2 assumes the plan HAS a total to
 * emit last. A total-less multi-coverage filing has none — the legal
 * Brief-92 transcription — so leg 2 returns its LAST TOWER, and the
 * caller headlines one coverage as the risk's price ($72 for a $267
 * two-tower risk, live 2026-07-15). This function cannot see the
 * difference: it reads the projected graph, and only the authored
 * STAGES distinguish a plan total from a tower tip.
 *
 * Every caller MUST first ask
 * `isTotalLessMultiCoverage(resolvePlanPremiumContext(plan, stages))`
 * and, when true, sum `moneyFields` (`sumMoneyFields`) under the
 * synthesized `COVERAGE_SUM_COLUMN` instead of calling this. Legs 1
 * and 3 stay authoritative — they read shapes the typed context
 * cannot (outputs declaring no `fieldType`) — which is why this
 * resolver survives rather than being deleted.
 *
 * Returns null when no output node defines a fieldName — the
 * caller should treat this as "can't score" and skip persistence.
 * Exported separately so the Inputs workspace can fold it into the
 * existing score-all flow without re-walking the plan elsewhere.
 */
export function resolvePremiumColumn(plan: {
  readonly nodes?: ReadonlyArray<{
    readonly kind: string;
    readonly params?: unknown;
  }>;
}): string | null {
  if (!plan.nodes) return null;
  const outputs: { fieldName: string; fieldType?: string }[] = [];
  for (const node of plan.nodes) {
    if (node.kind !== "output") continue;
    const params = node.params as
      | { fieldName?: string; fieldType?: string }
      | undefined;
    if (params?.fieldName) {
      outputs.push(
        params.fieldType
          ? { fieldName: params.fieldName, fieldType: params.fieldType }
          : { fieldName: params.fieldName },
      );
    }
  }
  if (outputs.length === 0) return null;
  const aggregate = outputs.find(
    (o) => o.fieldName === "total_premium" || o.fieldName === "final_premium",
  );
  if (aggregate) return aggregate.fieldName;
  for (let i = outputs.length - 1; i >= 0; i--) {
    if (outputs[i]!.fieldType === "money") return outputs[i]!.fieldName;
  }
  return outputs[0]!.fieldName;
}

/**
 * G-4 — Auto-detect the loss column for the `lr` KPI from the
 * uploaded CSV's input columns. Returns null when no plausible
 * column is found.
 *
 * Heuristic priority (first match wins):
 *   1. Exact match for canonical names: `loss`, `losses`,
 *      `incurred_loss`, `paid_loss`, `incurred_losses`
 *   2. Snake/camel-case names containing both `loss` AND a numeric
 *      qualifier (`incurred`, `paid`, `ultimate`, `reported`)
 *   3. Names that just contain `loss` (catch-all, last resort)
 *
 * Loss columns by convention land in the CSV (actuals brought in
 * alongside the risk attributes), so the input columns are the
 * search space. The picker UI in a future PR can override the
 * auto-detect when the user has a non-standard name.
 */
export function resolveLossColumn(
  inputColumns: readonly string[],
): string | null {
  if (inputColumns.length === 0) return null;

  const CANONICAL = new Set([
    "loss",
    "losses",
    "incurred_loss",
    "incurred_losses",
    "paid_loss",
    "paid_losses",
    "ultimate_loss",
    "ultimate_losses",
    "reported_loss",
    "reported_losses",
  ]);
  const QUALIFIERS = ["incurred", "paid", "ultimate", "reported"];

  const lcCols = inputColumns.map((c) => ({
    raw: c,
    lc: c.toLowerCase().trim(),
  }));

  // Pass 1: exact canonical match.
  for (const c of lcCols) {
    if (CANONICAL.has(c.lc)) return c.raw;
  }

  // Pass 2: contains "loss" AND a numeric qualifier.
  for (const c of lcCols) {
    if (!c.lc.includes("loss")) continue;
    if (QUALIFIERS.some((q) => c.lc.includes(q))) return c.raw;
  }

  // Pass 3: just contains "loss" — last-resort catch.
  for (const c of lcCols) {
    if (c.lc.includes("loss")) return c.raw;
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────
// Brief 75 phase 4 — persisted-run feed
// ──────────────────────────────────────────────────────────────────

/** One stored row of a DONE book run, as api-lab relays it from the
 *  scoring result store (projected inputs + outputs + verdict). */
export interface PersistedRunRow {
  readonly inputs?: Record<string, unknown> | undefined;
  readonly outputs?: Record<string, unknown> | undefined;
  readonly views?: Record<string, unknown> | undefined;
  readonly row_status?: "ok" | "error" | undefined;
  readonly eligibility_tier?: string | undefined;
}

/**
 * Coalesce a persisted book run's rows into the SAME `ScoredBatchResult`
 * grammar the exhibits read — the run-fed twin of `toScoredBatchResult`
 * (browser-scored). The verdict + error facet fold into outputs
 * identically, so charts, slices, and the CSV export cannot tell the
 * feeds apart. No `planFingerprint`: run staleness is the run's
 * `plan_content_hash` vs the live draft's, judged by the mount.
 *
 * When the advertised `premiumColumn` is NOT an engine output (the run
 * summary advertises the synthesized `COVERAGE_SUM_COLUMN` for a
 * total-less plan — no single output carries the premium), the column
 * is MATERIALIZED per clean row from the row's own service-derived
 * `views.premium`, never re-summed client-side (one authority). Error
 * rows stay premium-less (Law 2 / G8 — the views already withhold).
 */
export function runRowsToScoredBatchResult(args: {
  readonly rows: readonly PersistedRunRow[];
  readonly premiumColumn: string;
  readonly scoredAt: string;
  readonly lossColumn?: string;
}): ScoredBatchResult {
  const scoredRows: AnalyticsScoredRow[] = args.rows.map((r) => {
    const tier =
      r.eligibility_tier ??
      (typeof r.views?.tier === "string" ? r.views.tier : undefined);
    const outputs = r.outputs ?? {};
    const viewsPremium = r.views?.premium;
    const extra: Record<string, unknown> = {
      ...(tier != null ? { eligibility_tier: tier } : {}),
      ...(r.row_status === "error" ? { row_status: r.row_status } : {}),
      ...(!(args.premiumColumn in outputs) &&
      r.row_status !== "error" &&
      typeof viewsPremium === "number" &&
      Number.isFinite(viewsPremium)
        ? { [args.premiumColumn]: viewsPremium }
        : {}),
    };
    return {
      inputs: r.inputs ?? {},
      outputs:
        Object.keys(extra).length > 0 ? { ...outputs, ...extra } : outputs,
    };
  });
  return {
    scoredAt: args.scoredAt,
    rowCount: scoredRows.length,
    rows: scoredRows,
    premiumColumn: args.premiumColumn,
    ...(args.lossColumn !== undefined ? { lossColumn: args.lossColumn } : {}),
  };
}
