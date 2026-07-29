/**
 * IRPM / adjustment source spec — the shared "where does this value come
 * from" descriptor (Brief 62.1 / 62.2 / ADR-0042 D2).
 *
 * A sourced adjustment value (an IRPM net %, a derived endorsement amount)
 * can come from three places — a literal the underwriter typed, a declared
 * input column, or an API Lab connector — but the composer is BLIND to
 * which beyond "is it a `literal`?". 62.1 introduced this union inside
 * `policy-adjustments.ts`; 62.2 promotes it to this shared module (where
 * the per-row resolver also lands) and sharpens the `column` arm to carry
 * EITHER a single net column OR a per-category map.
 * `policy-adjustments.ts` re-exports it, so existing imports are unbroken.
 *
 * `literal` + `column` resolve inline (62.1/62.2); `connector` resolves
 * via an INJECTED evaluator (62.6) — the resolver never holds the HTTP
 * client. The former `model` arm is retired (Detachment Brief 1 §4 S1);
 * see MODEL_SOURCE_RETIRED_MESSAGE below.
 *
 * Pure data + a type guard + the pure per-row resolver. No React, no DOM,
 * no I/O. (Type-only imports of the resolver value shape from
 * `policy-compose` — erased at compile, so there is no runtime cycle.)
 */

import type { PolicyAdjustment } from "./policy-adjustments";
import type { AdjustmentResolver, ResolvedAdjustmentValue } from "./policy-compose";

/**
 * Detachment Brief 1 §4 S1 — the `{from:"model"}` source arm is retired:
 * OpenRater carries no model registry. External scores enter a plan as
 * TYPED INPUTS (declare the score in `inputs` and read it with a
 * `column` source); nothing probabilistic resolves at rating time. The
 * resolver refuses a legacy model source by name with this message.
 */
export const MODEL_SOURCE_RETIRED_MESSAGE =
  'model-backed sources are not supported in OpenRater — supply the ' +
  'score as a typed input (declare it in the plan\'s inputs and bind ' +
  'it with a {from:"column"} source).';

export type IrpmSourceSpec =
  | {
      readonly from: "literal";
      /** Net pct (e.g. -7 for −7%). Optional when `sections` are given. */
      readonly total?: number;
      /** The sub-section breakdown (D2); the cap applies to their sum. */
      readonly sections?: Readonly<Record<string, number>>;
    }
  | {
      readonly from: "column";
      /** A single NET column (signed %, e.g. `irpm_total_pct = -7`). Use
       *  with a single-category / net-mode schedule. Exactly one of
       *  `column` / `columns` is set (validated). */
      readonly column?: string;
      /** OR a per-category map: `category_id → column` carrying that
       *  category's signed %. Enforces per-category ranges downstream. */
      readonly columns?: Readonly<Record<string, string>>;
    }
  // `{from:"model"}` retired (S1) — see MODEL_SOURCE_RETIRED_MESSAGE.
  | { readonly from: "connector"; readonly connector_id: string; readonly version: string };

// ── Type guard (schema-validation boundary) ──────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isObject(value)) return false;
  return Object.values(value).every((v) => typeof v === "number");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((v) => typeof v === "string");
}

/**
 * Is this a structurally valid IrpmSourceSpec? Validates per `from` tag;
 * the `column` arm enforces exactly-one-of `column` / `columns`.
 */
export function isIrpmSourceSpec(value: unknown): value is IrpmSourceSpec {
  if (!isObject(value)) return false;
  switch (value.from) {
    case "literal":
      if (value.total !== undefined && typeof value.total !== "number") {
        return false;
      }
      if (value.sections !== undefined && !isNumberRecord(value.sections)) {
        return false;
      }
      return true;
    case "column": {
      const hasColumn = value.column !== undefined;
      const hasColumns = value.columns !== undefined;
      if (hasColumn === hasColumns) return false; // exactly one of the two
      return hasColumn
        ? isNonEmptyString(value.column)
        : isStringRecord(value.columns);
    }
    case "model":
      // Retired arm (S1): structurally recognizable, never valid — the
      // resolver + validators refuse it with MODEL_SOURCE_RETIRED_MESSAGE.
      return false;
    case "connector":
      return isNonEmptyString(value.connector_id) && isNonEmptyString(value.version);
    default:
      return false;
  }
}

