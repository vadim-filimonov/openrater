/**
 * synthesizeRepresentativeRisk — Brief 48 §3.4 / phase 3 (scored Verify mode).
 *
 * A rating plan is agnostic (factor *tables*). To show the mockup's resolved
 * `×values` + running build-up gutter, ONE concrete risk must be run. When the
 * plan carries no stored/CSV risk, synthesize a deterministic representative one
 * straight from the plan's own dimension catalog: each factor-lookup's bound
 * dimension contributes its FIRST level, so every factor resolves to a real
 * authored cell instead of the neutral 1.0 default.
 *
 * Returns `externalInputs` keyed by the SAME normalized field names
 * `stagesToRuntimePlan` emits its input nodes under (via `normalizePath`), so
 * the output drops straight into `runPlan(compiled, externalInputs)`.
 *
 * The value KIND mirrors the projector's resolution branch exactly (so the key
 * lands where the lookup expects it):
 *   - raw band path (banded dim bound by a column ≠ its slug) → an in-range
 *     NUMBER (first banded level's `lo`); the projector's `derive.band` buckets
 *     it back to that level id.
 *   - everything else (categorical, or a prebinned banded dim bound by its slug)
 *     → the first level's `id` — the direct-lookup key.
 *   - level-less dim → omitted → the factor hits the projector's neutral 1.0
 *     (honest: a real computed identity factor, not a fabricated key).
 *
 * Base rate + LCM are NOT synthesized here — the projector injects them (base
 * via `options.defaults`, LCM via `options.lcmOverride`), so the caller's
 * existing `stagesToRuntimePlan` config covers them.
 *
 * Pure data-in / data-out — no React, no I/O. Tested.
 */

import type { Dimension, DimensionLevel } from "@openrater/contracts";
import type { StageLike } from "./deriveRequiredInputs";
import { isNonInputNamespaceId, normalizePath } from "./deriveRequiredInputs";

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A banded level carries numeric [lo, hi); a categorical one carries an id. */
function bandedLo(level: DimensionLevel): number | undefined {
  if ("lo" in level && typeof level.lo === "number") return level.lo;
  return undefined;
}

/**
 * The representative value for one bound dim.
 *
 * `isRawBandPath` mirrors the projector (finding E4): EVERY banded dim
 * routes through `derive.band` now — the raw-number seed is always the
 * representative shape. (A prebinned level id would also resolve via
 * the node's idempotent pass-through, but the raw number is what real
 * submissions carry.)
 */
function representativeValueForDim(
  dim: Dimension | undefined,
  isRawBandPath: boolean,
): unknown {
  const levels = dim?.levels;
  if (!levels || levels.length === 0) return undefined;
  const first = levels[0];
  if (!first) return undefined;
  if (isRawBandPath) {
    // The first banded level's lower bound always falls inside its own
    // bucket — but an OPEN lower bound is −Infinity, and that sentinel
    // leaked into the rate card's pin chips as "model_year −Infinity"
    // (FCA #33, finding 118). A representative value must be a FINITE
    // in-band number: for [−∞, hi) use hi−1 (model year "<2014" pins
    // 2013 — the natural reading); a fully unbounded band pins 0.
    const lo = bandedLo(first);
    if (lo !== undefined && Number.isFinite(lo)) return lo;
    if (lo !== undefined) {
      const hi =
        "hi" in first && typeof first.hi === "number" && Number.isFinite(first.hi)
          ? first.hi
          : undefined;
      return hi !== undefined ? hi - 1 : 0;
    }
    return first.id;
  }
  // Direct lookup → the level id IS the key.
  return first.id;
}

/**
 * Build a deterministic representative risk's externalInputs from the plan's
 * multiplicative-chain factor lookups + the dimension catalog.
 *
 * `dimensions` is indexed by `slug` (the factor lookup binds dims by slug),
 * with `id` as a fallback key.
 */
export function synthesizeRepresentativeRisk(
  stages: readonly StageLike[],
  dimensions: readonly Dimension[],
): Record<string, unknown> {
  const dimsBySlug = new Map<string, Dimension>();
  for (const d of dimensions) {
    const slug = (d as { slug?: string }).slug;
    if (slug) dimsBySlug.set(slug, d);
    if (d.id) dimsBySlug.set(d.id, d);
  }

  const inputs: Record<string, unknown> = {};
  // F07 — fields that feed a chain's `exposure_input` MUST be seeded with a
  // number: the runtime computes `exposure_input / exposure_unit_divisor`, so a
  // string (e.g. a banded dim's level id) yields NaN and the premium drops out,
  // leaving the single-risk Test surface with "no numeric outputs". We collect
  // exposure fields first and seed them numerically LAST, so a numeric exposure
  // always wins over a band-id factor-key seed for the same field.
  const exposureFields = new Set<string>();

  for (const stage of stages) {
    if (stage.stage_kind !== "multiplicative_chain") continue;
    const cfg = asObject(stage.config_json);
    for (const rawChain of asArray(cfg["chains"])) {
      const chain = asObject(rawChain);
      const expoField = normalizePath(
        chain["exposure_input"] as string | undefined,
      );
      // A `literal:<n>` exposure (spec §4.6) is a constant the
      // projector executes — not a field the risk carries, so the
      // sample form must not grow a "Literal:250" input to fill.
      if (expoField && !isNonInputNamespaceId(expoField)) {
        exposureFields.add(expoField);
      }
      for (const rawLookup of asArray(chain["factor_lookups"])) {
        const lookup = asObject(rawLookup);
        const dimsMap = asObject(lookup["dimensions"]);
        for (const slug of Object.keys(dimsMap)) {
          const binding = asObject(dimsMap[slug]);
          // Brief 95 C2 — a computed binding's key is built INSIDE the
          // graph (chain.add over the operands, then band resolution):
          // never grow a form field for the dim slug. The OPERANDS are
          // the risk's fields — seed them numerically (below) exactly
          // like exposure bases.
          if (binding["source"] === "computed") {
            for (const rawField of asArray(binding["fields"])) {
              const opField = normalizePath(String(rawField));
              if (opField && !isNonInputNamespaceId(opField)) {
                exposureFields.add(opField);
              }
            }
            continue;
          }
          const field =
            normalizePath(binding["path"] as string | undefined) || slug;
          if (!field || field in inputs) continue;
          const dim = dimsBySlug.get(slug);
          const shape = (dim as { shape?: string } | undefined)?.shape;
          const isRawBandPath = shape === "banded";
          const value = representativeValueForDim(dim, isRawBandPath);
          // Omit unresolved dims — the factor falls back to the projector's
          // neutral 1.0 (honest), rather than seeding a fabricated key.
          if (value !== undefined) inputs[field] = value;
        }
      }
    }
  }

  // F07 — seed exposure-base fields with a representative NUMBER (last, so it
  // wins). If the field maps to a banded dim, use the first band's lower bound;
  // otherwise fall back to a positive sentinel so the exposure division is finite
  // and the Test surface produces a real premium instead of "no numeric outputs".
  for (const field of exposureFields) {
    // E4 follow-through: the factor loop may have seeded a raw band
    // number that is 0 (a first band starting at $0) — fine as a
    // lookup key, useless as an exposure base. Only a POSITIVE number
    // survives; anything else gets the exposure seed.
    const existing = inputs[field];
    if (typeof existing === "number" && existing > 0) continue;
    const dim = dimsBySlug.get(field);
    const lo =
      dim?.levels && dim.levels.length > 0 ? bandedLo(dim.levels[0]!) : undefined;
    inputs[field] = lo !== undefined && lo > 0 ? lo : 100_000;
  }

  return inputs;
}
