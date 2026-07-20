/**
 * S3ResultStore — AWS adapter STUB ("Switch to AWS", ADR-0045).
 *
 * NOT wired in the interim local build. To go to production: implement
 * these against the same ResultStore interface and set `STORE_DRIVER=s3`
 * + `S3_BUCKET`. Mapping notes:
 *   • saveSpec/saveInput → PutObject (jobs/<id>/spec.json, input.ndjson)
 *   • appendResults      → multipart upload parts (or buffer-then-Put per
 *     chunk to jobs/<id>/results.ndjson)
 *   • readResults        → GetObject with a byte Range for pagination
 *   • resultLocation     → a presigned GetObject URL (download without
 *     proxying bytes through the service)
 * Constructor throws so a misconfigured STORE_DRIVER=s3 fails fast.
 */

import type {
  ResultPage,
  ResultStoreWithSummary,
} from "../../ports/resultStore";

const NOT_CONFIGURED =
  "S3ResultStore is a stub — implement it for AWS (ADR-0045 'Switch to AWS') before setting STORE_DRIVER=s3.";

export class S3ResultStore implements ResultStoreWithSummary {
  constructor(config: { readonly bucket: string }) {
    void config;
    throw new Error(NOT_CONFIGURED);
  }

  async saveSpec(jobId: string, spec: unknown): Promise<void> {
    void jobId;
    void spec;
    throw new Error(NOT_CONFIGURED);
  }

  async loadSpec(jobId: string): Promise<unknown | null> {
    void jobId;
    throw new Error(NOT_CONFIGURED);
  }

  async saveInput(jobId: string, rows: readonly unknown[]): Promise<void> {
    void jobId;
    void rows;
    throw new Error(NOT_CONFIGURED);
  }

  async loadInput(jobId: string): Promise<readonly unknown[]> {
    void jobId;
    throw new Error(NOT_CONFIGURED);
  }

  async appendResults(jobId: string, rows: readonly unknown[]): Promise<void> {
    void jobId;
    void rows;
    throw new Error(NOT_CONFIGURED);
  }

  async readResults(
    jobId: string,
    offset: number,
    limit: number,
  ): Promise<ResultPage> {
    void jobId;
    void offset;
    void limit;
    throw new Error(NOT_CONFIGURED);
  }

  async saveSummary(jobId: string, summary: unknown): Promise<void> {
    void jobId;
    void summary;
    throw new Error(NOT_CONFIGURED);
  }

  async loadSummary(jobId: string): Promise<unknown | null> {
    void jobId;
    throw new Error(NOT_CONFIGURED);
  }

  resultLocation(jobId: string): string {
    void jobId;
    throw new Error(NOT_CONFIGURED);
  }

  async ping(): Promise<boolean> {
    return false;
  }

  async close(): Promise<void> {
    /* nothing */
  }
}
