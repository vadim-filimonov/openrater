/**
 * Total-less plans through the ROLLUP seams (the #482 follow-through).
 *
 * #482 made `views.premium` plan-aware; these are the three adjacent
 * seams that stayed single-field and under-reported a total-less
 * multi-coverage plan (legal per the workbook spec):
 *
 *   · /score-policy — `premiumFieldFor` fell to the LAST money output,
 *     so the rolled policy premium + every location premium carried ONE
 *     tower. Now: no tail → every coverage money output rolls up and
 *     the policy premium is their dec-page sum; a tail → the SAME named
 *     `composition_failed` refusal scoreOne raises (Law 2 — never a
 *     tail silently taxing the last tower).
 *
 *   · grouped book runs — `premiumRollupFieldOf` defaulted to
 *     `total_premium`, so grouped total-less books summarized null
 *     policy premiums. Now: money fields roll, policy premiums sum,
 *     and the summary advertises the synthesized `coverage_sum_premium`
 *     column (run-fed Analytics binds to it; the bridge materializes it
 *     per clean row from `views.premium`). A tail over a total-less
 *     grouped book FAILS the job with the named reason.
 *
 * A request-declared premium roll-up stays an explicit basis that wins
 * over the plan's own declarations (mirrors `views.premiumField`).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryJobQueue } from "../adapters/queue/inMemoryJobQueue";
import { FilesystemResultStore } from "../adapters/store/filesystemResultStore";
import { buildApp } from "../http/server";
import { processNextJob } from "../worker/worker";

/** Two coverage towers, NO total row — the legal total-less
 *  transcription (building $13 + contents $1,650 per location). */
const TOTALLESS_STAGES = [
  {
    stage_id: "chain_1",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        {
          name: "building",
          base_input: "ignored",
          base_value: 13,
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "building_premium",
        },
        {
          name: "contents",
          base_input: "ignored",
          base_value: 1650,
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "contents_premium",
        },
      ],
      output_total_field: "all_coverages_subtotal",
    },
  },
];

const FLAT_TAIL = [
  {
    kind: "endorsement",
    id: "e_flat",
    form: "E-1",
    effect: { kind: "flat", amount: 25 },
  },
];

function stagesPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "plan_stages",
    stages: TOTALLESS_STAGES,
    dimensions: [],
    factorTables: [],
    factorTableCells: {},
    trace: "none",
    options: { as_of: "2024-01-01" },
    ...extra,
  };
}

interface PolicyBody {
  premium: number | null;
  tier: string | null;
  row_status: string;
  locations: readonly { premium: number | null; row_status: string }[];
  location_count: number;
  rowIssues?: readonly { code?: string; message: string }[];
  composed?: { subtotal: number; final: number };
}

async function scorePolicy(
  payload: Record<string, unknown>,
): Promise<PolicyBody> {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/score-policy",
    payload,
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as PolicyBody;
  await app.close();
  return body;
}

describe("/score-policy · total-less multi-coverage plans", () => {
  it("rolls EVERY coverage and the policy premium is the dec-page sum", async () => {
    const body = await scorePolicy(
      stagesPayload({ locations: [{}, {}] }),
    );
    expect(body.row_status).toBe("ok");
    // Each location: $13 + $1,650 — the coverage sum, not the last tower.
    expect(body.locations.map((l) => l.premium)).toEqual([1663, 1663]);
    // The policy: 2 × $1,663 — never 2 × $1,650 (the pre-fix last-tower roll).
    expect(body.premium).toBe(3326);
    expect(body.location_count).toBe(2);
  });

  it("a policy tail over a total-less plan is the NAMED refusal — locations withheld too", async () => {
    const body = await scorePolicy(
      stagesPayload({ locations: [{}, {}], policyTail: FLAT_TAIL }),
    );
    expect(body.row_status).toBe("error");
    expect(body.premium).toBeNull();
    // Law 2 — the parts would reconstruct the refused number.
    expect(body.locations.map((l) => l.premium)).toEqual([null, null]);
    const issue = (body.rowIssues ?? []).find(
      (i) => i.code === "composition_failed",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/declares no total output/);
  });

  it("a DECLARED premium roll-up stays the explicit basis (wins over the sum)", async () => {
    const body = await scorePolicy(
      stagesPayload({
        locations: [{}, {}],
        rollupFields: [{ fieldName: "contents_premium", reducer: "sum" }],
      }),
    );
    expect(body.row_status).toBe("ok");
    expect(body.locations.map((l) => l.premium)).toEqual([1650, 1650]);
    expect(body.premium).toBe(3300);
  });

  it("a plan WITH a declared total still resolves it alone — never double-counted", async () => {
    const body = await scorePolicy(
      stagesPayload({
        stages: [
          ...TOTALLESS_STAGES,
          {
            stage_id: "final_round",
            stage_kind: "round",
            config_json: {
              input_path: "chain.total_premium",
              increment_input: "literal:1",
              min_value_input: "literal:0",
              output_field: "total_premium",
            },
          },
        ],
        locations: [{}, {}],
      }),
    );
    expect(body.row_status).toBe("ok");
    // 2 × $1,663 — NOT 2 × ($13 + $1,650 + $1,663).
    expect(body.premium).toBe(3326);
    expect(body.locations.map((l) => l.premium)).toEqual([1663, 1663]);
  });
});

