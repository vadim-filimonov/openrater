/**
 * heatBucket — Brief 34 PR 34.2.
 *
 * Pure heat-encoding library. Maps a cell value to one of 7 buckets
 * (heat-1 through heat-7) based on its signed deviation from the
 * baseline. The bucket numbers track the polished mockup's CSS
 * classes (`mini-cell.heat-N`) at `/mockup/34-factor-table-
 * visualization.html` lines 535–541.
 *
 * Bucket meaning:
 *   • heat-1 — deeply below baseline (≥ 30% discount)
 *   • heat-2 — moderately below baseline (5–30% discount)
 *   • heat-3 — at baseline (within 5%)
 *   • heat-4 — slightly above baseline (5–15% surcharge)
 *   • heat-5 — moderately above baseline (15–30% surcharge)
 *   • heat-6 — deeply above baseline (30–50% surcharge)
 *   • heat-7 — extreme surcharge (≥ 50%)
 *
 * Why 7 buckets and not a continuous gradient: gradients render
 * inconsistently across browsers; bucketed CSS classes use
 * `color-mix(in srgb, ...)` tokens which carry the same azure / orange
 * vocabulary as the rest of the design system. Keeps the heatmap
 * visually anchored to the tokens.
 */

/** Heat bucket — integer 1..7 (or 0 for "no encoding"). */
export type HeatBucket = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Default baseline. */
export const HEAT_BASELINE = 1;

/**
 * Compute the heat bucket for a cell value. Returns 0 when the
 * value is undefined (cell missing) — caller renders the cell
 * neutral.
 */
export function heatBucket(
  value: number | undefined,
  baseline: number = HEAT_BASELINE,
): HeatBucket {
  if (value === undefined) return 0;
  const delta = (value - baseline) / baseline;
  // Bands (chosen empirically against Meridian BOP rate-table ranges).
  if (delta <= -0.3) return 1;
  if (delta <= -0.05) return 2;
  if (delta < 0.05) return 3;
  if (delta < 0.15) return 4;
  if (delta < 0.3) return 5;
  if (delta < 0.5) return 6;
  return 7;
}

/**
 * Heat-scale legend entries, in display order. Each entry has a
 * bucket id + a human-readable range label. Consumers render this
 * below the grid.
 */
export const HEAT_LEGEND_ENTRIES: ReadonlyArray<{
  readonly bucket: HeatBucket;
  readonly label: string;
}> = [
  { bucket: 1, label: "< 0.7" },
  { bucket: 2, label: "0.7–0.95" },
  { bucket: 3, label: "≈ 1.0" },
  { bucket: 4, label: "1.05–1.15" },
  { bucket: 5, label: "1.15–1.3" },
  { bucket: 6, label: "1.3–1.5" },
  { bucket: 7, label: "> 1.5" },
];

/**
 * Format a cell value for display in the heatmap (mono, 3 decimals
 * trimmed). Mirrors FactorTableGrid2D's `formatCell` so the two
 * surfaces stay visually identical.
 */
export function formatHeatCell(value: number | undefined): string {
  if (value === undefined) return "·";
  if (value === 0) return "0";
  return value.toFixed(3).replace(/\.?0+$/, "") || "0";
}
