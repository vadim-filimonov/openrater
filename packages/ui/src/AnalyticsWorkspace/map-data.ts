/**
 * Brief 43 PR 43.5 — US state tile-grid layout.
 *
 * 9 rows × 11 columns, with `null` cells for visual whitespace. The
 * layout is intentionally editorial (per the §−1 mockup lock —
 * matches what the user signed off on); ADR-0018's MapLibre
 * choropleth is the eventual production swap-in but doesn't block
 * v1.
 *
 * 51 cells = 50 states + DC. Source: the Brief 43 mockup HTML at
 * `rate-lab/frontend/public/mockup/43-analytics-workspace.html`
 * line 1333. The arrangement preserves rough geographic intuition
 * (Pacific left, Atlantic right, FL bottom-right, etc).
 */

export type StateCode =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL"
  | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME"
  | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH"
  | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI"
  | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI"
  | "WY";

export const STATE_TILE_GRID: ReadonlyArray<ReadonlyArray<StateCode | null>> =
  Object.freeze([
    [null, null, null, null, null, null, null, null, null, null, "ME"],
    ["AK", null, null, null, null, null, null, null, null, "VT", "NH"],
    [null, null, "WA", "MT", "ND", "MN", "WI", null, "MI", "NY", "MA"],
    [null, null, "OR", "ID", "WY", "SD", "IA", "IL", "IN", "OH", "PA"],
    [null, null, "CA", "NV", "UT", "CO", "NE", "MO", "KY", "WV", "NJ"],
    ["CT", "RI", null, "AZ", "NM", "KS", "AR", "TN", "VA", "MD", "DE"],
    [null, null, null, null, null, "OK", "LA", "MS", "AL", "NC", "DC"],
    [null, null, null, null, null, "TX", null, null, null, "GA", null],
    ["HI", null, null, null, null, null, null, null, null, "FL", null],
  ] as const);

/** Flat list of all 51 codes — derived once at module load. */
export const STATE_CODES: readonly StateCode[] = Object.freeze(
  STATE_TILE_GRID.flatMap((row) =>
    row.filter((c): c is StateCode => c !== null),
  ),
);
