/**
 * Batch worker — consume the JobQueue, score the book, stream results
 * to the ResultStore.
 *
 * `processNextJob` does one job (deterministic — tests call it directly).
 * `runWorkerLoop` runs it forever until aborted (the container/in-process
 * worker). Per-chunk it appends results + updates progress, so a job's
 * status reflects real headway and big books never accumulate in memory.
 *
 * A worker is its OWN process (or in-process loop) → it calls
 * `ensureEngineReady()` itself; never assume the HTTP process registered
 * the kinds.
 */

import { compilePlan, type RunResult } from "@openrater/contracts";

import { ensureEngineReady } from "../core/engine";
import { runBatchChunked } from "../core/batch";
import { deriveViews, resolvePlanPremiumContext } from "../core/derive";
import type { JobSpec } from "../core/jobSpec";
import {
  resolvePlan,
  resolvePlanBundle,
  type PlanBundleDeps,
} from "../core/planSource";
import { projectTrace, toRunOptions } from "../core/score";
import { buildTailResolver } from "../core/tailResolver";
import type { JobQueue } from "../ports/jobQueue";
import type { ResultStore } from "../ports/resultStore";
import {
  composeBookPolicies,
  premiumRollupFieldOf,
  projectBookRows,
  summarizeBook,
} from "./bookRun";

function nowIso(): string {
  return new Date().toISOString();
}

export interface ProcessJobOptions {
  /** Block up to this long for a job (Redis BRPOP); 0 = non-blocking. */
  readonly timeoutMs?: number;
  /** plan resolution deps (snapshot-pinned API Lab fetch, A8; the
   *  bundle path additionally reads the snapshot BODY for book runs). */
  readonly planSource?: PlanBundleDeps;
}

/**
 * Claim + run the next job, if any. Returns true if a job was processed
 * (success OR failure — both are terminal + recorded), false if the
 * queue was empty within the timeout.
 */
export async function processNextJob(
  queue: JobQueue,
  store: ResultStore,
  options: ProcessJobOptions = {},
): Promise<boolean> {
  const jobId = await queue.claim(options.timeoutMs ?? 0);
  if (!jobId) return false;

  try {
    await queue.update(jobId, { status: "running", startedAt: nowIso() });

    const spec = (await store.loadSpec(jobId)) as JobSpec | null;
    if (!spec) throw new Error(`job ${jobId}: spec not found in result store`);
    const rows = (await store.loadInput(jobId)) as Record<string, unknown>[];

    const registry = ensureEngineReady();
    const runOptions = toRunOptions(spec.options);

    if (spec.book) {
      // ── Brief 75 book run: project → rate → compose → summarize ──
      // The stored rows are RAW book rows; everything downstream runs
      // through the one UI projection path (bookRun.ts).
      const bundle = await resolvePlanBundle(spec, options.planSource ?? {});
      const planPremium = resolvePlanPremiumContext(bundle.plan, bundle.stages);
      const projected = projectBookRows(
        rows as readonly Record<string, unknown>[],
        bundle,
        spec.book,
      );
      const collected: RunResult[] = [];
      let chunkBase = 0;
      await runBatchChunked(bundle.plan, projected, {
        chunkSize: spec.chunkSize,
        registry,
        run: runOptions,
        onChunk: async (chunk, done, total) => {
          const base = chunkBase;
          chunkBase += chunk.length;
          collected.push(...chunk);
          const out = chunk.map((result, i) => ({
            outputs: result.outputs,
            views: deriveViews(result, spec.views, planPremium),
            as_of: result.as_of,
            row_status: result.row_status,
            // Brief 75 phase 4 — a book row keeps its PROJECTED inputs
            // + resolved verdict: the persisted run is the exhibits'
            // whole substrate (Analytics slices by input dims).
            inputs: projected[base + i] ?? {},
            ...(result.eligibility_tier
              ? { eligibility_tier: result.eligibility_tier }
              : {}),
            ...(result.issues && result.issues.length > 0
              ? { rowIssues: result.issues }
              : {}),
            ...(spec.trace !== "none"
              ? { trace: projectTrace(result.trace, spec.trace) }
              : {}),
          }));
          await store.appendResults(jobId, out);
          await queue.update(jobId, { progress: { done, total } });
        },
      });
      const compiled = compilePlan(bundle.plan, registry);
      // A legacy model-sourced tail refuses BY NAME inside
      // buildTailResolver (S1) → the job fails with that named reason
      // (Law 2 — never an identity factor).
      const resolveAdjustment = buildTailResolver(bundle.policyTail);
      const policies = composeBookPolicies(
        compiled,
        projected,
        rows as readonly Record<string, unknown>[],
        bundle,
        spec.book,
        spec.options?.as_of,
        resolveAdjustment,
      );
      // Per-row ledger premium: the plan-aware views resolution (the
      // declared aggregate, the lone money output, or the total-less
      // coverage sum), else the book's declared premium field.
      const rowPremiumField = premiumRollupFieldOf(spec.book, planPremium);
      const summary = summarizeBook(
        collected,
        rows as readonly Record<string, unknown>[],
        (r) => {
          const v = deriveViews(r, spec.views, planPremium).premium;
          if (v !== null) return v;
          const f = r.outputs[rowPremiumField];
          return typeof f === "number" && Number.isFinite(f) ? f : null;
        },
        spec.book,
        policies,
        planPremium,
      );
      if ("saveSummary" in store) {
        await (
          store as ResultStore & {
            saveSummary(id: string, s: unknown): Promise<void>;
          }
        ).saveSummary(jobId, summary);
      }
    } else {
      const plan = await resolvePlan(spec, options.planSource ?? {});
      const planPremium = resolvePlanPremiumContext(
        plan,
        spec.source === "plan_stages" ? spec.stages : null,
      );
      await runBatchChunked(plan, rows, {
        chunkSize: spec.chunkSize,
        registry,
        run: runOptions,
        onChunk: async (chunk, done, total) => {
          const out = chunk.map((result) => ({
            outputs: result.outputs,
            views: deriveViews(result, spec.views, planPremium),
            as_of: result.as_of,
            ...(spec.trace !== "none"
              ? { trace: projectTrace(result.trace, spec.trace) }
              : {}),
          }));
          await store.appendResults(jobId, out);
          await queue.update(jobId, { progress: { done, total } });
        },
      });
    }

    await queue.update(jobId, {
      status: "succeeded",
      finishedAt: nowIso(),
      progress: { done: rows.length, total: rows.length },
    });
  } catch (err) {
    await queue.update(jobId, {
      status: "failed",
      finishedAt: nowIso(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** Run the worker until the signal aborts. One loop = one worker slot. */
export async function runWorkerLoop(
  queue: JobQueue,
  store: ResultStore,
  signal: AbortSignal,
  planSource: PlanBundleDeps = {},
): Promise<void> {
  while (!signal.aborted) {
    let processed = false;
    try {
      processed = await processNextJob(queue, store, {
        timeoutMs: 1000,
        planSource,
      });
    } catch {
      // processNextJob records per-job failure itself; this guards the
      // loop against an adapter-level throw (e.g. a transient Redis blip).
      processed = false;
    }
    if (!processed && !signal.aborted) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}
