/**
 * Connector-id derivation helpers (Brief 47 / Test-2 finding).
 *
 * Pure, framework-free so they unit-test under the rate-lab `node` env
 * (no CSS / React in the import graph) — mirrors how PlansListRoute's
 * `matchesPlanQuery` is split out for coverage.
 *
 * The studio auto-derives a `connector_id` from the display name while the
 * actuary hasn't hand-edited it. A naive slug can collide with a BUNDLED
 * connector id (e.g. "LightBox Structures" → `lightbox-structures`, which is
 * reserved) — the backend then 409s `connector_id_reserved` with no recovery.
 * `uniqueConnectorId` suffixes `-2`, `-3`, … until the id is free, exactly like
 * `GeoDimWizard`'s `uniqueSlug` does for dimension slugs.
 */

/** Lowercase, hyphenate, trim, cap at 80 chars. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Suffix `base` with `-2`, `-3`, … until it doesn't collide with an existing
 * connector id (bundled OR user). An empty base is returned untouched (the
 * studio's own save-time validation handles "give it an id"). Generous and
 * deterministic so re-deriving on every keystroke never accumulates suffixes —
 * it always recomputes from the freshly-slugified name.
 */
export function uniqueConnectorId(
  base: string,
  existing: readonly string[],
): string {
  const set = new Set(existing);
  if (base === "" || !set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
