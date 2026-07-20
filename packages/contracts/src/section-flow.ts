/**
 * Section flow — which sections structurally "feed into" which.
 *
 * The Control Tower shows "feeds into X, Y, Z" hints on each
 * section card based on STRUCTURAL spine semantics, regardless of
 * whether actual wires have been authored. This is the Lego studs
 * being visible even on empty plans.
 *
 * The shape captures the canonical rating dataflow:
 *
 *     Risk Inputs ──┐
 *                   ├──→ Classification ──┐
 *     Dimensions ───┘                     │
 *                                         ├──→ Rating Chains ──→ Modifiers ──┐
 *     Factor Tables ────→ ─────────────── ┘                                  │
 *                                                                            ├──→ Final Adj ──→ Outputs ──→ Rate Sample
 *                                                                            │
 *     Endorsements ──→ Final Adj                                             │
 *                                                                            │
 *     Loadings ──→ Final Adj  ←────────────────────────────────────────────  ┘
 *
 *     Eligibility · Territories — cross-cutting; do not feed downstream in this map.
 *
 * The exact downstream set is a judgment call; this is best-effort
 * spine semantics derived from Meridian BOP rating conventions. As the
 * substrate ports (Phase A.1) and conformance vectors reveal the
 * actual cascade shape, this map gets revised. The UI uses these
 * hints as "Lego studs" — visible connection intent, not runtime
 * proof.
 */

export const SECTION_FLOW: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "risk-inputs": Object.freeze([
      "classification",
      "factor-tables",
      "rating-chains",
    ]),
    dimensions: Object.freeze(["classification", "rating-chains"]),
    classification: Object.freeze(["rating-chains", "modifiers"]),
    territories: Object.freeze(["factor-tables", "rating-chains"]),
    "factor-tables": Object.freeze(["rating-chains", "modifiers"]),
    // Brief 34 PR 34.7: `curves` removed; 1-D banded factor tables
    // are the new curve concept.
    "rating-chains": Object.freeze([
      "modifiers",
      "loadings",
      "final-adjustments",
    ]),
    modifiers: Object.freeze(["loadings", "final-adjustments"]),
    endorsements: Object.freeze(["final-adjustments"]),
    loadings: Object.freeze(["final-adjustments"]),
    "final-adjustments": Object.freeze(["outputs"]),
    outputs: Object.freeze(["rate-against-sample"]),
    eligibility: Object.freeze<string[]>([]),
    "rate-against-sample": Object.freeze<string[]>([]),
  });

/** Sections that feed INTO a given section (inverse of SECTION_FLOW). */
export function sectionsFeedingInto(targetId: string): readonly string[] {
  const result: string[] = [];
  for (const [sourceId, downstream] of Object.entries(SECTION_FLOW)) {
    if (downstream.includes(targetId)) result.push(sourceId);
  }
  return result;
}
