/**
 * `derive.band` kind — bin a number into a banded dim's level id.
 *
 * The bridge between raw numeric inputs (e.g., `revenue = 45000`)
 * and the banded dim level ids (e.g., `02_25k_50k`) that
 * `lookup.direct` factor tables key on.
 *
 * Per ADR-0026 — band edges live ONLY on the dim's BandedLevel[] (single
 * source of truth). This kind takes a snapshot of the dim's levels at
 * projection time + uses the existing `resolveBandedLevel` substrate
 * helper to do the lookup. Same `[lo, hi)` half-open semantics that
 * `resolveCompositeLevel` uses for banded axes — one engine path, one
 * way to think about banded behavior.
 *
 * Per node-design-principle P-N1 (pure execute): no side effects, no
 * I/O, no state. Same `(value, levels)` → same `level_id` forever.
 *
 * Per P-N4 + P-N5: the trace records the resolved level id + label;
 * `explainStep` renders a citation-friendly line:
 *
 *   "revenue_band = 45000 → 02_25k_50k ($25K–$50K)"
 *
 * Per the Phase D "visible data flow" principle (P-N11 — proposed):
 * binning is its own visible runtime step. The auditor sees raw value
 * → band → factor as three traceable lines, not one collapsed lookup.
 */

import type { BlockKind, PortSpec } from "../block-types";
import {
  type BandedLevel,
  bandHi,
  bandLo,
  resolveBandedLevel,
  validateBandedLevels,
} from "../dimension-types";

export interface DeriveBandParams {
  /**
   * The banded dim's slug. Audit-facing — appears in the trace as
   * "<dimSlug> = <value> → <level_id> (<label>)". Doesn't affect
   * lookup behavior; supply the empty string if you don't have a
   * slug at projection time (the explain just reads "value =" then).
   */
  readonly dimSlug: string;
  /**
   * Snapshot of the dim's banded levels. Per ADR-0026 the projector
   * copies these from `dim.levels` at compile time so the runtime
   * doesn't need to look the dim up. Edits to the dim require a
   * re-projection, which is the same contract as `lookup.direct`'s
   * embedded `table`.
   */
  readonly levels: readonly BandedLevel[];
  /**
   * Optional fallback level id when the value is NaN / out-of-range
   * / Infinity. When unset, those cases return the empty string —
   * which then propagates to `lookup.direct` and falls back to its
   * `defaultValue`. Useful for plans that carry an explicit
   * "unknown" or "refer" band (the IRS-990 payroll dim does this
   * with `99_unknown`).
   */
  readonly outOfRangeLevelId?: string;
  /**
   * Cold-test L22 — clamp finite values that fall past the tails of
   * the band set onto the nearest band instead of returning the
   * out-of-range fallback (which then silently resolves to
   * `lookup.direct`'s default 1.0, under-pricing the risk).
   *
   * When `true`:
   *   • value below the lowest band's `lo`  → clamp to the FIRST band
   *   • value at/above the highest band's `hi` → clamp to the LAST band
   *
   * A single `outOfRangeLevelId` can't express this — it's one id for
   * both tails, and clamping needs *direction*. So clamping is its own
   * flag. NaN / non-finite values are NOT clamped (no nearest band is
   * meaningful) — they still take `outOfRangeLevelId ?? ""`. A finite
   * value that lands in a GAP between two non-contiguous bands is also
   * not clamped (genuinely ambiguous) — it takes the fallback too.
   *
   * Regardless of this flag, the `out_of_range` output reports whether
   * the raw value fell outside every band, so a score-time surface can
   * loudly count clamped/unmatched rows (no more silent 1.0).
   *
   * Defaults to `false` — pre-L22 plans keep the fallback-to-"" path.
   * The `stagesToRuntimePlan` projector sets this `true` on every
   * emitted `derive.band` node (the safe default for auto-binned dims).
   */
  readonly clampToNearest?: boolean;
}

export type DeriveBandInputs = { value: number };
/**
 * `level_id` — the resolved (or clamped / fallback) band id.
 * `out_of_range` — true when the raw value fell outside every band
 * (whether it was then clamped or left to the fallback). Diagnostic
 * only; left unwired by the projector but surfaced in the run trace so
 * a score-time UI can count out-of-range rows per banded dim (L22).
 */
export type DeriveBandOutputs = { level_id: string; out_of_range: boolean };

export const DeriveBandKind: BlockKind<
  DeriveBandParams,
  DeriveBandInputs,
  DeriveBandOutputs
