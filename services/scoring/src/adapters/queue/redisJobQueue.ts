/**
 * RedisJobQueue — local adapter that survives restarts + works across
 * separate server/worker PROCESSES (docker-compose `redis` profile).
 *
 * Job ids ride a Redis list (LPUSH/BRPOP — BRPOP gives real blocking
 * claims across processes); the lifecycle record is a JSON string per
 * job. This is the closest local analogue to the SQS shape, so the
 * SQS adapter is a sibling swap, not a leap.
 *
 * NOTE: `update` is read-modify-write (last-writer-wins) — fine for the
 * single-worker-per-job interim; the AWS path would use atomic updates.
 */

import { Redis } from "ioredis";

import type {
  JobQueue,
  JobRecord,
  JobUpdate,
} from "../../ports/jobQueue";

const READY_LIST = "scoring:jobs:ready";
const recordKey = (jobId: string): string => `scoring:job:${jobId}`;

export class RedisJobQueue implements JobQueue {
  private readonly redis: Redis;

  constructor(url: string) {
    // maxRetriesPerRequest: null keeps BRPOP from erroring under retry.
    this.redis = new Redis(url, { maxRetriesPerRequest: null });
  }

  async enqueue(record: JobRecord): Promise<void> {
    await this.redis.set(recordKey(record.jobId), JSON.stringify(record));
    await this.redis.lpush(READY_LIST, record.jobId);
  }

  async claim(timeoutMs: number): Promise<string | null> {
    const timeoutSec = Math.max(0, Math.ceil(timeoutMs / 1000));
    if (timeoutSec === 0) {
      return (await this.redis.rpop(READY_LIST)) ?? null;
    }
    const popped = await this.redis.brpop(READY_LIST, timeoutSec);
    return popped ? popped[1] : null;
  }

  async update(jobId: string, patch: JobUpdate): Promise<void> {
    const current = await this.get(jobId);
    if (!current) return;
    await this.redis.set(
      recordKey(jobId),
      JSON.stringify({ ...current, ...patch }),
    );
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const raw = await this.redis.get(recordKey(jobId));
    return raw ? (JSON.parse(raw) as JobRecord) : null;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