// ── The injected connector evaluator (62.6; ADR-0042 D2/D3) ──────────
//
// A `connector` IRPM is a LIVE API Lab call (async + costed + non-
// reproducible), so it is resolved by an INJECTED evaluator, never
// inline. The
// caller pre-fetches each connector's IRPM (one `invoke_connector` per row
// → net/sections + the replay snapshot + cost) and hands this synchronous
// callback to the resolver; the engine never holds the HTTP client or
// branches on the source (the resolver is the one place that does). Replay
// re-derives from the snapshot (62.6 §4) — never re-calls the live API.

/** What an injected connector evaluation yields — the mapped IRPM + the
 *  provenance/cost the trace records. `net`/`sections` are already mapped
 *  from the connector's output ports by the caller's output-role binding. */
export interface ConnectorEvaluation {
  /** The net IRPM % (signed, e.g. -7). */
  readonly net: number;
  /** Optional sub-section breakdown (an `irpm_sections` binding). */
  readonly sections?: Readonly<Record<string, number>>;
  /** The connector version actually called (provenance / "no floating latest"). */
  readonly version: string;
  /** The append-only replay snapshot id — the filing record (62.6 §4). */
  readonly snapshot_id?: string;
  /** The call cost in USD (the book cost rollup, 62.6 §5). */
  readonly cost_usd?: number;
  /** Set when the live call failed/timed out + a configured fallback net was
   *  used — surfaced in the trace, never a silent 1.0 (62.6 §3). */
  readonly fallback_reason?: string;
}

/** The injected callback that turns a connector reference + a row's features
 *  into a `ConnectorEvaluation`. Backed by the API Lab connector service
 *  (`invoke_connector` / snapshot replay); in tests, a fixture evaluator. */
export type ConnectorEvaluator = (
  ref: { readonly connector_id: string; readonly version: string },
  features: Readonly<Record<string, unknown>>,
) => ConnectorEvaluation;

// ── The per-row resolver (pure, shared, source-handling) ─────────────
//
// This is the ONE place that branches on `source.from` — the injected
// resolver, exactly where ADR-0042 D2 says source-handling belongs. The
// composer stays source-blind (it asks this resolver for any non-literal
// source). The cap is NOT applied here — the `schedule_rating` step in
// `composePolicy` clamps the resolved net to `cap_pct`, so there is one
// cap implementation, not two.

/** Context a source resolves against: the row's declared inputs. */
export interface IrpmResolveCtx {
  readonly externalInputs: Readonly<Record<string, unknown>>;
}

function sumValues(record: Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((sum, v) => sum + v, 0);
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") return `number ${value}`;
  if (typeof value === "string") return `string ${JSON.stringify(value)}`;
  return typeof value;
}

/** Read a declared input column as a finite signed number. Throws loudly
 *  (Validate-early, P-N6) — a missing or non-numeric IRPM column is an
 *  error, NEVER a silent 0 (that would understate the filed premium). */
function readNumericColumn(
  inputs: Readonly<Record<string, unknown>>,
  column: string,
): number {
  const raw = inputs[column];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(
      `resolveIrpmSource: column "${column}" did not resolve to a finite ` +
        `number (got ${describe(raw)}). A missing or non-numeric IRPM ` +
        `column is a loud error, never a silent 0.`,
    );
  }
  return raw;
}

/**
 * Resolve an `IrpmSourceSpec` against a row's inputs → the
 * `ResolvedAdjustmentValue` the composer applies (a `factor` net % +
 * optional sub-sections, with provenance). `literal` passes through;
 * `column` reads one net column or sums a per-category map; `connector`
 * calls the injected `ConnectorEvaluator` (62.6 — a live API Lab call,
 * replayed from its snapshot). A legacy `{from:"model"}` source is
 * refused by name (S1). The cap binds later, in the composer.
 */
