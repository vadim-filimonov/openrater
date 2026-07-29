/**
 * compare-model — the plan-to-plan comparison derivations (FCA
 * fca-2026-07-25 #24).
 *
 * Extracted from the Exhibits route (frontend/src/routes/exhibits/
 * compare.ts) into contracts so the CHAT side can answer "what
 * changed between these two plans" with the same arithmetic the app
 * renders (finding 75: the only structured diff was an
 * identity-locked revision preview).
 *
 * And extended, because the committee-facing rollup could not be
 * trusted (findings 74/102/76):
 *
 *   · Territory MEMBERSHIP is first-class. The old rollup diffed
 *     factor cells only, so "Territory factor — unchanged" coexisted
 *     with two counties moving between territories — premiums moved,
 *     the summary said nothing.
 *   · Dual-keyed geo members deduplicate. County workbooks key each
 *     county by BOTH its FIPS code and its name (two independent
 *     member rows); every count doubled and the biggest mover was
 *     headlined "31019" instead of "Buffalo". Within an assignment
 *     group (same territory on A, same on B), digit-shaped keys and
 *     name-shaped keys are aliases of the same real places: the
 *     canonical count is max(names, digits) and names lead the
 *     display.
 *   · Coverage/tower presence is enumerated. A retired endorsement
 *     tower (chains present on one side only) appeared NOWHERE in
 *     the visual compare.
 *
 * Structural *Like types — api-client's PlanDimension /
 * PlanFactorTable satisfy them; contracts stays dependency-free.
 * Pure functions; every consumer renders what these return.
 */

/** Two factors closer than this rate identically (float dust). */
const EPS = 1e-9;

// ── Structural inputs ────────────────────────────────────────────────

export interface GeoTerritoryLike {
  readonly id: string;
  readonly label?: string | null | undefined;
  readonly members: readonly string[];
}

export interface CompareDimLike {
  readonly slug: string;
  readonly display_name?: string | null | undefined;
  readonly dimension_type?: string | null | undefined;
  readonly geo_territories?: readonly GeoTerritoryLike[] | null | undefined;
  readonly levels?: readonly unknown[] | undefined;
}

export interface CompareTableLike {
  readonly table_id: string;
  readonly slug?: string | null | undefined;
  readonly display_name?: string | null | undefined;
  readonly cells: Readonly<Record<string, number>>;
}

export interface CompareStageLike {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly config_json?: unknown | undefined;
}

export function tableKey(t: CompareTableLike): string {
  return t.slug || t.table_id;
}

export function tableName(t: CompareTableLike): string {
  return t.display_name || t.slug || t.table_id;
}

// ── Table pairing + cell diffs ───────────────────────────────────────

export interface TablePair<T extends CompareTableLike = CompareTableLike> {
  readonly a: T;
  readonly b: T;
}

export interface PairedTables<T extends CompareTableLike = CompareTableLike> {
  readonly pairs: readonly TablePair<T>[];
  readonly onlyA: readonly T[];
  readonly onlyB: readonly T[];
}

/** Pair by slug (table_id fallback) — identity, never name-similarity. */
export function pairTables<T extends CompareTableLike>(
  aTables: readonly T[],
  bTables: readonly T[],
): PairedTables<T> {
  const bByKey = new Map(bTables.map((t) => [tableKey(t), t]));
  const pairs: TablePair<T>[] = [];
  const onlyA: T[] = [];
  const matchedB = new Set<string>();
  for (const a of aTables) {
    const b = bByKey.get(tableKey(a));
    if (b !== undefined) {
      pairs.push({ a, b });
      matchedB.add(tableKey(b));
    } else {
      onlyA.push(a);
    }
  }
  const onlyB = bTables.filter((t) => !matchedB.has(tableKey(t)));
  return { pairs, onlyA, onlyB };
}

