/**
 * Exhibits — comparison derivations (current Exhibits design).
 *
 * Two sides (A and B — a plan, or a plan@snapshot), paired and diffed:
 * tables pair by slug (never fuzzy names — §3's refuse-never-improvise);
 * a paired table is "changed" when any cell moved; unchanged tables
 * collapse out of the wall so the page IS the diff. The territory
 * verdict joins the two geo groupings on shared members and speaks in
 * plain counts. The comparison lede is counted facts into fixed
 * sentence frames — the same anti-census move as the portrait.
 *
 * Pure functions; the route renders what these return.
 */

import {
  planDimensionSchema,
  planFactorTableSchema,
  type PlanDimension,
  type PlanFactorTable,
} from "@openrater/api-client";
import { z } from "zod";

/** Two factors closer than this rate identically (float dust). */
const EPS = 1e-9;

// ── Snapshot body → substrate ────────────────────────────────────────

//  — the snapshot body carries stage rows too; the compare
// reads the UNDERWRITING kinds from them (gates/modifiers/
// endorsements/loadings). Permissive shape: config_json is opaque.
const snapshotStageSchema = z
  .object({
    stage_id: z.string(),
    stage_kind: z.string(),
    display_name: z.string().nullish(),
    config_json: z.unknown().optional(),
  })
  .passthrough();

const snapshotSubstrateSchema = z.object({
  dimensions: z.array(planDimensionSchema).default([]),
  factor_tables: z.array(planFactorTableSchema).default([]),
  stages: z.array(snapshotStageSchema).default([]),
});

export interface SideSubstrate {
  readonly dims: readonly PlanDimension[];
  readonly tables: readonly PlanFactorTable[];
  readonly stages: readonly z.infer<typeof snapshotStageSchema>[];
}

/**
 * A frozen snapshot's body carries the same substrate rows the live
 * endpoints serve (`rates/snapshots/models.py`). Parse them through the
 * SAME zod schemas the api-client uses — a body this can't parse is a
 * named error, never a silently-empty exhibit.
 */
export function parseSnapshotSubstrate(body: unknown): SideSubstrate {
  const parsed = snapshotSubstrateSchema.parse(body);
  return {
    dims: parsed.dimensions,
    tables: parsed.factor_tables,
    stages: parsed.stages,
  };
}

// ── Table pairing + cell diffs ───────────────────────────────────────

export interface TablePair {
  readonly a: PlanFactorTable;
  readonly b: PlanFactorTable;
}

export interface PairedTables {
  readonly pairs: readonly TablePair[];
  readonly onlyA: readonly PlanFactorTable[];
  readonly onlyB: readonly PlanFactorTable[];
}

/** Pair by slug (table_id fallback) — identity, never name-similarity. */
export function pairTables(
  aTables: readonly PlanFactorTable[],
  bTables: readonly PlanFactorTable[],
): PairedTables {
  const key = (t: PlanFactorTable): string => t.slug || t.table_id;
  const bByKey = new Map(bTables.map((t) => [key(t), t]));
  const pairs: TablePair[] = [];
  const onlyA: PlanFactorTable[] = [];
  const matchedB = new Set<string>();
  for (const a of aTables) {
    const b = bByKey.get(key(a));
    if (b !== undefined) {
      pairs.push({ a, b });
      matchedB.add(key(b));
    } else {
      onlyA.push(a);
    }
  }
  const onlyB = bTables.filter((t) => !matchedB.has(key(t)));
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

// ── The territory verdict ────────────────────────────────────────────

export interface TerritoryVerdict {
  /** Members (ZIPs/counties) present in both groupings. */
  readonly shared: number;
  readonly onlyA: number;
  readonly onlyB: number;
  readonly identical: number;
  readonly cheaperInB: number;
  readonly costlierInB: number;
  /** The largest swing among shared members with factors on both sides. */
  readonly largest: {
    readonly member: string;
    readonly from: number;
    readonly to: number;
    readonly pct: number;
  } | null;
}

function memberFactorMap(
  dim: PlanDimension,
  table: PlanFactorTable,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const territory of dim.geo_territories ?? []) {
    const factor = table.cells[territory.id];
    if (typeof factor !== "number" || !Number.isFinite(factor)) continue;
    for (const member of territory.members) out.set(member, factor);
  }
  return out;
}

