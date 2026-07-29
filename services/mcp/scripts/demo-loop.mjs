#!/usr/bin/env node
// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * The Brief 2 P1 checkpoint driver: speaks MCP (JSON-RPC over stdio)
 * to a freshly spawned @openrater/mcp server and walks the whole loop
 * against the Meridian example workbook — the same calls a Claude
 * client makes, minus the model.
 *
 *   node scripts/demo-loop.mjs
 *     env: RATER_API_URL (required, a running OpenRater server)
 *          MERIDIAN_XLSX (default: docs/specs/examples/meridian-shopfront-bop/...)
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const workbook =
  process.env.MERIDIAN_XLSX ??
  join(
    repoRoot,
    "docs/specs/examples/meridian-shopfront-bop/meridian_shopfront_bop.workbook.xlsx",
  );

// MCP_ENTRY overrides the dev entry with a BUILT artifact (the .mcpb
// payload's mcp/index.mjs) — the P3 proof drives the exact bytes that
// ship, on plain node, no tsx.
const child = process.env.MCP_ENTRY
  ? spawn(process.execPath, [resolve(process.env.MCP_ENTRY)], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "inherit"],
    })
  : spawn("npx", ["tsx", join(repoRoot, "services/mcp/src/main.ts")], {
      cwd: join(repoRoot, "services/mcp"),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "inherit"],
    });

let nextId = 1;
const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  child.stdin.write(payload + "\n");
  return new Promise((res, reject) => {
    pending.set(id, { resolve: res, reject });
    // unref: a pending guard timer must not hold the driver's event
    // loop open for 3 minutes after the loop finishes.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 180_000).unref();
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function call(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), text };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const step = (label, detail) => console.log(`\n■ ${label}\n  ${detail}`);

try {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "demo-loop", version: "0.0.0" },
  });
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  step("tools/list", `${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  const spec = await call("get_transcription_spec");
  step("get_transcription_spec", `${spec.text.length.toLocaleString()} chars of spec markdown`);

  const registry = parse((await call("get_capability_registry")).text);
  step("get_capability_registry", `${registry.constructs.length} constructs (registry ${registry.version ?? registry.revision ?? ""})`);

  const scratch = await mkdtemp(join(tmpdir(), "openrater-demo-"));
  const template = await call("get_workbook_template", { dest_dir: scratch });
  step("get_workbook_template", template.text);

  const check = parse((await call("validate_workbook", { xlsx_path: workbook })).text);
  step(
    "validate_workbook (Meridian example)",
    `ok=${check.ok} errors=${check.errors?.length ?? 0} warnings=${check.warnings?.length ?? 0}` +
      (check.already_built ? ` already_built=${check.already_built.rating_plan_id}` : ""),
  );

  let planId = check.already_built?.rating_plan_id ?? null;
  if (!planId) {
    const build = parse((await call("build_plan_from_workbook", { xlsx_path: workbook })).text);
    planId = build.rating_plan_id ?? build.plan?.rating_plan_id;
    step("build_plan_from_workbook", `built ${planId}`);
  } else {
    step("build_plan_from_workbook", `skipped — identical workbook already built as ${planId}`);
  }

  const report = parse((await call("get_build_report", { plan_id: planId })).text);
  const vectors = report.vectors ?? {};
  step(
    "get_build_report  ← REVIEW STOP (gaps + vectors)",
    `gaps=${(report.gaps ?? []).length} · vectors: ${vectors.matched ?? 0} checks matched across ${vectors.total_cases ?? 0} cases (status=${vectors.status ?? "?"})`,
  );

  const schema = parse((await call("get_plan_input_schema", { plan_id: planId })).text);
  const fromCaller = schema.inputs.filter((i) => i.expected_from_caller);
  step(
    "get_plan_input_schema",
    `${schema.count} declared inputs; ${fromCaller.length} expected from caller: ` +
      fromCaller.map((i) => i.name).slice(0, 12).join(", "),
  );

  const empty = await call("quote_risk", { plan_id: planId, inputs: {}, draft: true });
  const emptyParsed = parse(empty.text);
  step(
    "quote_risk({})  — honest refusal",
    empty.isError || !emptyParsed
      ? `refused verbatim → ${empty.text.split("\n")[0]}`
      : `row_status=${emptyParsed.row_status} (premium withheld; missing inputs named)`,
  );

  // Quote the filing's worked example mv_01 ("Retail t2, sprinklered,
  // preferred") — the same case the build's vectors verified. The build
  // report proved parity in-build; this shows the LIVE quote seam
  // producing the same premium.
  const firstCheck =
    (vectors.checks ?? []).find((c) => c.field?.includes("total")) ??
    (vectors.checks ?? [])[0] ??
    null;
  const inputs = {
    class_code: "c101",
    building_limit: 250000,
    bpp_limit: 80000,
    annual_gross_sales: 600000,
    construction_class: "jm",
    protection_class: "p1_4",
    zip: "68102",
    sprinklered: true,
    years_in_business: 8,
  };
  const quote = parse(
    (await call("quote_risk", { plan_id: planId, inputs, draft: true })).text,
  );
  step(
    `quote_risk(mv_01 "Retail t2, sprinklered, preferred" — ${Object.keys(inputs).length} inputs)`,
    `row_status=${quote.row_status} premium=${JSON.stringify(quote.views?.premium ?? quote.premium)}` +
      (firstCheck ? ` (build-verified ${firstCheck.field}: expected ${firstCheck.expected}, got ${firstCheck.actual}, Δ${firstCheck.delta})` : "") +
      ` link=${quote.open_in_openrater}`,
  );

  const header = Object.keys(inputs);
  if (header.length > 0) {
    const csvLine = header.map((k) => String(inputs[k])).join(",");
    const csvPath = join(scratch, "demo-book.csv");
    await writeFile(csvPath, `${header.join(",")}\n${csvLine}\n${csvLine}\n`);
    const rerate = parse((await call("rerate_book", { plan_id: planId, csv_path: csvPath })).text);
    step(
      "rerate_book (2-row CSV)",
      `status=${rerate.status} rows_submitted=${rerate.rows_submitted} run_id=${rerate.run_id} (row results stay out of chat)`,
    );
  }

  const link = parse((await call("open_in_openrater", { plan_id: planId })).text);
  step("open_in_openrater", link.url);

  console.log("\n✓ P1 loop complete.");
} finally {
  child.kill();
}
