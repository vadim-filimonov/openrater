/**
 * Dimensions sync layer — D6.2 / ADR-0027.
 *
 * Bridges the API-backed `PlanDimension` rows from `@openrater/api-client`
 * with the legacy `DimensionRow` UI shape that `PlanDetailRoute` and
 * every Brief 30 / Brief 27 primitive already consumes. The two shapes
 * are structurally identical — only the field names differ on the
 * primary id (`id` ↔ `dim_id`), so the adapters are one-line.
 *
 * Why a separate module
 * ---------------------
 * Keeps `PlanDetailRoute.tsx` from growing two more conversion
 * helpers + lets us test the round-trip in isolation. Also gives the
 * other migration PRs (D6.3 factor tables, D6.1 inputs mapping) an
 * obvious convention to follow.
 *
 * Migration semantics (ADR-0027 §3)
 * ---------------------------------
 * On first mount per plan-id:
 *   · If the API has dims → those win; local state hydrates from API
 *     (this is the multi-browser fix — browser B sees what browser A
 *     wrote)
 *   · Else if localStorage has dims → bulk-upload them to the API
 *     once, then the next session's API read finds them
 *   · Else → empty state
 *
 * Steady-state writes go through the `bulkUpsertDimensions` mutation
 * on every editedDimensions change, debounced ~400ms so per-keystroke
 * autosaves don't pummel the server.
 */

import type {
  PlanDimension,
  UpsertDimensionRequest,
} from "@openrater/api-client";
import type { DimensionRow } from "@openrater/ui";

// ---------------------------------------------------------------------------
// Banded-level normalization (lo/hi ⇄ min/max)
// ---------------------------------------------------------------------------

/**
 * The engine's `derive.band` / `resolveBandedLevel` / `clampToNearestBand`
 * substrate keys exclusively on `lo`/`hi` (ADR-0026, `dimension-types.ts`).
 * Some persisted banded dims — and every dim authored through the
 * `min`/`max` editor vocabulary — carry only `min`/`max` on their levels.
 * The backend stores `levels` as an opaque JSON array (no introspection,
 * no coercion — see `dimensions/models.py`), so whatever shape was written
 * round-trips back verbatim through `planDimensionToRow`.
 *
 * When the projector then snapshots those levels into a `derive.band` node,
 * `value >= l.lo && value < l.hi` is `value >= undefined && …` → `false` for
 * EVERY band → the value falls outside every band → `out_of_range` (the
 * score-time "N of N rows fell outside every band" banner) and the bound
 * relativity silently resolves to the lookup's neutral 1.0 / clamps to a
 * tail — mis-pricing the risk (e.g. the Sample BOP property-deductible band
 * priced $880 instead of the oracle $1,210).
 *
 * Backfill `lo`←`min` / `hi`←`max` here (the API→UI hop the projector reads
 * from) so a band authored either way resolves identically. This is the
 * production analog of the proven oracle harness's `normalizeBands` toggle
 * (`sampleBopLivePlan.verify.test.ts`), which demonstrated normalized=PASS /
 * raw-min/max=FAIL. Generic: keyed on `kind === "banded"`, never on a dim
 * slug. `min`/`max` are preserved so the editor's own vocabulary is intact;
 * an existing `lo`/`hi` always wins (never clobbered). The symmetric
 * `dimensionRowToUpsertRequest` then writes both pairs back, so the
 * steady-state bulk replace-all can't strip the `lo`/`hi` it just added.
 */
function normalizeBandedLevels(levels: unknown): unknown {
  if (!Array.isArray(levels)) return levels;
  let changed = false;
  const out = levels.map((lvl) => {
    if (!lvl || typeof lvl !== "object") return lvl;
    const l = lvl as Record<string, unknown>;
    if (l.kind !== "banded") return lvl;
    const next: Record<string, unknown> = { ...l };
    let touched = false;
    if (next.lo === undefined && typeof next.min === "number") {
      next.lo = next.min;
      touched = true;
    }
    if (next.hi === undefined && typeof next.max === "number") {
      next.hi = next.max;
      touched = true;
    }
    // Brief 66 §3.5 — open-ended bands: the CONTRACT expresses open
    // ends as ±Infinity (BandedLevel jsdoc), but JSON cannot carry
    // Infinity — the wire convention is null. Normalize on read so
    // resolveBandedLevel / derive.band / the validators see the
    // contract shape ('1M and up' actually resolves at runtime).
    if (next.lo === null) {
      next.lo = Number.NEGATIVE_INFINITY;
      touched = true;
    }
    if (next.hi === null) {
      next.hi = Number.POSITIVE_INFINITY;
      touched = true;
    }
    if (!touched) return lvl;
    changed = true;
    return next;
  });
  return changed ? out : levels;
}

/** Brief 66 §3.5 — ±Infinity → null for the JSON wire (the inverse of
 *  normalizeBandedLevels' read-side normalization). */
