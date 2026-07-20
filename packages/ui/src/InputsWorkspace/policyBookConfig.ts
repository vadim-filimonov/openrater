/**
 * policyBookConfig — derive a `PolicyBookConfig` + keyed rows from the
 * authored plan + input mapping (E08 + E03 PR D; ADR-016's "config from plan"
 * adapter).
 *
 * P2 G4 (ADR-0056) — lifted from app integrations into @openrater/ui so the
 * scoring service composes the FILED premium through the SAME extraction the
 * browser uses (Law 1: one premium, one code path). The rate-lab module
 * re-exports from here. Stage inputs are the structural `StageLike` — both
 * api-client's StageSummary and snapshot-body stage dicts satisfy it.
 *
 * This is the bridge between what the actuary AUTHORS in the UI and the pure
 * `evaluatePolicyBook` orchestrator (PR A):
 *
 *   · computedFields ← `input_node` stages carrying a `derived_expr` (D3).
 *   · rollupFields   ← the input mapping's `rollup_fields` (D2).
 *   · policyGates    ← `eligibility.gate` stages with `scope: "policy"` (D4).
 *   · keyed rows     ← the projected book rows + the `grouping_config`
 *                      `policy_id` / `location_id` columns (D1).
 *
 * Pure + deterministic; no I/O. The route runs `evaluatePolicyBook(compiled,
 * keyedRows, config)` when grouping is on + renders the grouped result.
 */

import {
  validateComputedExpr,
  type ComputedExpr,
  type ComputedField,
  type KeyedRiskRow,
  type PolicyAdjustment,
  type PolicyBookConfig,
  type PolicyGateSpec,
  type ProjectionIssue,
  type RollupReducer,
} from "@openrater/contracts";
import { TOTAL_TOWER_OUTPUT_FIELD } from "../CalculationTower/plan-mutations";
import {
  isCoverageSumBook,
  type PlanPremiumContext,
} from "../AnalyticsWorkspace/premium-resolution";
import type { StageLike } from "./deriveRequiredInputs";

/** A roll-up field as authored in the Inputs editor (D2). */
export interface AuthoredRollupField {
  readonly fieldName: string;
  readonly reducer: RollupReducer;
}

/** The grouping columns from the mapping's `grouping_config` (D1). */
export interface AuthoredGrouping {
  readonly policy_id_column?: string;
  readonly location_id_column?: string;
}

function readObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Build the `PolicyBookConfig` from the plan's stages + the authored roll-up
 * fields. Reads derived-input expressions, policy-scope gates, and maps the
 * roll-up declarations onto the orchestrator's shape.
 */
export function policyBookConfigFromPlan(
  stages: readonly StageLike[],
  rollupFields: readonly AuthoredRollupField[],
): PolicyBookConfig {
  const computedFields: ComputedField[] = [];
  const policyGates: PolicyGateSpec[] = [];

  for (const s of stages) {
    const cfg = readObject(s.config_json);
    if (s.stage_kind === "input_node") {
      const expr = cfg.derived_expr;
      const name =
        (typeof cfg.source_path === "string" && cfg.source_path) ||
        (typeof cfg.name === "string" && cfg.name) ||
        s.stage_id;
      if (expr && validateComputedExpr(expr) === null) {
        computedFields.push({ name, expr: expr as ComputedExpr });
      }
    } else if (s.stage_kind === "eligibility.gate" && cfg.scope === "policy") {
      policyGates.push({
        rules: (cfg.rules as PolicyGateSpec["rules"]) ?? [],
        default_tier:
          (cfg.default_tier as PolicyGateSpec["default_tier"]) ?? "standard",
        default_reasoning:
          (cfg.default_reasoning as string) ?? "Policy in appetite.",
      });
    }
  }

  return {
    ...(computedFields.length > 0 ? { computedFields } : {}),
    // The rolled key is the RAW declared field name — we deliberately do NOT
    // set `RollupField.as`, so `rollUpBook` keys each policy total by
    // `fieldName` (e.g. `tiv`, never `policy_tiv`). The policy field-picker
    // offers the SAME raw names (`policyAggregateFields`), so a UI-authored
    // policy gate matches the rolled key. The `as` `policy_`-prefix rename is
    // an optional primitive capability the wired path does not use. See
    // ADR-0046.
    rollupFields: rollupFields.map((f) => ({
      field: f.fieldName,
      reducer: f.reducer,
    })),
    ...(policyGates.length > 0 ? { policyGates } : {}),
  };
}