export interface CellDelta {
  /** Distinct cell keys across both sides. */
  readonly total: number;
  /** Keys whose value moved (or exists on only one side). */
  readonly changed: number;
  /** The largest relative move among keys present on BOTH sides. */
  readonly largest: {
    readonly key: string;
    readonly from: number;
    readonly to: number;
  } | null;
}

export function cellDelta(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): CellDelta {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let changed = 0;
  let largest: CellDelta["largest"] = null;
  let largestMove = 0;
  for (const key of keys) {
    const va = a[key];
    const vb = b[key];
    if (va === undefined || vb === undefined) {
      changed += 1;
      continue;
    }
    if (Math.abs(va - vb) <= EPS) continue;
    changed += 1;
    const move = va !== 0 ? Math.abs(vb / va - 1) : Math.abs(vb - va);
    if (move > largestMove) {
      largestMove = move;
      largest = { key, from: va, to: vb };
    }
  }
  return { total: keys.size, changed, largest };
}

export function pairChanged(pair: TablePair): boolean {
  return cellDelta(pair.a.cells, pair.b.cells).changed > 0;
}

// ── Geo membership: canonical members + reassignments ───────────────

/** member key → territory id, from the dim's grouping. */
export function memberAssignments(dim: CompareDimLike): Map<string, string> {
  const out = new Map<string, string>();
  for (const territory of dim.geo_territories ?? []) {
    for (const member of territory.members) out.set(member, territory.id);
  }
  return out;
}

function isDigitKey(member: string): boolean {
  return /^\d+$/.test(member.trim());
}

/**
 * Collapse dual-keyed members within one assignment signature.
 *
 * All members sharing the same (territoryA, territoryB) pair moved
 * identically — and when the set holds BOTH digit-shaped keys (FIPS/
 * ZIP codes) and name-shaped keys, the two shapes are the same real
 * places keyed twice (the county-workbook convention; the plan
 * carries no explicit alias link). The canonical count is
 * max(names, digits): 1:1 aliasing collapses exactly, and a
 * single-keyed straggler in a dual-keyed group still counts. Names
 * lead the display; digit keys fill in only past the name count.
 * A group with ONE key shape is untouched — ZIP-grain dims never
 * collapse.
 */
function canonicalMembers(members: readonly string[]): string[] {
  const names = members.filter((m) => !isDigitKey(m)).sort();
  const digits = members.filter((m) => isDigitKey(m)).sort();
  if (names.length === 0 || digits.length === 0) {
    return [...names, ...digits];
  }
  const count = Math.max(names.length, digits.length);
  return [...names, ...digits].slice(0, count);
}

export interface TerritoryReassignment {
  readonly member: string;
  readonly fromTerritory: string;
  readonly toTerritory: string;
}

export interface MembershipDelta {
  /** Canonical members whose territory changed, names preferred. */
  readonly reassigned: readonly TerritoryReassignment[];
  /** Raw moved-member count BEFORE alias collapsing (disclosure). */
  readonly rawMovedCount: number;
  /** Canonical members present on one side only. */
  readonly onlyA: number;
  readonly onlyB: number;
}

/**
 * The membership diff the rollup was blind to (findings 74/102): for
 * every shared member, did its TERRITORY change — independent of
 * whether any factor cell moved.
 */
