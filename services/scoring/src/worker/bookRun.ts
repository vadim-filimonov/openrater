/**
 * bookRun — the Brief 75 book path inside the batch worker.
 *
 * When a JobSpec carries `book`, the stored input rows are RAW book
 * rows (CSV strings). This module owns everything after that fact:
 *
 *   1. PROJECT   — raw rows → externalInputs through the shared UI
 *      path (`projectRowsToExternalInputs`), with dtypes derived from
 *      the plan's own input declarations (`deriveRequiredInputs`) —
 *      never a second projection implementation (Law 1).
 *   2. COMPOSE   — when the book declares grouping, the SAME policy
 *      pipeline the browser runs: config extracted from the stages
 *      (gates), the frozen tail + the G9 floor appended
 *      (`appendPlanFloor(planMinimumPremium)`), `evaluatePolicyBook`.
 *   3. SUMMARIZE — the run record's payload: facet totals
 *      (written / declined-indicative / error rows — ADR-0056:
 *      error ≠ decline ≠ $0), a compact per-row ledger, and the
 *      composed policies.
 *
 * Pure over its arguments — the worker owns I/O.
 */

import {
  evaluatePolicyBook,
  type AdjustmentResolver,
  type CompiledPlan,
  type PolicyBookResult,
  type RunResult,
} from "@openrater/contracts";
import {
  appendPlanFloor,
  keyedRowsFromBook,
  planMinimumPremium,
  policyBookConfigFromPlan,
} from "@openrater/ui/InputsWorkspace/policyBookConfig";
import { projectRowsToExternalInputs } from "@openrater/ui/InputsWorkspace/projectRowsForBatch";
import { deriveRequiredInputs } from "@openrater/ui/InputsWorkspace/deriveRequiredInputs";

import {
  extraPolicyRollupFields,
  isCoverageSumBook,
  premiumBasisField,
  resolvePlanPremiumContext,
  rolledPolicyPremium,
  totalLessTailRefusalMessage,
  type PlanPremiumContext,
} from "../core/derive";
import type { ResolvedPlanBundle } from "../core/planSource";
import type { BookBag } from "../core/schema";

export interface BookLedgerRow {
  readonly policy_id?: string;
  readonly location_id?: string;
  readonly premium: number | null;
  readonly tier: string | null;
  readonly row_status: "ok" | "error";
  readonly first_issue?: string;
}

export interface BookSummary {
  readonly row_count: number;
  readonly grouped: boolean;
  /** The output field the ledger's premiums read (Brief 75 phase 4 —
   *  run-fed Analytics binds its premium column to THIS, never a
   *  client-side name heuristic). */
  readonly premium_field: string;
  readonly totals: {
    readonly written: number;
    readonly declined_indicative: number;
    readonly error_rows: number;
    readonly error_policies?: number;
    readonly declined?: number;
  };
  readonly rows: readonly BookLedgerRow[];
  readonly policies?: readonly {
    readonly policy_id: string;
    readonly location_count: number;
    readonly premium: number | null;
    readonly tier: string;
    readonly row_errors?: number;
  }[];
}

/** Project raw book rows through the shared UI path. Dtypes come
 *  from the plan's OWN input declarations. */
export function projectBookRows(
  rawRows: readonly Record<string, unknown>[],
  bundle: ResolvedPlanBundle,
  book: BookBag,
): readonly Record<string, unknown>[] {
  const declared = bundle.stages
    ? deriveRequiredInputs(
        bundle.stages as unknown as Parameters<typeof deriveRequiredInputs>[0],
        (bundle.dimensions ?? []) as unknown as Parameters<
          typeof deriveRequiredInputs
        >[1],
      )
    : [];
  const inputDtypes: Record<string, string> = {};
  const inputDimMap: Record<string, string> = {};
  for (const d of declared) {
    if (d.id && d.dtype) inputDtypes[d.id] = d.dtype;
    // book intake — the dim binding the alias path resolves through
    // (the SAME derivation the app's preview projection uses).
    if (d.id && d.dimSlug) inputDimMap[d.id] = d.dimSlug;
  }
  return projectRowsToExternalInputs(
    rawRows as readonly Readonly<Record<string, string>>[],
    book.column_map,
    {
      inputDtypes: inputDtypes as never,
      inputDimMap,
      ...(book.alias_overrides ? { aliasOverrides: book.alias_overrides } : {}),
    },
  );
}

