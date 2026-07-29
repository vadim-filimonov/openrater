/**
 * Structured plan issues — ADR-0056 (Rate Lab v4 P2, Law 2).
 *
 * "Refuse or resolve, never improvise": an input the plan can't rate
 * is a VISIBLE, STRUCTURED signal — never a silent factor-1.0. This
 * module is the shared vocabulary for both issue species:
 *
 *   · `ProjectionIssue` — plan-shaped, produced when the projector
 *     turns authored stages into a runtime Plan (a property of the
 *     substrate + catalogs, row-independent).
 *   · `RowIssue` — row-shaped, produced at run time when one row
 *     meets one node (unknown key, unresolved output, …).
 *
 * Naming note: `PlanIssue` (validation.ts, Brief-9 reference
 * integrity) and the Brief-13 `Issue`/`collectIssues` unified panel
 * already exist — these species deliberately take non-colliding
 * names and FEED that system; they don't replace it.
 *
 * error ≠ decline ≠ $0 (ADR-0056): an error row has NO premium (the
 * runtime withholds unresolved numeric outputs); a decline is an
 * authored verdict from successful rating; $0 is real arithmetic.
 */

/* ============================================================
 * Unknown-key policy (authored per factor lookup)
 * ============================================================ */

/** The authored disposition for a lookup key that doesn't resolve. */
export type UnknownKeyPolicyMode = "error" | "default" | "refer";

/**
 * Engine-level miss policy carried on lookup params (`onMiss`).
 *
 * The projector stamps this from the authored per-lookup
 * `unknown_key_policy`, with `{ mode: "error" }` as the authoring
 * default (Law 2). When ABSENT, the kinds keep the legacy
 * `?? defaultValue` behavior — the raw engine stays byte-compatible
 * for hand-built plans + published conformance vectors; the LAW binds
 * at the authoring boundary, which always sets it explicitly.
 */
export interface OnMissPolicy {
  readonly mode: UnknownKeyPolicyMode;
  /** The authored resolution value — required when mode = "default". */
  readonly value?: number;
}

/* ============================================================
 * Issue shapes
 * ============================================================ */

/** Machine-stable projection-time codes (append-only registry). */
export type ProjectionIssueCode =
  | "factor_table_missing"
  | "factor_table_empty"
  | "coverage_slice_empty"
  | "table_unkeyable_2d"
  | "range_levels_unusable"
  | "lookup_unkeyed"
  | "predicate_dropped"
  | "stage_not_executed"
  | "chain_missing_base"
  // Retired from emission 2026-07-10 (finding E9): a multiplicative
  // schedule's package scope projects EXACTLY via per-tip application
  // (distributivity), so nothing falls back. The code stays in the
  // append-only registry for old persisted issue payloads.
  | "package_scope_fallback"
  | "multi_gate_tier_first_wins"
  | "orphan_stage"
  | "plan_compile_failed"
  // Brief 80 (platform-test finding E7) — the policy-composition
  // contract names its own breakage instead of returning null premiums:
  | "grouping_missing_rollup"
  | "round_output_nonstandard"
  | "grouping_column_missing"
  // 92.5 live finding — a once-per-policy additive endorsement has no
  // single tip on a multi-tower plan; the projector refuses loudly
  // instead of applying it N times (or corrupting via a shared node):
  | "endorsement_additive_multi_tower";

/** Machine-stable run-time codes (append-only registry). */
export type RowIssueCode =
  | "unknown_key"
  | "unknown_key_defaulted"
  | "unknown_key_referred"
  | "territory_unmapped"
  | "class_attribute_missing"
  | "band_out_of_range"
  | "missing_input"
  | "unknown_input"
  | "unresolved_output"
  | "composition_failed"
  // Brief 95 C4 — an explicit 0 exposure on a coverage the plan does
  // NOT mark electable (zero is not an elect-out; §12.4).
  | "zero_exposure_required"
  // FCA fca-2026-07-25 #15 — a supplied value outside the input's
  // DECLARED validation (min/max bounds, allowed_values). The row
  // still prices (garbage-in is the caller's right); the warning is
  // the plausibility signal the audit found missing everywhere: a
  // $1.28B payroll and a model-year '26' both priced silently while
  // the bounds mechanism sat unread.
  | "implausible_input"
  // ADR-0025 / FCA #21 — a composite dim's member axis resolved to no
  // level, so the joined key can't be built; names the MEMBER so the
  // refusal cites the culprit, not the downstream lookup's unknown-key.
  | "composite_member_unresolved"
  // FCA #23 — a bare-percentage schedule application on a multi-
  // category schedule can't be attributed; the neutral outcome is
  // DISCLOSED (the audited book lost six rows' filed IRPM silently).
  | "schedule_application_unattributable";