export function membershipDelta(
  aDim: CompareDimLike,
  bDim: CompareDimLike,
): MembershipDelta | null {
  const aMap = memberAssignments(aDim);
  const bMap = memberAssignments(bDim);
  if (aMap.size === 0 || bMap.size === 0) return null;

  // Group shared movers by (from → to); collapse aliases per group.
  const movedGroups = new Map<string, string[]>();
  let rawMoved = 0;
  const onlyAMembers: string[] = [];
  for (const [member, from] of aMap) {
    const to = bMap.get(member);
    if (to === undefined) {
      onlyAMembers.push(member);
      continue;
    }
    if (to === from) continue;
    rawMoved += 1;
    const sig = `${from}\u0000${to}`;
    const group = movedGroups.get(sig);
    if (group === undefined) movedGroups.set(sig, [member]);
    else group.push(member);
  }
  const onlyBMembers = [...bMap.keys()].filter((m) => !aMap.has(m));

  const reassigned: TerritoryReassignment[] = [];
  for (const [sig, members] of movedGroups) {
    const [fromTerritory, toTerritory] = sig.split("\u0000") as [
      string,
      string,
    ];
    for (const member of canonicalMembers(members)) {
      reassigned.push({ member, fromTerritory, toTerritory });
    }
  }
  reassigned.sort((x, y) => x.member.localeCompare(y.member));

  return {
    reassigned,
    rawMovedCount: rawMoved,
    onlyA: canonicalMembers(onlyAMembers).length,
    onlyB: canonicalMembers(onlyBMembers).length,
  };
}

// ── The territory verdict (member-level factor movement) ─────────────

export interface TerritoryVerdict {
  /** Canonical members (aliases collapsed) present in both groupings. */
  readonly shared: number;
  readonly onlyA: number;
  readonly onlyB: number;
  readonly identical: number;
  readonly cheaperInB: number;
  readonly costlierInB: number;
  /** Canonical members reassigned between territories. */
  readonly reassigned: readonly TerritoryReassignment[];
  /** The largest swing among canonical shared members. */
  readonly largest: {
    readonly member: string;
    readonly from: number;
    readonly to: number;
    readonly pct: number;
  } | null;
}

/**
 * Join the two geo groupings on their MEMBERS (the ZIPs/counties),
 * not their territory ids — a revision can redraw territories
 * entirely and the verdict still answers the question a member cares
 * about: "did my place get cheaper or costlier?" Counts run over
 * CANONICAL members (dual keys collapsed per assignment signature —
 * the pre-fix verdict counted every moved county twice) and the
 * largest swing is named by its name-shaped key when one exists.
 */
export function territoryVerdict(
  aDim: CompareDimLike,
  aTable: CompareTableLike,
  bDim: CompareDimLike,
  bTable: CompareTableLike,
): TerritoryVerdict | null {
  const aAssign = memberAssignments(aDim);
  const bAssign = memberAssignments(bDim);
  if (aAssign.size === 0 || bAssign.size === 0) return null;

  // Canonicalize the shared universe per (territoryA, territoryB)
  // signature — every member of a signature group shares the same
  // factor pair, so collapsing loses nothing.
  const sharedGroups = new Map<string, string[]>();
  const onlyAMembers: string[] = [];
  for (const [member, ta] of aAssign) {
    const tb = bAssign.get(member);
    if (tb === undefined) {
      onlyAMembers.push(member);
      continue;
    }
    const sig = `${ta}\u0000${tb}`;
    const group = sharedGroups.get(sig);
    if (group === undefined) sharedGroups.set(sig, [member]);
    else group.push(member);
  }
  const onlyBMembers = [...bAssign.keys()].filter((m) => !aAssign.has(m));

  let shared = 0;
  let identical = 0;
  let cheaper = 0;
  let costlier = 0;
  let largest: TerritoryVerdict["largest"] = null;
  const reassigned: TerritoryReassignment[] = [];
  for (const [sig, members] of sharedGroups) {
    const [ta, tb] = sig.split("\u0000") as [string, string];
    const canon = canonicalMembers(members);
    const from = aTable.cells[ta];
    const to = bTable.cells[tb];
    if (ta !== tb) {
      for (const member of canon) {
        reassigned.push({ member, fromTerritory: ta, toTerritory: tb });
      }
    }
    if (
      typeof from !== "number" ||
      !Number.isFinite(from) ||
      typeof to !== "number" ||
      !Number.isFinite(to)
    ) {
      continue;
    }
    shared += canon.length;
    if (Math.abs(to - from) <= EPS) {
      identical += canon.length;
      continue;
    }
    if (to < from) cheaper += canon.length;
    else costlier += canon.length;
    const pct = from !== 0 ? (to / from - 1) * 100 : 0;
    if (largest === null || Math.abs(pct) > Math.abs(largest.pct)) {
      // Names lead canonicalMembers, so the headline mover reads
      // "Buffalo", never its FIPS twin.
      largest = { member: canon[0]!, from, to, pct };
    }
  }
  reassigned.sort((x, y) => x.member.localeCompare(y.member));

  return {
    shared,
    onlyA: canonicalMembers(onlyAMembers).length,
    onlyB: canonicalMembers(onlyBMembers).length,
    identical,
    cheaperInB: cheaper,
    costlierInB: costlier,
    reassigned,
    largest,
  };
}

