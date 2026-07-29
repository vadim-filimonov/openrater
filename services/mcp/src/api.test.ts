// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/** The pure halves of the MCP client: CSV parsing/typing, Rule-2
 *  row-dump stripping, plan summarization, config, error shaping. */

import { describe, expect, it, vi, afterEach } from "vitest";

import {
  ApiError,
  comparePlans,
  compareRuns,
  exhibitsLink,
  getTranscriptionSpecSectioned,
  splitSpecSections,
  configFromEnv,
  csvToRows,
  parseCsv,
  planLink,
  quoteRisk,
  stripRowDumps,
  summarizePlan,
} from "./api.js";

afterEach(() => vi.unstubAllGlobals());

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas, doubled quotes, CRLF", () => {
    const text = 'a,b,c\r\n"x,1","say ""hi""",3\nplain,,5\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ['x,1', 'say "hi"', "3"],
      ["plain", "", "5"],
    ]);
  });
});

describe("csvToRows", () => {
  it("types numeric + boolean cells and omits empties", () => {
    const rows = csvToRows(
      "tiv,sprinklered,class_code,note\n850000,true,09011,\n\"1,200,000\",false,73912,corner lot\n",
    );
    expect(rows).toEqual([
      { tiv: 850000, sprinklered: true, class_code: 9011 },
      { tiv: 1200000, sprinklered: false, class_code: 73912, note: "corner lot" },
    ]);
  });

  it("returns [] without a data row", () => {
    expect(csvToRows("tiv,class_code\n")).toEqual([]);
  });
});

describe("stripRowDumps (Rule 2)", () => {
  it("replaces row arrays with counts, keeps scalars", () => {
    const out = stripRowDumps({
      run_id: "r1",
      status: "done",
      rows: [{ a: 1 }, { a: 2 }],
      summary: { premium_total: 123 },
    });
    expect(out).toEqual({
      run_id: "r1",
      status: "done",
      rows_count: 2,
      summary: { premium_total: 123 },
    });
  });
});

describe("summarizePlan", () => {
  it("keeps identity fields + stage-kind counts, drops the body", () => {
    const out = summarizePlan({
      rating_plan_id: "p1",
      display_name: "Meridian Shopfront BOP",
      status: "draft",
      stages: [
        { stage_kind: "input_node" },
        { stage_kind: "input_node" },
        { stage_kind: "multiplicative_chain" },
      ],
      factor_tables_inline: [{ huge: true }],
    });
    expect(out).toEqual({
      rating_plan_id: "p1",
      display_name: "Meridian Shopfront BOP",
      status: "draft",
      stage_count: 3,
      stage_kinds: { input_node: 2, multiplicative_chain: 1 },
    });
  });
});

describe("config + links", () => {
  it("defaults + trims trailing slashes; app link targets the plan", () => {
    const cfg = configFromEnv({
      RATER_API_URL: "http://127.0.0.1:9001/",
      RATER_APP_URL: "http://127.0.0.1:5221/",
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe("http://127.0.0.1:9001");
    expect(planLink(cfg, "meridian bop")).toBe(
      "http://127.0.0.1:5221/rate-lab/meridian%20bop",
    );
  });
});

describe("compare_plans (FCA #24, finding 75)", () => {
  it("answers plan-vs-plan with canonical membership counts — no id masquerade", async () => {
    // The audited scenario: identical T1–T5 factors on both sides;
    // Buffalo T3→T4 and Dodge T4→T3, each county dual-keyed
    // (name + FIPS). The pre-fix chat story: reingest_diff refuses
    // cross-plan diffs, the app rollup said "unchanged", and the
    // detail counted every county twice.
    const factors = { T3: 1.0, T4: 1.1 };
    const geoDim = (assign: Record<string, string>) => ({
      slug: "territory",
      display_name: "Territory",
      dimension_type: "geographic",
      levels: [],
      geo_territories: Object.entries(
        Object.entries(assign).reduce<Record<string, string[]>>(
          (acc, [member, terr]) => {
            (acc[terr] ??= []).push(member);
            return acc;
          },
          {},
        ),
      ).map(([id, members]) => ({ id, label: id, members })),
    });
    const side = (assign: Record<string, string>) => ({
      dims: { dimensions: [geoDim(assign)] },
      tables: {
        factor_tables: [
          {
            table_id: "ft_terr",
            slug: "territory_factor",
            display_name: "Territory factor",
            key_dimensions: ["territory"],
            cells: factors,
          },
        ],
      },
      detail: { display_name: "GL plan", stages: [] },
    });
    const a = side({ Buffalo: "T3", "31019": "T3", Dodge: "T4", "31053": "T4" });
    const b = side({ Buffalo: "T4", "31019": "T4", Dodge: "T3", "31053": "T3" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const path = String(url);
        const s = path.includes("plan-a") ? a : b;
        const body = path.endsWith("/dimensions")
          ? s.dims
          : path.endsWith("/factor-tables")
            ? s.tables
            : s.detail;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const cfg = configFromEnv({ RATER_API_URL: "http://x" } as NodeJS.ProcessEnv);
    const out = (await comparePlans(cfg, "plan-a", "plan-b")) as {
      summary: { members_reassigned: number; changed_tables: number };
      territory_reassignments: readonly {
        count: number;
        moves: readonly { member: string }[];
      }[];
      territory_verdicts: readonly {
        reassigned: readonly { member: string }[];
        largest_swing: { member: string } | null;
      }[];
    };
    // Two counties moved — not four (dual keys collapsed)…
    expect(out.summary.members_reassigned).toBe(2);
    expect(out.territory_reassignments[0]!.moves.map((m) => m.member)).toEqual([
      "Buffalo",
      "Dodge",
    ]);
    // …the factor table itself genuinely didn't change…
    expect(out.summary.changed_tables).toBe(0);
    // …and the member-level verdict names the county, not its FIPS.
    expect(out.territory_verdicts[0]!.largest_swing!.member).toBe("Buffalo");
  });
});

describe("error shaping", () => {
  it("passes the platform's refusal text + code through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "quote_missing_inputs",
              message: "Missing declared inputs: tiv, class_code.",
            },
          }),
          { status: 422 },
        ),
      ),
    );
    const cfg = configFromEnv({ RATER_API_URL: "http://x" } as NodeJS.ProcessEnv);
    await expect(
      quoteRisk(cfg, { planId: "p1", inputs: {} }),
    ).rejects.toMatchObject({
      message: "Missing declared inputs: tiv, class_code.",
      code: "quote_missing_inputs",
      status: 422,
    } satisfies Partial<ApiError>);
  });
});

