/**
 * Brief 44 PR 44.7 — Pure state utilities for the territory grouping
 * tab. Separated from the React drag-drop wiring so the mutation
 * logic is testable without simulating native drag events (jsdom
 * doesn't dispatch them realistically).
 *
 * Substrate shape (Brief 44 §3.1 + Q2 lock):
 *
 *   geo_territories: ReadonlyArray<{
 *     id: string;         // territory_id, slug-cased
 *     label: string;      // display label
 *     members: string[];  // level ids that belong to this territory
 *   }>
 *
 * Invariants enforced here:
 *   · Every level id appears in AT MOST ONE territory (no overlap)
 *   · Empty territory is allowed (newly created bucket, not yet
 *     populated) — the runtime treats it as a metadata entry that
 *     resolves nothing
 *   · Adding a level that's already in another territory moves it
 *     (removes from old, adds to new)
 */

export interface GeoTerritory {
  readonly id: string;
  readonly label: string;
  readonly members: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────
// Pure operations
// ──────────────────────────────────────────────────────────────────────

/**
 * Move a level into a territory. If the level is already in another
 * territory, it's removed from there first (Brief 44 §3.1 invariant
 * — no overlap).
 *
 * No-op if `targetTerritoryId` doesn't exist.
 */
export function addLevelToTerritory(
  territories: readonly GeoTerritory[],
  levelId: string,
  targetTerritoryId: string,
): GeoTerritory[] {
  if (!territories.some((t) => t.id === targetTerritoryId)) {
    return territories.slice();
  }
  return territories.map((t) => {
    if (t.id === targetTerritoryId) {
      if (t.members.includes(levelId)) return t; // already in
      return { ...t, members: [...t.members, levelId] };
    }
    if (t.members.includes(levelId)) {
      // Remove from non-target territory (level can only be in one).
      return { ...t, members: t.members.filter((m) => m !== levelId) };
    }
    return t;
  });
}

/**
 * Remove a level from a specific territory. After this, the level is
 * "ungrouped" (it doesn't appear in any territory's members list).
 * No-op if the territory doesn't exist or the level isn't a member.
 */
export function removeLevelFromTerritory(
  territories: readonly GeoTerritory[],
  levelId: string,
  fromTerritoryId: string,
): GeoTerritory[] {
  return territories.map((t) => {
    if (t.id !== fromTerritoryId) return t;
    return { ...t, members: t.members.filter((m) => m !== levelId) };
  });
}

/**
 * Append a new empty territory. Returns the new territories array AND
 * the id of the newly created bucket (consumers focus the rename
 * input on creation).
 *
 * Cold-test M9 — id scheme. When the caller supplies a NON-EMPTY label
 * (a user-named bucket), the id is the slug-cased label, uniquified
 * with a `_2`, `_3`… suffix on collision. When the label is EMPTY (the
 * "+ New territory" default-bucket path), we mint a uniform
 * `territory_1`, `territory_2`, … id instead of the old `territory`,
 * `territory_2`, `territory_3` sequence (which gave the FIRST bucket a
 * bare `territory` id and surprised anything keying off it). The first
 * free `territory_{n}` (n ≥ 1) that isn't already taken wins, so
 * deletions + re-adds stay consistent.
 *
 * The downstream territory-keying path (ParametrizeCanvas
 * `levelsForKeying` + `stagesToRuntimePlan.derive.territory`) reads
 * whatever ids the dim actually carries — it never hard-codes this
 * scheme — so legacy plans with the old bare-`territory` id keep
 * scoring unchanged; only NEW default buckets get the tidy numbering.
 */
export function createTerritory(
  territories: readonly GeoTerritory[],
  label: string,
): { readonly territories: GeoTerritory[]; readonly newId: string } {
  const existing = new Set(territories.map((t) => t.id));
  const trimmed = label.trim();
  let id: string;
  if (trimmed === "") {
    // Default unnamed bucket — uniform `territory_{n}` from 1.
    let n = 1;
    id = `territory_${n}`;
    while (existing.has(id)) {
      n += 1;
      id = `territory_${n}`;
    }
  } else {
    // User-named bucket — slug-cased label, uniquified on collision.
    const base = slugify(trimmed);
    id = base;
    let i = 2;
    while (existing.has(id)) {
      id = `${base}_${i}`;
      i += 1;
    }
  }
  return {
    territories: [
      ...territories,
      { id, label: trimmed || "New territory", members: [] },
    ],
    newId: id,
  };
}

/** Drop a territory and (silently) ungroup its members. */
export function deleteTerritory(
  territories: readonly GeoTerritory[],
  territoryId: string,
): GeoTerritory[] {
  return territories.filter((t) => t.id !== territoryId);
}

/** Rename a territory in place (id unchanged — that's stable). */
export function renameTerritory(
  territories: readonly GeoTerritory[],
  territoryId: string,
  nextLabel: string,
): GeoTerritory[] {
  return territories.map((t) =>
    t.id === territoryId ? { ...t, label: nextLabel } : t,
  );
}

// ──────────────────────────────────────────────────────────────────────
// Derived helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the set of level ids that are NOT yet in any territory.
 * Used by the consumer to render the "Ungrouped" column.
 */
export function ungroupedLevelIds(
  allLevelIds: readonly string[],
  territories: readonly GeoTerritory[],
): readonly string[] {
  const grouped = new Set<string>();
  for (const t of territories) {
    for (const m of t.members) grouped.add(m);
  }
  return allLevelIds.filter((id) => !grouped.has(id));
}

/**
 * Lookup map: level_id → its containing territory_id (or `undefined`
 * when ungrouped). Stable across renders; consumers memoize.
 */
export function territoryByLevel(
  territories: readonly GeoTerritory[],
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const t of territories) {
    for (const m of t.members) {
      // First-wins. The invariant says a level only appears in one
      // territory; if the upstream data violates that, we silently
      // keep the first.
      if (!out.has(m)) out.set(m, t.id);
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "territory"
  );
}
