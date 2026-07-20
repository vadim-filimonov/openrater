/**
 * Brief 64 — shared Analytics types + the KPI catalog.
 *
 * Extracted from the (now-removed) Brief 43 single-slice `AnalyticsWorkspace`
 * component so the math modules + the Brief 64 primitives + the v2
 * orchestrator can share them without depending on a component file. The
 * v1 component was deleted in the Brief 64 integration (pref #8).
 */

/**
 * KPIs — the 5 from Brief 43 §−1.Q3 + `min`/`max` premium (Brief 64).
 * Per level, `min`/`max` are the smallest / largest premium among the
 * level's rows; the Overview's per-variable spread is the min/max of these
 * level values across levels (see `overview-math.ts`).
 */
export type AnalyticsKpiId =
  | "count"
  | "total"
  | "avg"
  | "min"
  | "max"
  | "lr"
  | "rate_change";

export interface AnalyticsKpiSpec {
  readonly id: AnalyticsKpiId;
  readonly label: string;
  /** One-liner tooltip — read by screen readers + shown in the menu. */
  readonly hint: string;
}

/** The KPI catalog. Stable order; exported so the KPI selector + the
 *  exhibit math consume the same list. Brief 64 adds min/max premium. */
export const ANALYTICS_KPIS: readonly AnalyticsKpiSpec[] = Object.freeze([
  {
    id: "count" as const,
    label: "Row count",
    hint: "How many rows in the scored book.",
  },
  {
    id: "total" as const,
    label: "Total premium",
    hint: "Sum of the premium column across all rows.",
  },
  {
    id: "avg" as const,
    label: "Avg premium",
    hint: "Total premium ÷ row count.",
  },
  {
    id: "min" as const,
    label: "Min premium",
    hint: "Smallest premium among the rows in each level.",
  },
  {
    id: "max" as const,
    label: "Max premium",
    hint: "Largest premium among the rows in each level.",
  },
  {
    id: "lr" as const,
    label: "Loss ratio",
    hint: "Loss column ÷ premium column (when both present).",
  },
  {
    id: "rate_change" as const,
    label: "Rate change %",
    hint: "Draft total ÷ baseline total − 1, expressed as a percent.",
  },
]);

/** One slice variable the user can pick to break the book down by.
 *  Either a dimension (with mapped levels) or a raw scored column. */
export interface AnalyticsSliceOption {
  /** Stable id — dim slug. */
  readonly id: string;
  /** Physical input column the slice's values live in (Brief 51 L1). */
  readonly column?: string;
  /** Display label for the picker. */
  readonly label: string;
  /** Where it came from — affects the sub-picker behavior. */
  readonly kind: "dimension" | "column";
  /** For categorical slices: the available levels. */
  readonly levels?: readonly { readonly id: string; readonly label: string }[];
}

export interface AnalyticsSnapshotSummary {
  readonly snapshot_id: string;
  readonly display_name: string;
  /** Optional date string — when present, surfaced as the menu subtitle. */
  readonly created_at?: string;
}

/**
 * L32 — the persisted slice / level / KPI / metric selection. The route
 * reads it to seed the workspace (Brief 64 v2 uses `kpiId`).
 */
export interface AnalyticsViewState {
  readonly sliceId: string;
  readonly levelId: string | null;
  readonly kpiId: AnalyticsKpiId;
  readonly metricColumn: string;
}
