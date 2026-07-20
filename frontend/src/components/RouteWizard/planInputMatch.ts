/**
 * Plan-input matching for the Route wizard's "declare an input" nudge
 * (Test-2 finding). Pure + framework-free so it unit-tests under the rate-lab
 * `node` env — mirrors connectorId.ts / PlansListRoute's split-out helpers.
 *
 * The wizard binds each connector param (e.g. `address`) to a declared plan
 * input. When NO declared input could plausibly satisfy a param, the user is
 * stuck with an unhelpful dropdown — so we nudge them to declare one. This
 * predicate decides when there's clearly nothing to bind.
 */
import type { PlanInputDef } from "../../api/connectors";

/** Lowercase, alphanumerics only — for loose identifier comparison. */
export function normalizeIdent(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Is there a declared plan input that plausibly matches this connector param?
 *
 * Generous on purpose — we only nudge when there's clearly NOTHING sensible to
 * bind, so a present-but-unselected input never trips a false "no input"
 * prompt. Matches by normalized substring in either direction, requiring ≥3
 * chars on the contained side so a trivial hit (e.g. param `id`) doesn't count.
 */
export function hasPlausiblePlanInput(
  param: string,
  planInputs: readonly PlanInputDef[],
): boolean {
  const p = normalizeIdent(param);
  if (p === "") return true;
  const overlaps = (a: string, b: string): boolean =>
    (b.length >= 3 && a.includes(b)) || (a.length >= 3 && b.includes(a));
  return planInputs.some((i) => {
    const key = normalizeIdent(i.key);
    const label = normalizeIdent(i.label);
    return (key !== "" && overlaps(key, p)) || (label !== "" && overlaps(label, p));
  });
}
