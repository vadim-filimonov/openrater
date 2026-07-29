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

// ══════════════════════════════════════════════════════════════════
// FCA fca-2026-07-25 #22 — restart survival. The queue record lives
// in process memory while the artifacts (spec/input/results/summary)
// are on disk: a sidecar restart used to 404 every finished job's
// results the store still held — the drawer said "the rows aren't
// available anymore" the same day the run was made. The routes must
// rebuild the lifecycle record from the durable artifacts.
describe("/score-batch · restart survival (FCA #22)", () => {
  it("a finished job's rows and status survive a queue restart", async () => {
    const v1 = loadVector("V1.trivial-constant");
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 100 });
    const rows = Array.from({ length: 3 }, () => v1.externalInputs);
    const { jobId } = (
      await app.inject({
        method: "POST",
        url: "/score-batch",
        payload: { source: "plan", plan: v1.plan, rows, trace: "none" },
      })
    ).json() as { jobId: string };
    await processNextJob(queue, store, { timeoutMs: 0 });
    await app.close();

    // The restart: a FRESH queue (memory gone), the SAME store dir.
    const rebooted = buildApp({ queue: new InMemoryJobQueue(), store });

    const status = await rebooted.inject({
      method: "GET",
      url: `/score-batch/${jobId}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      status: "succeeded",
      progress: { done: 3, total: 3 },
    });

    const result = await rebooted.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result?offset=0&limit=100`,
    });
    expect(result.statusCode).toBe(200);
    const body = result.json() as {
      status: string;
      total: number;
      rows: { outputs: Record<string, unknown> }[];
    };
    expect(body.status).toBe("succeeded");
    expect(body.total).toBe(3);
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0]!.outputs).toEqual(v1.expectedOutputs);
    await rebooted.close();
  });

  it("a job interrupted by the restart reports failed with an honest error, not a phantom 404", async () => {
    const v1 = loadVector("V1.trivial-constant");
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store });
    const { jobId } = (
      await app.inject({
        method: "POST",
        url: "/score-batch",
        payload: {
          source: "plan",
          plan: v1.plan,
          rows: Array.from({ length: 4 }, () => v1.externalInputs),
          trace: "none",
        },
      })
    ).json() as { jobId: string };
    // No processNextJob — the "restart" hits before the worker ran.
    await app.close();

    const rebooted = buildApp({ queue: new InMemoryJobQueue(), store });
    const status = (
      await rebooted.inject({ method: "GET", url: `/score-batch/${jobId}` })
    ).json() as { status: string; error?: string };
    expect(status.status).toBe("failed");
    expect(status.error).toMatch(/restart/i);
    expect(status.error).toMatch(/re-run/i);
    await rebooted.close();
  });

  it("a truly unknown job stays a 404 after the fallback", async () => {
    const app = buildApp({ queue: new InMemoryJobQueue(), store: newStore() });
    const missing = await app.inject({
      method: "GET",
      url: "/score-batch/never-existed/result",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
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
// labs-ui path, policies compose (G4 extraction + G9 floor), and a
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
// FCA fca-2026-07-25 (S0) — book/quote parity. The book path consumed
// pre-final-adjustment chain totals: an UNGROUPED book never composed
// at all, so the plan-tail minimum premium the quote path applied was
// silently skipped on every row ($114 booked, 'rated', where quote_risk
// returned the filed $250 'floored at $250') and totals.written was
// short the floor delta. Each ungrouped row now composes as its own
// single-location policy through the SAME evaluatePolicyBook.
// ══════════════════════════════════════════════════════════════════

describe("/score-batch · ungrouped book/quote parity (FCA floor fix)", () => {
  // base $140/row, $500 plan floor — the floor BINDS on every row.
  const FLOOR_STAGES = [
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

  it("floors every ungrouped book row exactly as quote does — same risk, same number", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    // THE quote-path oracle: /score on the identical plan + inputs.
    const quote = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_stages",
        stages: FLOOR_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        projectorOptions: { minPremiumScope: "policy" },
        inputs: {},
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    expect(quote.statusCode).toBe(200);
    const quoted = quote.json() as {
      views: { premium: number | null };
      composed?: { subtotal: number; final: number };
    };
    // The quote path composes: $140 chain → $500 floor.
    expect(quoted.composed).toMatchObject({ subtotal: 140, final: 500 });
    expect(quoted.views.premium).toBe(500);

    // The SAME risk, three times, as an UNGROUPED book.
    const rows = [{ any: "r1" }, { any: "r2" }, { any: "r3" }];
    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: {
        source: "plan_stages",
        stages: FLOOR_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        projectorOptions: { minPremiumScope: "policy" },
        rows,
        trace: "none",
        options: { as_of: "2024-01-01" },
        book: {
          column_map: {},
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
        grouped: boolean;
        totals: { written: number; error_rows: number };
        rows: readonly { premium: number | null; row_status: string }[];
        policies?: unknown;
      };
    };
    expect(body.status).toBe("succeeded");
    const s = body.summary!;
    expect(s.grouped).toBe(false);
    // PARITY — every book row shows the quote path's filed number,
    // never the pre-floor chain total ($140 was the shipped defect).
    expect(s.rows.map((r) => r.premium)).toEqual([
      quoted.views.premium,
      quoted.views.premium,
      quoted.views.premium,
    ]);
    // The written total includes the floor on every row.
    expect(s.totals.written).toBe(3 * quoted.views.premium!);
    // Ungrouped-composed policies are 1:1 with rows — no separate array.
    expect(s.policies).toBeUndefined();

    // Each STORED row carries the seam the audit exposed, resolved:
    // outputs keep the pre-floor chain total (quote parity), views
    // serve the composed filed number, and the composed build-up is
    // attached as evidence of the floor.
    const page = await app.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result?offset=0&limit=3`,
    });
    const pageRows = (page.json() as {
      rows: readonly {
        outputs: Record<string, unknown>;
        views: { premium: number | null; premiumBasis?: string };
        composed?: {
          subtotal: number;
          final: number;
          adjustments: readonly { detail?: string }[];
        };
      }[];
    }).rows;
    expect(pageRows).toHaveLength(3);
    for (const r of pageRows) {
      expect(r.outputs.total_premium).toBe(140);
      expect(r.views.premium).toBe(500);
      expect(r.views.premiumBasis).toBe("composed");
      expect(r.composed).toMatchObject({ subtotal: 140, final: 500 });
      expect(
        r.composed!.adjustments.some((a) => /floor/i.test(a.detail ?? "")),
      ).toBe(true);
    }
    await app.close();
  });

  it("refuses an ungrouped book row missing a required gate-only input — BY NAME, never 'standard'", async () => {
    // FCA S0 #04: vehicle_use is declared required with no default and
    // feeds ONLY the eligibility gate. Omitting its column used to rate
    // every row 'standard' with input_issues null — the filed decline
    // rule was unreachable. Now each row refuses, naming the field.
    const GATED_STAGES = [
      {
        stage_id: "input_vehicle_use",
        stage_kind: "input_node",
        config_json: {
          name: "vehicle_use",
          data_type: "string",
          source: "form",
          source_path: "vehicle_use",
          required: true,
          output_field: "value",
        },
      },
      {
        stage_id: "eligibility_gate",
        stage_kind: "eligibility.gate",
        config_json: {
          rules: [
            {
              rule_id: "delivery_livery",
              variable: "vehicle_use",
              op: "in",
              value: ["delivery", "livery"],
              tier: "decline",
              reasoning: "Rule 3.B: delivery/livery use is not eligible.",
            },
          ],
          default_tier: "standard",
          default_reasoning: "Rule 3.C: all other autos.",
        },
      },
      {
        stage_id: "chain_1",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "prem",
              base_input: "ignored",
              base_value: 440,
              factor_lookups: [],
              lcm: { value: 1.0 },
              output_field: "prem_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: {
        source: "plan_stages",
        stages: GATED_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        rows: [{ some_col: "a" }, { some_col: "b" }],
        trace: "none",
        options: { as_of: "2024-01-01" },
        // vehicle_use is NOT mapped — the S2/S5 book shape.
        book: { column_map: {} },
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
        totals: { written: number; error_rows: number };
        rows: readonly {
          premium: number | null;
          tier: string | null;
          row_status: string;
          first_issue?: string;
        }[];
      };
    };
    expect(body.status).toBe("succeeded");
    const s = body.summary!;
    // Every row refuses — none books $440 'standard'.
    expect(s.totals.written).toBe(0);
    expect(s.totals.error_rows).toBe(2);
    for (const r of s.rows) {
      expect(r.row_status).toBe("error");
      expect(r.premium).toBeNull();
      expect(r.tier).toBeNull();
      expect(r.first_issue).toMatch(/vehicle_use/);
    }
    // The withheld verdict must not survive in the STORED rows either
    // (FCA review: refused rows used to persist the engine's grace
    // 'standard' as eligibility_tier — Analytics folded it back in).
    const page = await app.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result?offset=0&limit=2`,
    });
    const pageRows = (page.json() as {
      rows: readonly {
        eligibility_tier?: string;
        views: { premium: number | null; tier: string | null };
        row_status: string;
      }[];
    }).rows;
    for (const r of pageRows) {
      expect(r.row_status).toBe("error");
      expect(r.eligibility_tier).toBeUndefined();
      expect(r.views.premium).toBeNull();
      expect(r.views.tier).toBeNull();
    }
    await app.close();
  });

  it("GROUPED books withhold a refused row's policy premium and verdict too", async () => {
    // FCA review finding (confirmed by live repro): the composition
    // ran blind to preflight refusals, so a grouped policy containing
    // refused rows kept its composed premium in totals.written and a
    // confident 'standard' tier in summary.policies — while the row
    // ledger for the same rows said error/withheld. Grouped and
    // ungrouped books must agree about the same refusal.
    const GATED_FLOOR_STAGES = [
      {
        stage_id: "input_vehicle_use",
        stage_kind: "input_node",
        config_json: {
          name: "vehicle_use",
          data_type: "string",
          source: "form",
          source_path: "vehicle_use",
          required: true,
          output_field: "value",
        },
      },
      {
        stage_id: "eligibility_gate",
        stage_kind: "eligibility.gate",
        config_json: {
          rules: [
            {
              rule_id: "delivery_livery",
              variable: "vehicle_use",
              op: "in",
              value: ["delivery", "livery"],
              tier: "decline",
              reasoning: "Rule 3.B.",
            },
          ],
          default_tier: "standard",
          default_reasoning: "Rule 3.C.",
        },
      },
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
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: {
        source: "plan_stages",
        stages: GATED_FLOOR_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        projectorOptions: { minPremiumScope: "policy" },
        rows: [
          { pol: "P-1", loc: "L1" },
          { pol: "P-1", loc: "L2" },
        ],
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
        totals: {
          written: number;
          error_rows: number;
          error_policies?: number;
        };
        rows: readonly { row_status: string; premium: number | null }[];
        policies?: readonly {
          policy_id: string;
          premium: number | null;
          row_errors?: number;
        }[];
      };
    };
    expect(body.status).toBe("succeeded");
    const s = body.summary!;
    // No money and no verdict from a policy whose rows were refused.
    expect(s.totals.written).toBe(0);
    expect(s.totals.error_rows).toBe(2);
    expect(s.totals.error_policies).toBe(1);
    expect(s.policies).toHaveLength(1);
    expect(s.policies![0]).toMatchObject({
      policy_id: "P-1",
      premium: null,
      row_errors: 2,
    });
    await app.close();
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

  it("refuses the POLICY when a location omits a declared-required gate-only input (FCA)", async () => {
    // The multi-location arm of the same S0: without this, a policy
    // quote priced gate-only-missing risks the /score and book paths
    // refuse — same engine, third door.
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score-policy",
      payload: {
        source: "plan_stages",
        stages: [
          {
            stage_id: "input_vehicle_use",
            stage_kind: "input_node",
            config_json: {
              name: "vehicle_use",
              data_type: "string",
              source: "form",
              source_path: "vehicle_use",
              required: true,
              output_field: "value",
            },
          },
          {
            stage_id: "eligibility_gate",
            stage_kind: "eligibility.gate",
            config_json: {
              rules: [
                {
                  rule_id: "delivery_livery",
                  variable: "vehicle_use",
                  op: "in",
                  value: ["delivery", "livery"],
                  tier: "decline",
                  reasoning: "Rule 3.B.",
                },
              ],
              default_tier: "standard",
              default_reasoning: "Rule 3.C.",
            },
          },
          ...POLICY_STAGES,
        ],
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        projectorOptions: { minPremiumScope: "policy" },
        // L1 supplies the field; L2 omits it → the POLICY refuses
        // (Law 2 — partial location premiums would reconstruct the
        // withheld number).
        locations: [{ vehicle_use: "pleasure" }, {}],
        trace: "none",
        options: { as_of: "2024-01-01" },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      premium: number | null;
      tier: string | null;
      row_status: string;
      locations: readonly {
        premium: number | null;
        tier: string | null;
        row_status: string;
        rowIssues?: readonly { code?: string; message?: string }[];
      }[];
      rowIssues?: readonly { code?: string; message?: string }[];
    };
    expect(body.row_status).toBe("error");
    expect(body.premium).toBeNull();
    expect(body.tier).toBeNull();
    // Every location premium withheld; the refused one names its field.
    expect(body.locations.map((l) => l.premium)).toEqual([null, null]);
    expect(body.locations[1]!.row_status).toBe("error");
    expect(body.locations[1]!.tier).toBeNull();
    expect(
      body.locations[1]!.rowIssues?.some(
        (i) => i.code === "missing_input" && /vehicle_use/.test(i.message ?? ""),
      ),
    ).toBe(true);
    expect(
      body.rowIssues?.some(
        (i) => i.code === "missing_input" && /vehicle_use/.test(i.message ?? ""),
      ),
    ).toBe(true);
    await app.close();
  });
});
