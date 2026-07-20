/**
 * detectMismatches — Brief 38 PR 38.4 mismatch detection.
 *
 * Pure function. Walks the current column_map + sample rows +
 * dimensions to surface unmatched values that prevent scoring. Two
 * severity tiers (Brief 38 §8 lock):
 *
 *   - HARD (red, blocks full-batch scoring) — value not in dim levels,
 *     not in any alias, no close Levenshtein candidate (similarity
 *     to closest level < softThreshold). The "Score all N" button is
 *     disabled until the user resolves these.
 *
 *   - SOFT (yellow, suggested fix) — value not in levels but similar
 *     to one (similarity ≥ softThreshold). The banner auto-suggests
 *     the closest match; user clicks Apply / Reject / Edit.
 *
 * Three shapes the detector handles in v1:
 *
 *   - Categorical dims — string equality + alias resolution +
 *     alias_overrides + Levenshtein-based soft suggestions
 *   - Banded dims — numeric range membership check; suggestions list
 *     the nearest band (no Levenshtein on numbers)
 *   - Geographic / composite dims — skipped in v1 (territory + axis
 *     resolution is more complex; geographic mismatches are surfaced
 *     by Brief 20 in a separate flow)
 *
 * Pure data in / pure data out. No React, no DOM, no I/O. Composes
 * with the alias_overrides substrate from PR 38.1 (Brief 30 carry).
 *
 * Design references:
 *   - Brief 38 §8 (mismatch resolver)
 *   - Brief 38 §−1 Q4 lock (auto-suggest + user confirms)
 *   - Brief 30 (CategoricalLevel.aliases — runtime substrate)
 */

import type { Dimension } from "@openrater/contracts";
// ADR-0038 — the canonical geographic acceptance domain (the same set the
// factor grid keys on + the engine resolves), and inferDimensionShape so a
// geographic dim authored with shape:"categorical" is still treated as geo.
import {
  bandHi,
  bandLo,
  inferDimensionShape,
  geoAcceptanceSet,
  isGeographicLookupDim,
} from "@openrater/contracts";

import { levenshtein } from "./autoMatch";
import type { RequiredInputEntry } from "./ColumnMappingTable";
import { isRatioMapping } from "./ratioMapping";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** A single suggested replacement for a mismatched value. */
export interface MismatchSuggestion {
  /** Display label for the canonical level (e.g., "Frame"). */
  readonly label: string;
  /** Stable level id to write into `alias_overrides` (e.g., "frame"). */
  readonly canonicalLevelId: string;
  /** Normalized similarity 0..1 (1 = identical, 0 = disjoint). */
  readonly confidence: number;
}

/** One mismatched value with its row count + ranked suggestions. */
export interface MismatchedValue {
  /** The raw value as it appeared in the source (preserves casing). */
  readonly value: string;
  /** How many rows in the sample had this value. */
  readonly rowCount: number;
  /**
   * Up to N suggested canonical levels, sorted by confidence
   * descending. Empty array when no level scores above the soft
   * threshold. The banner picks the top entry as the auto-Apply
   * candidate.
   */
  readonly suggestions: readonly MismatchSuggestion[];
}

/**
 * One mismatch event — one (dim, column) pair with one or more
 * mismatched values. A single Mismatch corresponds to one banner
 * card in the UI.
 *
 * Severity is per-MISMATCH not per-value: a Mismatch is HARD when
 * *any* mismatched value has no suggestion above the soft threshold.
 * One bad value taints the whole banner.
 */
export interface Mismatch {
  /** Required input id (e.g., "construction"). */
  readonly inputId: string;
  /** Dim slug (e.g., "construction"). Stable id — for lookups/testids. */
  readonly dimSlug: string;
  /**
   * Dim display name (e.g., "Territory"). ADR-0038 — the banner binds to
   * THIS, not the slug, so a geographic dim whose slug froze to its
   * granularity ("zip") still reads "Territory" in the error. Falls back to
   * the slug when no display name is set.
   */
  readonly dimDisplayName: string;
  /** Source column name (e.g., "CONSTR"). */
  readonly columnName: string;
  /** Dim shape — drives the banner sub-template. */
  readonly dimShape: "categorical" | "banded" | "geographic";
  /** Severity: "hard" blocks scoring; "soft" warns. */
  readonly severity: "hard" | "soft";
  /** One entry per distinct mismatched value, ranked by rowCount desc. */
  readonly mismatchedValues: readonly MismatchedValue[];
}

