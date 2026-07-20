/**
 * Brief 44 PR 44.5 — Magnitude → tint bucketing for the map mode of
 * `<FactorTableViz>`.
 *
 * Translates a 1-D map of factor values keyed by level id into a
 * `Map<level_id, color>` consumable by `<UsChoropleth>`'s `colorById`
 * prop. Uses the same 5-bucket azure ramp as the Analytics map
 * (Brief 43 §5.2) — visual consistency across surfaces is one of
 * Brief 44's locks (mockup §1.4).
 *
 * Bucketing strategy (Brief 44 §5.4):
 *   · 5 buckets, equal-interval split on the [min, max] domain of
 *     the supplied values. Equal-interval is editor-friendly — the
 *     same factor reads as the same color across snapshots.
 *   · When all values are equal (degenerate case), every level gets
 *     the middle bucket color.
 *   · Levels not present in the cell map render in a NEUTRAL tint
 *     so the user sees "this level has no factor yet" rather than
 *     a misleading "0.0 = below average" tint.
 *
 * Visual lock: matches the legend in Frame 4 of the Brief 44 mockup
 * (Tier 1 → azure-500, Tier 2 → azure-700, Tier 3 → azure-800, Tier
 * 4 → azure-950, plus a low-tier azure-300 above average).
 */

/**
 * Brief 44 §5.4 bucket colors (low → high). Raw hex because these
 * feed MapLibre's paint `fill-color`, which resolves with CSS
 * Color Level 3 and can't see `var(--rater-color-*)` CSS custom
 * properties. Hex values track the design-system azure scale 1:1.
 */
export const GEO_BUCKET_COLORS: readonly string[] = [
  "#172554", // azure-950
  "#1e40af", // azure-800
  "#1d4ed8", // azure-700
  "#3b82f6", // azure-500
  "#93c5fd", // azure-300
] as const;

/** Color for levels missing a cell value. Distinct from the 5-bucket ramp. */
export const GEO_BUCKET_NEUTRAL = "#27272a"; // zinc-800

/** Number of buckets in the equal-interval split. */
export const GEO_BUCKET_COUNT = 5 as const;

export interface GeoBucketResult {
  /** level_id → fill color (5-bucket azure ramp; neutral for missing). */
  readonly tints: ReadonlyMap<string, string>;
  /** Computed domain (after filtering NaN). Useful for a legend caption. */
  readonly domain: { readonly min: number; readonly max: number } | null;
  /** Per-bucket midpoint values + colors, ordered low → high. */
  readonly bucketLegend: ReadonlyArray<{
    readonly color: string;
    readonly rangeLo: number;
    readonly rangeHi: number;
  }>;
}

/**
 * Compute level_id → tint color for the geo map view.
 *
 * `levelIds` is the full list of dim levels (so missing ones still
 * appear in the output map with the neutral color).
 *
 * `valueByLevelId` is the cell lookup — typically derived from
 * FactorTableViz's `cells` map.
 */
export function computeGeoTints(
  levelIds: readonly string[],
  valueByLevelId: ReadonlyMap<string, number>,
): GeoBucketResult {
  // Collect finite values for the domain. NaN / Infinity / null are
  // ignored — those levels fall into the "missing" bucket.
  const values: number[] = [];
  for (const id of levelIds) {
    const v = valueByLevelId.get(id);
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }

  const tints = new Map<string, string>();

  if (values.length === 0) {
    // No data — every level neutral.
    for (const id of levelIds) tints.set(id, GEO_BUCKET_NEUTRAL);
    return { tints, domain: null, bucketLegend: [] };
  }

  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Degenerate domain — all values equal. Every present level gets the
  // middle bucket; missing levels stay neutral.
  if (min === max) {
    const mid = GEO_BUCKET_COLORS[Math.floor(GEO_BUCKET_COUNT / 2)]!;
    for (const id of levelIds) {
      const v = valueByLevelId.get(id);
      tints.set(
        id,
        typeof v === "number" && Number.isFinite(v) ? mid : GEO_BUCKET_NEUTRAL,
      );
    }
    return {
      tints,
      domain: { min, max },
      bucketLegend: [{ color: mid, rangeLo: min, rangeHi: max }],
    };
  }

  // Build equal-interval bucket boundaries: 5 buckets over [min, max].
  const step = (max - min) / GEO_BUCKET_COUNT;
  const boundaries: number[] = [];
  for (let i = 1; i < GEO_BUCKET_COUNT; i += 1) {
    boundaries.push(min + step * i);
  }

  // Assign each level to a bucket. Bucket index is the count of
  // boundaries the value exceeds (clamped to [0, 4]).
  for (const id of levelIds) {
    const v = valueByLevelId.get(id);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      tints.set(id, GEO_BUCKET_NEUTRAL);
      continue;
    }
    let bucket = 0;
    for (const b of boundaries) {
      if (v >= b) bucket += 1;
    }
    if (bucket > GEO_BUCKET_COUNT - 1) bucket = GEO_BUCKET_COUNT - 1;
    tints.set(id, GEO_BUCKET_COLORS[bucket]!);
  }

  // Compose the per-bucket legend.
  const bucketLegend: Array<{
    color: string;
    rangeLo: number;
    rangeHi: number;
  }> = [];
  for (let i = 0; i < GEO_BUCKET_COUNT; i += 1) {
    const lo = i === 0 ? min : (boundaries[i - 1] ?? min);
    const hi = i === GEO_BUCKET_COUNT - 1 ? max : (boundaries[i] ?? max);
    bucketLegend.push({ color: GEO_BUCKET_COLORS[i]!, rangeLo: lo, rangeHi: hi });
  }

  return { tints, domain: { min, max }, bucketLegend };
}
