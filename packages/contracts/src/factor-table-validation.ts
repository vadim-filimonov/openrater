/**
 * Factor-table row validation — Brief 18 P-FT2 + §6 + M5.1.8.
 *
 * Pure-function validator that walks a factor table's rows and
 * returns a list of `Issue` records (Brief 13 unified-error-panel
 * shape). Consumed by:
 *   · The route's section banner (real-time feedback while editing)
 *   · Brief 9's collectIssues() aggregator (when filing-export runs)
 *
 * Per Brief 18 §6 the validation rules are:
 *   1. All `key` values are non-empty after trim.
 *   2. All `key` values are unique within a table.
 *   3. All `factor` values are finite numbers.
 *   4. All `factor` values are > 0 (positive).
 *   5. Reserved key `__default__` appears at most once.
 *   6. Citation present (rule + page) — warn level (filing export
 *      escalates to error via collectIssues).
 *
 * No React, no DOM, no I/O. Synchronous + deterministic — same
 * input always produces the same Issue ids (per Brief 13 P-UE8).
 *
 * For Brief 18's `class_factor` table, an additional check could
 * verify each non-default key is a valid ISO BOP class code. That
 * lives in `collectIssues()` because it requires the class library
 * snapshot — see Brief 9. This module covers the table-only checks.
 */

import { deriveIssueId } from "./issues/helpers";
import type { Issue } from "./issues/types";

/** Reserved sentinel — matches DEFAULT_ROW_KEY from @openrater/ui. */
export const FACTOR_TABLE_DEFAULT_KEY = "__default__";

/**
 * Minimal row shape consumed by the validator. Matches both
 * `FactorTableGridRow` (UI primitive) and `FactorTableRow` (wire
 * shape) so it's reusable from either context.
 */
export interface FactorTableValidationRow {
  readonly key: string;
  readonly factor: number;
  readonly citation_rule?: string;
  readonly citation_page?: string;
}

/** Inputs to the validator. */
export interface ValidateFactorTableInput {
  /** Stable id of the factor table (matches the spine entity id). */
  readonly tableId: string;
  /** Human display name (for the issue message). */
  readonly tableDisplayName: string;
  /** All rows in the table, including the default sentinel if present. */
  readonly rows: readonly FactorTableValidationRow[];
}

/**
 * Validate a factor table. Returns an issue per problem found,
 * sorted in stable order. Empty array means the table is clean.
 *
 * Pure + synchronous. Safe to call on every edit (O(N) per row).
 */
export function validateFactorTableRows(
  input: ValidateFactorTableInput,
): readonly Issue[] {
  const { tableId, tableDisplayName, rows } = input;
  const issues: Issue[] = [];

  // ── 1+2+5: Walk rows once, track keys for uniqueness + default-count
  const seenKeys = new Map<string, number>(); // normalized key → first-seen-index
  let defaultRowCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const trimmed = row.key.trim();

    // Rule 1: non-empty key
    if (trimmed === "") {
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "error",
          rowKey: `(row ${i + 1})`,
          field: "key",
          messageTemplate: "empty_key",
          message: `Row ${i + 1} in factor table “${tableDisplayName}” has an empty key. Every row must have a non-empty key.`,
        }),
      );
      continue; // Skip further uniqueness check for empty keys
    }

    // Rule 5: default-row count
    if (trimmed === FACTOR_TABLE_DEFAULT_KEY) {
      defaultRowCount++;
      if (defaultRowCount > 1) {
        issues.push(
          makeIssue({
            tableId,
            tableDisplayName,
            severity: "error",
            rowKey: trimmed,
            field: "key",
            messageTemplate: "duplicate_default",
            message: `Factor table “${tableDisplayName}” has more than one default row. Only one row may use the reserved key \`__default__\`.`,
          }),
        );
      }
    }

    // Rule 2: uniqueness
    const firstSeen = seenKeys.get(trimmed);
    if (firstSeen !== undefined) {
      // Only emit one duplicate issue per dup-pair (the second instance).
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "error",
          rowKey: trimmed,
          field: "key",
          messageTemplate: "duplicate_key",
          message: `Factor table “${tableDisplayName}” has a duplicate key: \`${trimmed}\` appears on rows ${firstSeen + 1} and ${i + 1}.`,
        }),
      );
    } else {
      seenKeys.set(trimmed, i);
    }

    // Rule 3+4: factor must be finite + positive
    if (!Number.isFinite(row.factor)) {
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "error",
          rowKey: trimmed,
          field: "factor",
          messageTemplate: "non_finite_factor",
          message: `Factor table “${tableDisplayName}” row \`${trimmed}\`: factor is not a finite number.`,
        }),
      );
    } else if (row.factor <= 0) {
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "error",
          rowKey: trimmed,
          field: "factor",
          messageTemplate: "non_positive_factor",
          message: `Factor table “${tableDisplayName}” row \`${trimmed}\`: factor must be > 0 (got ${row.factor}).`,
        }),
      );
    }

    // Rule 6: missing citation (warn — Brief 9 escalates for filing)
    const hasRule = (row.citation_rule ?? "").trim() !== "";
    const hasPage = (row.citation_page ?? "").trim() !== "";
    if (!hasRule && !hasPage) {
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "warning",
          rowKey: trimmed,
          field: "citation_rule",
          messageTemplate: "missing_citation",
          message: `Factor table “${tableDisplayName}” row \`${trimmed}\` has no citation. Add a rule + page reference before exporting for filing.`,
        }),
      );
    } else if (!hasRule) {
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "warning",
          rowKey: trimmed,
          field: "citation_rule",
          messageTemplate: "missing_citation_rule",
          message: `Factor table “${tableDisplayName}” row \`${trimmed}\` has a citation page but no rule.`,
        }),
      );
    } else if (!hasPage) {
      issues.push(
        makeIssue({
          tableId,
          tableDisplayName,
          severity: "warning",
          rowKey: trimmed,
          field: "citation_page",
          messageTemplate: "missing_citation_page",
          message: `Factor table “${tableDisplayName}” row \`${trimmed}\` has a citation rule but no page.`,
        }),
      );
    }
  }

  return issues;
}

// ── Internal: Issue factory ─────────────────────────────────────

interface MakeIssueArgs {
  readonly tableId: string;
  readonly tableDisplayName: string;
  readonly severity: "error" | "warning";
  readonly rowKey: string;
  readonly field: string;
  readonly messageTemplate: string;
  readonly message: string;
}

function makeIssue(args: MakeIssueArgs): Issue {
  const location = {
    section: "factor-tables",
    entity: `${args.tableId}.${args.rowKey}`,
    field: args.field,
  } as const;
  // Errors block filing; warnings don't (per Brief 9 default policy).
  // Missing citations are exceptional: they're warnings that filing
  // exports promote to blocking — handled in collectIssues().
  const filing_blocking = args.severity === "error";
  return {
    id: deriveIssueId({
      source: "authoring",
      location,
      message_template: args.messageTemplate,
    }),
    severity: args.severity,
    source: "authoring",
    message: args.message,
    location,
    filing_blocking,
    fix_hint: {
      label: `Open factor table → ${args.rowKey}`,
      target: location,
    },
  };
}
