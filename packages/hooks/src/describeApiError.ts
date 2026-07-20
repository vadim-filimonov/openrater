/**
 * describeApiError — turn a thrown error into an actuary-language
 * notice (Brief 58, Pillar A / P-DW5).
 *
 * The global save-failure surface shows the `message` verbatim, with
 * the technical `detail` tucked behind a "Details" expander. No LLM
 * rewriting — a small, hand-authored, deterministic map keyed on the
 * `RaterApiError.code` / `status` the fetcher already assigns.
 *
 * `id` is the coalesce key: identical transport failures (e.g. several
 * saves failing while the backend is down) merge into one card rather
 * than flooding the stack.
 */

import { RaterApiError } from "@openrater/api-client";

export interface ApiErrorDescription {
  /** Coalesce key — same id ⇒ one card with a count. */
  readonly id: string;
  /** Bold lead line. */
  readonly title: string;
  /** Actuary-language explanation. */
  readonly message: string;
  /** Technical detail (status + code + raw message). */
  readonly detail: string;
}

/**
 * @param error  the thrown value (usually a RaterApiError).
 * @param action optional verb phrase, e.g. "create the plan". Defaults
 *               to the generic "save your changes".
 */
export function describeApiError(
  error: unknown,
  action?: string,
): ApiErrorDescription {
  const title = `Couldn't ${action ?? "save your changes"}`;

  if (error instanceof RaterApiError) {
    const detail = `${error.status} ${error.code} — ${error.message}`;
    const id = `${error.code}:${error.status}`;

    // Transport failure — the actuary can least diagnose this, so it
    // gets the clearest call to action.
    if (error.code === "network_error" || error.status === 0) {
      return {
        id,
        title,
        message:
          "Couldn't reach API Lab — your changes weren't saved. Check that the backend is running, then retry.",
        detail,
      };
    }

    // Server error — nothing was saved; transient enough to retry.
    if (error.status >= 500 || error.code === "server_error") {
      return {
        id,
        title,
        message:
          "API Lab hit an error and your changes weren't saved. Retry in a moment.",
        detail,
      };
    }

    // Front-end / back-end contract drift.
    if (
      error.code === "schema_mismatch" ||
      error.code === "fixture_schema_mismatch" ||
      error.code === "invalid_json"
    ) {
      return {
        id,
        title,
        message:
          "The app and the server are out of sync, so your change wasn't saved. Reload to pick up the latest, then retry.",
        detail,
      };
    }

    // 4xx fall-through. These are normally handled inline at the call
    // site (validation/conflict banners); the global surface is only a
    // floor, so we show the server's own message verbatim.
    return { id, title, message: error.message, detail };
  }

  // Non-RaterApiError (a raw throw somewhere). Surface it rather than
  // swallow — that's the whole point of P-DW1.
  const message =
    error instanceof Error
      ? error.message
      : "Something went wrong and your change wasn't saved.";
  return {
    id: `unknown:${message}`,
    title,
    message,
    detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}
