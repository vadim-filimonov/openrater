import { describe, expect, it } from "vitest";
import { derivePlanStatus } from "./plan-status";

const pv = {
  snapshot_id: "ps_abc",
  display_name: "v1",
  published_at: "2026-07-11T00:00:00Z",
};

describe("derivePlanStatus (Brief 84 §1)", () => {
  it("draft: no published version", () => {
    expect(derivePlanStatus({ status: "draft" })).toEqual({ kind: "draft" });
    expect(
      derivePlanStatus({ status: "draft", published_version: null }),
    ).toEqual({ kind: "draft" });
  });

  it("live: a published version exists — regardless of backend status", () => {
    expect(
      derivePlanStatus({ status: "draft", published_version: pv }),
    ).toEqual({
      kind: "live",
      versionName: "v1",
      diverged: false,
      liveIntegrationCount: 0,
    });
  });

  it("live carries drift + connection facts", () => {
    expect(
      derivePlanStatus({
        status: "draft",
        published_version: pv,
        diverged: true,
        live_integration_count: 2,
      }),
    ).toEqual({
      kind: "live",
      versionName: "v1",
      diverged: true,
      liveIntegrationCount: 2,
    });
  });

  it("archived wins over everything — the API is off", () => {
    expect(
      derivePlanStatus({
        status: "archived",
        published_version: pv,
        diverged: true,
      }),
    ).toEqual({ kind: "archived" });
  });

  it("backend-active with nothing published reads as DRAFT (never overpromise)", () => {
    expect(derivePlanStatus({ status: "active" })).toEqual({ kind: "draft" });
    expect(derivePlanStatus({ status: "proposed" })).toEqual({
      kind: "draft",
    });
  });

  it("missing optional facts default honestly", () => {
    const d = derivePlanStatus({ status: "proposed", published_version: pv });
    expect(d).toEqual({
      kind: "live",
      versionName: "v1",
      diverged: false,
      liveIntegrationCount: 0,
    });
  });
});
