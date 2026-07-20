/**
 * Typed errors with an HTTP status, so the thin HTTP layer can map a
 * core failure to a response without knowing the core's internals.
 * The core throws these; `http/server.ts` translates them.
 */

export class ServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** 400 — the request was malformed (bad plan, bad inputs). */
export function badRequest(message: string, details?: unknown): ServiceError {
  return new ServiceError(400, "bad_request", message, details);
}

/** 404 — a referenced resource (e.g. plan_id) does not exist. */
export function notFound(message: string): ServiceError {
  return new ServiceError(404, "not_found", message);
}

/** 501 — a request shape is accepted by the schema but not yet wired. */
export function notImplemented(message: string): ServiceError {
  return new ServiceError(501, "not_implemented", message);
}
