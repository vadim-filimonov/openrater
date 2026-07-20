/**
 * Brief 50 — Route match confidence.
 *
 * Pure scoring for the "did the external lookup match the right entity?" review
 * gate. When a connector output declares `echo_of` (it echoes back an input —
 * e.g. Google Places `matched_name` echoes the `query` searched), we compare the
 * value the user searched by against the value the API returned, so a fuzzy
 * lookup that found the WRONG org becomes visible before the user pushes it.
 *
 * Reuses `nameSimilarity` (the same identifier-similarity used by column
 * auto-match), so the signal is consistent across the product.
 */
import { nameSimilarity } from "./autoMatch";

export type MatchConfidenceLevel = "strong" | "partial" | "weak";

export interface MatchConfidence {
  /** Name similarity in [0, 1]; 0 when the lookup returned nothing. */
  readonly similarity: number;
  /** Bucketed level driving the badge tone + copy. */
  readonly level: MatchConfidenceLevel;
}

/** ≥ this → "strong" (green). Mirrors autoMatch's auto threshold. */
export const MATCH_STRONG_THRESHOLD = 0.8;
/** ≥ this (and < strong) → "partial" (amber); below → "weak" (red). */
export const MATCH_PARTIAL_THRESHOLD = 0.45;

/**
 * Score how well an echoed output value matches the input it was searched by.
 *
 * @param query   The value the user searched by (the bound input's sample).
 * @param matched The value the connector returned for the echoing output.
 *
 * An empty `matched` (the lookup found nothing) scores 0 → "weak" so it always
 * reads as "review." Callers should only invoke this when `query` is non-empty
 * (there's nothing to compare otherwise).
 */
export function matchConfidence(query: string, matched: string): MatchConfidence {
  const m = matched.trim();
  if (m === "") return { similarity: 0, level: "weak" };
  const q = query.trim();
  const similarity = q === "" ? 0 : nameSimilarity(q, m);
  const level: MatchConfidenceLevel =
    similarity >= MATCH_STRONG_THRESHOLD
      ? "strong"
      : similarity >= MATCH_PARTIAL_THRESHOLD
        ? "partial"
        : "weak";
  return { similarity, level };
}
