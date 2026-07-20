/**
 * /score-batch lifecycle — async job over the queue + store ports.
 *
 * Uses the LOCAL adapters (InMemoryJobQueue + a temp-dir
 * FilesystemResultStore) and drives the worker deterministically via
 * `processNextJob` (no background loop racing). Proves: enqueue → status
 * → chunked processing → results equal /score parity, plus failure +
 * pagination + the plan_stages projection wiring.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { InMemoryJobQueue } from "../adapters/queue/inMemoryJobQueue";
import { FilesystemResultStore } from "../adapters/store/filesystemResultStore";
import { buildApp } from "../http/server";
import { processNextJob } from "../worker/worker";

const CONFORMANCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/contracts/src/__tests__/conformance",
);

interface JsonVector {
  readonly plan: unknown;
  readonly externalInputs: Record<string, unknown>;
  readonly expectedOutputs: Record<string, unknown>;
}

function loadVector(stem: string): JsonVector {
  return JSON.parse(
    readFileSync(join(CONFORMANCE_DIR, `${stem}.json`), "utf8"),
  ) as JsonVector;
}

function newStore(): FilesystemResultStore {
  return new FilesystemResultStore(mkdtempSync(join(tmpdir(), "scoring-test-")));
}

describe("/score-batch · lifecycle", () => {
  it("scores a 5-row book and each result matches /score parity", async () => {
    const v7 = loadVector("V7.bop-like-end-to-end");
    const queue = new InMemoryJobQueue();
    const store = newStore();
    // chunkSize 2 over 5 rows → exercises multi-chunk progress.
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    const rows = Array.from({ length: 5 }, () => v7.externalInputs);
    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: {
        source: "plan",
        plan: v7.plan,
        rows,
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    expect(enqueue.statusCode).toBe(202);
    const { jobId } = enqueue.json() as { jobId: string };

    const queued = await app.inject({ method: "GET", url: `/score-batch/${jobId}` });
    expect(queued.json()).toMatchObject({ status: "queued", progress: { total: 5 } });

    expect(await processNextJob(queue, store, { timeoutMs: 0 })).toBe(true);

    const done = await app.inject({ method: "GET", url: `/score-batch/${jobId}` });
    expect(done.json()).toMatchObject({
      status: "succeeded",
      progress: { done: 5, total: 5 },
    });

    const result = await app.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result?offset=0&limit=100`,
    });
    const body = result.json() as {
      total: number;
      rows: { outputs: Record<string, unknown> }[];
      location: string;
    };
    expect(body.total).toBe(5);
    expect(body.rows).toHaveLength(5);
    for (const row of body.rows) {
      expect(row.outputs).toEqual(v7.expectedOutputs);
    }
    expect(body.location).toMatch(/^file:\/\//);
    await app.close();
  });

  it("paginates results", async () => {
    const v1 = loadVector("V1.trivial-constant");
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 100 });

    const rows = Array.from({ length: 10 }, () => v1.externalInputs);
    const { jobId } = (
      await app.inject({
        method: "POST",
        url: "/score-batch",
        payload: { source: "plan", plan: v1.plan, rows, trace: "none" },
      })
    ).json() as { jobId: string };
    await processNextJob(queue, store, { timeoutMs: 0 });

    const page1 = (
      await app.inject({
        method: "GET",
        url: `/score-batch/${jobId}/result?offset=0&limit=4`,
      })
    ).json() as { rows: unknown[]; total: number; nextOffset: number | null };
    expect(page1.rows).toHaveLength(4);
    expect(page1.total).toBe(10);
    expect(page1.nextOffset).toBe(4);

    const page3 = (
      await app.inject({
        method: "GET",
        url: `/score-batch/${jobId}/result?offset=8&limit=4`,
      })
    ).json() as { rows: unknown[]; nextOffset: number | null };
    expect(page3.rows).toHaveLength(2);
    expect(page3.nextOffset).toBeNull();
    await app.close();
  });

  it("records a job as failed when the plan can't compile", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store });

    const { jobId } = (
      await app.inject({
        method: "POST",
        url: "/score-batch",
        payload: {
          source: "plan",
          plan: {
            id: "bad",
            version: "1.0.0",
            name: "unknown kind",
            nodes: [{ id: "x", kind: "does.not.exist", params: {} }],
            edges: [],
          },
          rows: [{}],
          trace: "none",
        },
      })
    ).json() as { jobId: string };

    await processNextJob(queue, store, { timeoutMs: 0 });
    const status = (
      await app.inject({ method: "GET", url: `/score-batch/${jobId}` })
    ).json() as { status: string; error?: string };
    expect(status.status).toBe("failed");
    expect(status.error).toBeTruthy();
    await app.close();
  });

  it("rejects an empty book (400) and an unknown job (404)", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store });

    const empty = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: { source: "plan", plan: loadVector("V1.trivial-constant").plan, rows: [] },
    });
    expect(empty.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/score-batch/does-not-exist",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("processNextJob returns false when the queue is empty", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    expect(await processNextJob(queue, store, { timeoutMs: 0 })).toBe(false);
  });
});

describe("/score · plan_stages projection wiring", () => {
  it("routes plan_stages through the reused projector (not 501)", async () => {
    const app = buildApp();
    // Empty stage set projects to an empty runtime plan — proves the
    // projection path is wired + reachable end-to-end (the projector's
    // rating correctness is owned by @openrater/ui's own suite).
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: [],
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        inputs: {},
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// ══════════════════════════════════════════════════════════════════
// Brief 75 (P3) — the BOOK path: raw rows project through the ONE
// shared UI path, policies compose (G4 extraction + G9 floor), and a
// summary artifact persists (facet totals + compact ledger).
// ══════════════════════════════════════════════════════════════════

describe("/score-batch · book runs (Brief 75)", () => {
  // The G9 proof plan: base $140/location, $500 plan floor, grouped.
  const BOOK_STAGES = [
    {
      stage_id: "chain_1",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [
          {
            name: "prem",
            base_input: "ignored",
            base_value: 140,
            factor_lookups: [],
            lcm: { value: 1.0 },
            output_field: "prem_premium",
          },
        ],
        output_total_field: "premium",
      },
    },
    {
      stage_id: "final_round",
      stage_kind: "round",
      config_json: {
        input_path: "chain.total_premium",
        increment_input: "literal:1",
        min_value_input: "literal:500",
        output_field: "total_premium",
      },
    },
  ];

  it("projects raw rows, composes the policy, floors ONCE, and persists the summary", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    // RAW book rows — CSV-string values, grouping columns included.
    const rows = [
      { pol: "P-1", loc: "L1", ignored_col: "x" },
      { pol: "P-1", loc: "L2", ignored_col: "x" },
      { pol: "P-1", loc: "L3", ignored_col: "x" },
    ];
    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: {
        source: "plan_stages",
        stages: BOOK_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        // G9 — the projector omits the per-row floor under policy
        // scope; the composition floors once.
        projectorOptions: { minPremiumScope: "policy" },
        rows,
        trace: "none",
        options: { as_of: "2024-01-01" },
        book: {
          column_map: {},
          grouping: { policy_id_column: "pol", location_id_column: "loc" },
          rollup_fields: [{ fieldName: "total_premium", reducer: "sum" }],
        },
      },
    });
    expect(enqueue.statusCode).toBe(202);
    const { jobId } = enqueue.json() as { jobId: string };

    expect(await processNextJob(queue, store, { timeoutMs: 0 })).toBe(true);

    const res = await app.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result`,
    });
    const body = res.json() as {
      status: string;
      summary?: {
        row_count: number;
        grouped: boolean;
        totals: {
          written: number;
          declined_indicative: number;
          error_rows: number;
        };
        rows: readonly { premium: number | null; row_status: string }[];
        policies?: readonly {
          policy_id: string;
          premium: number | null;
          location_count: number;
        }[];
      };
    };
    expect(body.status).toBe("succeeded");
    expect(body.summary).toBeDefined();
    const s = body.summary!;
    expect(s.row_count).toBe(3);
    expect(s.grouped).toBe(true);
    // Per-row: UNFLOORED $140 each under policy scope…
    expect(s.rows.map((r) => r.premium)).toEqual([140, 140, 140]);
    // …the policy composes rolled $420 → floored ONCE to the filed $500
    // (pre-G9 this book charged $1,500):
    expect(s.policies).toHaveLength(1);
    expect(s.policies![0]).toMatchObject({
      policy_id: "P-1",
      location_count: 3,
      premium: 500,
    });
    expect(s.totals.written).toBe(500);
    expect(s.totals.error_rows).toBe(0);
    // Phase 4 — the summary names its premium field (run-fed Analytics
    // binds to it, never a client-side heuristic)…
    expect(
      (s as unknown as { premium_field: string }).premium_field,
    ).toBe("total_premium");
    // …and each STORED row carries its projected inputs (the exhibits'
    // slice variables ride the persisted run).
    const page = await app.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result?offset=0&limit=3`,
    });
    const pageRows = (page.json() as {
      rows: readonly { inputs?: Record<string, unknown> }[];
    }).rows;
    expect(pageRows).toHaveLength(3);
    for (const r of pageRows) expect(r.inputs).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// Brief 76 (P4.1b) — the POLICY quote seam: N locations → ONE rolled-up
// FILED premium synchronously (the SAME evaluatePolicyBook the book
// path runs), floored ONCE per policy (G9).
// ══════════════════════════════════════════════════════════════════

describe("/score-policy · synchronous policy composition (Brief 76)", () => {
  // base $140/location, $500 plan floor — the G9 proof, one policy.
  const POLICY_STAGES = [
    {
      stage_id: "chain_1",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [
          {
            name: "prem",
            base_input: "ignored",
            base_value: 140,
            factor_lookups: [],
            lcm: { value: 1.0 },
            output_field: "prem_premium",
          },
        ],
        output_total_field: "premium",
      },
    },
    {
      stage_id: "final_round",
      stage_kind: "round",
      config_json: {
        input_path: "chain.total_premium",
        increment_input: "literal:1",
        min_value_input: "literal:500",
        output_field: "total_premium",
      },
    },
  ];

  it("rolls 3 locations up and floors ONCE: 3×$140 = $420 → $500 filed", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score-policy",
      payload: {
        source: "plan_stages",
        stages: POLICY_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        // G9 — the projector omits the per-row floor under policy scope;
        // the composition floors the rolled subtotal once.
        projectorOptions: { minPremiumScope: "policy" },
        locations: [{}, {}, {}],
        rollupFields: [{ fieldName: "total_premium", reducer: "sum" }],
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      premium: number | null;
      row_status: string;
      location_count: number;
      composed?: { subtotal: number; final: number };
      locations: readonly { premium: number | null; row_status: string }[];
    };
    // Per-location: UNFLOORED $140 each (policy scope)…
    expect(body.locations.map((l) => l.premium)).toEqual([140, 140, 140]);
    // …the policy rolls $420 → floored ONCE to the filed $500:
    expect(body.composed?.subtotal).toBe(420);
    expect(body.composed?.final).toBe(500);
    expect(body.premium).toBe(500);
    expect(body.row_status).toBe("ok");
    expect(body.location_count).toBe(3);
    await app.close();
  });

  it("rejects an empty policy (400 — needs ≥1 location)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score-policy",
      payload: {
        source: "plan_stages",
        stages: POLICY_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        locations: [],
        trace: "none",
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
