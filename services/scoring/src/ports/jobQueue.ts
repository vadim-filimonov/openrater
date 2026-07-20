/**
 * JobQueue port (ADR-0045 §4).
 *
 * The seam that becomes AWS SQS (+ a small status store) in production.
 * Local adapters: InMemoryJobQueue (zero-dep default) + RedisJobQueue
 * (docker-compose). The interface owns the job LIFECYCLE record
 * (status/progress); bulk artifacts (input rows, result NDJSON) live in
 * the ResultStore. Swapping to SQS is implementing this interface +
 * `QUEUE_DRIVER=sqs` — no core or engine change.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobProgress {
  readonly done: number;
  readonly total: number;
}

export interface JobRecord {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly progress: JobProgress;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: string;
}

export type JobUpdate = Partial<
  Pick<JobRecord, "status" | "progress" | "startedAt" | "finishedAt" | "error">
>;

export interface JobQueue {
  /** Persist a new job record (status "queued") and make it claimable. */
  enqueue(record: JobRecord): Promise<void>;
  /**
   * Claim the next ready job id, blocking up to `timeoutMs` for one.
   * Returns null on timeout. Local adapters remove-on-claim (no
   * redelivery on crash — acceptable for the interim; the SQS adapter
   * maps this to receive + visibility-timeout + ack).
   */
  claim(timeoutMs: number): Promise<string | null>;
  /** Merge a lifecycle patch into a job record. */
  update(jobId: string, patch: JobUpdate): Promise<void>;
  /** Read the current job record, or null if unknown. */
  get(jobId: string): Promise<JobRecord | null>;
  /** Readiness probe — true when the backing store is reachable. */
  ping(): Promise<boolean>;
  /** Release resources (connections). */
  close(): Promise<void>;
}
