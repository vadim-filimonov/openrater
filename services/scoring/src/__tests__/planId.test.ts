/**
 * source:"plan_id" — snapshot-pinned API Lab resolution (ADR-0049 A8).
 *
 * The wiring under test: schema accepts {planId, snapshotId}; the route
 * threads PlanSourceDeps; apiLabPlans fetches the snapshot, projects the
 * body, caches by snapshotId (immutable → cache-forever), and maps the
 * failure modes honestly (unreachable → 503, missing → 404, chainless →
 * 400, undep'd runtime → 501).
 *
 * Rating correctness stays where it lives: the body→plan projection is
 * mocked to return a conformance-vector plan, because
 * `snapshotBodyToRuntimePlan`'s real behavior is owned by
 * @openrater/ui's own suite (the same division batch.test.ts uses for
 * plan_stages).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openrater/ui/AnalyticsWorkspace/snapshot-plan", () => ({
  snapshotBodyToRuntimePlan: vi.fn(
    (body: Record<string, unknown>) =>
      Array.isArray(body.stages) && body.stages.length > 0
        ? loadVector("V1.trivial-constant").plan
        : null,
  ),
  // P2 G4 — the bundle path (scoreOne) resolves through the
  // issues-carrying projection + reads the frozen tail.
  snapshotBodyToProjection: vi.fn((body: Record<string, unknown>) =>
    Array.isArray(body.stages) && body.stages.length > 0
      ? { plan: loadVector("V1.trivial-constant").plan, issues: [] }
      : null,
  ),
  snapshotBodyPolicyTail: vi.fn(() => null),
}));

import { clearSnapshotPlanCache } from "../core/apiLabPlans";
import { buildApp } from "../http/server";

interface JsonVector {
  readonly plan: unknown;
  readonly expectedOutputs: Record<string, unknown>;
}

const CONFORMANCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/contracts/src/__tests__/conformance",
);

function loadVector(stem: string): JsonVector {
  return JSON.parse(
    readFileSync(join(CONFORMANCE_DIR, `${stem}.json`), "utf8"),
  ) as JsonVector;
}

const API_LAB = "http://api-lab.test:8001";

function snapshotResponse(stages: unknown[]): Response {
  return new Response(
    JSON.stringify({
      snapshot_id: "ps_abc",
      plan_id: "plan_x",
      body: { plan: {}, stages, dimensions: [], factor_tables: [] },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const PLAN_ID_PAYLOAD = {
  source: "plan_id",
  planId: "plan_x",
  snapshotId: "ps_abc",
  inputs: {},
  trace: "none",
} as const;

describe("/score · source:plan_id", () => {
  beforeEach(() => clearSnapshotPlanCache());
  afterEach(() => vi.unstubAllGlobals());

  it("stays an honest 501 when the runtime has no API Lab wired", async () => {
    const app = buildApp(); // no apiLabBase
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: PLAN_ID_PAYLOAD,
    });
    expect(res.statusCode).toBe(501);
    await app.close();
  });

  it("resolves the snapshot bundle, scores, and caches by snapshotId", async () => {
    const fetchedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      fetchedUrls.push(String(url));
      return snapshotResponse([{ stage: 1 }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildApp({ apiLabBase: API_LAB });

    const first = await app.inject({
      method: "POST",
      url: "/score",
      payload: PLAN_ID_PAYLOAD,
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as { outputs: Record<string, unknown> };
    expect(body.outputs).toEqual(
      loadVector("V1.trivial-constant").expectedOutputs,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchedUrls[0]).toBe(
      `${API_LAB}/api/v1/plans/plan_x/snapshots/ps_abc`,
    );

    // Immutable snapshot → the second score is a cache hit, no re-fetch.
    const second = await app.inject({
      method: "POST",
      url: "/score",
      payload: PLAN_ID_PAYLOAD,
    });
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("maps API Lab unreachable to 503 (retry-safe)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: PLAN_ID_PAYLOAD,
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: string }).error).toBe(
      "openrater_unavailable",
    );
    await app.close();
  });

  it("maps a missing snapshot to 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: PLAN_ID_PAYLOAD,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("refuses a chainless snapshot with 400 (never a wrong answer)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => snapshotResponse([])),
    );
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: PLAN_ID_PAYLOAD,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects plan_id without snapshotId at the schema (400)", async () => {
    const app = buildApp({ apiLabBase: API_LAB });
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: { source: "plan_id", planId: "plan_x", inputs: {} },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
