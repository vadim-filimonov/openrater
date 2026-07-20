/**
 * Plan validation — authoring-time error surfacing.
 *
 * Pure-logic validation pass that walks a PlanEntitiesSnapshot and
 * returns a structured list of issues. The UI layer
 * (PlanSurfaceIssueBanner, queued for V.22.A5 commit #2) consumes
 * this report and surfaces a "Fix in <Section>" affordance per
 * issue.
 *
 * Phase 1 scope (this module): **broken entity references only.**
 * The validation pass detects:
 *   · chain factor → unknown dimension id
 *   · chain factor → unknown factor-table id
 *   · chain factor → unknown coverage-chain id (subchain)
 *   · chain factor → unknown input-source field name
 *   · factor-table key binding → unknown dimension or input field
 *
 * Brief 34 PR 34.7 removed the curve concept (Brief 19); validation
 * for curve refs + curve input bindings is gone.
 *
 * Deferred to a Phase 2 pass (separate ticket):
 *   · Type-mismatch validation (money → factor port, etc.)
 *   · Domain validation (negative TIV, etc.)
 *   · Compile-warning surfacing (cycles, unwired inputs)
 *   · Predicate-level validation in Eligibility
 *   · Stale-reference warnings (renamed entities)
 *
 * Pure + synchronous + no React + no I/O. Safe to call on every
 * section save without performance concern. Plan size up to
 * ~thousands of factors stays sub-millisecond.
 */

/* ============================================================
 * Issue shape (consumed by the UI banner)
 * ============================================================ */

export interface PlanIssue {
  severity: "error" | "warning";
  /** PlanSurface section id (matches the 14-section spine). */
  sectionId: string;
  /** Display label for the section (used in the "Fix in <Section>" link). */
  sectionLabel: string;
  /** Programmatic field path so the UI can later highlight the exact field. */
  field: string;
  /** Actuary-language one-sentence message. No engineer jargon. */
  message: string;
  /** Present when the issue is a broken reference (most common case). */
  brokenRef?: {
    kind: "dimension" | "factor_table" | "coverage_chain" | "input_source";
    id: string;
  };
}

export interface PlanValidationReport {
  issues: readonly PlanIssue[];
  countsBySeverity: { readonly error: number; readonly warning: number };
}

/* ============================================================
 * Entity snapshot shapes
 *
 * Minimal types capturing only the fields validation reads.
 * Kept local to this module so the validator stays decoupled
 * from any storage / hook layer. The PlanSurface integration
 * (commit #2) maps live state to these snapshots.
 * ============================================================ */

export interface ChainSnapshot {
  readonly coverage_chain_id: string;
  readonly display_name: string;
  readonly factors: readonly {
    readonly name: string;
    /** Factor kind: "constant" | "input" | "dimension" | "factor_table" | "coverage_chain". */
    readonly type: string;
    /** Reference into the relevant entity registry (id / field name). */
    readonly ref: string | null;
  }[];
}

export interface FactorTableSnapshot {
  readonly factor_table_id: string;
  readonly display_name: string;
  readonly key_columns: readonly {
    readonly name: string;
    readonly binding_source: "input" | "dimension";
    readonly binding_name: string;
  }[];
}

export interface DimensionSnapshot {
  readonly dimension_id: string;
  readonly display_name: string;
}

export interface SourceSnapshot {
  readonly input_source_id: string;
  readonly field_name: string;
}

export interface PlanEntitiesSnapshot {
  readonly chains: readonly ChainSnapshot[];
  readonly factorTables: readonly FactorTableSnapshot[];
  readonly dimensions: readonly DimensionSnapshot[];
  readonly sources: readonly SourceSnapshot[];
}

/* ============================================================
 * The validation pass
 * ============================================================ */

