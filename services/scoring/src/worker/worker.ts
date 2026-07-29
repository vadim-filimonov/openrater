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

import {
  compilePlan,
  type PolicyBookResult,
  type RowIssue,
  type RunResult,
} from "@openrater/contracts";

import { ensureEngineReady } from "../core/engine";
import { runBatchChunked } from "../core/batch";
import { deriveViews, resolvePlanPremiumContext } from "../core/derive";
import type { JobSpec } from "../core/jobSpec";
import {
  declaredInputsFromStages,
  implausibleInputIssues,
  preflightInputs,
  withDeclaredGateDefaults,
} from "../core/inputsPreflight";
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
  composedTailFor,
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
      // ── Brief 75 book run: project → compose → rate → summarize ──
      // The stored rows are RAW book rows; everything downstream runs
      // through the one labs-ui path (bookRun.ts).
      const bundle = await resolvePlanBundle(spec, options.planSource ?? {});
      const planPremium = resolvePlanPremiumContext(bundle.plan, bundle.stages);
      const declared = declaredInputsFromStages(bundle.stages);
      // FCA — a workbook default on a GATE-ONLY field (no input node)
      // must reach the gate's externalInputs read on book rows too;
      // mapped column values always win.
      const projected = projectBookRows(
        rows as readonly Record<string, unknown>[],
        bundle,
        spec.book,
      ).map((row) => withDeclaredGateDefaults(bundle.plan, declared, row));
      const compiled = compilePlan(bundle.plan, registry);
      // A legacy model-sourced tail refuses BY NAME inside
      // buildTailResolver (S1) → the job fails with that named reason
      // (Law 2 — never an identity factor).
      const resolveAdjustment = buildTailResolver(bundle.policyTail);
      // Composition runs BEFORE the streaming loop so per-row stored
      // results can carry their composed premiums (FCA fca-2026-07-25
      // S0 — book rows skipped the plan-tail minimum premium the quote
      // path applied; run-detail rows displayed the pre-floor number
      // as 'rated'). For an UNGROUPED book each row is its own
      // single-location policy (`row_${i}` — bookRun.ts).
      const grouped = !!spec.book.grouping?.policy_id_column;
      const hasTail = composedTailFor(bundle).length > 0;
      const policies = composeBookPolicies(
        compiled,
        projected,
        rows as readonly Record<string, unknown>[],
        bundle,
        spec.book,
        runOptions,
        resolveAdjustment,
      );
      const rowPolicy = new Map<string, PolicyBookResult>(
        !grouped && policies ? policies.map((p) => [p.policy_id, p]) : [],
      );
      // FCA — spec §12.4 on the book path too: a DECLARED-required
      // no-default input absent from a row refuses THAT row by name
      // (the engine errors chain-consumed misses itself; this covers
      // gate-only fields, which otherwise rate the default tier).
      const refusals: readonly (RowIssue | null)[] = projected.map((row) => {
        const refused = preflightInputs(bundle.plan, row, declared)
          .refused_inputs;
        if (refused.length === 0) return null;
        return {
          severity: "error",
          code: "missing_input",
          nodeId: "inputs_preflight",
          message:
            `Required input(s) missing (no default): ` +
            `${refused.join(", ")} — premium and eligibility verdict ` +
            `withheld.`,
        };
      });
      // FCA #15 — declared-bounds plausibility warnings per row
      // (min/max/enum). Warnings never error a row; they ride the
      // stored issues so run detail and quote parity both show them.
      const plausibility: readonly (readonly RowIssue[])[] = projected.map(
        (row) => implausibleInputIssues(declared, row),
      );
      // GROUPED books: the composition ran blind to the preflight
      // refusals (a gate-only missing field rates cleanly in-engine),
      // so a policy containing refused rows would keep its composed
      // premium and default-tier verdict — exactly the money and
      // verdict the refusal withholds. Fold the refusals in: bump
      // row_errors and strip composed; summarizeBook's ADR-0056 policy
      // accounting (error_policies, premium null) then applies.
      let adjustedPolicies = policies;
      if (grouped && policies) {
        const polCol = spec.book.grouping!.policy_id_column!;
        const refusedByPolicy = new Map<string, number>();
        refusals.forEach((refusal, i) => {
          if (!refusal) return;
          const raw = (rows as readonly Record<string, unknown>[])[i] ?? {};
          // The SAME keying keyedRowsFromBook uses.
          const pid =
            raw[polCol] != null && String(raw[polCol]) !== ""
              ? String(raw[polCol])
              : `row_${i}`;
          refusedByPolicy.set(pid, (refusedByPolicy.get(pid) ?? 0) + 1);
        });
        if (refusedByPolicy.size > 0) {
          adjustedPolicies = policies.map((p) => {
            const n = refusedByPolicy.get(p.policy_id);
            if (!n) return p;
            const { composed: _withheld, ...rest } = p;
            return { ...rest, row_errors: (p.row_errors ?? 0) + n };
          });
        }
      }
      const collected: RunResult[] = [];
      let chunkBase = 0;
      await runBatchChunked(bundle.plan, projected, {
        chunkSize: spec.chunkSize,
        registry,
        run: runOptions,
        onChunk: async (chunk, done, total) => {
          const base = chunkBase;
          chunkBase += chunk.length;
          const out = chunk.map((raw, i) => {
            const idx = base + i;
            const refusal = refusals[idx] ?? null;
            const policyOf = rowPolicy.get(`row_${idx}`);
            // Law 2 — an ungrouped row under a tail that yielded NO
            // composed build-up is a FAILED composition, refused by
            // name — never a silent fallback to the pre-floor number.
            const compositionIssue: RowIssue | null =
              !refusal &&
              raw.row_status !== "error" &&
              !grouped &&
              hasTail &&
              policies !== null &&
              (policyOf === undefined ||
                policyOf.composed === undefined ||
                (policyOf.row_errors ?? 0) > 0)
                ? {
                    severity: "error",
                    code: "composition_failed",
                    nodeId: "policy_tail",
                    message:
                      "The filed premium could not be composed for " +
                      "this row — the plan tail produced no composed " +
                      "premium.",
                  }
                : null;
            const warned: RunResult =
              (plausibility[idx]?.length ?? 0) > 0
                ? {
                    ...raw,
                    issues: [...(raw.issues ?? []), ...plausibility[idx]!],
                  }
                : raw;
            let result: RunResult = warned;
            if (refusal) {
              // The withheld verdict must not survive anywhere — the
              // engine's default-tier grace verdict rode
              // eligibility_tier.
              const { eligibility_tier: _withheld, ...rest } = warned;
              result = {
                ...rest,
                row_status: "error",
                issues: [...(warned.issues ?? []), refusal],
              };
            } else if (compositionIssue) {
              result = {
                ...warned,
                row_status: "error",
                issues: [...(warned.issues ?? []), compositionIssue],
              };
            }
            const rowOk = result.row_status !== "error";
            const policy = rowOk ? policyOf : undefined;
            const composed = policy?.composed;
            collected.push(
              policy
                ? { ...result, eligibility_tier: policy.appetite.tier }
                : result,
            );
            const views = deriveViews(result, spec.views, planPremium);
            return {
              outputs: result.outputs,
              // Law 1 — when the row composes, THE premium is
              // composed.final (the filed number, floor applied), and
              // the verdict is the policy-precedence appetite tier —
              // byte-identical to what quote_risk returns for the same
              // inputs. An error row (refused, failed composition, or
              // engine error) carries no money and no verdict — same
              // clamp scoreOne applies.
              views: !rowOk
                ? { premium: null, perCoverage: {}, tier: null }
                : {
                    ...views,
                    ...(composed !== undefined
                      ? {
                          premium: composed.final,
                          premiumBasis: "composed" as const,
                        }
                      : {}),
                    ...(policy !== undefined
                      ? { tier: policy.appetite.tier }
                      : {}),
                  },
              as_of: result.as_of,
              row_status: result.row_status,
              // Brief 75 phase 4 — a book row keeps its PROJECTED inputs
              // + resolved verdict: the persisted run is the exhibits'
              // whole substrate (Analytics slices by input dims).
              inputs: projected[idx] ?? {},
              // FCA #13/#S2 passthrough — the caller's RAW row rides
              // along (PolicyNbr and friends): identifying row 3 as
              // CM-26-000502 used to require hand-counting against the
              // source CSV; the run surface and the CSV export can now
              // name it.
              source:
                (rows as readonly Record<string, unknown>[])[idx] ?? {},
              ...(policy
                ? { eligibility_tier: policy.appetite.tier }
                : rowOk && result.eligibility_tier
                  ? { eligibility_tier: result.eligibility_tier }
                  : {}),
              ...(result.issues && result.issues.length > 0
                ? { rowIssues: result.issues }
                : {}),
              ...(composed !== undefined ? { composed } : {}),
              ...(spec.trace !== "none"
                ? { trace: projectTrace(result.trace, spec.trace) }
                : {}),
            };
          });
          await store.appendResults(jobId, out);
          await queue.update(jobId, { progress: { done, total } });
        },
      });
      // Per-row ledger premium: the composed final when the row is its
      // own policy (ungrouped), else the plan-aware views resolution
      // (the declared aggregate, the lone money output, or the total-
      // less coverage sum), else the book's declared premium field.
      const rowPremiumField = premiumRollupFieldOf(spec.book, planPremium);
      const summary = summarizeBook(
        collected,
        rows as readonly Record<string, unknown>[],
        (r, i) => {
          const composed =
            r.row_status !== "error"
              ? rowPolicy.get(`row_${i}`)?.composed
              : undefined;
          if (composed !== undefined) return composed.final;
          const v = deriveViews(r, spec.views, planPremium).premium;
          if (v !== null) return v;
          const f = r.outputs[rowPremiumField];
          return typeof f === "number" && Number.isFinite(f) ? f : null;
        },
        spec.book,
        adjustedPolicies,
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
