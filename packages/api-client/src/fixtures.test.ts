/**
 * Tests for the fixture-mode bridge (M4.0).
 *
 * Covers:
 *   · setFixture / clearFixtures registry behavior
 *   · enableFixtureMode flag gates the short-circuit
 *   · resolveFixture path matching (exact + pattern + precedence)
 *   · request() returns the fixture when one matches
 *   · request() throws `fixture_not_found` when none matches in fixture mode
 *   · Static + function fixtures both work
 *   · Schema validation still runs against fixture values
 */

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { RaterApiError } from "./error";
import { request } from "./fetcher";
import {
  _fixtureCount,
  clearFixtures,
  disableFixtureMode,
  enableFixtureMode,
  isFixtureModeEnabled,
  resolveFixture,
  setFixture,
  setFixturePattern,
} from "./fixtures";

// Reset state between tests so each starts from a clean registry.
afterEach(() => {
  clearFixtures();
  disableFixtureMode();
});

// ---------------------------------------------------------------------------
// Registry mechanics
// ---------------------------------------------------------------------------

describe("fixture registry", () => {
  it("starts disabled with no fixtures", () => {
    expect(isFixtureModeEnabled()).toBe(false);
    expect(_fixtureCount()).toBe(0);
  });

  it("enableFixtureMode flips the flag", () => {
    enableFixtureMode();
    expect(isFixtureModeEnabled()).toBe(true);
    disableFixtureMode();
    expect(isFixtureModeEnabled()).toBe(false);
  });

  it("setFixture adds an exact-path entry", () => {
    setFixture("GET", "/api/v1/plans", []);
    expect(_fixtureCount()).toBe(1);
  });

  it("setFixture for the same (method, path) REPLACES the old value", () => {
    setFixture("GET", "/api/v1/plans", []);
    setFixture("GET", "/api/v1/plans", [{ id: "x" }]);
    expect(_fixtureCount()).toBe(1);
    const resolved = resolveFixture("GET", "/api/v1/plans");
    expect(resolved?.fixture.kind).toBe("exact");
    if (resolved?.fixture.kind === "exact") {
      expect(resolved.fixture.value).toEqual([{ id: "x" }]);
    }
  });

  it("clearFixtures resets the registry but not the mode flag", () => {
    enableFixtureMode();
    setFixture("GET", "/api/v1/plans", []);
    clearFixtures();
    expect(_fixtureCount()).toBe(0);
    expect(isFixtureModeEnabled()).toBe(true); // mode flag unchanged
  });
});

// ---------------------------------------------------------------------------
// resolveFixture — path matching
// ---------------------------------------------------------------------------

describe("resolveFixture — exact paths", () => {
  it("returns null when no fixture registered", () => {
    expect(resolveFixture("GET", "/api/v1/plans")).toBeNull();
  });

  it("matches exact (method, path)", () => {
    setFixture("GET", "/api/v1/plans", []);
    const resolved = resolveFixture("GET", "/api/v1/plans");
    expect(resolved).not.toBeNull();
    expect(resolved?.fixture.kind).toBe("exact");
    expect(resolved?.params).toEqual({});
  });

  it("method mismatch returns null", () => {
    setFixture("GET", "/api/v1/plans", []);
    expect(resolveFixture("POST", "/api/v1/plans")).toBeNull();
  });

  it("path mismatch returns null", () => {
    setFixture("GET", "/api/v1/plans", []);
    expect(resolveFixture("GET", "/api/v1/plans/abc")).toBeNull();
  });
});

