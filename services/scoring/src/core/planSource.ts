/**
 * PlanSource — resolve a scoring request into a runtime `Plan`.
 *
 * A port (ADR-0045 §4): three ways to obtain the same runtime Plan the
 * engine consumes. Shared by /score (single) and the batch worker, so a
 * book scores through the identical resolution path as a single risk.
 *   • "plan"        — identity (the body already IS a runtime Plan).
 *   • "plan_stages" — project authored stages via the reused projector
 *                     (inherits the E13 completion).
 *   • "plan_id"     — resolve the plan's FROZEN snapshot bundle from
 *                     API Lab and project it (ADR-0049 A8). The fetch
 *                     itself is injected via `deps.fetchPlanById` so this
 *                     module stays pure and the HTTP/cache policy lives
 *                     in `apiLabPlans`; a runtime without the dep wired
 *                     still fails with a clear 501 rather than a wrong
 *                     answer.
 */

import type { Plan } from "@openrater/contracts";
import { notImplemented } from "./errors";
import { projectStagesToPlan, type ProjectStagesInput } from "./projector";

/** The plan-bearing subset of a request — shared by ScoreRequest + JobSpec. */
export type PlanResolution =
  | { readonly source: "plan"; readonly plan: unknown }
  | ({ readonly source: "plan_stages" } & {
      readonly stages: ProjectStagesInput["stages"];
      readonly dimensions: ProjectStagesInput["dimensions"];
      readonly factorTables: ProjectStagesInput["factorTables"];
      readonly factorTableCells: ProjectStagesInput["factorTableCells"];
      readonly projectorOptions?: ProjectStagesInput["options"];
      /** Brief 75 — a draft's frozen tail rides the request. */
      readonly policyTail?: readonly unknown[] | undefined;
    })
  | {
      readonly source: "plan_id";
      readonly planId: string;
      readonly snapshotId: string;
    };

/** Injected capabilities resolution may need (kept out of the pure core). */
export interface PlanSourceDeps {
  /** Snapshot-pinned API Lab resolution — apiLabPlans'
   *  `fetchSnapshotRuntimePlan`, partially applied with the service's
   *  `API_LAB_BASE`. */
  readonly fetchPlanById?: (
    planId: string,
    snapshotId: string,
  ) => Promise<Plan>;
}

export async function resolvePlan(
  r: PlanResolution,
  deps: PlanSourceDeps = {},
): Promise<Plan> {
  if (r.source === "plan") {
    // The schema validated the envelope; compilePlan is the real gate.
    return r.plan as unknown as Plan;
  }
  if (r.source === "plan_stages") {
    return projectStagesToPlan({
      stages: r.stages,
      dimensions: r.dimensions,
      factorTables: r.factorTables,
      factorTableCells: r.factorTableCells,
      ...(r.projectorOptions ? { options: r.projectorOptions } : {}),
    });
  }
  if (deps.fetchPlanById) {
    return deps.fetchPlanById(r.planId, r.snapshotId);
  }
  throw notImplemented(
    "source 'plan_id' requires API Lab resolution, which this runtime did " +
      "not wire (no fetchPlanById dep / API_LAB_BASE). Send a runtime Plan " +
      "(source:'plan') or authored stages (source:'plan_stages') instead.",
  );
}

// ─────────────────────────────────────────────────────────────────
// P2 G4/G5 (ADR-0056) — bundle resolution: the plan PLUS the
// composition substrate (authored stages, frozen tail, projection
// issues). `/score` composes the FILED premium from this; the legacy
// `resolvePlan` above stays for the batch worker until P3 moves runs
// server-side.
// ─────────────────────────────────────────────────────────────────

import type { PolicyAdjustment, ProjectionIssue } from "@openrater/contracts";
import {
  snapshotBodyToProjection,
  snapshotBodyPolicyTail,
} from "@openrater/ui/AnalyticsWorkspace/snapshot-plan";
import { badRequest } from "./errors";
import { projectStagesToProjection } from "./projector";

/** Minimal structural stage — what config extraction reads. */
export interface BundleStage {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly config_json?: unknown;
}