/** Knobs for the detect pass. */
export interface DetectMismatchesOptions {
  /**
   * Max rows to inspect. Defaults to 100 (Brief 38 §8 lock). The
   * banner sample is statistical: 100 rows reliably surfaces
   * mismatches that affect >= 1% of the data.
   */
  readonly maxSampleRows?: number;
  /**
   * Similarity threshold for SOFT vs HARD severity. Values whose
   * closest dim-level Levenshtein similarity is ≥ this are SOFT
   * (auto-suggested); below it are HARD (blocked). Default 0.45
   * — empirically separates "wood" ↔ "frame" (0.43) from
   * "wooden frame" ↔ "frame" (0.55).
   */
  readonly softThreshold?: number;
  /**
   * Cap on suggestions per mismatched value. Default 3 — enough for
   * the user to pick if Apply is wrong; not overwhelming.
   */
  readonly maxSuggestions?: number;
}

const DEFAULT_OPTIONS: Required<DetectMismatchesOptions> = {
  maxSampleRows: 100,
  softThreshold: 0.45,
  maxSuggestions: 3,
};

// Alias override shape — mirrors Plan.input_mapping.alias_overrides
// (PR 38.1). Outer key: dim_slug. Inner key: mismatched value.
// Inner value: canonical level id.
export type AliasOverrides = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Normalize a string for level lookup. Matches the convention used
 * by autoMatch.valueMatchFraction (Brief 38 PR 38.2).
 */
function normalize(s: unknown): string {
  if (s == null) return "";
  return String(s).toLowerCase().trim();
}

/**
 * Build a Map<normalized-value, canonical-level-id> for a categorical
 * dim. Includes:
 *   - Every level's id
 *   - Every level's label
 *   - Every level's alias
 *   - Every alias_overrides entry for this dim's slug
 */
function buildCategoricalLookup(
  dim: Dimension,
  aliasOverridesForDim: Readonly<Record<string, string>> | undefined,
): Map<string, { canonicalLevelId: string; label: string }> {
  const out = new Map<
    string,
    { canonicalLevelId: string; label: string }
  >();
  for (const level of dim.levels ?? []) {
    if (level.kind !== "categorical") continue;
    out.set(normalize(level.id), {
      canonicalLevelId: level.id,
      label: level.label,
    });
    out.set(normalize(level.label), {
      canonicalLevelId: level.id,
      label: level.label,
    });
    // PR 11i-fix — Brief 30 lock says CategoricalLevel.aliases is a
    // required array, but the route's DimensionRow shape passes
    // through `levels` lenient — a dim authored before the aliases
    // field landed (or a user-created dim with no aliases yet)
    // arrives with `aliases: undefined`. Default to [] so the
    // detectMismatches walk doesn't crash. Same guard in
    // findClosestCategoricalLevels below.
    for (const alias of level.aliases ?? []) {
      out.set(normalize(alias), {
        canonicalLevelId: level.id,
        label: level.label,
      });
    }
  }
  // alias_overrides win over dim aliases for the same key — the
  // user's per-plan choice takes precedence (Brief 38 §−1 Q4).
  if (aliasOverridesForDim) {
    for (const [mismatchedValue, canonicalLevelId] of Object.entries(
      aliasOverridesForDim,
    )) {
      const level = (dim.levels ?? []).find(
        (l) => l.id === canonicalLevelId && l.kind === "categorical",
      );
      if (level && level.kind === "categorical") {
        out.set(normalize(mismatchedValue), {
          canonicalLevelId: level.id,
          label: level.label,
        });
      }
    }
  }
  return out;
}

/**
 * Compute the normalized-Levenshtein similarity between two strings.
 * Re-uses the algorithm from autoMatch.levenshtein (PR 38.2) so the
 * scoring is consistent across the workspace.
 */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const max = Math.max(na.length, nb.length);
  if (max === 0) return 1;
  return 1 - levenshtein(na, nb) / max;
}

/**
 * Rank candidate level matches for a mismatched value. Returns up to
 * `maxSuggestions` levels sorted by similarity descending.
 */