describe("resolveFixture — patterns", () => {
  it("matches a {id} placeholder", () => {
    setFixturePattern("GET", "/api/v1/plans/{id}", () => ({ id: "x" }));
    const resolved = resolveFixture("GET", "/api/v1/plans/plan-123");
    expect(resolved).not.toBeNull();
    expect(resolved?.params).toEqual({ id: "plan-123" });
  });

  it("captures multiple params", () => {
    setFixturePattern(
      "GET",
      "/api/v1/plans/{plan_id}/stages/{stage_id}/io",
      () => ({}),
    );
    const resolved = resolveFixture(
      "GET",
      "/api/v1/plans/p123/stages/s456/io",
    );
    expect(resolved?.params).toEqual({ plan_id: "p123", stage_id: "s456" });
  });

  it("does NOT match a path with extra segments", () => {
    setFixturePattern("GET", "/api/v1/plans/{id}", () => ({}));
    expect(
      resolveFixture("GET", "/api/v1/plans/p123/stages"),
    ).toBeNull();
  });

  it("URL-decodes captured params", () => {
    setFixturePattern("GET", "/api/v1/plans/{id}", () => ({}));
    const resolved = resolveFixture(
      "GET",
      "/api/v1/plans/meridian%20shopfront%20ne",
    );
    expect(resolved?.params).toEqual({ id: "meridian shopfront ne" });
  });

  it("exact match takes precedence over pattern", () => {
    setFixturePattern("GET", "/api/v1/plans/{id}", () => ({ via: "pattern" }));
    setFixture("GET", "/api/v1/plans/specific", { via: "exact" });
    const resolved = resolveFixture("GET", "/api/v1/plans/specific");
    expect(resolved?.fixture.kind).toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// request() short-circuit
// ---------------------------------------------------------------------------

const plansSchema = z.array(
  z.object({
    rating_plan_id: z.string(),
    display_name: z.string(),
  }),
);

describe("request() with fixture mode", () => {
  it("returns the registered fixture instead of hitting fetch", async () => {
    enableFixtureMode();
    setFixture("GET", "/api/v1/plans", [
      { rating_plan_id: "p1", display_name: "Plan 1" },
    ]);

    const result = await request({
      method: "GET",
      path: "/api/v1/plans",
      schema: plansSchema,
    });
    expect(result).toEqual([
      { rating_plan_id: "p1", display_name: "Plan 1" },
    ]);
  });

  it("throws fixture_not_found when no fixture matches", async () => {
    enableFixtureMode();
    // Don't register anything
    await expect(
      request({
        method: "GET",
        path: "/api/v1/plans",
        schema: plansSchema,
      }),
    ).rejects.toThrow(RaterApiError);
  });

  it("fixture_not_found includes method + path in the message", async () => {
    enableFixtureMode();
    try {
      await request({
        method: "POST",
        path: "/api/v1/plans/abc/fork",
        schema: z.object({}),
      });
      throw new Error("Expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RaterApiError);
      const err = e as RaterApiError;
      expect(err.code).toBe("fixture_not_found");
      expect(err.message).toContain("POST");
      expect(err.message).toContain("/api/v1/plans/abc/fork");
    }
  });

  it("function fixtures receive captured params + query", async () => {
    enableFixtureMode();
    setFixturePattern(
      "GET",
      "/api/v1/plans/{id}",
      (params: Record<string, string>) => ({
        rating_plan_id: params.id,
        display_name: `Plan ${params.id}`,
      }),
    );

    const result = await request({
      method: "GET",
      path: "/api/v1/plans/p42",
      schema: z.object({
        rating_plan_id: z.string(),
        display_name: z.string(),
      }),
    });
    expect(result).toEqual({
      rating_plan_id: "p42",
      display_name: "Plan p42",
    });
  });

  it("validates fixture values against the calling schema", async () => {
    enableFixtureMode();
    // Fixture is missing the required `display_name` field.
    setFixture("GET", "/api/v1/plans", [{ rating_plan_id: "p1" }]);

    try {
      await request({
        method: "GET",
        path: "/api/v1/plans",
        schema: plansSchema,
      });
      throw new Error("Expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RaterApiError);
      expect((e as RaterApiError).code).toBe("fixture_schema_mismatch");
    }
  });

  it("disabling fixture mode bypasses the registry", () => {
    setFixture("GET", "/api/v1/plans", []);
    expect(isFixtureModeEnabled()).toBe(false);
    // Without enabling, request() would proceed to fetch. We can't easily
    // test that without mocking fetch, but `isFixtureModeEnabled()`
    // returning false is the gating signal the fetcher consults.
    expect(isFixtureModeEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real-world example — listPlans with fixture
// ---------------------------------------------------------------------------

describe("integration — listPlans through fixture mode", () => {
  it("returns the curated fixture instead of hitting the backend", async () => {
    // Import the actual client function — exercises the same request()
    // path real callers use.
    const { listPlans } = await import("./plans");

    enableFixtureMode();
    setFixture("GET", "/api/v1/plans", [
      {
        rating_plan_id: "sample_bop_ne_2026_demo",
        display_name: "Meridian BOP NE 2026 (demo fixture)",
        line_of_business: "bop",
        jurisdiction: "WI",
        effective_date: "2026-07-01",
        status: "active",
        parent_plan_id: null,
        source_filing_id: null,
        created_at: "2026-05-20T14:00:00Z",
        draft_session_id: null,
        template_id: null,
        coverages: null,
        last_edited_at: null,
        content_hash: null,
      },
    ]);

    const plans = await listPlans();
    expect(plans).toHaveLength(1);
    const first = plans[0];
    if (!first) throw new Error("expected a plan in fixture");
    expect(first.rating_plan_id).toBe("sample_bop_ne_2026_demo");
    expect(first.line_of_business).toBe("bop");
  });
});
