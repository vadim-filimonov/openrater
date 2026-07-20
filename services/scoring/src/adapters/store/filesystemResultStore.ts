/**
 * FilesystemResultStore — the local ResultStore adapter (NDJSON).
 *
 * Layout: <STORE_DIR>/jobs/<jobId>/{spec.json, input.ndjson, results.ndjson}.
 * NDJSON makes appends cheap (one line per row) and keeps big scored
 * books off the HTTP response — the route paginates `readResults` or
 * hands back `resultLocation` (a file:// URI; an s3:// URI on AWS).
 */

import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ResultPage,
  ResultStoreWithSummary,
} from "../../ports/resultStore";

/** Keep job ids to a safe path segment (they're UUIDs, but be defensive). */
function safeSegment(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9._-]/g, "_");
}

function toNdjson(rows: readonly unknown[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

async function readNdjson(path: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}

export class FilesystemResultStore implements ResultStoreWithSummary {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private jobDir(jobId: string): string {
    return join(this.root, "jobs", safeSegment(jobId));
  }

  private async ensureJobDir(jobId: string): Promise<string> {
    const dir = this.jobDir(jobId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async saveSpec(jobId: string, spec: unknown): Promise<void> {
    const dir = await this.ensureJobDir(jobId);
    await writeFile(join(dir, "spec.json"), JSON.stringify(spec), "utf8");
  }

  async loadSpec(jobId: string): Promise<unknown | null> {
    try {
      const raw = await readFile(join(this.jobDir(jobId), "spec.json"), "utf8");
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async saveInput(jobId: string, rows: readonly unknown[]): Promise<void> {
    const dir = await this.ensureJobDir(jobId);
    await writeFile(join(dir, "input.ndjson"), toNdjson(rows), "utf8");
  }

  async loadInput(jobId: string): Promise<readonly unknown[]> {
    return readNdjson(join(this.jobDir(jobId), "input.ndjson"));
  }

  async appendResults(jobId: string, rows: readonly unknown[]): Promise<void> {
    const dir = await this.ensureJobDir(jobId);
    await appendFile(join(dir, "results.ndjson"), toNdjson(rows), "utf8");
  }

  async readResults(
    jobId: string,
    offset: number,
    limit: number,
  ): Promise<ResultPage> {
    const all = await readNdjson(join(this.jobDir(jobId), "results.ndjson"));
    const rows = all.slice(offset, offset + limit);
    const end = offset + limit;
    return {
      rows,
      total: all.length,
      offset,
      nextOffset: end < all.length ? end : null,
    };
  }

  // P3 Brief 75 — the book-run summary artifact (totals + compact
  // per-row ledger + composed policies), written once post-composition.
  async saveSummary(jobId: string, summary: unknown): Promise<void> {
    const dir = await this.ensureJobDir(jobId);
    await writeFile(join(dir, "summary.json"), JSON.stringify(summary), "utf8");
  }

  async loadSummary(jobId: string): Promise<unknown | null> {
    try {
      const raw = await readFile(
        join(this.jobDir(jobId), "summary.json"),
        "utf8",
      );
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  resultLocation(jobId: string): string {
    return pathToFileURL(join(this.jobDir(jobId), "results.ndjson")).href;
  }

  async ping(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