export interface ResolvedPlanBundle {
  readonly plan: Plan;
  /** Structured projection issues (ADR-0056); [] for raw plans. */
  readonly planIssues: readonly ProjectionIssue[];
  /** Authored stages when known (plan_stages / plan_id) — null for raw plans. */
  readonly stages: readonly BundleStage[] | null;
  /** Authored dimensions when known — the input deriver reads them. */
  readonly dimensions: readonly unknown[] | null;
  /** The frozen policy tail (snapshot body / plan.policy_tail), else null. */
  readonly policyTail: readonly PolicyAdjustment[] | null;
}

/** Injected body fetch for `plan_id` bundles (apiLabPlans.fetchSnapshotBody,
 *  partially applied with API_LAB_BASE). */
export interface PlanBundleDeps extends PlanSourceDeps {
  readonly fetchSnapshotBody?: (
    planId: string,
    snapshotId: string,
  ) => Promise<Record<string, unknown>>;
  // fetchModelVersion is retired: a legacy model-sourced tail or gate
  // refuses by name because OpenRater has no model registry.
}

function tailOf(raw: readonly unknown[] | null): readonly PolicyAdjustment[] | null {
  if (!raw) return null;
  const items = raw.filter(
    (a): a is PolicyAdjustment =>
      !!a && typeof a === "object" && typeof (a as { kind?: unknown }).kind === "string",
  );
  return items.length > 0 ? items : null;
}

export async function resolvePlanBundle(
  r: PlanResolution,
  deps: PlanBundleDeps = {},
): Promise<ResolvedPlanBundle> {
  if (r.source === "plan") {
    const plan = r.plan as unknown as Plan;
    const planTail = (plan as { policy_tail?: readonly PolicyAdjustment[] })
      .policy_tail;
    return {
      plan,
      planIssues: [],
      stages: null,
      dimensions: null,
      policyTail: planTail && planTail.length > 0 ? planTail : null,
    };
  }
  if (r.source === "plan_stages") {
    const projection = projectStagesToProjection({
      stages: r.stages,
      dimensions: r.dimensions,
      factorTables: r.factorTables,
      factorTableCells: r.factorTableCells,
      // G9 — the service composes policies: the floor applies ONCE,
      // post-IRPM, via the tail (appendPlanFloor at the score seam).
      options: {
        ...(r.projectorOptions as Record<string, unknown> | undefined),
        minPremiumScope: "policy",
      } as ProjectStagesInput["options"],
    });
    return {
      plan: projection.plan,
      planIssues: projection.issues,
      stages: r.stages as unknown as readonly BundleStage[],
      dimensions: (r.dimensions as readonly unknown[] | undefined) ?? null,
      policyTail: tailOf(
        Array.isArray(r.policyTail) ? [...r.policyTail] : null,
      ),
    };
  }
  if (!deps.fetchSnapshotBody) {
    throw notImplemented(
      "source 'plan_id' requires API Lab resolution, which this runtime " +
        "did not wire (no fetchSnapshotBody dep / API_LAB_BASE). Send a " +
        "runtime Plan (source:'plan') or authored stages " +
        "(source:'plan_stages') instead.",
    );
  }
  const body = await deps.fetchSnapshotBody(r.planId, r.snapshotId);
  const projection = snapshotBodyToProjection(body, {
    planId: r.planId,
    minPremiumScope: "policy",
  });
  if (projection === null) {
    throw badRequest(
      `Snapshot ${r.snapshotId} has no runnable rating chain — scoring ` +
        `it would echo inputs. Author a multiplicative chain and re-freeze.`,
    );
  }
  const stages = Array.isArray(body.stages)
    ? (body.stages as readonly BundleStage[])
    : null;
  return {
    plan: projection.plan,
    planIssues: projection.issues,
    stages,
    dimensions: Array.isArray(body.dimensions)
      ? (body.dimensions as readonly unknown[])
      : null,
    policyTail: tailOf(
      snapshotBodyPolicyTail(body as Record<string, unknown>),
    ),
  };
}
