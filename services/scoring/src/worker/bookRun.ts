/**
 * bookRun — the Brief 75 book path inside the batch worker.
 *
 * When a JobSpec carries `book`, the stored input rows are RAW book
 * rows (CSV strings). This module owns everything after that fact:
 *
 *   1. PROJECT   — raw rows → externalInputs through the ONE labs-ui
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
  type RunOptions,
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
  /** FCA #15 — book-level plausibility signals ("one row is 99.8% of
   *  the written total"). Absent when there is nothing to say. */
  readonly warnings?: readonly string[];
  readonly policies?: readonly {
    readonly policy_id: string;
    readonly location_count: number;
    readonly premium: number | null;
    readonly tier: string;
    readonly row_errors?: number;
  }[];
}

/** Project raw book rows through the one labs-ui path. Dtypes come
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
    // Book-intake §4 — the dim binding the alias path resolves through
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

/** Compose policies through the SAME evaluatePolicyBook the quote path
 *  uses. Grouped books compose per policy (tail + G9 floor once per
 *  policy). UNGROUPED books compose per ROW — each row is its own
 *  single-location policy (`row_${i}`), exactly how scoreOne wraps a
 *  single quote — whenever the plan carries a tail/floor or policy
 *  gates. FCA fca-2026-07-25 (S0): before this, ungrouped books never
 *  composed at all, so the minimum-premium floor the quote path
 *  applied was silently skipped on every book row ($114 booked where
 *  the filed floor prints $250) and totals under-counted the floor
 *  delta. Returns null only when there is nothing to compose. */
export function composeBookPolicies(
  compiled: CompiledPlan,
  projected: readonly Record<string, unknown>[],
  rawRows: readonly Record<string, unknown>[],
  bundle: ResolvedPlanBundle,
  book: BookBag,
  run: RunOptions | undefined,
  resolveAdjustment?: AdjustmentResolver,
): readonly PolicyBookResult[] | null {
  const grouping = book.grouping ?? {};
  const base = policyBookConfigFromPlan(
    (bundle.stages ?? []) as unknown as Parameters<
      typeof policyBookConfigFromPlan
    >[0],
    (book.rollup_fields ?? []).map((f) => ({
      fieldName: f.fieldName,
      reducer: f.reducer as never,
    })),
  );
  const composedTail = composedTailFor(bundle);
  if (
    !grouping.policy_id_column &&
    composedTail.length === 0 &&
    (base.policyGates?.length ?? 0) === 0
  ) {
    // Ungrouped AND nothing to compose — per-row facets are the whole
    // story; the chain totals ARE the filed premiums.
    return null;
  }
  // keyedRowsFromBook keys ungrouped rows as `row_${i}`/`L${i+1}` —
  // one single-location policy per row, in row order.
  const keyed = keyedRowsFromBook(projected, rawRows, {
    ...(grouping.policy_id_column
      ? { policy_id_column: grouping.policy_id_column }
      : {}),
    ...(grouping.location_id_column
      ? { location_id_column: grouping.location_id_column }
      : {}),
  });
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
  // FULL run options thread through (FCA review 2026-07-26: passing
  // as_of alone dropped classLibrary, so the composition re-run could
  // diverge from the chunked rating on class-exposure plans).
  return evaluatePolicyBook(compiled, keyed, config, {
    ...(run ?? {}),
    ...(resolveAdjustment ? { resolveAdjustment } : {}),
  });
}

/** The plan's composed tail (frozen policy tail + the G9 floor) — the
 *  thing the book path must apply per policy (grouped) or per row
 *  (ungrouped). Shared with the worker so it can tell "composed
 *  legitimately absent (no tail)" from "composition FAILED". */
export function composedTailFor(
  bundle: ResolvedPlanBundle,
): ReturnType<typeof appendPlanFloor> {
  return appendPlanFloor(
    bundle.policyTail ?? [],
    bundle.stages
      ? planMinimumPremium(
          bundle.stages as unknown as Parameters<typeof planMinimumPremium>[0],
        )
      : null,
  );
}

/** The facet totals + compact ledger the run record persists.
 *  `premiumOf` receives the row index too — the ungrouped-composed
 *  path (FCA S0 book/quote parity) resolves each row's premium from
 *  its own single-row policy's composed.final. */
export function summarizeBook(
  results: readonly RunResult[],
  rawRows: readonly Record<string, unknown>[],
  premiumOf: (r: RunResult, index: number) => number | null,
  book: BookBag,
  policies: readonly PolicyBookResult[] | null,
  planPremium: PlanPremiumContext,
): BookSummary {
  const grouping = book.grouping ?? {};
  const grouped = !!grouping.policy_id_column;
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
      premium: r.row_status === "error" ? null : premiumOf(r, i),
      // MVP-011 — a tier is a verdict; unrateable rows get none.
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

  // GROUPED books account per policy. Ungrouped-composed books (each
  // row its own policy) account per ROW — the rows already carry
  // their composed premiums via premiumOf, so the per-row branch is
  // the correct (and parity-preserving) accounting.
  if (policies && grouped) {
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

  // FCA fca-2026-07-25 #15 — the totals-concentration signal. A
  // thousands-column slip priced ONE row at 99.8% of the whole book's
  // written total and every surface presented the sum as
  // unremarkable. When a single contributor dominates (≥80% of a
  // multi-contributor written total), the summary says so and points
  // at the row — the number still stands; the silence doesn't.
  const warnings: string[] = [];
  const contributions: { label: string; value: number }[] = [];
  if (policies && grouped) {
    for (const p of policies) {
      if ((p.row_errors ?? 0) > 0 || p.appetite.tier === "decline") continue;
      const v = policyPremiumOf(p);
      if (v !== null) contributions.push({ label: `policy ${p.policy_id}`, value: v });
    }
  } else {
    rows.forEach((r, i) => {
      if (r.row_status === "error" || r.tier === "decline") return;
      if (r.premium !== null) {
        contributions.push({
          label: r.policy_id ? `row ${i + 1} (${r.policy_id})` : `row ${i + 1}`,
          value: r.premium,
        });
      }
    });
  }
  if (written > 0 && contributions.length >= 2) {
    const top = contributions.reduce((a, b) => (b.value > a.value ? b : a));
    const share = top.value / written;
    if (share >= 0.8) {
      warnings.push(
        `One ${grouped ? "policy" : "row"} dominates the book: ` +
          `${top.label} contributes ${(share * 100).toFixed(1)}% of the ` +
          `written total ($${top.value.toLocaleString("en-US")} of ` +
          `$${written.toLocaleString("en-US")}). Check its ` +
          `exposure/units before relying on the total.`,
      );
    }
  }

  return {
    row_count: results.length,
    grouped,
    premium_field: premiumField,
    totals: {
      written,
      declined_indicative: indicative,
      error_rows: errorRows,
      declined,
      ...(policies && grouped ? { error_policies: errorPolicies } : {}),
    },
    rows,
    ...(warnings.length > 0 ? { warnings } : {}),
    // Ungrouped-composed policies are 1:1 with rows — the ledger IS
    // the policy list, so no separate array.
    ...(policies && grouped
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