describe("transcription spec pagination (FCA #29, finding 52)", () => {
  const SPEC = [
    "Preamble line.",
    "## 4. Sheets",
    "sheet intro",
    "### 4.1 Sheet `plan`",
    "plan rules",
    "### 4.15 Sheets `geo.<slug>`",
    "geo rules",
    "## 12. Engine semantics",
    "engine rules",
  ].join("\n");

  it("splits on §-headings with a preamble section", () => {
    const keys = splitSpecSections(SPEC).map((s) => s.key);
    expect(keys).toEqual(["intro", "4", "4.1", "4.15", "12"]);
  });

  it("no-arg returns a TOC — never a truncated blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(SPEC, { status: 200 })),
    );
    const cfg = configFromEnv({ RATER_API_URL: "http://x" } as NodeJS.ProcessEnv);
    const toc = (await getTranscriptionSpecSectioned(cfg)) as {
      total_chars: number;
      sections: { key: string }[];
      note: string;
    };
    expect(toc.total_chars).toBe(SPEC.length);
    expect(toc.sections.map((s) => s.key)).toContain("4.15");
    expect(toc.note).toMatch(/section/i);
  });

  it("a section key returns that section; a prefix returns the family", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(SPEC, { status: 200 })),
    );
    const cfg = configFromEnv({ RATER_API_URL: "http://x" } as NodeJS.ProcessEnv);
    const one = (await getTranscriptionSpecSectioned(cfg, "4.15")) as string;
    expect(one).toContain("### 4.15");
    expect(one).toContain("geo rules");
    expect(one).not.toContain("engine rules");
    const family = (await getTranscriptionSpecSectioned(cfg, "4")) as string;
    expect(family).toContain("### 4.1 ");
    expect(family).toContain("### 4.15");
    const miss = (await getTranscriptionSpecSectioned(cfg, "99")) as {
      error: string;
    };
    expect(miss.error).toMatch(/No spec section/);
  });
});

describe("compare_runs + exhibits links (FCA #28, findings 78/80)", () => {
  it("relays the server arithmetic and appends the drawer deep link", async () => {
    const serverCompare = {
      a: { rating_plan_id: "plan-a", run_id: "run_1" },
      b: { rating_plan_id: "plan-b", run_id: "run_2" },
      joined_by_column: "PolicyNbr",
      totals: { premium_a: 100, premium_b: 110, delta: 10, pct: 10 },
      movers: [{ key: "P-1", delta: 10 }],
      caveats: [],
    };
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        seen.push(String(url));
        return new Response(JSON.stringify(serverCompare), { status: 200 });
      }),
    );
    const cfg = configFromEnv({
      RATER_API_URL: "http://x",
      RATER_APP_URL: "http://app",
    } as NodeJS.ProcessEnv);
    const out = (await compareRuns(
      cfg,
      "plan-a",
      "run_1",
      "run_2",
      "plan-b",
    )) as Record<string, unknown>;
    // ONE code path: the numbers are the server's, verbatim.
    expect(out.totals).toEqual(serverCompare.totals);
    expect(out.joined_by_column).toBe("PolicyNbr");
    expect(seen[0]).toContain(
      "/api/v1/plans/plan-a/runs/run_1/compare?with_run=run_2&with_plan=plan-b",
    );
    // The drawer deep link carries the whole compare in the URL.
    expect(out.review_url).toBe(
      "http://app/rate-lab/plan-a/workspace/verify?run=run_1&vs=run_2&vsPlan=plan-b",
    );
  });

  it("exhibitsLink carries the compare in the URL — bookmarkable, sendable", () => {
    const cfg = configFromEnv({
      RATER_API_URL: "http://x",
      RATER_APP_URL: "http://app",
    } as NodeJS.ProcessEnv);
    expect(exhibitsLink(cfg, "meridian bop")).toBe(
      "http://app/exhibits?a=meridian%20bop",
    );
    expect(exhibitsLink(cfg, "a1", "b2")).toBe("http://app/exhibits?a=a1&b=b2");
  });
});
