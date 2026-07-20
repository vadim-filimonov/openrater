/**
 * Schedule rating shapes — Brief 15 (Modifiers section).
 *
 * Schedule rating is JUDGMENT-DRIVEN modification of premium. The
 * plan-author defines the schedule STRUCTURE (categories + per-
 * category ranges + filed total cap). The per-risk underwriter
 * supplies VALUES + reasoning per category — the schedule kind
 * combines them into a cumulative multiplicative factor.
 *
 *     Schedule (filed structure)
 *       ├─ Category "Management experience"  ±5%  reasoning_required: yes
 *       ├─ Category "Premises maintenance"   ±5%
 *       ├─ Category "Safety devices"        ±10%
 *       └─ total_cap_pct: 25
 *
 *     ScheduleApplication (per-risk)
 *       ├─ "mgmt_experience": { value_pct: -5, reasoning: "Strong leadership; 15+ yrs", source: "underwriter" }
 *       ├─ "premises_maint":  { value_pct:  3, reasoning: "Deferred maintenance",       source: "underwriter" }
 *       └─ "safety_devices":  { value_pct: -7, reasoning: "Monitored alarm + sprinklers", source: "uw_report" }
 *
 *     Result
 *       - factor: 0.91 (= 1 + sum / 100 within the cap)
 *       - applied_categories: [{ category_id, value_pct, reasoning, source }]
 *
 * Pure types. No React, no DOM. The runtime evaluator lives in
 * `kinds/modifier-schedule.ts`. The UI primitives (<ScheduleCategoryRow>,
 * <ScheduleApplicationForm>, <RunningTotalChip>) live in @openrater/ui
 * and consume these shapes verbatim.
 */

import type { EligibilityTier } from "./tier-types";

/**
 * One category in a schedule — the plan-author defines this as part
 * of the filed structure.
 */
export interface ScheduleCategory {
  /** Stable id within the schedule (slug or similar). Used as the
   *  key in ScheduleApplication.values. */
  readonly category_id: string;
  /** Display name shown in the UI + trace (e.g., "Management experience"). */
  readonly name: string;
  /** Per-category range expressed as ±N% (e.g., 5 → ±5%). The applied
   *  value must satisfy abs(value_pct) <= range_pct. */
  readonly range_pct: number;
  /** Optional tier filter — when set, the category applies ONLY when
   *  the eligibility verdict's tier is in this list. Composes with
   *  Brief 10 (Eligibility & Appetite). */
  readonly tier_filter?: readonly EligibilityTier[];
  /** Whether per-category reasoning is required when value_pct != 0.
   *  Defaults true; setting false is rare and explicitly logged. */
  readonly reasoning_required: boolean;
  /** Display order (1-indexed) within the schedule's category list.
   *  Optional — the runtime preserves declaration order when unset. */
  readonly display_order?: number;
}

/**
 * Where this application's category value came from. Drives the audit
 * trail + the trace's source attribution.
 *
 *   - underwriter:   the underwriter authored both value + reasoning
 *   - uw_report:     auto-suggested by UW Report; underwriter accepted
 *                    (Brief 7 + Brief 15 Q9)
 *   - default_zero:  no value supplied; treated as 0% (no surcharge,
 *                    no credit). reasoning is implicit ("no adjustment").
 */
export type ScheduleApplicationSource =
  | "underwriter"
  | "uw_report"
  | "default_zero";

/** Iterable list of every ScheduleApplicationSource. */
export const SCHEDULE_APPLICATION_SOURCES: readonly ScheduleApplicationSource[] =
  Object.freeze(["underwriter", "uw_report", "default_zero"] as const);

/**
 * One category's applied value (per-risk). Authored by the underwriter
 * or auto-suggested by UW Report + accepted by the underwriter.
 */
export interface ScheduleApplicationEntry {
  /** Applied value as signed percentage. Positive = surcharge,
   *  negative = credit. Must satisfy abs(value_pct) <=
   *  category.range_pct (validated at evaluation; out-of-range surfaces
   *  as a runtime error per Brief 15 P-M3). */
  readonly value_pct: number;
  /** Reasoning text — verbatim into the trace per Brief 15 P-M4.
   *  Required when value_pct != 0 AND the category's reasoning_required
   *  is true. */
  readonly reasoning?: string;
  /** Provenance of this value. Drives audit attribution. */
  readonly source: ScheduleApplicationSource;
}

/**
 * Per-risk application of a schedule. Underwriter (or UW Report) supplies
 * this; the modifier.schedule kind consumes it via the `application`
 * input port.
 */
export interface ScheduleApplication {
  /** Must match the parent schedule's schedule_id. */
  readonly schedule_id: string;
  /** Keyed by ScheduleCategory.category_id. Categories that don't
   *  appear here are treated as default_zero. */
  readonly values: Readonly<Record<string, ScheduleApplicationEntry>>;
}

/**
 * The full schedule definition — the plan-author writes this.
 *
 * Categories are LIVE PARAMS of the modifier.schedule kind — the
 * actuary edits them via the Modifiers section UI; they persist into
 * the plan JSON; they execute at run time.
 */
export interface Schedule {
  /** Stable id for the schedule (slug). Used in the application's
   *  schedule_id field for matching. */
  readonly schedule_id: string;
  /** Display name (e.g., "Property schedule mod"). */
  readonly display_name: string;
  /** Whether this schedule applies per-coverage or at the plan level
   *  (cross-LOB package modifier). Per Brief 15 Q6. */
  readonly scope: "per_coverage" | "package";
  /** Coverage ids this schedule applies to when scope=per_coverage.
   *  When scope=package, the schedule applies to ALL coverages across
   *  all LOBs (multi-LOB plans). */
  readonly coverages?: readonly string[];
  /** Filed total cap (e.g., 25 → ±25%). The cumulative applied
   *  values are clamped to this cap; exceeding it surfaces as a
   *  runtime error per Brief 15 P-M3. */
  readonly total_cap_pct: number;
  /** The category structure. Order is the display order. */
  readonly categories: readonly ScheduleCategory[];
  /** Citation to the filed schedule (e.g., "Meridian Rule MS-R4.2"). */
  readonly citation?: string;
  /** Actuary reasoning verbatim into the trace. */
  readonly reasoning?: string;
  /** Optional coverage/product scoping tags — OPAQUE strings (ADR-0033
   *  §0; re-keyed off `LineCode` in gate 5). When set, this schedule
   *  applies only to the tagged coverages. */
  readonly lob_tags?: readonly string[];
  /** Display order within the Modifiers section (1-indexed). */
  readonly display_order?: number;
}

/**
 * The per-category evaluation result. Surfaces in the trace for the
 * audit trail.
 */
export interface AppliedScheduleCategory {
  readonly category_id: string;
  readonly name: string;
  readonly value_pct: number;
  readonly reasoning?: string;
  readonly source: ScheduleApplicationSource;
  /** True when the category was filtered out by tier_filter (didn't
   *  apply at runtime). When skipped, value_pct is 0 and source is
   *  "default_zero". */
  readonly skipped_by_tier?: boolean;
}