/** The roll-up field names the mapping itself declares — the book-shaped
 *  input every function in the shared premium-basis cluster takes. */
function declaredRollupNames(book: BookBag): readonly string[] {
  return (book.rollup_fields ?? []).map((f) => f.fieldName);
}

/** The premium field the composition rolls up + the summary advertises
 *  (`premium_field` — run-fed Analytics binds its premium column to
 *  THIS). Thin `BookBag` adapter over the shared `premiumBasisField`;
 *  the browser resolves the same answer from the same function. */
export function premiumRollupFieldOf(
  book: BookBag,
  planPremium?: PlanPremiumContext,
): string {
  return premiumBasisField(declaredRollupNames(book), planPremium);
}

/** Total-less multi-coverage AND no declared premium roll-up — the
 *  policy premium is the dec-page sum over the coverage money outputs
 *  (a declared roll-up is an explicit authored basis that wins). */
function isTotalLessBook(
  book: BookBag,
  planPremium: PlanPremiumContext,
): boolean {
  return isCoverageSumBook(declaredRollupNames(book), planPremium);
}

/** Compose policies when the book declares grouping. Returns null for
 *  ungrouped books (per-row facets are the whole story there). */
export function composeBookPolicies(
  compiled: CompiledPlan,
  projected: readonly Record<string, unknown>[],
  rawRows: readonly Record<string, unknown>[],
  bundle: ResolvedPlanBundle,
  book: BookBag,
  asOf: string | undefined,
  resolveAdjustment?: AdjustmentResolver,
): readonly PolicyBookResult[] | null {
  const grouping = book.grouping ?? {};
  if (!grouping.policy_id_column) return null;
  const keyed = keyedRowsFromBook(projected, rawRows, {
    policy_id_column: grouping.policy_id_column,
    ...(grouping.location_id_column
      ? { location_id_column: grouping.location_id_column }
      : {}),
  });
  const base = policyBookConfigFromPlan(
    (bundle.stages ?? []) as unknown as Parameters<
      typeof policyBookConfigFromPlan
    >[0],
    (book.rollup_fields ?? []).map((f) => ({
      fieldName: f.fieldName,
      reducer: f.reducer as never,
    })),
  );
  const composedTail = appendPlanFloor(
    bundle.policyTail ?? [],
    bundle.stages
      ? planMinimumPremium(
          bundle.stages as unknown as Parameters<
            typeof planMinimumPremium
          >[0],
        )
      : null,
  );
  const planPremium = resolvePlanPremiumContext(bundle.plan, bundle.stages);
  const totalLess = isTotalLessBook(book, planPremium);
  // Law 2 — a tail/floor composes over ONE rolled-up premium field. A
  // total-less multi-coverage plan declares none; the job fails with
  // the NAMED reason (mirrors scoreOne + scorePolicy) — never a tail
  // silently taxing the last tower across the whole book.
  if (totalLess && composedTail.length > 0) {
    throw new Error(
      `The filed premium could not be composed: ` +
        `${totalLessTailRefusalMessage(planPremium.moneyFields.length)}`,
    );
  }
  const premiumField = premiumRollupFieldOf(book, planPremium);
  // Roll-up fields: the mapping's declarations, PLUS whatever Law 1
  // needs on top (total-less ⇒ every coverage money output; declared
  // nothing ⇒ the basis field). The SHARED synthesis — /score-policy
  // and the browser's local composition call the same function.
  const fields = [
    ...base.rollupFields,
    ...extraPolicyRollupFields(
      declaredRollupNames(book),
      planPremium,
      premiumField,
    ).map((field) => ({ field, reducer: "sum" as const })),
  ];
  const config = {
    ...base,
    rollupFields: fields,
    ...(composedTail.length > 0
      ? {
          policyTail: composedTail,
          premiumRollupField: premiumField,
          ...(book.policyInputKeys
            ? { policyInputKeys: book.policyInputKeys }
            : {}),
        }
      : {}),
  };
  return evaluatePolicyBook(compiled, keyed, config, {
    ...(asOf ? { as_of: asOf } : {}),
    ...(resolveAdjustment ? { resolveAdjustment } : {}),
  });
}

