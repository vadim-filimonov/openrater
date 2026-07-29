/**
 * FCA fca-2026-07-25 #15 — no plausibility surface existed anywhere:
 * a $1.28B payroll (thousands-column slip) priced silently at 99.8%
 * of the book's written total, and a driver_age below the DECLARED
 * minimum priced without comment ("the bounds mechanism exists and is
 * used elsewhere, but nothing checks it"). Declared min/max/enum
 * bounds now yield WARNING issues on quote and book paths — the row
 * still prices — and the book summary flags a dominating contributor.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryJobQueue } from "../adapters/queue/inMemoryJobQueue";
import { FilesystemResultStore } from "../adapters/store/filesystemResultStore";
import { buildApp } from "../http/server";
import { processNextJob } from "../worker/worker";

const BOUNDED_STAGES = [
  {
    stage_id: "input_driver_age",
    stage_kind: "input_node",
    config_json: {
      name: "driver_age",
      data_type: "int",
      source: "form",
      source_path: "driver_age",
      required: true,
      validation: { min: 16, max: 110 },
      output_field: "value",
    },
  },
  {
    stage_id: "input_vehicle_use",
    stage_kind: "input_node",
    config_json: {
      name: "vehicle_use",
      data_type: "enum",
      source: "form",
      source_path: "vehicle_use",
      required: false,
      validation: { enum: ["pleasure", "commuting", "livery"] },
      output_field: "value",
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

function payload(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    source: "plan_stages",
    stages: BOUNDED_STAGES,
    dimensions: [],
    factorTables: [],
    factorTableCells: {},
    inputs,
    trace: "none",
    options: { as_of: "2024-01-01" },
  };
}

interface Body {
  readonly row_status: string;
  readonly views: { premium: number | null };
  readonly rowIssues?: readonly {
    severity?: string;
    code?: string;
    message?: string;
  }[];
}

describe("/score · declared-bounds plausibility warnings (FCA #15)", () => {
  it("a value below the declared minimum prices WITH a warning naming the bound", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: payload({ driver_age: 12, vehicle_use: "pleasure" }),
    });
    const body = res.json() as Body;
    // The row still prices — a warning, never a refusal.
    expect(body.row_status).toBe("ok");
    expect(body.views.premium).toBe(440);
    const warn = (body.rowIssues ?? []).find(
      (i) => i.code === "implausible_input",
    );
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toContain("driver_age");
    expect(warn?.message).toContain("16");
    await app.close();
  });

  it("garbage in an enum field prices WITH a warning naming the vocabulary", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: payload({ driver_age: 40, vehicle_use: "banana" }),
    });
    const body = res.json() as Body;
    expect(body.row_status).toBe("ok");
    const warn = (body.rowIssues ?? []).find(
      (i) => i.code === "implausible_input",
    );
    expect(warn?.message).toContain("vehicle_use");
    expect(warn?.message).toContain("allowed values");
    await app.close();
  });

  it("in-range values stay silent", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: payload({ driver_age: 40, vehicle_use: "pleasure" }),
    });
    const body = res.json() as Body;
    expect(body.row_status).toBe("ok");
    expect(
      (body.rowIssues ?? []).filter((i) => i.code === "implausible_input"),
    ).toHaveLength(0);
    await app.close();
  });
});

describe("/score-batch · book plausibility (FCA #15)", () => {
  it("out-of-bounds rows warn; a dominating row flags the totals", async () => {
    const queue = new InMemoryJobQueue();
    const store = new FilesystemResultStore(
      mkdtempSync(join(tmpdir(), "scoring-plaus-")),
    );
    const app = buildApp({ queue, store, defaultChunkSize: 2 });
    // An exposure-scaled plan: one row carries a classic
    // thousands-column slip and dwarfs the book.
    const EXPOSURE_STAGES = [
      {
        stage_id: "input_payroll",
        stage_kind: "input_node",
        config_json: {
          name: "payroll",
          data_type: "money",
          source: "form",
          source_path: "payroll",
          required: true,
          output_field: "value",
        },
      },
      {
        stage_id: "chain_1",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "prem",
              base_input: "form_input.payroll",
              factor_lookups: [],
              lcm: { value: 0.01 },
              output_field: "prem_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const enqueue = await app.inject({
      method: "POST",
      url: "/score-batch",
      payload: {
        source: "plan_stages",
        stages: EXPOSURE_STAGES,
        dimensions: [],
        factorTables: [],
        factorTableCells: {},
        rows: [
          { payroll: "148000" },
          { payroll: "1284000000" }, // dollars keyed into a thousands field
          { payroll: "220000" },
        ],
        trace: "none",
        options: { as_of: "2024-01-01" },
        book: { column_map: { payroll: "payroll" } },
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
      summary?: {
        totals: { written: number };
        warnings?: readonly string[];
      };
    };
    const s = body.summary!;
    // All three rows priced (garbage-in is the caller's right)…
    expect(s.totals.written).toBe(12840000 + 1480 + 2200);
    // …but the summary stops pretending nothing is odd.
    expect(s.warnings).toBeDefined();
    expect(s.warnings![0]).toMatch(/row 2/);
    expect(s.warnings![0]).toMatch(/\d{2,3}\.\d% of the written total/);
    await app.close();
  });
});
