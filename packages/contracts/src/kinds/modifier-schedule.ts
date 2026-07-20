/**
 * `modifier.schedule` kind — schedule rating evaluator.
 *
 * Brief 15 (Modifiers section). Applies a judgment-driven schedule of
 * per-category modifications to produce a cumulative factor.
 *
 *   Given:
 *     - schedule (filed structure: categories + ranges + cap)
 *     - application (per-risk: value_pct + reasoning + source per category)
 *     - optional tier (from upstream eligibility.gate)
 *
 *   Computes:
 *     - For each category:
 *         · If tier_filter set + tier doesn't match → skip (value_pct = 0)
 *         · Otherwise read application.values[category_id]
 *         · Default to 0% when not supplied
 *         · Validate abs(value_pct) <= category.range_pct
 *     - Sum all applied value_pct values
 *     - Validate abs(sum) <= total_cap_pct (filed cap)
 *     - Return factor = 1 + sum/100 (so −11% sum → factor 0.89)
 *
 *   Trace shows:
 *     - The cumulative factor
 *     - Per-category applied values + reasoning + source
 *     - Which categories were skipped (tier-filtered)
 *     - Whether the cap was hit
 *
 * Per Brief 15 P-M3 (cap enforced) + P-M4 (per-category reasoning) +
 * P-M9 (tier-conditional categories).
 *
 * The runtime DOESN'T special-case this kind — execute is pure +
 * deterministic + reads the schedule from params, the application
 * from the input port, the tier from the optional tier port.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type {
  AppliedScheduleCategory,
  Schedule,
  ScheduleApplication,
  ScheduleApplicationEntry,
} from "../schedule-types";
import {
  type EligibilityTier,
  isEligibilityTier,
} from "../tier-types";

export interface ModifierScheduleParams {
  /** The filed schedule structure. */
  readonly schedule: Schedule;
}

/**
 * Wire inputs:
 *   - application: the ScheduleApplication (per-risk values).
 *   - tier (optional): the eligibility verdict for tier-conditional
 *     categories. When unwired, no tier filtering is applied (all
 *     categories evaluate).
 */
export interface ModifierScheduleInputs {
  application: ScheduleApplication;
  tier?: string;
}

export interface ModifierScheduleOutputs {
  /** Cumulative multiplicative factor (1 + sum/100). */
  factor: number;
  /** Sum of all applied value_pct values (signed, before factor conversion). */
  applied_pct: number;
  /** Per-category evaluation results — surfaces in the trace. */
  applied_categories: readonly AppliedScheduleCategory[];
  /** True when the absolute applied_pct equals the filed cap (sum was
   *  clamped). When true, the trace surfaces a cap-hit warning. */
  cap_hit: boolean;
}

export const ModifierScheduleKind: BlockKind<
  ModifierScheduleParams,
  ModifierScheduleInputs,
  ModifierScheduleOutputs