describe("book runs · total-less grouped books", () => {
  function newStore(): FilesystemResultStore {
    return new FilesystemResultStore(
      mkdtempSync(join(tmpdir(), "scoring-test-")),
    );
  }

  it("grouped policies sum their coverages and the summary advertises coverage_sum_premium", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    const rows = [
      { pol: "P-1", loc: "L1" },
      { pol: "P-1", loc: "L2" },
      { pol: "P-2", loc: "L1" },
    ];
    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: stagesPayload({
        rows,
        book: {
          column_map: {},
          grouping: { policy_id_column: "pol", location_id_column: "loc" },
        },
      }),
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
        premium_field: string;
        totals: { written: number; error_rows: number };
        rows: readonly { premium: number | null }[];
        policies?: readonly {
          policy_id: string;
          premium: number | null;
          location_count: number;
        }[];
      };
    };
    expect(body.status).toBe("succeeded");
    const s = body.summary!;
    // Run-fed Analytics binds its premium column to THIS — the
    // synthesized dec-page-sum column, not a tower's field.
    expect(s.premium_field).toBe("coverage_sum_premium");
    // Per-row ledger: the coverage sum (was: null / one tower).
    expect(s.rows.map((r) => r.premium)).toEqual([1663, 1663, 1663]);
    // Grouped policies: P-1 = 2 × $1,663, P-2 = $1,663 (was: null).
    expect(s.policies).toEqual([
      expect.objectContaining({
        policy_id: "P-1",
        location_count: 2,
        premium: 3326,
      }),
      expect.objectContaining({
        policy_id: "P-2",
        location_count: 1,
        premium: 1663,
      }),
    ]);
    expect(s.totals.written).toBe(4989);
    expect(s.totals.error_rows).toBe(0);

    // Each persisted row's views carry the coverage-sum premium the
    // bridge materializes into the synthesized column client-side.
    const page = await app.inject({
      method: "GET",
      url: `/score-batch/${jobId}/result?offset=0&limit=3`,
    });
    const pageRows = (
      page.json() as {
        rows: readonly {
          views?: { premium: number | null; premiumBasis?: string };
        }[];
      }
    ).rows;
    for (const r of pageRows) {
      expect(r.views?.premium).toBe(1663);
      expect(r.views?.premiumBasis).toBe("coverage_sum");
    }
    await app.close();
  });

  it("a tail over a total-less grouped book FAILS the job with the named reason", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: stagesPayload({
        rows: [
          { pol: "P-1", loc: "L1" },
          { pol: "P-1", loc: "L2" },
        ],
        policyTail: FLAT_TAIL,
        book: {
          column_map: {},
          grouping: { policy_id_column: "pol", location_id_column: "loc" },
        },
      }),
    });
    expect(enqueue.statusCode).toBe(202);
    const { jobId } = enqueue.json() as { jobId: string };
    expect(await processNextJob(queue, store, { timeoutMs: 0 })).toBe(true);

    const status = (
      await app.inject({ method: "GET", url: `/score-batch/${jobId}` })
    ).json() as { status: string; error?: string };
    expect(status.status).toBe("failed");
    expect(status.error).toMatch(/declares no total output/);
    await app.close();
  });

  it("an UNGROUPED total-less book still ledgers the coverage sums (no policies)", async () => {
    const queue = new InMemoryJobQueue();
    const store = newStore();
    const app = buildApp({ queue, store, defaultChunkSize: 2 });

    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: stagesPayload({
        rows: [{ any: "x" }, { any: "y" }],
        book: { column_map: {} },
      }),
    });
    const { jobId } = enqueue.json() as { jobId: string };
    expect(await processNextJob(queue, store, { timeoutMs: 0 })).toBe(true);

    const body = (
      await app.inject({ method: "GET", url: `/score-batch/${jobId}/result` })
    ).json() as {
      status: string;
      summary?: {
        premium_field: string;
        grouped: boolean;
        totals: { written: number };
        rows: readonly { premium: number | null }[];
      };
    };
    expect(body.status).toBe("succeeded");
    expect(body.summary!.grouped).toBe(false);
    expect(body.summary!.premium_field).toBe("coverage_sum_premium");
    expect(body.summary!.rows.map((r) => r.premium)).toEqual([1663, 1663]);
    expect(body.summary!.totals.written).toBe(3326);
    await app.close();
  });
});
