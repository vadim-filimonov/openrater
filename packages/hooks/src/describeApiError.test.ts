import { describe, it, expect } from "vitest";
import { RaterApiError } from "@openrater/api-client";
import { describeApiError } from "./describeApiError";

describe("describeApiError", () => {
  it("maps a network error to the 'backend unreachable' message", () => {
    const d = describeApiError(
      new RaterApiError({ status: 0, code: "network_error", message: "Failed to fetch" }),
    );
    expect(d.title).toBe("Couldn't save your changes");
    expect(d.message).toMatch(/couldn't reach api lab/i);
    expect(d.id).toBe("network_error:0");
    expect(d.detail).toContain("Failed to fetch");
  });

  it("maps a 5xx to the 'server error, retry' message", () => {
    const d = describeApiError(
      new RaterApiError({ status: 500, code: "server_error", message: "boom" }),
    );
    expect(d.message).toMatch(/retry in a moment/i);
    expect(d.id).toBe("server_error:500");
  });

  it("maps schema drift to a 'reload' message", () => {
    const d = describeApiError(
      new RaterApiError({ status: 200, code: "schema_mismatch", message: "drift" }),
    );
    expect(d.message).toMatch(/out of sync/i);
  });

  it("passes a 4xx server message through verbatim (inline-handled floor)", () => {
    const d = describeApiError(
      new RaterApiError({ status: 409, code: "conflict", message: "Name already taken" }),
    );
    expect(d.message).toBe("Name already taken");
    expect(d.id).toBe("conflict:409");
  });

  it("honors a custom action verb in the title", () => {
    const d = describeApiError(
      new RaterApiError({ status: 0, code: "network_error", message: "x" }),
      "create the plan",
    );
    expect(d.title).toBe("Couldn't create the plan");
  });

  it("surfaces a non-RaterApiError throw rather than swallowing it", () => {
    const d = describeApiError(new Error("kaboom"));
    expect(d.message).toBe("kaboom");
    expect(d.detail).toContain("kaboom");
  });
});
