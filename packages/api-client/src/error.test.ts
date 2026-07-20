/**
 * <errorFromResponse> tests — pins down the three response shapes the
 * fetcher might see in practice:
 *
 *   1. openrater.errors envelope (production shape — every backend
 *      route emits `{"error": {"code": ..., "message": ..., ...}}`).
 *   2. FastAPI `{detail: {message: ...}}` (legacy bare-HTTPException).
 *   3. FastAPI `{detail: "string"}` (legacy bare-HTTPException).
 *
 * Plus the fallback: non-JSON body → use HTTP status text so the UI
 * shows something rather than `[object Object]`.
 *
 * Originally added with PR 43.1 (the FreezeVersionDialog needs the
 * `{"error": {...}}` envelope to surface the inline 409 collision
 * message instead of the generic "Conflict" status text).
 */

import { describe, expect, it } from "vitest";
import { errorFromResponse, RaterApiError } from "./error";

function mockResponse(opts: {
  status: number;
  statusText?: string;
  body?: unknown;
}): Response {
  const body = opts.body === undefined ? null : JSON.stringify(opts.body);
  return new Response(body, {
    status: opts.status,
    statusText: opts.statusText ?? "",
    headers: { "Content-Type": "application/json" },
  });
}

describe("errorFromResponse — openrater.errors envelope", () => {
  it("promotes the envelope code + message over HTTP status defaults", async () => {
    const res = mockResponse({
      status: 409,
      statusText: "Conflict",
      body: {
        error: {
          code: "snapshot_name_collision",
          message: "A snapshot named 'filed_q3' already exists for this plan.",
          param: "display_name",
        },
      },
    });
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(RaterApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("snapshot_name_collision");
    expect(err.message).toBe(
      "A snapshot named 'filed_q3' already exists for this plan.",
    );
    expect(err.field).toBe("display_name");
  });

  it("falls back to the HTTP-derived code when envelope has no code", async () => {
    const res = mockResponse({
      status: 422,
      body: {
        error: {
          message: "Validation error.",
        },
      },
    });
    const err = await errorFromResponse(res);
    expect(err.code).toBe("validation_failed");
    expect(err.message).toBe("Validation error.");
    expect(err.field).toBeUndefined();
  });

  it("ignores envelopes that lack a string message (no UI to surface)", async () => {
    const res = mockResponse({
      status: 500,
      statusText: "Internal Server Error",
      body: { error: { code: "server_error" } },
    });
    const err = await errorFromResponse(res);
    // Falls through to the statusText branch.
    expect(err.message).toBe("Internal Server Error");
    expect(err.code).toBe("server_error");
  });
});

describe("errorFromResponse — FastAPI detail fallback", () => {
  it("parses {detail: 'string'}", async () => {
    const res = mockResponse({
      status: 404,
      body: { detail: "Plan not found." },
    });
    const err = await errorFromResponse(res);
    expect(err.message).toBe("Plan not found.");
    expect(err.code).toBe("not_found");
  });

  it("parses {detail: {message: 'string'}}", async () => {
    const res = mockResponse({
      status: 400,
      body: { detail: { message: "Bad input." } },
    });
    const err = await errorFromResponse(res);
    expect(err.message).toBe("Bad input.");
    expect(err.code).toBe("bad_request");
  });
});

describe("errorFromResponse — fallback", () => {
  it("uses statusText when the body is unrecognized JSON", async () => {
    const res = mockResponse({
      status: 503,
      statusText: "Service Unavailable",
      body: { something: "else" },
    });
    const err = await errorFromResponse(res);
    expect(err.message).toBe("Service Unavailable");
    expect(err.code).toBe("server_error");
  });

  it("uses statusText when the body is not JSON at all", async () => {
    const res = new Response("plain text", {
      status: 502,
      statusText: "Bad Gateway",
    });
    const err = await errorFromResponse(res);
    expect(err.message).toBe("Bad Gateway");
  });

  it("synthesizes a default message when statusText is empty", async () => {
    const res = mockResponse({
      status: 418,
      body: { something: "else" },
    });
    const err = await errorFromResponse(res);
    expect(err.message).toBe("Request failed with 418");
  });
});
