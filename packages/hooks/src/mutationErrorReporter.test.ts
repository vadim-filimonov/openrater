import { describe, it, expect, beforeEach } from "vitest";
import { RaterApiError } from "@openrater/api-client";
import { apiErrorBus } from "@openrater/design-system/error-bus";
import { reportMutationError, reportMutationSuccess } from "./mutationErrorReporter";

describe("reportMutationError", () => {
  beforeEach(() => {
    apiErrorBus.clear();
  });

  // The core "save fails → error shown" assertion at the policy layer:
  // a failed mutation surfaces on the bus.
  it("pushes a notice to the bus on a mutation failure", () => {
    reportMutationError(
      new RaterApiError({ status: 0, code: "network_error", message: "Failed to fetch" }),
    );
    const snap = apiErrorBus.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.message).toMatch(/couldn't reach api lab/i);
  });

  it("suppresses the global surface when the call site handles it inline", () => {
    reportMutationError(
      new RaterApiError({ status: 409, code: "conflict", message: "taken" }),
      { localErrorSurface: true },
    );
    expect(apiErrorBus.getSnapshot()).toHaveLength(0);
  });

  it("wires a retry callback through to the notice when provided", () => {
    let retried = 0;
    reportMutationError(
      new RaterApiError({ status: 0, code: "network_error", message: "x" }),
      { retry: () => (retried += 1) },
    );
    const notice = apiErrorBus.getSnapshot()[0];
    expect(notice?.retry).toBeTypeOf("function");
    notice?.retry?.();
    expect(retried).toBe(1);
  });
});

describe("reportMutationSuccess — I6 (clear stale save-failure cards on success)", () => {
  beforeEach(() => {
    apiErrorBus.clear();
  });

  it("clears a lingering error card when a later save succeeds", () => {
    reportMutationError(
      new RaterApiError({ status: 422, code: "validation_error", message: "bad body" }),
    );
    expect(apiErrorBus.getSnapshot()).toHaveLength(1);
    reportMutationSuccess();
    expect(apiErrorBus.getSnapshot()).toHaveLength(0);
  });

  it("leaves the global stack alone for a call site that owns its surface", () => {
    reportMutationError(
      new RaterApiError({ status: 0, code: "network_error", message: "x" }),
    );
    reportMutationSuccess({ localErrorSurface: true });
    expect(apiErrorBus.getSnapshot()).toHaveLength(1);
  });
});