> = {
  id: "derive.band",
  category: "lookup",
  label: "Band lookup",
  description:
    "Bin a number into a banded dim's level id (raw $45,000 → '02_25k_50k')",
  inputs: [
    {
      name: "value",
      type: "float",
      description: "The raw numeric value to bin",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "level_id",
      type: "string",
      description: "The matching band's level id (or clamp/fallback id)",
    } as PortSpec,
    {
      name: "out_of_range",
      type: "bool",
      description:
        "True when the raw value fell outside every band (clamped or not)",
    } as PortSpec,
  ],
  defaultParams: { dimSlug: "", levels: [] },
  defaultSize: "compact",
  execute: (inputs, params) => {
    // The wire type is `float`, but `externalInputs` are `unknown` —
    // CSV values arrive as strings ("850000") and an upstream layer
    // may already have resolved the band id. Defend all three forms
    // so binning works regardless of how the value reached us:
    //
    //   1. Already a level id  → pass through (idempotent). Lets a
    //      pre-binned column (or a redundant client-side bin) coexist
    //      with this runtime step without double-binning to "".
    //   2. number / numeric string → coerce + resolve via [lo, hi).
    //   3. anything else (NaN, empty, garbage) → out-of-range fallback.
    const raw = inputs.value as unknown;

    if (typeof raw === "string") {
      const alreadyBanded = params.levels.find((l) => l.id === raw);
      if (alreadyBanded) return { level_id: alreadyBanded.id, out_of_range: false };
    }

    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(num)) {
      // NaN / non-finite: no nearest band to clamp to. Fallback only.
      return { level_id: params.outOfRangeLevelId ?? "", out_of_range: true };
    }
    const id = resolveBandedLevel(params.levels, num);
    if (id !== null) return { level_id: id, out_of_range: false };

    // Out of range. Cold-test L22 — clamp to the nearest tail band when
    // requested so a value past the top/bottom never silently resolves
    // to the lookup's neutral 1.0 default. `out_of_range` stays true so
    // the score-time surface can still count + warn on the clamp.
    if (params.clampToNearest) {
      const clamped = clampToNearestBand(params.levels, num);
      if (clamped !== null) return { level_id: clamped, out_of_range: true };
    }
    return { level_id: params.outOfRangeLevelId ?? "", out_of_range: true };
  },
  validate: (params) => {
    if (params.levels.length === 0) {
      // An empty levels array is valid at the kind level (the chain
      // editor may be mid-author), but the engine will always return
      // the fallback. Surface this as a warning rather than an error.
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message: "No banded levels set; every value resolves to fallback",
            field: "levels",
          },
        ],
      };
    }
    const err = validateBandedLevels(params.levels);
    if (err) {
      return {
        valid: false,
        issues: [{ severity: "error", message: err, field: "levels" }],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const lvl = params.levels.find((l) => l.id === outputs.level_id);
    const slug = params.dimSlug || "value";
    if (lvl) {
      // Cold-test L22 — when the value was out of range but clamped onto
      // a real band, the auditor must see that the band was REACHED by
      // clamping, not by a natural [lo, hi) match. Otherwise the trace
      // would read as a normal in-range hit and hide the under-/over-
      // shoot that triggered the clamp.
      const suffix = outputs.out_of_range ? " (clamped — out of range)" : "";
      return `${slug} = ${inputs.value} → ${lvl.id} (${lvl.label})${suffix}`;
    }
    return `${slug} = ${inputs.value} → out of range`;
  },
  // ADR-0056 — an out-of-range value is a structured (warning) issue.
  // Clamping onto a tail band is an AUTHORED resolution (cold-test
  // L22), so the row still rates; unresolved fallbacks flow to the
  // consuming lookup's onMiss policy.
  collectRowIssues: (inputs, params, outputs) => {
    if (!outputs.out_of_range) return undefined;
    const slug = params.dimSlug || "value";
    const clamped = params.levels.some((l) => l.id === outputs.level_id);
    return [
      {
        severity: "warning",
        code: "band_out_of_range",
        message: clamped
          ? `\`${slug}\` value \`${String(inputs.value)}\` is outside every band; clamped to \`${outputs.level_id}\` (authored resolution).`
          : `\`${slug}\` value \`${String(inputs.value)}\` is outside every band; the consuming lookup's unknown-key policy decides the outcome.`,
        detail: {
          key: String(inputs.value),
          ...(params.dimSlug ? { field: params.dimSlug } : {}),
        },
      },
    ];
  },
};

/**
 * Clamp a finite out-of-range value onto the nearest tail band.
 *
 * The band list is sorted ascending by `lo` (invariant enforced by
 * `validateBandedLevels`), so the first banded level is the bottom
 * band and the last is the top. We only clamp the genuine tails:
 *
 *   • `value < first.lo`  → first band id   (below the bottom)
 *   • `value >= last.hi`  → last band id    (at/above the top)
 *
 * A value that fell out of range but is NEITHER below the bottom nor
 * above the top sits in a GAP between non-contiguous bands — there is
 * no unambiguous "nearest" band, so we return `null` and let the
 * caller fall back to `outOfRangeLevelId`. (Contiguous band sets — the
 * validated shape — never produce a gap, so this only guards malformed
 * mid-author states.)
 *
 * Returns the clamped level id, or `null` when no tail clamp applies.
 */
function clampToNearestBand(
  levels: readonly BandedLevel[],
  value: number,
): string | null {
  const banded = levels.filter((l) => l.kind === "banded");
  if (banded.length === 0) return null;
  const first = banded[0]!;
  const last = banded[banded.length - 1]!;
  // E5 — null bounds are open ends (±∞): nothing lies past an open
  // tail, so the comparison is naturally false and no clamp applies.
  if (value < bandLo(first)) return first.id;
  if (value >= bandHi(last)) return last.id;
  return null;
}
