/**
 * gateValueLevels — the value space an eligibility gate can actually
 * match for a dimension-backed field (the Brief 89.3 walk trap: the
 * composer's value seat took free text, so typing `fr` against a
 * Construction-class dim whose level ids are verbatim labels authored
 * a decline rule that never fired, with zero feedback).
 *
 * The gate runtime reads `externalInputs[variable]` RAW (see
 * `@openrater/contracts` kinds/eligibility-gate — no dim resolution runs
 * before a gate walks). So the options the value seat may offer are
 * the ids a submission actually carries, and those differ by shape:
 *
 *   • categorical (and the standard/classification default) — the
 *     level id IS the runtime key (`synthesizeRepresentativeRisk`
 *     seeds exactly `levels[0].id`), so offer THE keying site's list
 *     (`levelsForKeying`).
 *   • banded — the submission carries a raw NUMBER (`derive.band`
 *     buckets it inside factor lookups, never before gates); band ids
 *     would author exactly the never-matching rule this helper exists
 *     to prevent. No options — the seat stays a typed input.
 *   • geographic — the submission carries the granular geo code
 *     (state / county / ZIP), so offer the GRANULAR levels. The
 *     grouped `levelsForKeying` projection (territory ids) is a
 *     factor-keying construct the gate never sees.
 *
 * Pure data-in / data-out — no React, no I/O. Consumed by the
 * EligibilityMount when it builds `AppetiteFieldOption.levels`.
 */

import { isGeographicLookupDim } from "@openrater/contracts";

import type { DimensionRow } from "../DimensionsTable";
import { levelsForKeying } from "../keying";

export interface GateValueLevel {
  readonly id: string;
  readonly label: string;
}

export function gateValueLevels(
  dim: Pick<
    DimensionRow,
    "dimension_type" | "shape" | "levels" | "geo_territories"
  >,
): readonly GateValueLevel[] {
  if (dim.shape === "banded") return [];
  const levels = isGeographicLookupDim(dim)
    ? (dim.levels ?? [])
    : levelsForKeying(dim);
  return levels
    .filter((l) => l.id !== "")
    .map((l) => ({ id: l.id, label: l.label || l.id }));
}