/**
 * The one synthetic policy aggregate the roll-up always provides (the number of
 * locations in the policy). NOT an authored roll-up field — `rollUpBook` keeps
 * it as a sibling of `rolled`, and `evaluatePolicyBook` injects it into the
 * policy-gate evaluation map so a gate may read it.
 */
export const POLICY_LOCATION_COUNT = "location_count";

/**
 * P2 G9 (ADR-0056) — the plan's authored minimum-premium floor: the
 * `round` stage's `min_value_input` literal, or null when no positive
 * floor is authored. Mirrors the projector's literal parser
 * (`"literal:500"` / `"500"` / `500`; `literal:0` = the persisted
 * "no floor").
 *
 * When a book is scored GROUPED, the projector omits the per-row floor
 * (`minPremiumScope: "policy"`) and the caller appends this value as a
 * `minimum_premium` tail step — applied ONCE per policy, POST-IRPM.
 * That is the G9 fix: floored per location, a 3-location policy paid
 * 3× the filed minimum.
 */
export function planMinimumPremium(
  stages: readonly StageLike[],
): number | null {
  for (const s of stages) {
    if (s.stage_kind !== "round") continue;
    const cfg = readObject(s.config_json);
    const v = cfg.min_value_input;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const m = v.trim().match(/^(?:literal:)?(-?\d+(?:\.\d+)?)$/);
      if (m) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

/**
 * Brief 80 (finding E7) — THE resolver for "which scored field is the
 * plan total": the authored `round` stage's non-blank `output_field`,
 * else the `total_premium` convention (`TOTAL_TOWER_OUTPUT_FIELD`).
 *
 * Every composition consumer keys on this ONE answer — the derived
 * premium roll-up (D-C), the run ledger's total column, and the
 * composition-issue checks below. Before this resolver the knowledge
 * lived as duplicated string literals in three modules, which is how
 * a drawer-authored `final_premium_usd` broke composition silently.
 */
export function planTotalOutputField(stages: readonly StageLike[]): string {
  for (const s of stages) {
    if (s.stage_kind !== "round") continue;
    const cfg = readObject(s.config_json);
    const of =
      typeof cfg.output_field === "string" ? cfg.output_field.trim() : "";
    if (of !== "") return of;
  }
  return TOTAL_TOWER_OUTPUT_FIELD;
}

/**
 * Brief 80 D-E — the three named authoring issues that make a broken
 * policy-composition chain say WHY composed premiums would come back
 * null, before anything runs. All warning severity: the plan still
 * rates per-row; composition is what degrades.
 *
 *   · `round_output_nonstandard`  — a round stage publishes a total
 *     under a bespoke field; the ledger, the roll-up, and the quote
 *     composition read `total_premium`.
 *   · `grouping_missing_rollup`   — grouping is on but no roll-up
 *     covers the plan total, so every policy's premium rolls to null.
 *   · `grouping_column_missing`   — the grouping names a column the
 *     loaded book doesn't carry (every row falls back to its own
 *     single-location policy).
 *
 * Pure. `bookColumns` is optional — without a loaded book the column
 * check is skipped (nothing to compare against), the other two still
 * run. `planPremium` is optional — without it the total-less exemption
 * below cannot be evaluated and the roll-up check runs as before.
 */
export function collectCompositionIssues(
  stages: readonly StageLike[],
  mapping: {
    readonly grouping_config?: AuthoredGrouping;
    readonly rollup_fields?: readonly AuthoredRollupField[];
  } | null,
  bookColumns?: readonly string[],
  planPremium?: PlanPremiumContext | null,
): ProjectionIssue[] {
  const issues: ProjectionIssue[] = [];

  // 1. Non-standard round output — flagged regardless of grouping
  //    (the run ledger reads the convention even per-row).
  for (const s of stages) {
    if (s.stage_kind !== "round") continue;
    const cfg = readObject(s.config_json);
    const of =
      typeof cfg.output_field === "string" ? cfg.output_field.trim() : "";
    if (of !== "" && of !== TOTAL_TOWER_OUTPUT_FIELD) {
      issues.push({
        severity: "warning",
        code: "round_output_nonstandard",
        message: `Stage \`${s.stage_id}\` publishes the plan total as \`${of}\` — the policy ledger, the roll-up, and the quote API read \`${TOTAL_TOWER_OUTPUT_FIELD}\`. Composed premiums will come back empty until it is normalized.`,
        stageId: s.stage_id,
        ref: { field: of, stageKind: "round" },
      });
    }
  }

  const grouping = mapping?.grouping_config;
  const groupingOn =
    typeof grouping?.policy_id_column === "string" &&
    grouping.policy_id_column !== "";
  if (!groupingOn) return issues;

  // 2. Grouping without a premium roll-up — policies roll to nothing.
  //    EXCEPT the total-less transcription (93.4): the plan declares NO
  //    total, the composers roll every coverage and sum the dec page,
  //    and declaring a premium-named field would SUPPRESS that sum. The
  //    warning would name the bug as the cure — and read as a lie next
  //    to a policy list showing real summed premiums.
  const rollups = mapping?.rollup_fields ?? [];
  const coverageSum =
    planPremium != null &&
    isCoverageSumBook(
      rollups.map((f) => f.fieldName),
      planPremium,
    );
  const totalField = planTotalOutputField(stages);
  if (!coverageSum && !rollups.some((f) => f.fieldName === totalField)) {
    issues.push({
      severity: "warning",
      code: "grouping_missing_rollup",
      message: `Rows group into policies but no roll-up covers the plan total \`${totalField}\` — every policy's premium rolls to null. Add \`${totalField}\` (sum) to the rolled fields.`,
      ref: { field: totalField },
    });
  }

  // 3. Grouping columns the loaded book doesn't carry.
  if (bookColumns) {
    const cols = new Set(bookColumns);
    for (const [label, col] of [
      ["policy", grouping.policy_id_column],
      ["location", grouping.location_id_column],
    ] as const) {
      if (typeof col === "string" && col !== "" && !cols.has(col)) {
        issues.push({
          severity: "warning",
          code: "grouping_column_missing",
          message: `The ${label} grouping column \`${col}\` is not in the loaded book — each row rates as its own single-location policy until the column is re-picked.`,
          ref: { field: col },
        });
      }
    }
  }

  return issues;
}

/** The synthetic tail step id `appendPlanFloor` writes (audit-stable). */
export const PLAN_MIN_PREMIUM_STEP_ID = "plan_min_premium";

/**
 * Append the plan's authored floor as the LAST tail step (post-IRPM,
 * post-endorsements — floors are order-terminal by definition). A
 * no-floor plan returns the tail unchanged; an authored tail that
 * already ends in its own minimum still composes correctly (max is
 * idempotent under composition: floor∘floor = floor at the larger).
 */
export function appendPlanFloor(
  tail: readonly PolicyAdjustment[],
  minimumPremium: number | null,
): readonly PolicyAdjustment[] {
  if (minimumPremium === null) return tail;
  return [
    ...tail,
    {
      kind: "minimum_premium",
      id: PLAN_MIN_PREMIUM_STEP_ID,
      floor: minimumPremium,
    },
  ];
}

/**
 * The aggregate field ids a POLICY-scope gate's field-picker may offer, given
 * the plan's authored roll-up field names (`rollup_fields[].fieldName`).
 *
 * The SINGLE source of truth shared by the field-picker (the route's
 * `policyFields`) and the rolled-key set a policy gate reads — so a picked
 * field can never silently no-match (ADR-0046). It is exactly:
 *   · each declared roll-up field name VERBATIM — `policyBookConfigFromPlan`
 *     keeps the raw `fieldName` (no `RollupField.as`), so the rolled key ===
 *     the declared field name (e.g. `tiv`, not `policy_tiv`);
 *   · plus `location_count`, the synthetic aggregate (deduped if a field is
 *     already named `location_count`).
 * Order: declared fields first (first-seen), then `location_count`.
 */
export function policyAggregateFields(
  rollupFieldNames: readonly string[],
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of rollupFieldNames) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  if (!seen.has(POLICY_LOCATION_COUNT)) out.push(POLICY_LOCATION_COUNT);
  return out;
}

/**
 * Pair each projected `externalInputs` row with its `policy_id` /
 * `location_id` from the matching RAW book row, producing the orchestrator's
 * `KeyedRiskRow[]`. A row missing a policy id falls back to its own index so
 * it forms a single-location policy (never silently merged).
 */
export function keyedRowsFromBook(
  projected: readonly Readonly<Record<string, unknown>>[],
  rawRows: readonly Readonly<Record<string, unknown>>[],
  grouping: AuthoredGrouping,
): KeyedRiskRow[] {
  const policyCol = grouping.policy_id_column;
  const locationCol = grouping.location_id_column;
  return projected.map((inputs, i) => {
    const raw = rawRows[i] ?? {};
    const policy_id =
      policyCol && raw[policyCol] != null && String(raw[policyCol]) !== ""
        ? String(raw[policyCol])
        : `row_${i}`;
    const location_id =
      locationCol && raw[locationCol] != null && String(raw[locationCol]) !== ""
        ? String(raw[locationCol])
        : `L${i + 1}`;
    return { policy_id, location_id, inputs: { ...inputs } };
  });
}