/**
 * Join the two geo groupings on their MEMBERS (the ZIPs), not their
 * territory ids — a revision can redraw territories entirely and the
 * verdict still answers the question a member cares about: "did my
 * ZIP get cheaper or costlier?"
 */
export function territoryVerdict(
  aDim: PlanDimension,
  aTable: PlanFactorTable,
  bDim: PlanDimension,
  bTable: PlanFactorTable,
): TerritoryVerdict | null {
  const aMap = memberFactorMap(aDim, aTable);
  const bMap = memberFactorMap(bDim, bTable);
  if (aMap.size === 0 || bMap.size === 0) return null;
  let shared = 0;
  let identical = 0;
  let cheaper = 0;
  let costlier = 0;
  let largest: TerritoryVerdict["largest"] = null;
  for (const [member, from] of aMap) {
    const to = bMap.get(member);
    if (to === undefined) continue;
    shared += 1;
    if (Math.abs(to - from) <= EPS) {
      identical += 1;
      continue;
    }
    if (to < from) cheaper += 1;
    else costlier += 1;
    const pct = from !== 0 ? (to / from - 1) * 100 : 0;
    if (largest === null || Math.abs(pct) > Math.abs(largest.pct)) {
      largest = { member, from, to, pct };
    }
  }
  return {
    shared,
    onlyA: aMap.size - shared,
    onlyB: bMap.size - shared,
    identical,
    cheaperInB: cheaper,
    costlierInB: costlier,
    largest,
  };
}

// ── The comparison lede's counted facts ──────────────────────────────

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

function levelIds(dim: PlanDimension): Set<string> {
  const out = new Set<string>();
  for (const raw of dim.levels as readonly LevelIdRecord[]) {
    if (typeof raw.id === "string") out.add(raw.id);
  }
  return out;
}

export function compareFacts(
  aDims: readonly PlanDimension[],
  aTables: readonly PlanFactorTable[],
  bDims: readonly PlanDimension[],
  bTables: readonly PlanFactorTable[],
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
        biggest = { table: pair.a.display_name, ...delta.largest };
      }
    }
  }

  const bDimBySlug = new Map(bDims.map((d) => [d.slug, d]));
  const aDimSlugs = new Set(aDims.map((d) => d.slug));
  const removedLevels: { dim: string; ids: string[] }[] = [];
  const addedLevels: { dim: string; ids: string[] }[] = [];
  for (const aDim of aDims) {
    const bDim = bDimBySlug.get(aDim.slug);
    if (bDim === undefined) continue;
    const aIds = levelIds(aDim);
    const bIds = levelIds(bDim);
    const removed = [...aIds].filter((id) => !bIds.has(id));
    const added = [...bIds].filter((id) => !aIds.has(id));
    if (removed.length > 0)
      removedLevels.push({ dim: aDim.display_name, ids: removed });
    if (added.length > 0)
      addedLevels.push({ dim: aDim.display_name, ids: added });
  }

  return {
    sharedTables: pairs.length,
    changedTables,
    onlyBTables: onlyB.map((t) => t.display_name),
    onlyATables: onlyA.map((t) => t.display_name),
    newDims: bDims
      .filter((d) => !aDimSlugs.has(d.slug))
      .map((d) => d.display_name),
    removedDims: aDims
      .filter((d) => !bDimBySlug.has(d.slug))
      .map((d) => d.display_name),
    removedLevels,
    addedLevels,
    biggest,
  };
}

// ── Side refs in the URL (?a=plan or ?a=plan@snapshot) ───────────────

export interface SideRef {
  readonly planId: string;
  readonly snapshotId: string | null;
}

export function parseSideRef(raw: string | null): SideRef | null {
  if (raw === null || raw === "") return null;
  const at = raw.indexOf("@");
  if (at === -1) return { planId: raw, snapshotId: null };
  const planId = raw.slice(0, at);
  const snapshotId = raw.slice(at + 1);
  if (planId === "" || snapshotId === "") return null;
  return { planId, snapshotId };
}

export function formatSideRef(ref: SideRef): string {
  return ref.snapshotId === null
    ? ref.planId
    : `${ref.planId}@${ref.snapshotId}`;
}
