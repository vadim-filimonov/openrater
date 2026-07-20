/**
 * detectOutOfRange — cold-test L22 score-time out-of-range surface.
 *
 * Pure function. Walks a batch of `RunResult` traces and counts, per
 * banded dimension, how many rows had a value that fell OUTSIDE every
 * band (above the top band's `hi` or below the bottom band's `lo`).
 *
 * Why this exists: a banded value past the tails used to resolve to
 * `derive.band` → "" → `lookup.direct` default 1.0, silently under-
 * pricing the risk (the cold-test's 93 revenue>$5M rows scored a 1.0
 * factor instead of the top band's 1.75/2.1, dropping ~$157K from the
 * book while the run still reported "green"). The `derive.band` kind
 * now clamps such values onto the nearest band AND flags
 * `out_of_range: true` on its trace output. This detector reads that
 * flag back so the UI can LOUDLY report the clamp — the fix is never
 * silent.
 *
 * The dim slug + label come from the runtime plan's `derive.band`
 * node params (the trace itself doesn't carry params), so this takes
 * both the executed `Plan` and its `results`. Node id → dimSlug is
 * resolved once up front.
 *
 * Pure data in / pure data out. No React, no DOM, no I/O. Mirrors the
 * `detectMismatches` shape so the consuming workspace treats the two
 * banners uniformly.
 */

import type { Plan, RunResult } from "@openrater/contracts";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** Per-banded-dimension out-of-range tally across a scored batch. */
export interface OutOfRangeBand {
  /**
   * The banded dim's slug (from the `derive.band` node params). May be
   * the empty string if the projector emitted the node without a slug;
   * the consumer falls back to the node id for display in that case.
   */
  readonly dimSlug: string;
  /** The runtime node id that produced the binning (audit handle). */
  readonly nodeId: string;
  /**
   * How many scored rows had a value that fell outside every band for
   * this dim. Always ≥ 1 when this entry is present (zero-count dims
   * are filtered out).
   */
  readonly count: number;
  /** Total rows scored (denominator for "{count} of {total}"). */
  readonly total: number;
  /**
   * Whether the projected plan clamps out-of-range values for this dim
   * (`derive.band` param `clampToNearest`). When true the premium used
   * the nearest tail band; when false it silently used factor 1.0.
   * Drives the banner copy ("clamped to the nearest band" vs "priced
   * at the neutral 1.0 factor").
   */
  readonly clamped: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

interface BandNodeMeta {
  readonly dimSlug: string;
  readonly clamped: boolean;
}

/**
 * Build a `nodeId → { dimSlug, clamped }` map for every `derive.band`
 * node in the plan. Read once so the per-row trace scan is O(rows ×
 * traced-nodes) without re-reading params each time.
 */
function indexBandNodes(plan: Plan): Map<string, BandNodeMeta> {
  const out = new Map<string, BandNodeMeta>();
  for (const node of plan.nodes) {
    if (node.kind !== "derive.band") continue;
    const params = (node.params ?? {}) as {
      dimSlug?: unknown;
      clampToNearest?: unknown;
    };
    out.set(node.id, {
      dimSlug: typeof params.dimSlug === "string" ? params.dimSlug : "",
      clamped: params.clampToNearest === true,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Scan a batch of run results for out-of-range banded values.
 *
 * Returns one `OutOfRangeBand` per banded dim that had ≥ 1 out-of-range
 * row, sorted by descending count (most-impacted dim first). Returns an
 * empty array when no `derive.band` node fired out of range — the
 * common healthy case — so the consumer renders nothing.
 *
 * A row counts as out-of-range for a dim when that dim's `derive.band`
 * trace entry reports `outputs.out_of_range === true`. The detector is
 * agnostic to whether the value was then clamped — both clamped and
 * unclamped out-of-range rows are counted (the `clamped` flag on the
 * result distinguishes the remediation).
 */
export function detectOutOfRange(
  plan: Plan,
  results: readonly RunResult[],
): readonly OutOfRangeBand[] {
  const bandNodes = indexBandNodes(plan);
  if (bandNodes.size === 0) return [];

  const total = results.length;
  // nodeId → count of out-of-range rows.
  const counts = new Map<string, number>();

  for (const result of results) {
    for (const nodeId of bandNodes.keys()) {
      const entry = result.trace[nodeId];
      if (!entry) continue;
      if (entry.outputs?.out_of_range === true) {
        counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
      }
    }
  }

  const out: OutOfRangeBand[] = [];
  for (const [nodeId, count] of counts) {
    if (count === 0) continue;
    const meta = bandNodes.get(nodeId)!;
    out.push({
      dimSlug: meta.dimSlug,
      nodeId,
      count,
      total,
      clamped: meta.clamped,
    });
  }
  // Most-impacted dim first; tie-break by nodeId for stable ordering.
  out.sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId));
  return out;
}

/**
 * Convenience predicate — did ANY banded dim report an out-of-range
 * row? Lets the consumer cheaply gate the banner without re-walking.
 */
export function hasOutOfRange(bands: readonly OutOfRangeBand[]): boolean {
  return bands.length > 0;
}