/** The facet totals + compact ledger the run record persists. */
export function summarizeBook(
  results: readonly RunResult[],
  rawRows: readonly Record<string, unknown>[],
  premiumOf: (r: RunResult) => number | null,
  book: BookBag,
  policies: readonly PolicyBookResult[] | null,
  planPremium: PlanPremiumContext,
): BookSummary {
  const grouping = book.grouping ?? {};
  const premiumField = premiumRollupFieldOf(book, planPremium);
  // One policy-premium read (ADR-0056 precedence intact): an error
  // policy carries NO premium; else the composed final; else the
  // SHARED rolled read — the dec-page sum over every rolled coverage
  // for a total-less plan, the single rolled basis otherwise.
  const policyPremiumOf = (p: PolicyBookResult): number | null => {
    if ((p.row_errors ?? 0) > 0) return null;
    if (p.composed) return p.composed.final;
    return rolledPolicyPremium(
      p.rollup.rolled,
      planPremium,
      declaredRollupNames(book),
    );
  };
  const rows: BookLedgerRow[] = results.map((r, i) => {
    const raw = rawRows[i] ?? {};
    const firstIssue = (r.issues ?? []).find((x) => x.severity === "error");
    return {
      ...(grouping.policy_id_column
        ? { policy_id: String(raw[grouping.policy_id_column] ?? `row_${i}`) }
        : {}),
      ...(grouping.location_id_column
        ? { location_id: String(raw[grouping.location_id_column] ?? `L${i + 1}`) }
        : {}),
      premium: r.row_status === "error" ? null : premiumOf(r),
      //  — a tier is a verdict; unrateable rows get none.
      tier: r.row_status === "error" ? null : (r.eligibility_tier ?? null),
      row_status: r.row_status,
      ...(firstIssue ? { first_issue: firstIssue.message } : {}),
    };
  });

  let written = 0;
  let indicative = 0;
  let declined = 0;
  let errorRows = 0;
  let errorPolicies = 0;

  if (policies) {
    // ADR-0056 policy accounting — mirrors the browser's policyTotals:
    // an error policy contributes to NO total; declined premiums are
    // indicative-only.
    for (const p of policies) {
      if ((p.row_errors ?? 0) > 0) {
        errorPolicies += 1;
        continue;
      }
      const v = policyPremiumOf(p);
      if (p.appetite.tier === "decline") {
        declined += 1;
        if (v !== null) indicative += v;
      } else if (v !== null) {
        written += v;
      }
    }
    errorRows = rows.filter((r) => r.row_status === "error").length;
  } else {
    for (const r of rows) {
      if (r.row_status === "error") {
        errorRows += 1;
        continue;
      }
      if (r.tier === "decline") {
        declined += 1;
        if (r.premium !== null) indicative += r.premium;
      } else if (r.premium !== null) {
        written += r.premium;
      }
    }
  }

  return {
    row_count: results.length,
    grouped: !!grouping.policy_id_column,
    premium_field: premiumField,
    totals: {
      written,
      declined_indicative: indicative,
      error_rows: errorRows,
      declined,
      ...(policies ? { error_policies: errorPolicies } : {}),
    },
    rows,
    ...(policies
      ? {
          policies: policies.map((p) => ({
            policy_id: p.policy_id,
            location_count: p.rollup.location_count,
            premium: policyPremiumOf(p),
            tier: p.appetite.tier,
            ...((p.row_errors ?? 0) > 0 ? { row_errors: p.row_errors } : {}),
          })),
        }
      : {}),
  };
}
