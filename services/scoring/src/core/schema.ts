/**
 * Request/response schemas (zod — already a @openrater/contracts dep).
 *
 * `/score` and `/score-batch` share a discriminated request on `source`:
 *   • "plan"        — a raw runtime Plan (nodes+edges). The exact
 *                     conformance-vector shape; depends on @openrater/contracts
 *                     ONLY, so the parity test runs against it directly.
 *   • "plan_stages" — authored stages projected via stagesToRuntimePlan
 *                     (reuses the ONE projector, inherits the E13 work).
 *   • "plan_id"     — stages resolved from API Lab over HTTP (follow-up).
 *
 * `/score` carries one `inputs` record; `/score-batch` carries `rows[]`
 * + an optional `chunkSize`. Validation is loose on plan/stage internals
 * — the engine validates node params at compile time, so re-validating
 * every kind here would duplicate (and drift from) the engine contract.
 */

import { z } from "zod";
import { badRequest } from "./errors";

// ── Runtime Plan (the contract surface) ─────────────────────────────
const planNodeSchema = z
  .object({ id: z.string(), kind: z.string(), params: z.unknown() })
  .passthrough();

const planEdgeSchema = z.object({
  from: z.object({ node: z.string(), port: z.string() }),
  to: z.object({ node: z.string(), port: z.string() }),
});

export const planSchema = z
  .object({
    id: z.string(),
    version: z.string(),
    name: z.string(),
    nodes: z.array(planNodeSchema),
    edges: z.array(planEdgeSchema),
  })
  .passthrough();

// ── Run options (thread into @openrater/contracts RunOptions) ────────────
const classLibraryEntrySchema = z
  .object({
    class_code: z.string(),
    display_name: z.string(),
    exposure_bases: z.array(z.unknown()).default([]),
  })
  .passthrough();

const runOptionsInputSchema = z.object({
  /** ISO date pinning time-varying resources (engine RunOptions.as_of). */
  as_of: z.string().optional(),
  /** Class library entries → makeClassLibrary() (Brief 16). */
  classLibraryEntries: z.array(classLibraryEntrySchema).optional(),
});

// ── View projection (premium/perCoverage/tier are config-driven) ────
const viewConfigSchema = z.object({
  premiumField: z.string().optional(),
  coverageFields: z.array(z.string()).optional(),
  tierField: z.string().optional(),
});

// ── plan_stages projection inputs ───────────────────────────────────
const stageLikeSchema = z
  .object({
    stage_id: z.string(),
    stage_kind: z.string(),
    display_name: z.string().optional(),
    config_json: z.unknown().optional(),
  })
  .passthrough();

const factorTableLikeSchema = z
  .object({
    id: z.string(),
    display_name: z.string().optional(),
    key_dimension: z.string().optional(),
    key_dimensions: z.array(z.string()).optional(),
    // ADR-0063 — linear-interpolation flag the projector reads to emit
    // `lookup.multi.interpolateOn`. Explicit here (not just passthrough)
    // so the contract self-documents; absent/null = step.
    interpolation: z
      .object({ mode: z.literal("linear"), axis: z.string() })
      .nullish(),
  })
  .passthrough();

const projectorOptionsSchema = z.object({
  lcmOverride: z.number().optional(),
  defaults: z.record(z.unknown()).optional(),
  planId: z.string().optional(),
  planName: z.string().optional(),
});

// ── Discriminator member bags (shared by /score + /score-batch) ─────
const planBag = { source: z.literal("plan"), plan: planSchema } as const;
const stagesBag = {
  source: z.literal("plan_stages"),
  stages: z.array(stageLikeSchema),
  dimensions: z.array(z.unknown()).default([]),
  factorTables: z.array(factorTableLikeSchema).default([]),
  factorTableCells: z.record(z.record(z.number())).default({}),
  projectorOptions: projectorOptionsSchema.optional(),
  // Brief 75 / ADR-0055 — a DRAFT plan has no snapshot, so its frozen
  // tail rides the request; without this the zod bag silently STRIPPED
  // the field and draft runs composed pre-tail (caught in P3).
  policyTail: z.array(z.unknown()).optional(),
} as const;
const idBag = {
  source: z.literal("plan_id"),
  planId: z.string(),
  /** The frozen plan version to resolve (ADR-0049 A7/A8: determinism is
   *  mandatory — resolution is by immutable snapshot, never live stages). */
  snapshotId: z.string(),
} as const;

// Fields on EVERY request (both endpoints).
const common = {
  options: runOptionsInputSchema.optional(),
  views: viewConfigSchema.optional(),
  /** How much trace to return — "none" for book-scale callers. */
  trace: z.enum(["none", "summary", "full"]).default("summary"),
} as const;

