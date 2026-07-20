/**
 * autoMatchColumns — Brief 38 PR 38.2 auto-recognition algorithm.
 *
 * Pure function. Given a plan's required inputs + a source's columns +
 * (optional) sample rows + (optional) dimensions for value-matching,
 * returns a confidence-scored ranking of source-column candidates for
 * every required input.
 *
 * Algorithm per Brief 38 §7:
 *
 *   1. NAME MATCH (weight 0.6) — Levenshtein-similarity between the
 *      normalized required-input name (slug + display_name + dim
 *      aliases) and the normalized source-column name. Token-aware
 *      with substring containment bonuses; exact-match scores 1.0.
 *
 *   2. VALUE MATCH (weight 0.4) — when the input is a dimension ref
 *      AND sample rows are available, sample up to 20 rows of each
 *      candidate column. For each row's value (lowercased + alias-
 *      resolved), count whether it matches a known dim level. Score
 *      = match fraction. Falls back to name-only when no values are
 *      available.
 *
 *   3. COMBINED CONFIDENCE = 0.6 × name + 0.4 × value (or 1.0 × name
 *      when no value-match is possible). Buckets:
 *        ≥ 0.8 → "auto"      (auto-apply, green)
 *        ≥ 0.4 → "suggested" (yellow, user confirms)
 *        < 0.4 → "empty"     (gray; not surfaced as a suggestion)
 *
 * Pure data in / pure data out — no React, no DOM, no I/O. 100%
 * testable. The UI layer in PR 38.3 will consume this module's
 * output via the `<ColumnMappingTable>` primitive.
 *
 * Design references:
 *   - Brief 38 §7 (auto-recognition algorithm)
 *   - Brief 38 §−1 Q5 lock (name + value match with confidence)
 *   - Brief 30 (CategoricalLevel.aliases substrate)
 */

import type { Dimension } from "@openrater/contracts";
// The identifier-matching core lives in contracts so
// the chat door's header pre-flight judges names with the SAME
// algorithm. Re-exported below; consumer imports are unchanged.
import {
  levenshtein,
  nameSimilarity,
  normalizeIdent,
  tokenize,
} from "@openrater/contracts";

export { levenshtein, nameSimilarity, normalizeIdent, tokenize };

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** Normalized dtype hint used by both required inputs + source columns. */
export type MatchDtype = "number" | "string" | "boolean" | "date";

/**
 * A required input the plan needs satisfied. The UI derives this list
 * by walking the plan's input nodes + factor key dimensions + model
 * inputs + rating-dim split values (Brief 38 §4.2).
 */
export interface RequiredInput {
  /** Stable id (e.g., "class_code", "model:discr_credit:building_age"). */
  readonly id: string;
  /**
   * Display + matching name. The auto-match runs against this string
   * (lowercased + normalized) for the name-score component.
   */
  readonly name: string;
  /** Optional human-readable secondary label (e.g., "Class code"). */
  readonly displayName?: string;
  /**
   * Hint for dtype-compatible filtering. When set, source columns of
   * a different dtype get a name-score penalty (so e.g. "TIV_USD" is
   * not auto-matched to a string-typed input).
   */
  readonly dtype?: MatchDtype;
  /**
   * If the input is a dimension reference, the dim's slug. Enables
   * value-match against the dim's levels via `dimensions`.
   */
  readonly dimSlug?: string;
}

/**
 * One column in the source data. The UI derives this from a parsed
 * CSV header row or an inferred webhook payload schema.
 */
export interface SourceColumn {
  /** Header name as it appears in the source. */
  readonly name: string;
  /** Optional dtype hint; inferred from sample values when available. */
  readonly dtype?: MatchDtype;
}

/**
 * Per-input scored candidate. The UI uses `bucket` to drive visual
 * styling (auto / suggested / empty); `confidence` is the primary
 * sort key.
 */
export interface MatchCandidate {
  /** The source column under consideration. */
  readonly columnName: string;
  /** Combined 0..1 confidence — the headline number shown in UI. */
  readonly confidence: number;
  /** Component score: how well the names compare (0..1). */
  readonly nameScore: number;
  /** Component score: how well sample values match the dim (0..1, when available). */
  readonly valueScore?: number;
  /** Confidence bucket — drives chip color in the mapping table. */
  readonly bucket: "auto" | "suggested" | "empty";
}

/**
 * Optional knobs for the auto-match algorithm. v1 ships sensible
 * defaults; consumers can override for testing or for unusual
 * domains.
 */