// ── Coverage/tower presence (finding 76) ─────────────────────────────

interface ChainRecordLike {
  readonly name?: unknown;
  readonly coverage_value?: unknown;
  readonly output_field?: unknown;
}

function chainLabels(stages: readonly CompareStageLike[]): Map<string, string> {
  // key: the chain's stable identity (coverage_value, else output
  // field, else name); value: the display label.
  const out = new Map<string, string>();
  for (const stage of stages) {
    if (!stage.stage_kind.includes("multiplicative_chain")) continue;
    const cfg = stage.config_json;
    if (cfg === null || typeof cfg !== "object") continue;
    const chains = (cfg as { chains?: unknown }).chains;
    if (!Array.isArray(chains)) continue;
    for (const raw of chains as readonly ChainRecordLike[]) {
      if (raw === null || typeof raw !== "object") continue;
      const coverage =
        typeof raw.coverage_value === "string" && raw.coverage_value !== ""
          ? raw.coverage_value
          : undefined;
      const outField =
        typeof raw.output_field === "string" && raw.output_field !== ""
          ? raw.output_field
          : undefined;
      const name =
        typeof raw.name === "string" && raw.name !== "" ? raw.name : undefined;
      const key = coverage ?? outField ?? name;
      if (key === undefined) continue;
      out.set(key, name ?? coverage ?? outField ?? key);
    }
  }
  return out;
}

export interface CoveragePresence {
  /** Towers present in A only (retired in B), by display label. */
  readonly onlyA: readonly string[];
  /** Towers present in B only (new), by display label. */
  readonly onlyB: readonly string[];
}

/**
 * Finding 76 — a retired endorsement tower (its chains, inputs and
 * outputs all gone from one side) appeared NOWHERE in the visual
 * compare. Enumerate coverage/tower presence by chain identity.
 */
export function coveragePresence(
  aStages: readonly CompareStageLike[],
  bStages: readonly CompareStageLike[],
): CoveragePresence {
  const a = chainLabels(aStages);
  const b = chainLabels(bStages);
  const onlyA = [...a.entries()]
    .filter(([key]) => !b.has(key))
    .map(([, label]) => label)
    .sort();
  const onlyB = [...b.entries()]
    .filter(([key]) => !a.has(key))
    .map(([, label]) => label)
    .sort();
  return { onlyA, onlyB };
}

// ── The comparison's counted facts ───────────────────────────────────

export interface TerritoryReassignmentFact {
  /** The geo dim's display name. */
  readonly dim: string;
  readonly dimSlug: string;
  readonly count: number;
  readonly moves: readonly TerritoryReassignment[];
}

export interface CompareFacts {
  readonly sharedTables: number;
  readonly changedTables: number;
  readonly onlyBTables: readonly string[];
  readonly onlyATables: readonly string[];
  /** Inputs (dims) present on one side only, by display name. */
  readonly newDims: readonly string[];
  readonly removedDims: readonly string[];
  /** Level-membership changes on shared dims (e.g. a class leaving). */
  readonly removedLevels: readonly {
    readonly dim: string;
    readonly ids: readonly string[];
  }[];
  readonly addedLevels: readonly {
    readonly dim: string;
    readonly ids: readonly string[];
  }[];
  /**
   * FCA #24 (findings 74/102) — geo members whose TERRITORY changed,
   * per shared geographic dim, aliases collapsed. First-class: the
   * rollup used to read only factor cells, so a membership redraw
   * with identical factors reported "unchanged" while premiums moved.
   */
  readonly territoryReassignments: readonly TerritoryReassignmentFact[];
  /** FCA #24 (finding 76) — towers present on one side only. */
  readonly onlyACoverages: readonly string[];
  readonly onlyBCoverages: readonly string[];
  /** The single largest relative cell move across changed pairs. */
  readonly biggest: {
    readonly table: string;
    readonly key: string;
    readonly from: number;
    readonly to: number;
  } | null;
}