function suggestionsForMismatch(
  value: string,
  dim: Dimension,
  maxSuggestions: number,
): readonly MismatchSuggestion[] {
  const scored: { label: string; canonicalLevelId: string; confidence: number }[] = [];
  for (const level of dim.levels ?? []) {
    if (level.kind !== "categorical") continue;
    // Score against the level's label (the human-facing form).
    let best = similarity(value, level.label);
    // Also try the id + every alias; keep the max.
    const trySim = similarity(value, level.id);
    if (trySim > best) best = trySim;
    // PR 11i-fix — see buildCategoricalLookup above for the same
    // guard. aliases may be undefined on dims authored without it.
    for (const alias of level.aliases ?? []) {
      const s = similarity(value, alias);
      if (s > best) best = s;
    }
    scored.push({
      label: level.label,
      canonicalLevelId: level.id,
      confidence: best,
    });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, maxSuggestions);
}

/**
 * For a banded dim, check whether a numeric value falls into ANY
 * band's [lo, hi). Returns the matched level id or null. Non-numeric
 * values always return null (banded mismatch).
 */
function findBand(
  value: unknown,
  dim: Dimension,
): { canonicalLevelId: string; label: string } | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  for (const level of dim.levels ?? []) {
    if (level.kind !== "banded") continue;
    // E5 — null bounds are JSON-safe open ends (±∞).
    if (n >= bandLo(level) && n < bandHi(level)) {
      return { canonicalLevelId: level.id, label: level.label };
    }
  }
  return null;
}

