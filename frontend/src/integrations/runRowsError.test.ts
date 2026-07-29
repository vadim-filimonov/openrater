/**
 * FCA #22 (finding 146) — the drawer must relay the API's own rows
 * refusal, not replace it with a hardcoded guess.
 */

import { describe, expect, it } from "vitest";
import { RaterApiError } from "@openrater/api-client";

import { runRowsErrorMessage } from "./runRowsError";

describe("runRowsErrorMessage", () => {
  it("relays the API's own refusal verbatim — the actionable sentence survives", () => {
    const err = new RaterApiError({
      status: 502,
      code: "scoring_failed",
      message:
        "The scoring service no longer holds results for job j1 — " +
        "re-run the book to regenerate them.",
    });
    expect(runRowsErrorMessage(err)).toBe(
      "The scoring service no longer holds results for job j1 — " +
        "re-run the book to regenerate them.",
    );
  });

  it("falls back to a plain sentence on non-API errors, never a fabricated cause", () => {
    expect(runRowsErrorMessage(new TypeError("fetch failed"))).toBe(
      "The rows for this run couldn't be loaded.",
    );
    const fallback = runRowsErrorMessage(null);
    expect(fallback).toBe("The rows for this run couldn't be loaded.");
    expect(fallback).not.toMatch(/result store has let them go/);
  });
});