/**
 * A plan-shaped issue from projection/compile — exists before any row
 * is scored. severity "error" ⇒ the plan would produce a wrong or
 * blocked premium; "warning" ⇒ a structural resolution was applied
 * and the result stands, visibly qualified.
 */
export interface ProjectionIssue {
  readonly severity: "error" | "warning";
  readonly code: ProjectionIssueCode;
  /** Actuary-readable, names the artifact ("Factor table X has no cells"). */
  readonly message: string;
  /** Authored provenance — the stage this issue traces to (P-N3 stable id). */
  readonly stageId?: string;
  /** The runtime node involved, when one was emitted. */
  readonly nodeId?: string;
  /** Structured pointers for deep-linking / dedup. */
  readonly ref?: {
    readonly table?: string;
    readonly dim?: string;
    readonly field?: string;
    readonly coverage?: string;
    readonly stageKind?: string;
  };
}

/** Structured context on a row issue (what missed, where, under which policy). */
export interface RowIssueDetail {
  /** tableName of the lookup involved. */
  readonly table?: string;
  /** The key value that missed (stringified), when one existed. */
  readonly key?: string;
  /** The raw input field on the key-resolution path, when known. */
  readonly field?: string;
  /** The policy that governed the outcome. */
  readonly policy?: UnknownKeyPolicyMode;
  /** What `default(x)` resolved to. */
  readonly appliedValue?: number;
  /** The coverage involved (Brief 95 C4 election refusals). */
  readonly coverage?: string;
}

/**
 * A row-shaped issue from run time — one row meeting one node.
 * severity "error" ⇒ the row cannot be rated (row_status "error", no
 * premium); "warning" ⇒ an authored/structural resolution applied.
 */
export interface RowIssue {
  readonly severity: "error" | "warning";
  readonly code: RowIssueCode;
  /** The runtime node — attached by `runPlan`, not by the kind. */
  readonly nodeId: string;
  readonly message: string;
  readonly detail?: RowIssueDetail;
}

/**
 * What a kind produces: everything but the node id (a kind's
 * `execute`/`collectRowIssues` doesn't know which node it is running
 * as — the runtime attaches identity).
 */
export type RowIssueSeed = Omit<RowIssue, "nodeId">;

/* ============================================================
 * The fatal channel — typed throw for `onMiss.mode === "error"`
 * ============================================================ */

/**
 * Thrown by a kind's `execute()` when a Law-2 policy refuses the row.
 * `runPlan` already catches per-node execute throws and continues the
 * row (partial trace, `{}` outputs downstream); it recognizes this
 * class specially to preserve the structured seed instead of only the
 * message string. One poisoned row can never abort a batch.
 */
export class RowIssueError extends Error {
  readonly seed: RowIssueSeed;

  constructor(seed: RowIssueSeed) {
    super(seed.message);
    this.name = "RowIssueError";
    this.seed = seed;
  }
}

/* ============================================================
 * Shared miss-resolution helpers (used by the four lookup kinds)
 * ============================================================ */

/**
 * Render a lookup key for messages — distinguishes three cases:
 *   · `undefined`  → the raw input field was ABSENT (missing_input)
 *   · `null` / ""  → a field was supplied but the key RESOLVED to
 *     nothing upstream (unmapped territory, missing class attribute) —
 *     still an unknown_key; the derive enrichers name the root cause
 *   · anything else → an unknown key, quoted
 */
function describeKey(key: unknown): {
  label: string;
  keyStr?: string;
  absent: boolean;
} {
  if (key === undefined) {
    return { label: "no key (input missing)", absent: true };
  }
  if (key === null || key === "") {
    return {
      label: "empty key (unresolved upstream — see the row's other issues)",
      absent: false,
    };
  }
  const keyStr = String(key);
  return { label: `key \`${keyStr}\``, keyStr, absent: false };
}

