/**
 * <WebhookConfigDrawer> — Brief 38 PR 38.7 Q7 ★ pivot.
 *
 * The webhook config form from Frame 5 of the Brief 38 mockup. The
 * user pivoted from "simple sample-payload" to "configurable webhook"
 * during the §−1 walkthrough — so this drawer is the heaviest UI in
 * the brief: URL + method + headers + 4 auth modes + payload schema +
 * auto-infer + test-request.
 *
 * Controlled — parent owns the WebhookConfig + emits onChange on
 * every edit. The drawer fires three side-channel callbacks:
 *
 *   - onTest    — fires a single request, renders result inline
 *   - onInfer   — auto-fetches a sample, populates payload_schema.fields
 *   - onSave    — confirms the config (parent persists to Plan.input_mapping)
 *   - onDiscard — closes without saving
 *
 * SECURITY: secrets are stored as ENV-VAR NAMES, never raw values
 * (per Brief 38 §9). The drawer renders `*_env: "VAR_NAME"` input
 * fields; the API Lab runtime resolves at request time. For the
 * TEST action, the caller may temporarily inject a transient secret
 * via the testSecrets prop — never persisted.
 *
 * Pure presentation. The actual HTTP request is the caller's
 * responsibility (testWebhookRequest provides a reference impl).
 */

// The v1 <WebhookConfigDrawer> primitive was deleted in the v2 cutover
// (2026-06-09); this module now exports only the reused types + helpers
// (emptyWebhookConfig / applyAuthToHeaders / testWebhookRequest), which
// WebhookSource (v2) composes.
import type { PayloadSchemaField } from "./inferPayloadSchema";

// ─────────────────────────────────────────────────────────────────
// Substrate-mirror types
//
// These mirror Plan.input_mapping.source (webhook variant) from
// Brief 38 PR 38.1's @openrater/contracts addition. We define them
// locally here because PR 38.1 may not have merged yet — once it
// does, swap these to imports.
// ─────────────────────────────────────────────────────────────────

export type AuthSpec =
  | { readonly kind: "none" }
  | {
      readonly kind: "api-key";
      readonly header_name: string;
      readonly value_env: string;
    }
  | {
      readonly kind: "basic";
      readonly username_env: string;
      readonly password_env: string;
    }
  | {
      readonly kind: "bearer";
      readonly token_env: string;
    };

export interface PayloadSchema {
  readonly content_type:
    | "application/json"
    | "application/x-www-form-urlencoded";
  readonly root_path?: string;
  readonly fields: readonly PayloadSchemaField[];
}

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * The narrow webhook variant of SourceSpec (from PR 38.1). We model
 * this explicitly to avoid type-narrowing repeatedly in the body.
 */
export interface WebhookConfig {
  readonly kind: "webhook";
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth?: AuthSpec;
  readonly payload_schema: PayloadSchema;
}

export interface WebhookTestResult {
  readonly ok: boolean;
  /** HTTP status code on success; missing on network errors. */
  readonly status?: number;
  /** Wall-clock duration of the request. */
  readonly durationMs?: number;
  /**
   * Truncated response body (first ~10 KB) for display. The parsed
   * structured value is passed separately via `parsed`.
   */
  readonly body?: string;
  /** Decoded body (JSON.parse of the response). */
  readonly parsed?: unknown;
  /**
   * Fields inferred from the parsed body via `inferPayloadSchema`.
   * Populated when the test ran successfully and inference applied.
   */
  readonly inferredFields?: readonly PayloadSchemaField[];
  /** Error message on failure. */
  readonly error?: string;
}


// ─────────────────────────────────────────────────────────────────
// Initial / default values
// ─────────────────────────────────────────────────────────────────

/**
 * Build a sensible empty WebhookConfig — useful when transitioning
 * a SourceSpec from CSV → Webhook for the first time.
 */
export function emptyWebhookConfig(): WebhookConfig {
  return {
    kind: "webhook",
    url: "",
    method: "GET",
    headers: {},
    auth: { kind: "none" },
    payload_schema: {
      content_type: "application/json",
      root_path: "",
      fields: [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Reference test-request implementation
// ─────────────────────────────────────────────────────────────────

/**
 * Helper to map AuthSpec + env to fetch Headers. Resolves env-var
 * names through the supplied `env` map (typically `process.env` on
 * Node, or a transient testSecrets object in the browser).
 *
 * Returns the next headers object — does NOT mutate input.
 */
export function applyAuthToHeaders(
  baseHeaders: Readonly<Record<string, string>>,
  auth: AuthSpec | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = { ...baseHeaders };
  if (!auth || auth.kind === "none") return out;
  if (auth.kind === "api-key") {
    const v = env[auth.value_env];
    if (v) out[auth.header_name] = v;
    return out;
  }
  if (auth.kind === "basic") {
    const u = env[auth.username_env];
    const p = env[auth.password_env];
    if (u && p) {
      // btoa is universal — present in modern browsers AND Node 16+
      // (built-in since Node 16, no Buffer import needed).
      const encoded =
        typeof btoa !== "undefined" ? btoa(`${u}:${p}`) : `${u}:${p}`;
      out["Authorization"] = `Basic ${encoded}`;
    }
    return out;
  }
  if (auth.kind === "bearer") {
    const t = env[auth.token_env];
    if (t) out["Authorization"] = `Bearer ${t}`;
    return out;
  }
  return out;
}

/**
 * Reference implementation of `onTest` — fires a single request,
 * captures status + duration + body. Consumers can pass this
 * directly to `<WebhookConfigDrawer>`'s onTest prop. The `env`
 * argument resolves env-var indirection at request time.
 *
 * Falls back gracefully when `globalThis.fetch` is unavailable
 * (returns an error result rather than throwing).
 */
export async function testWebhookRequest(
  config: WebhookConfig,
  env: Readonly<Record<string, string | undefined>> = {},
  fetchImpl: typeof globalThis.fetch | undefined = typeof globalThis.fetch !== "undefined"
    ? globalThis.fetch.bind(globalThis)
    : undefined,
): Promise<WebhookTestResult> {
  if (!fetchImpl) {
    return {
      ok: false,
      error: "fetch is not available in this environment.",
    };
  }
  if (!/^https?:\/\//.test(config.url)) {
    return { ok: false, error: "URL must start with http:// or https://." };
  }
  const baseHeaders = config.headers ?? {};
  const headers = applyAuthToHeaders(baseHeaders, config.auth, env);
  const init: RequestInit = {
    method: config.method ?? "GET",
    headers,
  };
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await fetchImpl(config.url, init);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body — pass through as-is.
    }
    return {
      ok: res.ok,
      status: res.status,
      durationMs: t1 - t0,
      body: text.slice(0, 10_000),
      ...(parsed !== undefined ? { parsed } : {}),
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown fetch error",
    };
  }
}