export interface AutoMatchOptions {
  /**
   * Confidence threshold above which a candidate auto-applies.
   * Default 0.8 (Brief 38 §7 lock).
   */
  readonly autoThreshold?: number;
  /**
   * Confidence threshold above which a candidate is a yellow
   * suggestion (and below which it's filtered out of the result).
   * Default 0.4 (Brief 38 §7 lock).
   */
  readonly suggestThreshold?: number;
  /**
   * Weight of the name-match score in the combined confidence.
   * Default 0.6 (Brief 38 §7 lock). The value-match weight is
   * 1 - nameWeight.
   */
  readonly nameWeight?: number;
  /**
   * Max sample rows to inspect for value-match. Default 20
   * (Brief 38 §7 lock). Larger samples improve accuracy but cost
   * time on huge CSVs; 20 hits a sweet spot.
   */
  readonly maxSampleRows?: number;
  /**
   * Penalty applied to the name-match when source + required dtypes
   * mismatch. Default 0.5 (halves the name score). Set to 1.0 to
   * disable.
   */
  readonly dtypeMismatchPenalty?: number;
}

const DEFAULT_OPTIONS: Required<AutoMatchOptions> = {
  autoThreshold: 0.8,
  suggestThreshold: 0.4,
  nameWeight: 0.6,
  maxSampleRows: 20,
  dtypeMismatchPenalty: 0.5,
};

// ─────────────────────────────────────────────────────────────────
// Internal helpers — value matching against dim levels
// ─────────────────────────────────────────────────────────────────

/**
 * Build a fast lookup set of all canonical level identifiers AND
 * their aliases for a dimension. Used by `valueMatchFraction` to
 * decide whether a sampled value "belongs" to the dim's vocabulary.
 *
 * Keys are normalized (lowercased + trimmed). The returned set
 * includes:
 *   - Every level's id
 *   - Every level's label (categorical only)
 *   - Every level's aliases[] (categorical only)
 *
 * For banded dims (numeric ranges), value-match cannot use string
 * equality. The caller short-circuits banded dims to no-value-match.
 */
function buildLevelLookup(dim: Dimension): Set<string> {
  const out = new Set<string>();
  const levels = dim.levels ?? [];
  for (const level of levels) {
    out.add(normalizeForValueMatch(level.id));
    if ("label" in level && level.label) {
      out.add(normalizeForValueMatch(level.label));
    }
    if ("aliases" in level && level.aliases) {
      for (const alias of level.aliases) {
        out.add(normalizeForValueMatch(alias));
      }
    }
  }
  return out;
}

/**
 * Normalize a value for matching against a dim level. Lowercase +
 * trim; preserves non-alpha (so "92-103" stays distinguishable from
 * "92.103"). Different from the identifier normalization which
 * strips separators.
 */
function normalizeForValueMatch(value: unknown): string {
  if (value == null) return "";
  return String(value).toLowerCase().trim();
}

/**
 * For a given source column + dimension, count how many of the
 * sampled rows have a value that resolves to one of the dim's known
 * level identifiers (id / label / alias). Returns the match fraction
 * in [0, 1], or `null` when no sample rows or the dim is banded /
 * geographic (where string-equality doesn't apply).
 */
