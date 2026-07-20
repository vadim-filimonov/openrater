/**
 * Per-plan API keys (Brief 76, v4 P4.2) — the quote endpoint's optional
 * machine-auth gate. The SECRET is returned exactly once (mint); every
 * read after that is metadata with a recognizable prefix.
 */

import { z } from "zod";
import { request } from "./fetcher";

export const apiKeySummarySchema = z.object({
  key_id: z.string(),
  rating_plan_id: z.string(),
  secret_prefix: z.string(),
  label: z.string().nullable().default(null),
  created_at: z.string(),
  created_by: z.string().nullable().default(null),
  last_used_at: z.string().nullable().default(null),
  revoked_at: z.string().nullable().default(null),
});
export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;

export const apiKeyCreatedSchema = apiKeySummarySchema.extend({
  secret: z.string(),
});
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;

const apiKeyListSchema = z.object({ keys: z.array(apiKeySummarySchema) });

export async function mintApiKey(
  planId: string,
  body: { label?: string } = {},
): Promise<ApiKeyCreated> {
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/api-keys`,
    body,
    schema: apiKeyCreatedSchema,
  });
}

export async function listApiKeys(
  planId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<readonly ApiKeySummary[]> {
  const res = await request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/api-keys`,
    schema: apiKeyListSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  return res.keys;
}

export async function revokeApiKey(
  planId: string,
  keyId: string,
): Promise<void> {
  await request({
    method: "DELETE",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/api-keys/${encodeURIComponent(keyId)}`,
    schema: z.void(),
  });
}
