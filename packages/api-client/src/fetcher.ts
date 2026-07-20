/**
 * Shared fetch wrapper.
 *
 * - Prepends API_BASE
 * - Sends + accepts JSON
 * - Maps non-2xx → RaterApiError
 * - Parses 2xx body through a Zod schema (typed result)
 *
 * Every per-entity client function goes through this. No raw fetch
 * elsewhere in @openrater/api-client.
 */

import type { z } from "zod";
import { getApiBase } from "./config";
import { errorFromResponse, RaterApiError } from "./error";
import type { HttpMethod } from "./fetcher-types";
import {
  fixtureMissBehavior,
  isFixtureModeEnabled,
  materializeFixture,
  resolveFixture,
} from "./fixtures";

interface RequestOpts<TSchema extends z.ZodTypeAny> {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Raw (non-JSON) request body — Brief 92's workbook upload. The
   *  bytes ship as-is with `content-type: application/octet-stream`
   *  (override via `headers`). Mutually exclusive with `body`. */
  rawBody?: BodyInit;
  /** Zod schema to validate the response body. */
  schema: TSchema;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Extra request headers (v4 G14 — `If-Match` preconditions). */
  headers?: Record<string, string>;
}

export async function request<TSchema extends z.ZodTypeAny>(
  opts: RequestOpts<TSchema>,
): Promise<z.infer<TSchema>> {
  const { method = "GET", path, query, body, rawBody, schema, signal, headers } =
    opts;

  // Fixture-mode short-circuit (M4.0). When enabled, the registry
  // owns the response. On a miss, behavior is governed by
  // `enableFixtureMode({ onMiss })`:
  //   · "error"   — throw `fixture_not_found` (default; right for tests).
  //   · "network" — fall through to the real fetch (right for dev
  //                 bootstraps that fixture-fill some endpoints but
  //                 keep others against the real backend).
  if (isFixtureModeEnabled()) {
    const resolved = resolveFixture(method, path);
    if (resolved !== null) {
      const queryParams = buildQueryParams(query);
      const value = materializeFixture(
        resolved.fixture,
        resolved.params,
        queryParams,
      );
      // Still validate via the calling function's Zod schema —
      // fixtures that drift from the contract surface immediately.
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new RaterApiError({
          status: 0,
          code: "fixture_schema_mismatch",
          message:
            `Fixture for ${method} ${path} did not match the expected schema. ` +
            `Update the fixture to match the contract.`,
          raw: { issues: parsed.error.issues, fixtureValue: value },
        });
      }
      return parsed.data;
    }
    if (fixtureMissBehavior() === "error") {
      throw new RaterApiError({
        status: 0,
        code: "fixture_not_found",
        message:
          `Fixture mode is enabled but no fixture matches ${method} ${path}. ` +
          `Register one with setFixture() / setFixturePattern(), enable ` +
          `fixture mode with onMiss: "network" to fall through to the ` +
          `backend, or disable fixture mode entirely.`,
      });
    }
    // onMiss: "network" — fall through to the real fetch below.
  }

  const url = buildUrl(path, query);
  const init: RequestInit = {
    method,
    headers: {
      "content-type":
        rawBody !== undefined ? "application/octet-stream" : "application/json",
      accept: "application/json",
      ...(headers ?? {}),
    },
  };
  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  if (signal) {
    init.signal = signal;
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // Network-level failure (CORS, no internet, server down).
    throw new RaterApiError({
      status: 0,
      code: "network_error",
      message: e instanceof Error ? e.message : "Network request failed",
      raw: e,
    });
  }

  if (!res.ok) {
    throw await errorFromResponse(res);
  }

  // Some endpoints return 204 No Content (e.g. delete + the discard
  // route may); guard against parsing an empty body.
  if (res.status === 204) {
    return schema.parse(undefined);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new RaterApiError({
      status: res.status,
      code: "invalid_json",
      message: "Server returned a 2xx but the response body is not valid JSON.",
    });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new RaterApiError({
      status: res.status,
      code: "schema_mismatch",
      message:
        "Server response did not match the expected schema. This usually means " +
        "the backend was upgraded but the frontend wasn't redeployed.",
      raw: { issues: parsed.error.issues, body: json },
    });
  }

  return parsed.data;
}

function buildUrl(
  path: string,
  query: Record<string, string | number | boolean | undefined | null> | undefined,
): string {
  const base = getApiBase();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function buildQueryParams(
  query: Record<string, string | number | boolean | undefined | null> | undefined,
): URLSearchParams {
  const params = new URLSearchParams();
  if (!query) return params;
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return params;
}