/**
 * Resolve a lookup miss per the node's `onMiss` policy.
 *
 *   · absent policy → legacy `defaultValue` (raw-engine back-compat;
 *     the projector always stamps a policy on authored factor lookups)
 *   · "error"       → throws `RowIssueError` (code `unknown_key`)
 *   · "default"     → returns the authored value
 *   · "refer"       → returns 1.0 (indicative; the runtime escalates
 *     the row's eligibility to `submit` via the paired warning issue)
 *
 * The non-fatal modes get their visible `RowIssue` from the kind's
 * `collectRowIssues` (see `lookupMissSeed`), keeping `execute` pure
 * value-out.
 */
export function resolveLookupMiss(
  onMiss: OnMissPolicy | undefined,
  defaultValue: number,
  ctx: {
    readonly key?: unknown;
    readonly tableName?: string;
    /** Raw input field feeding this lookup's key path (projector-stamped). */
    readonly keySource?: string;
  },
): number {
  if (!onMiss) return defaultValue;
  const { label, keyStr, absent } = describeKey(ctx.key);
  const table = ctx.tableName ? ` in \`${ctx.tableName}\`` : "";
  if (onMiss.mode === "error") {
    throw new RowIssueError({
      severity: "error",
      code: absent ? "missing_input" : "unknown_key",
      // Book-intake §4 — an unknown KEY points home: the alias
      // vocabulary lives in Inputs → Match columns. (A missing input
      // is a different disease; it names the absent FIELD — FCA #17:
      // the old scaffold read 'no key (input missing) not found in
      // `X`', garbled English that never said which field to supply.)
      message: absent
        ? `Cannot rate: ${
            ctx.keySource ? `\`${ctx.keySource}\` was` : "an input was"
          } not supplied, so ${
            ctx.tableName ? `\`${ctx.tableName}\`` : "a lookup"
          } has no key.`
        : `Cannot rate: ${label} not found${table}. If your data uses ` +
          `different codes, translate them in Inputs → Match columns.`,
      detail: {
        ...(ctx.tableName !== undefined ? { table: ctx.tableName } : {}),
        ...(keyStr !== undefined ? { key: keyStr } : {}),
        ...(ctx.keySource !== undefined ? { field: ctx.keySource } : {}),
        policy: "error",
      },
    });
  }
  if (onMiss.mode === "default") {
    return typeof onMiss.value === "number" && Number.isFinite(onMiss.value)
      ? onMiss.value
      : defaultValue;
  }
  // "refer" — rate at the multiplicative identity, indicative only.
  return 1.0;
}

/**
 * Build the visible `RowIssueSeed` for a NON-FATAL miss (policy
 * "default"/"refer"). Kinds call this from `collectRowIssues` after
 * re-detecting the miss (pure + cheap). Returns undefined for the
 * fatal/legacy modes (error throws in execute; absent policy keeps
 * the legacy silent default at the raw-engine level).
 */
export function lookupMissSeed(
  onMiss: OnMissPolicy | undefined,
  defaultValue: number,
  ctx: {
    readonly key?: unknown;
    readonly tableName?: string;
    readonly keySource?: string;
  },
): RowIssueSeed | undefined {
  if (!onMiss || onMiss.mode === "error") return undefined;
  const { label, keyStr } = describeKey(ctx.key);
  const table = ctx.tableName ? ` in \`${ctx.tableName}\`` : "";
  const base = {
    ...(ctx.tableName !== undefined ? { table: ctx.tableName } : {}),
    ...(keyStr !== undefined ? { key: keyStr } : {}),
    ...(ctx.keySource !== undefined ? { field: ctx.keySource } : {}),
  };
  if (onMiss.mode === "default") {
    const applied =
      typeof onMiss.value === "number" && Number.isFinite(onMiss.value)
        ? onMiss.value
        : defaultValue;
    return {
      severity: "warning",
      code: "unknown_key_defaulted",
      message: `${capitalize(label)} not found${table}; authored default ${applied} applied.`,
      detail: { ...base, policy: "default", appliedValue: applied },
    };
  }
  return {
    severity: "warning",
    code: "unknown_key_referred",
    message: `${capitalize(label)} not found${table}; rated at 1.0 (indicative) and referred to underwriting.`,
    detail: { ...base, policy: "refer", appliedValue: 1.0 },
  };
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