interface LevelIdRecord {
  readonly id?: unknown;
}

function levelIds(dim: CompareDimLike): Set<string> {
  const out = new Set<string>();
  for (const raw of (dim.levels ?? []) as readonly LevelIdRecord[]) {
    if (typeof raw.id === "string") out.add(raw.id);
  }
  return out;
}

function dimName(d: CompareDimLike): string {
  return d.display_name || d.slug;
}

export function compareFacts(
  aDims: readonly CompareDimLike[],
  aTables: readonly CompareTableLike[],
  bDims: readonly CompareDimLike[],
  bTables: readonly CompareTableLike[],
  aStages: readonly CompareStageLike[] = [],
  bStages: readonly CompareStageLike[] = [],
): CompareFacts {
  const { pairs, onlyA, onlyB } = pairTables(aTables, bTables);
  let changedTables = 0;
  let biggest: CompareFacts["biggest"] = null;
  let biggestMove = 0;
  for (const pair of pairs) {
    const delta = cellDelta(pair.a.cells, pair.b.cells);
    if (delta.changed === 0) continue;
    changedTables += 1;
    if (delta.largest !== null) {
      const move =
        delta.largest.from !== 0
          ? Math.abs(delta.largest.to / delta.largest.from - 1)
          : Math.abs(delta.largest.to - delta.largest.from);
      if (move > biggestMove) {
        biggestMove = move;
        biggest = { table: tableName(pair.a), ...delta.largest };
      }
    }
  }

  const bDimBySlug = new Map(bDims.map((d) => [d.slug, d]));
  const aDimSlugs = new Set(aDims.map((d) => d.slug));
  const removedLevels: { dim: string; ids: string[] }[] = [];
  const addedLevels: { dim: string; ids: string[] }[] = [];
  const territoryReassignments: TerritoryReassignmentFact[] = [];
  for (const aDim of aDims) {
    const bDim = bDimBySlug.get(aDim.slug);
    if (bDim === undefined) continue;
    const aIds = levelIds(aDim);
    const bIds = levelIds(bDim);
    const removed = [...aIds].filter((id) => !bIds.has(id));
    const added = [...bIds].filter((id) => !aIds.has(id));
    if (removed.length > 0)
      removedLevels.push({ dim: dimName(aDim), ids: removed });
    if (added.length > 0) addedLevels.push({ dim: dimName(aDim), ids: added });

    const delta = membershipDelta(aDim, bDim);
    if (delta !== null && delta.reassigned.length > 0) {
      territoryReassignments.push({
        dim: dimName(aDim),
        dimSlug: aDim.slug,
        count: delta.reassigned.length,
        moves: delta.reassigned,
      });
    }
  }

  const presence = coveragePresence(aStages, bStages);

  return {
    sharedTables: pairs.length,
    changedTables,
    onlyBTables: onlyB.map(tableName),
    onlyATables: onlyA.map(tableName),
    newDims: bDims.filter((d) => !aDimSlugs.has(d.slug)).map(dimName),
    removedDims: aDims.filter((d) => !bDimBySlug.has(d.slug)).map(dimName),
    removedLevels,
    addedLevels,
    territoryReassignments,
    onlyACoverages: presence.onlyA,
    onlyBCoverages: presence.onlyB,
    biggest,
  };
}
