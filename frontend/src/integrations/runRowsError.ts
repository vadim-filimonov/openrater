/**
 * runRowsError — FCA fca-2026-07-25 #22 (finding 146).
 *
 * The run drawer's rows-fetch error used to render one hardcoded
 * guess ("the result store has let them go") no matter what the API
 * said — swallowing the server's honest, actionable refusal ("re-run
 * the book to regenerate them"). One rule: relay the API's own
 * message when there is one; never invent a cause.
 */

import { RaterApiError } from "@openrater/api-client";

export function runRowsErrorMessage(error: unknown): string {
  if (error instanceof RaterApiError && error.message.trim() !== "") {
    return error.message;
  }
  return "The rows for this run couldn't be loaded.";
}