const scoreExtra = { inputs: z.record(z.unknown()).default({}) } as const;
// Brief 75 (P3) — the BOOK bag: when present, `rows` are RAW book rows
// (CSV strings); the worker projects them through the ONE labs-ui
// projection path (`projectRowsToExternalInputs`, dtypes derived from
// the stages) and composes policies per the grouping + roll-ups. The
// gates/floor/tail still derive from the plan substrate (G4 seam) —
// this bag carries only what lives in the MAPPING, not the plan.
const bookBagSchema = z.object({
  column_map: z.record(z.string()),
  // Book-intake §4 — the mapping's value translations (dim slug →
  // raw value → canonical level id). The worker projects through
  // them, so aliases resolved in Inputs hold on server book runs too.
  alias_overrides: z.record(z.record(z.string())).optional(),
  grouping: z
    .object({
      policy_id_column: z.string().optional(),
      location_id_column: z.string().optional(),
    })
    .optional(),
  rollup_fields: z
    .array(
      z.object({
        fieldName: z.string(),
        reducer: z.string(),
      }),
    )
    .optional(),
  policyInputKeys: z.array(z.string()).optional(),
});
export type BookBag = z.infer<typeof bookBagSchema>;

const batchExtra = {
  rows: z.array(z.record(z.unknown())),
  chunkSize: z.number().int().positive().optional(),
  book: bookBagSchema.optional(),
} as const;

// Brief 76 (P4.1b) — the POLICY bag: `locations` are already-declared
// input objects (one per location), NOT raw CSV — the caller sends the
// plan's declared inputs directly. The service composes them into ONE
// policy (tail + gates + G9 floor, the SAME `evaluatePolicyBook` the
// book path runs) and returns the rolled-up FILED premium synchronously.
// `policyInputKeys` are the per-policy constants the tail's guards + GLM
// read (mirrors the book bag).
const policyExtra = {
  locations: z.array(z.record(z.unknown())).min(1),
  policyInputKeys: z.array(z.string()).optional(),
  // The plan's roll-up declarations (from its mapping) — so a tail GLM
  // whose features are policy-level aggregates (e.g. total_floor_area_sqft)
  // reads the SUMMED value, exactly as the book path composes. Absent ⇒
  // only the premium field rolls (single-coverage plans).
  rollupFields: z
    .array(z.object({ fieldName: z.string(), reducer: z.string() }))
    .optional(),
} as const;

// ── /score ──────────────────────────────────────────────────────────
export const scoreRequestSchema = z.discriminatedUnion("source", [
  z.object({ ...planBag, ...common, ...scoreExtra }),
  z.object({ ...stagesBag, ...common, ...scoreExtra }),
  z.object({ ...idBag, ...common, ...scoreExtra }),
]);

// ── /score-batch ─────────────────────────────────────────────────────
export const scoreBatchRequestSchema = z.discriminatedUnion("source", [
  z.object({ ...planBag, ...common, ...batchExtra }),
  z.object({ ...stagesBag, ...common, ...batchExtra }),
  z.object({ ...idBag, ...common, ...batchExtra }),
]);

// ── /score-policy ─────────────────────────────────────────────────────
export const scorePolicyRequestSchema = z.discriminatedUnion("source", [
  z.object({ ...planBag, ...common, ...policyExtra }),
  z.object({ ...stagesBag, ...common, ...policyExtra }),
  z.object({ ...idBag, ...common, ...policyExtra }),
]);

export type ScoreRequest = z.infer<typeof scoreRequestSchema>;
export type ScoreBatchRequest = z.infer<typeof scoreBatchRequestSchema>;
export type ScorePolicyRequest = z.infer<typeof scorePolicyRequestSchema>;
export type ScoreTraceMode = ScoreRequest["trace"];

/** Parse + validate a `/score` body, throwing a 400 ServiceError on failure. */
export function parseScoreRequest(body: unknown): ScoreRequest {
  const parsed = scoreRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid /score request", parsed.error.flatten());
  }
  return parsed.data;
}

/** Parse + validate a `/score-policy` body, throwing a 400 on failure. */
export function parseScorePolicyRequest(body: unknown): ScorePolicyRequest {
  const parsed = scorePolicyRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid /score-policy request", parsed.error.flatten());
  }
  return parsed.data;
}

/** Parse + validate a `/score-batch` body, throwing a 400 on failure. */
export function parseScoreBatchRequest(body: unknown): ScoreBatchRequest {
  const parsed = scoreBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid /score-batch request", parsed.error.flatten());
  }
  return parsed.data;
}