/** Nearest band suggestion for an out-of-range banded value. */
function nearestBandSuggestion(
  value: number,
  dim: Dimension,
): MismatchSuggestion | null {
  let best: { label: string; id: string; distance: number } | null = null;
  for (const level of dim.levels ?? []) {
    if (level.kind !== "banded") continue;
    // E5 — null bounds are open ends: distance to an open side is
    // -Infinity…value (never "before" it), so it can't win nearest
    // unless the value is genuinely inside (findBand handles that).
    const lo = bandLo(level);
    const d = value < lo ? lo - value : value - bandHi(level);
    if (best === null || d < best.distance) {
      best = { label: level.label, id: level.id, distance: d };
    }
  }
  if (!best) return null;
  // Confidence inversely proportional to distance, normalized
  // crudely. The banner shows the suggestion as informational; the
  // user still has to confirm via a different flow than alias.
  const confidence = 1 / (1 + best.distance);
  return {
    label: best.label,
    canonicalLevelId: best.id,
    confidence,
  };
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Detect mismatches across every mapped (input, column) pair.
 *
 * @param requiredInputs Inputs with dim refs to inspect.
 * @param columnMap Current mapping (input.id → source column name).
 * @param sampleRows Source rows to walk (capped by `maxSampleRows`).
 * @param dimensions Dim catalogue (used to look up levels + shapes).
 * @param aliasOverrides Optional plan-level alias overrides.
 * @param options Knobs.
 *
 * @returns One Mismatch entry per (input, column) pair that has at
 *          least one unmatched value. Empty array when everything
 *          aligns. The order matches the order of `requiredInputs`.
 */
export function detectMismatches(
  requiredInputs: readonly RequiredInputEntry[],
  columnMap: Readonly<Record<string, string>>,
  sampleRows: readonly Record<string, unknown>[],
  dimensions: readonly Dimension[],
  aliasOverrides?: AliasOverrides,
  options: DetectMismatchesOptions = {},
): readonly Mismatch[] {
  const opts: Required<DetectMismatchesOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const rows = sampleRows.slice(0, opts.maxSampleRows);
  const dimsBySlug = new Map<string, Dimension>();
  for (const d of dimensions) dimsBySlug.set(d.slug, d);

  const out: Mismatch[] = [];

  for (const input of requiredInputs) {
    if (!input.dimSlug) continue;
    const columnName = columnMap[input.id];
    if (!columnName) continue;

    // Derived-ratio mappings (Brief 45 K8) are a user assertion, not a
    // literal CSV column — there is no `row["@ratio:…"]` to inspect.
    // Skip mismatch detection; the ratio resolves to a number that the
    // engine's `derive.band` bins at runtime.
    if (isRatioMapping(columnName)) continue;

    const dim = dimsBySlug.get(input.dimSlug);
    if (!dim) continue;

    // ADR-0038 — a geographic dim is detected by isGeographicLookupDim
    // (dimension_type OR shape === "geographic"), NOT inferDimensionShape: a
    // dim authored with shape:"categorical" but dimension_type:"geographic"
    // (the live-bug shape) reads back as "categorical" through
    // inferDimensionShape and would be mis-routed to the categorical branch
    // against its (often empty) levels — that misroute was the F3 "not in the
    // dim's levels — Score blocked" failure. Composite stays out of v1 scope.
    const isGeo = isGeographicLookupDim(dim);
    const shape = inferDimensionShape(dim);
    if (!isGeo && shape === "composite") continue;

    // Count mismatched values + their row counts.
    const counter = new Map<string, number>();

    if (isGeo) {
      // ADR-0038 — accept any value the engine can resolve to a key: a level
      // id (ZIP/state, grouped or not) OR an active territory id. Built from
      // geoAcceptanceSet, the same canonical domain the factor grid keys on
      // and derive.territory resolves, so the grid, the validator, and the
      // engine can never disagree (the F3 root cause). A policy CSV that
      // carries `territory` (t1/t2) OR a raw ZIP both validate.
      const accept = geoAcceptanceSet(dim);
      for (const row of rows) {
        const raw = row[columnName];
        if (raw == null || raw === "") continue;
        const key = String(raw);
        if (!accept.has(normalize(key))) {
          counter.set(key, (counter.get(key) ?? 0) + 1);
        }
      }
    } else if (shape === "banded") {
      // Banded: every value must fit in some [lo, hi). A value the
      // user has explicitly mapped via alias_overrides (e.g.
      // "16294238" → "07_1m_5m") counts as resolved. Without this the
      // banded branch ignored overrides entirely, so clicking "Apply"
      // on a banded mismatch never cleared it — the count stayed put
      // and scoring stayed blocked forever (K7).
      const overridesForDim = aliasOverrides?.[input.dimSlug];
      for (const row of rows) {
        const v = row[columnName];
        if (v == null || v === "") continue;
        if (overridesForDim && overridesForDim[String(v)] !== undefined) {
          continue;
        }
        if (findBand(v, dim) === null) {
          const key = String(v);
          counter.set(key, (counter.get(key) ?? 0) + 1);
        }
      }
    } else {
      // Categorical (default): every value must hit the lookup.
      const lookup = buildCategoricalLookup(
        dim,
        aliasOverrides?.[input.dimSlug],
      );
      for (const row of rows) {
        const raw = row[columnName];
        if (raw == null || raw === "") continue;
        const key = String(raw);
        if (!lookup.has(normalize(key))) {
          counter.set(key, (counter.get(key) ?? 0) + 1);
        }
      }
    }

    if (counter.size === 0) continue;

    // Build mismatchedValues with suggestions; track per-value
    // severity to determine the overall mismatch severity.
    const mismatchedValues: MismatchedValue[] = [];
    let anyHard = false;

    for (const [value, rowCount] of counter.entries()) {
      let suggestions: readonly MismatchSuggestion[] = [];
      if (shape === "banded") {
        const n = Number(value);
        const s =
          Number.isFinite(n) ? nearestBandSuggestion(n, dim) : null;
        suggestions = s ? [s] : [];
      } else if (isGeo) {
        // No fuzzy alias for geo — a value that resolves to no key (a ZIP
        // outside scope, a garbage code) isn't fixable by aliasing it to a
        // territory. It simply scores at the default (handled below).
        suggestions = [];
      } else {
        suggestions = suggestionsForMismatch(value, dim, opts.maxSuggestions);
      }
      const top = suggestions[0];
      // Severity:
      //   - Categorical: HARD when no suggestion clears softThreshold.
      //   - Banded: HARD only when the value is NON-NUMERIC (a real
      //     type error in a numeric column). An out-of-RANGE numeric
      //     (e.g. revenue above the top band) is a legitimate data
      //     condition — per the rating spec, out-of-range "refers" —
      //     so it is SOFT and must NOT hard-block the batch (K7). A
      //     continuous dim can't enumerate every out-of-range value as
      //     a fixable alias; blocking on them froze a 2,000-row score
      //     on 93 large-revenue accounts.
      const isHard =
        shape === "banded"
          ? !Number.isFinite(Number(value))
          : isGeo
            ? // ADR-0028 — an unmapped geographic value surfaces a diagnostic
              // and scores at the lookup's 1.0 default; it never hard-blocks
              // the batch (same "surface, don't silently 1.0" posture as the
              // banded out-of-range K7 fix — a geo dim can't enumerate every
              // bad ZIP as a fixable alias).
              false
            : !top || top.confidence < opts.softThreshold;
      if (isHard) anyHard = true;
      mismatchedValues.push({ value, rowCount, suggestions });
    }

    // Sort mismatched values by rowCount desc — surface the most
    // impactful first.
    mismatchedValues.sort((a, b) => b.rowCount - a.rowCount);

    out.push({
      inputId: input.id,
      dimSlug: input.dimSlug,
      dimDisplayName: dim.display_name || input.dimSlug,
      columnName,
      dimShape:
        shape === "banded"
          ? "banded"
          : isGeo
            ? "geographic"
            : "categorical",
      severity: anyHard ? "hard" : "soft",
      mismatchedValues,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// Alias write-back helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Immutably write an alias override for a mismatched value.
 *
 * Used by the MismatchBanner's Apply action: when the user accepts
 * a suggestion, the orchestrator calls this to compute the updated
 * `alias_overrides` and patches `Plan.input_mapping.alias_overrides`
 * (Brief 38 PR 38.1 substrate).
 *
 * Optionally, the orchestrator ALSO appends the mismatched value to
 * the dim's `levels[].aliases[]` so other plans on the same dim
 * library benefit. That second write happens against the dim
 * substrate (not the mapping); the helper for that is
 * `appendDimAlias` below.
 */
export function applyAliasOverride(
  current: AliasOverrides,
  dimSlug: string,
  mismatchedValue: string,
  canonicalLevelId: string,
): AliasOverrides {
  const next: Record<string, Readonly<Record<string, string>>> = {
    ...current,
  };
  const existingForDim = current[dimSlug] ?? {};
  next[dimSlug] = { ...existingForDim, [mismatchedValue]: canonicalLevelId };
  return next;
}

/**
 * Remove an alias override. Used by Reject + Edit flows + by the
 * UndoChip when the user undoes an Apply.
 */
export function removeAliasOverride(
  current: AliasOverrides,
  dimSlug: string,
  mismatchedValue: string,
): AliasOverrides {
  if (!current[dimSlug] || !(mismatchedValue in current[dimSlug])) {
    return current;
  }
  const next: Record<string, Readonly<Record<string, string>>> = {
    ...current,
  };
  const nextDim = { ...current[dimSlug] };
  delete nextDim[mismatchedValue];
  // Drop the dim entry entirely when no overrides remain.
  if (Object.keys(nextDim).length === 0) {
    delete next[dimSlug];
  } else {
    next[dimSlug] = nextDim;
  }
  return next;
}

/**
 * Compute a Dimension patch that appends a new alias to the named
 * level's `aliases[]`. Pure function — the orchestrator applies this
 * to its dim collection. Returns the SAME dim reference if the alias
 * is already present (so React `===` checks remain stable).
 */
export function appendDimAlias(
  dim: Dimension,
  levelId: string,
  alias: string,
): Dimension {
  if (!dim.levels) return dim;
  const targetLevel = dim.levels.find((l) => l.id === levelId);
  if (!targetLevel || targetLevel.kind !== "categorical") return dim;
  const lcAlias = alias.toLowerCase().trim();
  // Already present (case-insensitive)? Return unchanged.
  if (
    targetLevel.aliases.some(
      (a) => a.toLowerCase().trim() === lcAlias,
    ) ||
    targetLevel.id.toLowerCase() === lcAlias ||
    targetLevel.label.toLowerCase() === lcAlias
  ) {
    return dim;
  }
  const nextLevels = dim.levels.map((l) => {
    if (l.id !== levelId) return l;
    if (l.kind !== "categorical") return l;
    return { ...l, aliases: [...l.aliases, alias] };
  });
  return { ...dim, levels: nextLevels };
}

// ─────────────────────────────────────────────────────────────────
// Convenience predicate
// ─────────────────────────────────────────────────────────────────

/**
 * `true` when any mismatch in the list is severity "hard". The
 * orchestrator consults this to decide whether to disable the
 * "Score all N rows" button (Brief 38 §8 aggregate gate).
 */
export function hasHardMismatch(mismatches: readonly Mismatch[]): boolean {
  return mismatches.some((m) => m.severity === "hard");
}

/**
 * Project the mismatches list down to a Set of input.ids — the shape
 * `<ColumnMappingTable>` expects for its `mismatchedInputs` prop.
 */
export function mismatchedInputIds(
  mismatches: readonly Mismatch[],
): ReadonlySet<string> {
  return new Set(mismatches.map((m) => m.inputId));
}