export function validatePlanReferences(
  plan: PlanEntitiesSnapshot,
): PlanValidationReport {
  const issues: PlanIssue[] = [];

  // Build O(1) lookup sets once. Snapshots are read-only so we
  // don't worry about mutation while iterating.
  const dimensionIds = new Set(plan.dimensions.map((d) => d.dimension_id));
  const factorTableIds = new Set(plan.factorTables.map((t) => t.factor_table_id));
  const chainIds = new Set(plan.chains.map((c) => c.coverage_chain_id));
  const sourceFieldNames = new Set(plan.sources.map((s) => s.field_name));

  /* -- Chain factor refs ----------------------------------- */

  for (const chain of plan.chains) {
    for (let i = 0; i < chain.factors.length; i++) {
      const factor = chain.factors[i]!;
      // Constant factors carry their value inline — nothing to resolve.
      // input/dimension/factor_table/coverage_chain reference
      // entities by id and must resolve.
      if (factor.ref === null || factor.ref === "") continue;

      switch (factor.type) {
        case "dimension":
          if (!dimensionIds.has(factor.ref)) {
            issues.push({
              severity: "error",
              sectionId: "rating-chains",
              sectionLabel: "Rating Chains",
              field: `chains[${chain.coverage_chain_id}].factors[${i}].ref`,
              message: `Chain "${chain.display_name}" factor "${factor.name}" references dimension \`${factor.ref}\` — that dimension isn't registered. Add it in Dimensions, or pick an existing dimension.`,
              brokenRef: { kind: "dimension", id: factor.ref },
            });
          }
          break;
        case "factor_table":
          if (!factorTableIds.has(factor.ref)) {
            issues.push({
              severity: "error",
              sectionId: "rating-chains",
              sectionLabel: "Rating Chains",
              field: `chains[${chain.coverage_chain_id}].factors[${i}].ref`,
              message: `Chain "${chain.display_name}" factor "${factor.name}" references factor table \`${factor.ref}\` — that table doesn't exist. Author it in Factor Tables, or pick an existing one.`,
              brokenRef: { kind: "factor_table", id: factor.ref },
            });
          }
          break;
        case "coverage_chain":
          if (!chainIds.has(factor.ref)) {
            issues.push({
              severity: "error",
              sectionId: "rating-chains",
              sectionLabel: "Rating Chains",
              field: `chains[${chain.coverage_chain_id}].factors[${i}].ref`,
              message: `Chain "${chain.display_name}" factor "${factor.name}" references subchain \`${factor.ref}\` — that chain doesn't exist.`,
              brokenRef: { kind: "coverage_chain", id: factor.ref },
            });
          }
          break;
        case "input":
          if (!sourceFieldNames.has(factor.ref)) {
            issues.push({
              severity: "error",
              sectionId: "rating-chains",
              sectionLabel: "Rating Chains",
              field: `chains[${chain.coverage_chain_id}].factors[${i}].ref`,
              message: `Chain "${chain.display_name}" factor "${factor.name}" reads input field \`${factor.ref}\` — that field isn't declared. Add it in Risk Inputs.`,
              brokenRef: { kind: "input_source", id: factor.ref },
            });
          }
          break;
        // `constant` and any other kind without a ref are not validated
        // here. The block-kind validate() hook covers their internal
        // params.
      }
    }
  }

  /* -- Factor table key bindings --------------------------- */

  for (const table of plan.factorTables) {
    for (const col of table.key_columns) {
      if (col.binding_name === "") continue;
      if (col.binding_source === "dimension") {
        if (!dimensionIds.has(col.binding_name)) {
          issues.push({
            severity: "error",
            sectionId: "factor-tables",
            sectionLabel: "Factor Tables",
            field: `tables[${table.factor_table_id}].keys[${col.name}].binding_name`,
            message: `Factor table "${table.display_name}" key "${col.name}" binds to dimension \`${col.binding_name}\` — that dimension isn't registered.`,
            brokenRef: { kind: "dimension", id: col.binding_name },
          });
        }
      } else if (col.binding_source === "input") {
        if (!sourceFieldNames.has(col.binding_name)) {
          issues.push({
            severity: "error",
            sectionId: "factor-tables",
            sectionLabel: "Factor Tables",
            field: `tables[${table.factor_table_id}].keys[${col.name}].binding_name`,
            message: `Factor table "${table.display_name}" key "${col.name}" binds to input field \`${col.binding_name}\` — that field isn't declared.`,
            brokenRef: { kind: "input_source", id: col.binding_name },
          });
        }
      }
    }
  }

  /* -- Aggregate counts ------------------------------------ */

  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errorCount++;
    else warningCount++;
  }

  return {
    issues,
    countsBySeverity: { error: errorCount, warning: warningCount },
  };
}

/* ============================================================
 * Empty-snapshot helper for tests + initial state.
 * ============================================================ */

export const EMPTY_PLAN_SNAPSHOT: PlanEntitiesSnapshot = {
  chains: [],
  factorTables: [],
  dimensions: [],
  sources: [],
};