export function resolveIrpmSource(
  source: IrpmSourceSpec,
  ctx: IrpmResolveCtx,
  evaluateConnector?: ConnectorEvaluator,
): ResolvedAdjustmentValue {
  // Legacy data can still carry the retired arm at runtime — refuse it
  // by name (never a silent no-op; Law 2).
  if ((source as { from?: unknown }).from === "model") {
    throw new Error(`resolveIrpmSource: ${MODEL_SOURCE_RETIRED_MESSAGE}`);
  }
  switch (source.from) {
    case "literal": {
      const sections = source.sections;
      const net = source.total ?? (sections ? sumValues(sections) : 0);
      return {
        kind: "factor",
        net,
        ...(sections !== undefined ? { sections } : {}),
        provenance: { source: "literal" },
      };
    }
    case "column": {
      if (source.column !== undefined) {
        return {
          kind: "factor",
          net: readNumericColumn(ctx.externalInputs, source.column),
          provenance: { source: "column" },
        };
      }
      const columns = source.columns;
      if (!columns) {
        throw new Error(
          `resolveIrpmSource: a "column" source must set either "column" (net) or "columns" (per-category).`,
        );
      }
      const sections: Record<string, number> = {};
      for (const [category, col] of Object.entries(columns)) {
        sections[category] = readNumericColumn(ctx.externalInputs, col);
      }
      return {
        kind: "factor",
        net: sumValues(sections),
        sections,
        provenance: { source: "column" },
      };
    }
    case "connector": {
      if (!evaluateConnector) {
        throw new Error(
          `resolveIrpmSource: source "connector" needs an injected ConnectorEvaluator ` +
            `(the API Lab connector — Brief 62.6). literal + column resolve inline.`,
        );
      }
      const ev = evaluateConnector(
        { connector_id: source.connector_id, version: source.version },
        ctx.externalInputs,
      );
      return {
        kind: "factor",
        net: ev.net,
        ...(ev.sections !== undefined ? { sections: ev.sections } : {}),
        provenance: {
          source: "connector",
          connector: source.connector_id,
          version: ev.version,
          ...(ev.snapshot_id !== undefined ? { snapshot_id: ev.snapshot_id } : {}),
          ...(ev.cost_usd !== undefined ? { cost_usd: ev.cost_usd } : {}),
          ...(ev.fallback_reason !== undefined ? { fallback_reason: ev.fallback_reason } : {}),
        },
      };
    }
  }
}

function adjustmentSource(adj: PolicyAdjustment): IrpmSourceSpec | undefined {
  switch (adj.kind) {
    case "schedule_rating":
      return adj.source;
    case "endorsement":
      return adj.source;
    default:
      return undefined;
  }
}

/**
 * Build an `AdjustmentResolver` (the callback `composePolicy` injects for
 * non-literal sources) backed by `resolveIrpmSource`. The composer calls
 * it per cohort row for each adjustment whose source it can't read inline;
 * `ctx.externalInputs` is that row's declared inputs.
 *
 * The engine never sees this — it only sees an injected `resolveAdjustment`
 * (ADR-0042 D2), so a connector-sourced and a literal IRPM share one path.
 * A legacy `{from:"model"}` source refuses by name inside
 * `resolveIrpmSource` (S1).
 */
export function makeIrpmAdjustmentResolver(
  evaluateConnector?: ConnectorEvaluator,
): AdjustmentResolver {
  return (adj, ctx) => {
    const source = adjustmentSource(adj);
    if (!source) {
      throw new Error(
        `makeIrpmAdjustmentResolver: adjustment "${adj.id}" (kind "${adj.kind}") has no source to resolve.`,
      );
    }
    return resolveIrpmSource(
      source,
      { externalInputs: ctx.externalInputs },
      evaluateConnector,
    );
  };
}
