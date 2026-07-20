/**
 * WebhookConfigDrawer module — webhook helper tests.
 *
 * The v1 <WebhookConfigDrawer> component was deleted in the v2 cutover
 * (2026-06-09); WebhookSource (v2) is its replacement. This module still
 * exports the pure helpers WebhookSource composes — `emptyWebhookConfig`,
 * `applyAuthToHeaders`, `testWebhookRequest` — and these are their tests
 * (the component-render tests went with the component).
 */

import { describe, it, expect, vi } from "vitest";
import {
  applyAuthToHeaders,
  emptyWebhookConfig,
  testWebhookRequest,
} from "./WebhookConfigDrawer";
import type { WebhookConfig } from "./WebhookConfigDrawer";

const baseConfig: WebhookConfig = {
  kind: "webhook",
  url: "https://api.example.com/score",
  method: "GET",
  headers: { Accept: "application/json" },
  auth: { kind: "none" },
  payload_schema: {
    content_type: "application/json",
    root_path: "",
    fields: [],
  },
};

describe("emptyWebhookConfig", () => {
  it("returns a valid WebhookConfig with empty fields", () => {
    const c = emptyWebhookConfig();
    expect(c.kind).toBe("webhook");
    expect(c.method).toBe("GET");
    expect(c.auth?.kind).toBe("none");
    expect(c.payload_schema.fields).toEqual([]);
  });
});

describe("applyAuthToHeaders", () => {
  it("returns headers unchanged for kind=none", () => {
    const out = applyAuthToHeaders(
      { Accept: "application/json" },
      { kind: "none" },
      {},
    );
    expect(out).toEqual({ Accept: "application/json" });
  });

  it("adds an api-key header from env", () => {
    const out = applyAuthToHeaders(
      {},
      { kind: "api-key", header_name: "X-Key", value_env: "MY_KEY" },
      { MY_KEY: "secret-value" },
    );
    expect(out["X-Key"]).toBe("secret-value");
  });

  it("skips api-key when env value is missing", () => {
    const out = applyAuthToHeaders(
      {},
      { kind: "api-key", header_name: "X-Key", value_env: "MISSING" },
      {},
    );
    expect(out["X-Key"]).toBeUndefined();
  });

  it("adds Basic auth header from env", () => {
    const out = applyAuthToHeaders(
      {},
      { kind: "basic", username_env: "U", password_env: "P" },
      { U: "alice", P: "wonderland" },
    );
    expect(out["Authorization"]).toBe(`Basic ${btoa("alice:wonderland")}`);
  });

  it("adds Bearer auth header from env", () => {
    const out = applyAuthToHeaders(
      {},
      { kind: "bearer", token_env: "T" },
      { T: "abc123" },
    );
    expect(out["Authorization"]).toBe("Bearer abc123");
  });

  it("preserves base headers when adding auth", () => {
    const out = applyAuthToHeaders(
      { Accept: "application/json", "X-Tenant": "demo" },
      { kind: "bearer", token_env: "T" },
      { T: "abc123" },
    );
    expect(out["Accept"]).toBe("application/json");
    expect(out["X-Tenant"]).toBe("demo");
    expect(out["Authorization"]).toBe("Bearer abc123");
  });

  it("does not mutate the input headers", () => {
    const baseHeaders = { Accept: "application/json" };
    applyAuthToHeaders(
      baseHeaders,
      { kind: "bearer", token_env: "T" },
      { T: "abc" },
    );
    expect(baseHeaders).toEqual({ Accept: "application/json" });
  });
});

describe("testWebhookRequest", () => {
  it("returns error when URL doesn't start with http(s)", async () => {
    const r = await testWebhookRequest(
      { ...baseConfig, url: "ftp://example.com" },
      {},
      vi.fn() as unknown as typeof globalThis.fetch,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/http/);
  });

  it("returns error when fetch is unavailable", async () => {
    const r = await testWebhookRequest(baseConfig, {}, undefined);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/fetch/);
  });

  it("returns success with status + parsed body on 200", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"a":1}',
    })) as unknown as typeof globalThis.fetch;
    const r = await testWebhookRequest(baseConfig, {}, fetchMock);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"a":1}');
    expect(r.parsed).toEqual({ a: 1 });
  });

  it("returns success: false on non-2xx HTTP", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    })) as unknown as typeof globalThis.fetch;
    const r = await testWebhookRequest(baseConfig, {}, fetchMock);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/401/);
  });

  it("captures duration in ms", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, status: 200, text: async () => "{}" };
    }) as unknown as typeof globalThis.fetch;
    const r = await testWebhookRequest(baseConfig, {}, fetchMock);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.durationMs).toBeLessThan(1000);
  });

  it("applies auth headers via env", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "{}",
    })) as unknown as typeof globalThis.fetch;
    await testWebhookRequest(
      { ...baseConfig, auth: { kind: "bearer", token_env: "TOKEN" } },
      { TOKEN: "abc" },
      fetchMock,
    );
    const callArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = callArgs?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer abc");
  });

  it("survives network failures + returns an error result", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const r = await testWebhookRequest(baseConfig, {}, fetchMock);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it("truncates long response bodies for display", async () => {
    const longBody = "x".repeat(50_000);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => longBody,
    })) as unknown as typeof globalThis.fetch;
    const r = await testWebhookRequest(baseConfig, {}, fetchMock);
    expect((r.body ?? "").length).toBeLessThanOrEqual(10_000);
  });
});