function valueMatchFraction(
  dim: Dimension,
  columnName: string,
  sampleRows: readonly Record<string, unknown>[],
  maxSamples: number,
): number | null {
  // Banded dims compare values to numeric ranges, not strings. We
  // could implement banded value-match (does the number fall inside
  // ANY of the dim's bands?) but skip in v1; name-match alone
  // already differentiates banded from categorical columns well.
  const shape = (dim as { shape?: string }).shape;
  if (shape === "banded" || shape === "geographic" || shape === "composite") {
    return null;
  }
  if (sampleRows.length === 0) return null;
  const lookup = buildLevelLookup(dim);
  if (lookup.size === 0) return null;
  const rows = sampleRows.slice(0, maxSamples);
  let matches = 0;
  let nonEmptyRows = 0;
  for (const row of rows) {
    const v = row[columnName];
    if (v == null || v === "") continue;
    nonEmptyRows++;
    const key = normalizeForValueMatch(v);
    if (lookup.has(key)) matches++;
  }
  if (nonEmptyRows === 0) return null;
  return matches / nonEmptyRows;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Bucket a confidence score into the three Brief 38 §7 buckets:
 *
 *   - `confidence >= autoThreshold`     → "auto"      (green)
 *   - `confidence >= suggestThreshold`  → "suggested" (yellow)
 *   - otherwise                          → "empty"    (gray)
 *
 * Exported for consumers who want to re-bucket a stored confidence
 * (e.g., when rendering a saved mapping).
 */
export function bucketConfidence(
  confidence: number,
  options: AutoMatchOptions = {},
): MatchCandidate["bucket"] {
  const auto = options.autoThreshold ?? DEFAULT_OPTIONS.autoThreshold;
  const suggest = options.suggestThreshold ?? DEFAULT_OPTIONS.suggestThreshold;
  if (confidence >= auto) return "auto";
  if (confidence >= suggest) return "suggested";
  return "empty";
}

/**
 * Score one (input, column) pair. Returns the full breakdown so the
 * caller can inspect the components in addition to the headline
 * confidence. Pure function; safe to memoize.
 */
export function scoreCandidate(
  input: RequiredInput,
  column: SourceColumn,
  sampleRows: readonly Record<string, unknown>[],
  dimensions: readonly Dimension[],
  options: AutoMatchOptions = {},
): MatchCandidate {
  const opts: Required<AutoMatchOptions> = { ...DEFAULT_OPTIONS, ...options };

  // ── Name score — try a few name forms for the input and take the best.
  //
  // `input.id` is the canonical runtime field name — the exact string a
  // CSV column maps TO. For banded dims it's the raw source field (the
  // chain reads `form_input.revenue` → id "revenue") while `input.name`
  // is the dim's DISPLAY label ("Revenue band"). A CSV column called
  // "revenue" normalize-equals the id (→ 1.0, auto-apply) but only
  // partially matches the display label ("revenue" vs "revenue band" →
  // below the 0.8 auto threshold → stuck on "suggested"/"empty"). Trying
  // the id first is what lets revenue/payroll/stress/occupancy banded
  // factors auto-bind instead of silently defaulting to 1.0. Categorical
  // dims are unaffected — their id, slug, and display label all already
  // normalize to the same token set.
  //
  // We take the MAX similarity across every form (loop below), so adding
  // the id can only raise a score, never lower one.
  const inputNames = [input.id, input.name];
  if (input.displayName && input.displayName !== input.name) {
    inputNames.push(input.displayName);
  }
  // If this input references a dim, also use the dim's display_name +
  // slug as candidate name strings (a column called "CONSTR" matches
  // "construction" dim even when the required-input id is something
  // namespace-prefixed like "submission.construction").
  if (input.dimSlug) {
    const dim = dimensions.find((d) => d.slug === input.dimSlug);
    if (dim) {
      inputNames.push(dim.slug);
      if (dim.display_name) inputNames.push(dim.display_name);
    }
  }
  let nameScore = 0;
  for (const candidate of inputNames) {
    const sim = nameSimilarity(candidate, column.name);
    if (sim > nameScore) nameScore = sim;
  }

  // Dtype-mismatch penalty applied to name score.
  //
  // PR 11f-bis — when the required input is a DIM REF
  // (`input.dimSlug` set), the input.dtype is just a UI hint
  // (categorical = string, banded = number) and the column.dtype
  // is whatever parseCsv inferred from the sampled values. Those
  // two can legitimately disagree: a categorical "class_code" dim
  // has string-keyed levels like "612110" or "722410" — values
  // that parseCsv reads as numbers. Penalizing this case is a
  // false positive that knocks a perfect-name-match score from
  // 1.0 down to 0.5 → "suggested" instead of "auto", and the
  // user has to manually re-pick the obvious mapping.
  //
  // Skip the penalty entirely when the input is a dim ref. The
  // value-match path below (`valueMatchFraction`) is the canonical
  // way to detect dim mismatches — it compares actual values to
  // the dim's known levels + aliases, which is far more accurate
  // than a dtype heuristic.
  if (
    !input.dimSlug &&
    input.dtype &&
    column.dtype &&
    input.dtype !== column.dtype &&
    // Don't penalize date↔string (dates are commonly stored as strings).
    !(input.dtype === "date" && column.dtype === "string") &&
    !(input.dtype === "string" && column.dtype === "date")
  ) {
    nameScore *= opts.dtypeMismatchPenalty;
  }

  // ── Value score — only when input has a dim ref + we have a matching dim.
  let valueScore: number | undefined;
  if (input.dimSlug) {
    const dim = dimensions.find((d) => d.slug === input.dimSlug);
    if (dim) {
      const frac = valueMatchFraction(
        dim,
        column.name,
        sampleRows,
        opts.maxSampleRows,
      );
      if (frac !== null) valueScore = frac;
    }
  }

  // ── Combined confidence.
  //
  // PR 11f-ter — when nameScore is a PERFECT match (1.0, meaning the
  // normalize-equal short-circuit fired in nameSimilarity), use it
  // as a floor regardless of value-match. The pathological case is
  // a dim ref where the dim catalog hasn't been populated with all
  // its levels yet (user is mid-authoring) — valueMatchFraction
  // returns 0 because the CSV's actual values don't overlap with the
  // dim's empty/partial level list. Without the floor, a clean
  // column-name-equals-input-name match drops from 1.0 → 0.6 → the
  // "suggested" bucket, and the user has to manually re-pick what
  // the algorithm should have nailed.
  //
  // The floor only fires on EXACT name matches (nameScore === 1.0).
  // For imperfect-name + perfect-value cases the blend still applies.
  let confidence: number;
  if (valueScore !== undefined) {
    const blended =
      opts.nameWeight * nameScore + (1 - opts.nameWeight) * valueScore;
    confidence = nameScore === 1.0 ? Math.max(nameScore, blended) : blended;
  } else {
    confidence = nameScore;
  }

  // ── PR D3.4 (Phase D auto-binning) — banded-dim raw-column bonus ──
  //
  // When the bound dim is banded AND the column is numeric AND the
  // column name matches the dim's "raw" name (slug minus `_band`
  // suffix, e.g., `revenue` ↔ `revenue_band`), pin confidence to 1.0.
  //
  // The runtime (per ADR-0026 + PR D3.3) auto-bins the raw value
  // through derive.band — the actuary shouldn't have to manually
  // confirm what the auto-matcher should obviously nail. Without
  // this bonus, `revenue` → `revenue_band` scores ~0.85 (substring
  // match) and lands in the "suggested" bucket, requiring a click
  // to accept on every banded column in the plan.
  //
  // The bonus only fires when:
  //   - the input is a dim ref (input.dimSlug set)
  //   - the bound dim has shape: "banded"
  //   - the column dtype is "number"
  //   - the column name normalize-equals the dim's raw name
  //     (dim slug with `_band` / `_bucket` / `_bin` suffix stripped)
  if (input.dimSlug) {
    const dim = dimensions.find((d) => d.slug === input.dimSlug);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dimShape = (dim as any)?.shape;
    if (dimShape === "banded" && column.dtype === "number") {
      const rawName = input.dimSlug.replace(/_(band|bucket|bin)$/i, "");
      if (rawName && rawName !== input.dimSlug) {
        const rawSim = nameSimilarity(rawName, column.name);
        if (rawSim === 1.0) {
          confidence = 1.0;
        } else if (rawSim > nameScore) {
          // Imperfect raw-name match still beats the slug match — take
          // the better of the two so `total_revenue` → `revenue_band`
          // still scores well even though it's not a slug-strip equal.
          confidence = Math.max(confidence, rawSim);
        }
      }
    }
  }

  const bucket = bucketConfidence(confidence, opts);

  return valueScore === undefined
    ? { columnName: column.name, confidence, nameScore, bucket }
    : { columnName: column.name, confidence, nameScore, valueScore, bucket };
}

/**
 * Run auto-recognition against the full input × column matrix.
 *
 * For each required input, returns the list of candidate columns
 * sorted by confidence descending. Candidates with `bucket === "empty"`
 * are FILTERED OUT (they would be visual noise in the mapping table).
 * If no column scores above the suggest threshold, the input maps to
 * an empty array — the UI surfaces this as "pick a column" with no
 * auto-suggestion.
 *
 * The first-come-first-served / multi-claim resolution mentioned in
 * Brief 38 §7 is INTENTIONALLY not enforced here — this function
 * returns ALL candidates. A higher-level coordinator (in PR 38.3 +
 * `applyAutoMatchToMapping`) handles the "same column matched to
 * two inputs" surfacing.
 *
 * Performance: O(I × C × max(L_name, R_sample)) where I = required
 * inputs, C = source columns, L_name = name length, R_sample = sample
 * row count. For typical inputs (20 × 14 × 100) this runs in single-
 * digit ms.
 *
 * @returns `Record<input.id, MatchCandidate[]>` — keys are stable
 *          per-input ids; values are sorted descending by confidence.
 */
export function autoMatchColumns(
  requiredInputs: readonly RequiredInput[],
  sourceColumns: readonly SourceColumn[],
  sampleRows: readonly Record<string, unknown>[],
  dimensions: readonly Dimension[],
  options: AutoMatchOptions = {},
): Record<string, readonly MatchCandidate[]> {
  const out: Record<string, MatchCandidate[]> = {};
  for (const input of requiredInputs) {
    const candidates: MatchCandidate[] = [];
    for (const column of sourceColumns) {
      const c = scoreCandidate(
        input,
        column,
        sampleRows,
        dimensions,
        options,
      );
      if (c.bucket !== "empty") candidates.push(c);
    }
    // Sort descending by confidence; ties broken by name-score, then
    // by alphabetical column name (deterministic).
    candidates.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.nameScore !== a.nameScore) return b.nameScore - a.nameScore;
      return a.columnName.localeCompare(b.columnName);
    });
    out[input.id] = candidates;
  }
  return out;
}
