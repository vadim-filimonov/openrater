/**
 * 12-factor config — env only, parsed + validated with zod (ADR-0045 §5).
 *
 * NO hardcoded endpoints or credentials. Every variable is documented
 * in services/scoring/README.md. The same variable NAMES carry over to
 * the AWS deployment (task-def / Lambda env + Secrets Manager) — only
 * the driver values change (memory→sqs, fs→s3). Nothing here reads
 * `import.meta.env` (that is browser/Vite-only); this is a Node service.
 */

import { z } from "zod";

const envSchema = z.object({
  /** HTTP listen port for the container/server entrypoint. */
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),

  /** Job queue driver — local now, AWS later (config swap, not rewrite). */
  QUEUE_DRIVER: z.enum(["memory", "redis", "sqs"]).default("memory"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  /** Reserved for the AWS adapter (stub today). */
  SQS_QUEUE_URL: z.string().optional(),

  /** Result/artifact store driver. */
  STORE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  /** Filesystem store root (local). Big scored books land here as NDJSON. */
  STORE_DIR: z.string().default("./.scoring-data"),
  /** Reserved for the AWS adapter (stub today). */
  S3_BUCKET: z.string().optional(),

  /** API Lab base URL — the PlanSource `plan_id` resolver target. */
  API_LAB_BASE: z.string().default("http://127.0.0.1:8001"),

  /** Batch guardrails. */
  MAX_BATCH_ROWS: z.coerce.number().int().positive().default(50_000),
  CHUNK_SIZE: z.coerce.number().int().positive().default(200),

  /** Number of in-process worker loops the server boots (0 = none). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(0).default(1),
});

export type ServiceConfig = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse process.env into a validated config. Throws a readable error
 * (listing the offending vars) on misconfiguration — fail fast at boot,
 * never silently run with a bad endpoint.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid scoring-service config: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
