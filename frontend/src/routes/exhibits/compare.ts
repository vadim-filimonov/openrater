/**
 * Exhibits — comparison derivations (Brief: portfolio-redesign v2 §5, P2).
 *
 * The arithmetic lives in @openrater/contracts (`compare-model`) so
 * the chat-side compare_plans tool answers with the SAME numbers this
 * page renders (FCA #24, finding 75). This module keeps the app-side
 * glue: parsing a frozen snapshot body through the api-client zod
 * schemas, and the ?a=plan@snapshot URL grammar.
 *
 * What the shared model fixed here (findings 74/102/76): territory
 * MEMBERSHIP changes are first-class in `compareFacts` (the old
 * rollup diffed factor cells only — two moved counties read
 * "unchanged"), dual-keyed county members collapse to one count with
 * names leading, and coverage/tower presence is enumerated.
 */

import {
  planDimensionSchema,
  planFactorTableSchema,
  type PlanDimension,
  type PlanFactorTable,
} from "@openrater/api-client";
import { z } from "zod";

export {
  cellDelta,
  compareFacts,
  membershipDelta,
  pairChanged,
  pairTables,
  territoryVerdict,
} from "@openrater/contracts";
export type {
  CellDelta,
  CompareFacts,
  PairedTables,
  TablePair,
  TerritoryReassignment,
  TerritoryReassignmentFact,
  TerritoryVerdict,
} from "@openrater/contracts";

// ── Snapshot body → substrate ────────────────────────────────────────

// MVP-009 — the snapshot body carries stage rows too; the compare
// reads the UNDERWRITING kinds from them (gates/modifiers/
// endorsements/loadings) and now the coverage towers (FCA #24).
// Permissive shape: config_json is opaque.
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