function serializeOpenBands(levels: unknown): unknown {
  if (!Array.isArray(levels)) return levels;
  return levels.map((lvl) => {
    if (!lvl || typeof lvl !== "object") return lvl;
    const l = lvl as Record<string, unknown>;
    if (l.kind !== "banded") return lvl;
    const loOpen = l.lo === Number.NEGATIVE_INFINITY;
    const hiOpen = l.hi === Number.POSITIVE_INFINITY;
    if (!loOpen && !hiOpen) return lvl;
    return {
      ...l,
      ...(loOpen ? { lo: null } : {}),
      ...(hiOpen ? { hi: null } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * API `PlanDimension` → UI `DimensionRow`.
 *
 * Drops the lifecycle columns (`created_at`, `updated_at`,
 * `content_hash`) that the UI doesn't render; keeps everything else
 * verbatim. The `levels` cast is structural — the backend stores +
 * returns the array as JSON without introspecting; the UI's
 * BandedLevel / CategoricalLevel discriminators narrow at the
 * consumption site.
 */
export function planDimensionToRow(pd: PlanDimension): DimensionRow {
  const row: Record<string, unknown> = {
    id: pd.dim_id,
    display_name: pd.display_name,
    slug: pd.slug,
  };
  if (pd.data_type !== undefined) row.data_type = pd.data_type;
  // Role on the UI row narrows to "rating-input" | "structural" | "both";
  // the API stores it as a free-form string. Pass through verbatim — if
  // a legacy plan has an out-of-set value, the UI primitives fall back
  // to lenient rendering rather than throwing.
  if (pd.role !== undefined) row.role = pd.role;
  if (pd.dimension_type !== undefined && pd.dimension_type !== null) {
    row.dimension_type = pd.dimension_type;
  }
  if (pd.shape !== undefined && pd.shape !== null) row.shape = pd.shape;
  if (pd.description !== undefined && pd.description !== null) {
    row.description = pd.description;
  }
  if (pd.axes !== undefined && pd.axes !== null) row.axes = pd.axes;
  if (pd.source_field !== undefined && pd.source_field !== null) {
    row.source_field = pd.source_field;
  }
  // Brief 44 geographic substrate — carry the three geo fields through
  // the API → UI hop. Cold-test M (geo territory-keying mismatch): the
  // ParametrizeCanvas `levelsForKeying` helper + `stagesToRuntimePlan`
  // `derive.territory` projection both read `geo_territories` to key a
  // factor table off the 5 territory ids instead of the 51 raw states.
  // Dropping these here (the pre-M behavior) meant the API-wins mount
  // path (ADR-0027 §3 — "API is the source of truth") silently
  // overwrote the locally-authored territory grouping with an empty
  // one, so the grid + runtime fell back to per-state keying and the
  // territory factor never scored. The schemas already round-trip
  // these (planDimensionSchema lines 95–100); this is purely the
  // adapter catching up.
  if (pd.geo_granularity !== undefined && pd.geo_granularity !== null) {
    row.geo_granularity = pd.geo_granularity;
  }
  if (pd.geo_scope !== undefined && pd.geo_scope !== null) {
    row.geo_scope = pd.geo_scope;
  }
  if (pd.geo_territories !== undefined && pd.geo_territories !== null) {
    row.geo_territories = pd.geo_territories;
  }
  // Brief 51 / ADR-0035 — class registry binding + the class-derived
  // wire. Brief 60: these were dropped here, so the API-wins hydration +
  // the steady-state bulk replace-all silently stripped `derived_from`
  // from class-derived structural dims (P-N10) — the projector's
  // `derive.class_attribute` branch then never fired and the property
  // rate-number leg priced at 1.0. Carry them through verbatim.
  if (pd.class_library_id !== undefined && pd.class_library_id !== null) {
    row.class_library_id = pd.class_library_id;
  }
  if (pd.derived_from !== undefined && pd.derived_from !== null) {
    row.derived_from = pd.derived_from;
  }
  // Brief 66 §3.2 — the LAST two round-trip gaps (the fourth + fifth
  // documented drop incidents in this file's history; migration 025
  // added the columns). The round-trip property test now fails loudly
  // whenever DimensionRow grows a field these adapters don't carry.
  if (
    pd.classification_mapping !== undefined &&
    pd.classification_mapping !== null
  ) {
    row.classification_mapping = pd.classification_mapping;
  }
  if (pd.options !== undefined && pd.options !== null) {
    row.options = pd.options;
  }
  if (
    pd.monotonicity_expected !== undefined &&
    pd.monotonicity_expected !== null
  ) {
    row.monotonicity_expected = pd.monotonicity_expected;
  }
  // `levels` is the polymorphic array. The backend stores it
  // verbatim, so a round-trip preserves every per-level field. We
  // backfill `lo`/`hi` from `min`/`max` on banded levels here so the
  // `stagesToRuntimePlan` → `derive.band` projection (which keys only
  // on `lo`/`hi`) bins min/max-authored bands correctly instead of
  // dropping every value out-of-range → neutral 1.0 (see
  // normalizeBandedLevels above).
  row.levels = normalizeBandedLevels(pd.levels);
  return row as unknown as DimensionRow;
}

/**
 * UI `DimensionRow` → API `UpsertDimensionRequest`.
 *
 * Symmetric inverse of `planDimensionToRow`. The ONLY deliberately
 * dropped field is the deprecated `territory_schema_id` (Brief 44
 * replaced it with geo_granularity/geo_scope/geo_territories); every
 * other DimensionRow field round-trips — enforced by
 * dimensionsSync.roundtrip.test.ts, which fails whenever DimensionRow
 * grows a field this adapter does not carry. The `dim_id` is the
 * stable identity used by the PUT endpoint.
 */
export function dimensionRowToUpsertRequest(
  row: DimensionRow,
): UpsertDimensionRequest {
  // Required fields with sensible UI fallbacks for legacy rows that
  // pre-date the strict Pydantic contract (display_name + role both
  // got introduced after the substrate was already shipping; some
  // localStorage-cached rows may be missing them).
  const req: Record<string, unknown> = {
    dim_id: row.id,
    display_name: row.display_name || row.id,
    slug: row.slug || row.id,
    data_type: row.data_type || "string",
    role: row.role || "rating-input",
    // Backfill lo/hi from min/max symmetrically with planDimensionToRow,
    // so the steady-state bulk replace-all re-persists the lo/hi the read
    // path added instead of round-tripping a min/max-only level back to the
    // API (which would re-break derive.band on the next hydration).
    // Open ends serialize EXPLICITLY as null (JSON.stringify would turn
    // Infinity into null anyway — explicit beats accidental).
    levels: serializeOpenBands(normalizeBandedLevels(row.levels ?? [])),
  };
  if (row.dimension_type !== undefined) {
    req.dimension_type = row.dimension_type;
  }
  if (row.shape !== undefined) req.shape = row.shape;
  if (row.description !== undefined) req.description = row.description;
  if (row.axes !== undefined && row.axes !== null) {
    req.axes = [...row.axes];
  }
  // Brief 60 follow-up — `source_field` (the raw input a derived/geo dim reads
  // FROM, e.g. a geographic `territory` dim ← the `zip` column) was preserved by
  // `planDimensionToRow` but DROPPED here, so the steady-state bulk replace-all
  // wrote a geographic dim WITHOUT its source column. The next hydration read it
  // back null and the `derive.territory` projection lost its input — every
  // base-loss-cost lookup then fell to its 1.0 default. Symmetric inverse of
  // `planDimensionToRow`, same fix shape as `geo_territories` / `derived_from`.
  if (row.source_field !== undefined) req.source_field = row.source_field;
  // Brief 44 geographic substrate — symmetric inverse of
  // `planDimensionToRow`. Without these the steady-state debounced
  // write (PlanDetailRoute ~line 833) persisted a geo dim WITHOUT its
  // territory grouping, so the very next API-wins hydration read it
  // back empty (cold-test M). `geo_territories` is deep-copied so the
  // request never aliases the UI row's frozen array.
  if (row.geo_granularity !== undefined) {
    req.geo_granularity = row.geo_granularity;
  }
  if (row.geo_scope !== undefined) {
    req.geo_scope = row.geo_scope;
  }
  if (row.geo_territories !== undefined) {
    req.geo_territories = row.geo_territories.map((t) => ({
      id: t.id,
      label: t.label,
      members: [...t.members],
    }));
  }
  // Brief 51 / ADR-0035 — symmetric inverse of `planDimensionToRow`.
  // Brief 60: without these the steady-state bulk replace-all wrote the
  // `class_code` dim WITHOUT its registry binding and every class-derived
  // structural dim WITHOUT its `derived_from`, so the next hydration read
  // them back bare and the derivation never wired.
  if (row.class_library_id !== undefined) {
    req.class_library_id = row.class_library_id;
  }
  if (row.derived_from !== undefined) {
    req.derived_from = {
      source_dim: row.derived_from.source_dim,
      attribute: row.derived_from.attribute,
      // Brief 83 — the declared-override field must survive the write
      // side too; rebuilding the object without it was exactly the
      // Brief-60 clobber, one field later.
      ...(row.derived_from.override_field != null
        ? { override_field: row.derived_from.override_field }
        : {}),
    };
  }
  // Brief 66 §3.2 — the last two round-trip gaps (migration 025).
  if (row.classification_mapping !== undefined) {
    req.classification_mapping = row.classification_mapping.map((r) => ({
      input_pattern: r.input_pattern,
      canonical_class_code: r.canonical_class_code,
      ...(r.notes !== undefined ? { notes: r.notes } : {}),
    }));
  }
  if (row.options !== undefined) {
    req.options = [...row.options];
  }
  if (
    row.monotonicity_expected !== undefined &&
    row.monotonicity_expected !== null
  ) {
    req.monotonicity_expected = row.monotonicity_expected;
  }
  return req as UpsertDimensionRequest;
}

/**
 * Bulk converter — for the localStorage → API one-shot migration path
 * (ADR-0027 §3) and the steady-state debounced write.
 */
export function dimensionRowsToBulkRequest(
  rows: readonly DimensionRow[],
): { dimensions: UpsertDimensionRequest[] } {
  return { dimensions: rows.map(dimensionRowToUpsertRequest) };
}
