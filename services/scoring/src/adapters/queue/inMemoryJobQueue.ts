/**
 * InMemoryJobQueue — the zero-dependency default local adapter.
 *
 * `pnpm start` / the test suite need no Docker. Single-process only:
 * the route that enqueues and the in-process worker that claims MUST
 * share one instance (wired in src/main.ts / buildApp). State is lost on
 * restart — fine for local dev; production uses Redis or SQS.
 */

import type {
  JobQueue,
  JobRecord,
  JobUpdate,
} from "../../ports/jobQueue";

export class InMemoryJobQueue implements JobQueue {
  private readonly records = new Map<string, JobRecord>();
  private readonly ready: string[] = [];

  async enqueue(record: JobRecord): Promise<void> {
    this.records.set(record.jobId, record);
    this.ready.push(record.jobId);
  }

  async claim(_timeoutMs: number): Promise<string | null> {
    // Non-blocking; the worker loop backs off when this returns null.
    return this.ready.shift() ?? null;
  }

  async update(jobId: string, patch: JobUpdate): Promise<void> {
    const current = this.records.get(jobId);
    if (!current) return;
    this.records.set(jobId, { ...current, ...patch });
  }

  async get(jobId: string): Promise<JobRecord | null> {
    return this.records.get(jobId) ?? null;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
