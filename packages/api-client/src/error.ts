/**
 * Typed error shape — every @openrater/api-client function rejects with
 * a RaterApiError. Per VISION Part 0 §2: errors are explanations, not
 * codes. The component layer turns these into user-facing messages.
 */

export interface RaterApiErrorDetail {
  /** Stable identifier the UI branches on. */
  code: string;
  /** Human-readable detail from the server (or our fetch wrapper). */
  message: string;
  /** Optional JSON pointer into the request payload, when the server
   * surfaces a field-scoped error. */
  field?: string;
}

export class RaterApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  readonly raw: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    field?: string;
    raw?: unknown;
  }) {
    super(opts.message);
    this.name = "RaterApiError";
    this.status = opts.status;
    this.code = opts.code;
    if (opts.field !== undefined) this.field = opts.field;
    this.raw = opts.raw;
  }
}

/**
 * Map a fetch Response to a RaterApiError. Recognizes three response
 * shapes, in priority order:
 *
 *   1. `openrater.errors` envelope (the production shape — every
 *      `RaterError` subclass flows through `register_error_handlers`):
 *        { "error": { "code": "...", "message": "...",
 *                     "param": "...", "hint": "...", "details": {...} } }
 *
 *   2. Plain FastAPI `{detail: {message: "..."}}` (used by a handful
 *      of bare HTTPException raises that don't go through our error
 *      registry yet — fallback for the unmigrated routes).
 *
 *   3. FastAPI `{detail: "string"}` — same fallback, scalar form.
 *
 * Anything else (no JSON, unrecognized shape) falls back to the HTTP
 * status text, so the dialog at least shows "Conflict" instead of
 * "[object Object]" on the rare unhappy path.
 */
export async function errorFromResponse(res: Response): Promise<RaterApiError> {
  let parsed: unknown = undefined;
  try {
    parsed = await res.json();
  } catch {
    /* not JSON — fall through */
  }

  // Shape 1: openrater.errors envelope. The `code` here is the STABLE
  // contract code (e.g. `snapshot_name_collision`) that clients
  // switch on — promote it over the generic HTTP-status-derived code.
  if (parsed && typeof parsed === "object") {
    const env = (parsed as { error?: unknown }).error;
    if (env && typeof env === "object") {
      const e = env as {
        code?: unknown;
        message?: unknown;
        param?: unknown;
      };
      if (typeof e.message === "string") {
        const code =
          typeof e.code === "string" ? e.code : codeForStatus(res.status);
        const out: {
          status: number;
          code: string;
          message: string;
          field?: string;
          raw?: unknown;
        } = {
          status: res.status,
          code,
          message: e.message,
          raw: parsed,
        };
        if (typeof e.param === "string") out.field = e.param;
        return new RaterApiError(out);
      }
    }
  }

  // Shape 2 + 3: FastAPI `{detail: ...}` fallback for routes that
  // bypass the openrater.errors registry.
  const detail =
    parsed && typeof parsed === "object"
      ? (parsed as { detail?: unknown }).detail
      : undefined;

  if (typeof detail === "string") {
    return new RaterApiError({
      status: res.status,
      code: codeForStatus(res.status),
      message: detail,
      raw: parsed,
    });
  }

  if (detail && typeof detail === "object") {
    const d = detail as { message?: unknown; report?: unknown };
    if (typeof d.message === "string") {
      return new RaterApiError({
        status: res.status,
        code: codeForStatus(res.status),
        message: d.message,
        raw: parsed,
      });
    }
  }

  return new RaterApiError({
    status: res.status,
    code: codeForStatus(res.status),
    message: res.statusText || `Request failed with ${res.status}`,
    raw: parsed,
  });
}

function codeForStatus(s: number): string {
  if (s === 400) return "bad_request";
  if (s === 401) return "unauthorized";
  if (s === 403) return "forbidden";
  if (s === 404) return "not_found";
  if (s === 409) return "conflict";
  if (s === 422) return "validation_failed";
  if (s >= 500) return "server_error";
  return "request_failed";
}
