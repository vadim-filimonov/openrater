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
      "tiv,sprinklered,sequence,note\n850000,true,101,\n\"1,200,000\",false,202,corner lot\n",
    );
    expect(rows).toEqual([
      { tiv: 850000, sprinklered: true, sequence: 101 },
      { tiv: 1200000, sprinklered: false, sequence: 202, note: "corner lot" },
    ]);
  });

  it("returns [] without a data row", () => {
    expect(csvToRows("tiv,sequence\n")).toEqual([]);
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
