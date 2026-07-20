/**
 * ResultStore port (ADR-0045 §4).
 *
 * The seam that becomes AWS S3 in production. Local adapter:
 * FilesystemResultStore (NDJSON). Holds the bulk job artifacts — the
 * job spec, the input rows, and the appended per-row results — so big
 * scored books never travel inline in an HTTP response (they stream /
 * paginate from here, or return a store reference). Swapping to S3 is
 * implementing this interface + `STORE_DRIVER=s3`.
 */

export interface ResultPage {
  readonly rows: readonly unknown[];
  readonly total: number;
  readonly offset: number;
  /** Next offset to request, or null when the page reached the end. */
  readonly nextOffset: number | null;
}

export interface ResultStore {
  /** Persist the job definition (everything but the input rows). */
  saveSpec(jobId: string, spec: unknown): Promise<void>;
  loadSpec(jobId: string): Promise<unknown | null>;

  /** Persist the full input row set for a job. */
  saveInput(jobId: string, rows: readonly unknown[]): Promise<void>;
  loadInput(jobId: string): Promise<readonly unknown[]>;

  /** Append a chunk of per-row results (streaming-friendly). */
  appendResults(jobId: string, rows: readonly unknown[]): Promise<void>;
  /** Read a page of results — keeps big books off the response body. */
  readResults(jobId: string, offset: number, limit: number): Promise<ResultPage>;

  /**
   * A durable reference to the full result artifact — a `file://` path
   * locally, a `s3://` URI (or presigned URL) on AWS. The caller can
   * hand this to a downstream consumer instead of streaming bytes.
   */
  resultLocation(jobId: string): string;

  /** Readiness probe. */
  ping(): Promise<boolean>;
  /** Release resources. */
  close(): Promise<void>;
}

/**
 * P3 Brief 75 — the book-run SUMMARY artifact: facet totals + the
 * compact per-row ledger + composed policies, written ONCE by the
 * worker after composition. Small next to results.ndjson (compact
 * rows, no traces) but still a job artifact — it lives here, not in
 * the queue record.
 */
export interface ResultStoreWithSummary extends ResultStore {
  saveSummary(jobId: string, summary: unknown): Promise<void>;
  loadSummary(jobId: string): Promise<unknown | null>;
}