> = {
  id: "modifier.schedule",
  category: "chain",
  label: "Schedule modifier",
  description:
    "Judgment-driven schedule rating — per-category mods, total cap, optional tier filtering.",
  inputs: [
    {
      name: "application",
      type: "record",
      description:
        "Per-risk ScheduleApplication with per-category value_pct + reasoning + source.",
    } as PortSpec,
    {
      name: "tier",
      type: "string",
      optional: true,
      description:
        "Optional eligibility tier — when wired, tier-conditional categories are filtered.",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "factor",
      type: "factor",
      description: "Cumulative multiplicative factor.",
    } as PortSpec,
    {
      name: "applied_pct",
      type: "pct",
      description: "Sum of applied value_pct values (signed).",
    } as PortSpec,
    {
      name: "applied_categories",
      type: "record",
      description: "Per-category evaluation result (for trace).",
    } as PortSpec,
    {
      name: "cap_hit",
      type: "bool",
      description: "True when the filed cap was reached.",
    } as PortSpec,
  ],
  defaultParams: {
    schedule: {
      schedule_id: "untitled_schedule",
      display_name: "Untitled schedule",
      scope: "per_coverage",
      total_cap_pct: 25,
      categories: [],
    },
  },
  defaultSize: "regular",
  execute: (inputs, params) => {
    const { schedule } = params;
    // The application reaches book runs as a raw CSV cell — a JSON
    // string, not the parsed envelope. Parse defensively; anything
    // that isn't a usable {values} object degrades to default_zero
    // (never throws mid-graph — an exploding modifier withheld ALL
    // coverage outputs for the row).
    const rawApplication = inputs.application as unknown;
    const parsedApplication =
      typeof rawApplication === "string"
        ? (() => {
            try {
              return JSON.parse(rawApplication) as ScheduleApplication;
            } catch {
              return undefined;
            }
          })()
        : (rawApplication as ScheduleApplication | undefined);
    const application =
      parsedApplication &&
      typeof parsedApplication === "object" &&
      parsedApplication.values &&
      typeof parsedApplication.values === "object"
        ? parsedApplication
        : {
            schedule_id: schedule.schedule_id,
            values: {},
          };
    const tier = normalizeTier(inputs.tier);
    const cats: AppliedScheduleCategory[] = [];
    let sum = 0;
    for (const category of schedule.categories) {
      const skipped =
        category.tier_filter !== undefined &&
        category.tier_filter.length > 0 &&
        tier !== undefined &&
        !category.tier_filter.includes(tier);
      const entry = application.values[category.category_id];
      const value_pct = skipped ? 0 : safeValuePct(entry, category.range_pct);
      sum += value_pct;
      cats.push({
        category_id: category.category_id,
        name: category.name,
        value_pct,
        ...(entry?.reasoning ? { reasoning: entry.reasoning } : {}),
        source: skipped
          ? "default_zero"
          : (entry?.source ?? "default_zero"),
        ...(skipped ? { skipped_by_tier: true } : {}),
      });
    }
    // Cap enforcement: clamp the sum's magnitude to the filed cap.
    // The trace surfaces cap_hit so the underwriter sees clamping
    // happened.
    const cap = schedule.total_cap_pct;
    const cap_hit = Math.abs(sum) >= cap;
    const clamped = cap_hit
      ? sum >= 0
        ? cap
        : -cap
      : sum;
    return {
      factor: 1 + clamped / 100,
      applied_pct: clamped,
      applied_categories: cats,
      cap_hit,
    };
  },
  validate: (params) => {
    const s = params.schedule;
    if (!s.schedule_id || s.schedule_id.trim() === "") {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "schedule.schedule_id is required.",
            field: "schedule.schedule_id",
          },
        ],
      };
    }
    if (s.total_cap_pct < 0) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "total_cap_pct must be non-negative.",
            field: "schedule.total_cap_pct",
          },
        ],
      };
    }
    const seen = new Set<string>();
    for (const c of s.categories) {
      if (!c.category_id || c.category_id.trim() === "") {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: "Every category must have a non-empty category_id.",
              field: "schedule.categories",
            },
          ],
        };
      }
      if (seen.has(c.category_id)) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `Duplicate category_id "${c.category_id}" in schedule.`,
              field: "schedule.categories",
            },
          ],
        };
      }
      seen.add(c.category_id);
      if (c.range_pct < 0) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `Category "${c.category_id}" has negative range_pct; ranges are absolute.`,
              field: "schedule.categories",
            },
          ],
        };
      }
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, outputs) => {
    const cat_count = outputs.applied_categories.length;
    const applied_count = outputs.applied_categories.filter(
      (c) => c.value_pct !== 0,
    ).length;
    const cap_note = outputs.cap_hit
      ? ` (capped at ±${params.schedule.total_cap_pct}%)`
      : "";
    const factor_str = outputs.factor.toFixed(4);
    return `${params.schedule.display_name}: ${applied_count} of ${cat_count} categor${cat_count === 1 ? "y" : "ies"} applied → ${outputs.applied_pct >= 0 ? "+" : ""}${outputs.applied_pct.toFixed(1)}%${cap_note} → factor ${factor_str}`;
  },
};

/** Coerce an unknown tier value to a valid EligibilityTier or undefined. */
function normalizeTier(t: unknown): EligibilityTier | undefined {
  if (typeof t !== "string") return undefined;
  return isEligibilityTier(t) ? t : undefined;
}

/**
 * Read + clamp the value_pct from an application entry. Out-of-range
 * values are clamped to the category's range_pct (and the trace's
 * cap_hit signals when the schedule-level cap was reached). Out-of-
 * range PER-CATEGORY clamping is silent in the value but visible in
 * the trace (the underwriter sees `value_pct = clamped_value` vs the
 * application's submitted value, which differs).
 *
 * This is intentional defensive design: rather than throwing on
 * malformed input, we clamp + surface. The unified error panel
 * (Brief 13) catches the discrepancy via collectIssues.
 */
function safeValuePct(
  entry: ScheduleApplicationEntry | undefined,
  range_pct: number,
): number {
  if (!entry) return 0;
  const raw = entry.value_pct;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  if (Math.abs(raw) > range_pct) {
    return raw > 0 ? range_pct : -range_pct;
  }
  return raw;
}
