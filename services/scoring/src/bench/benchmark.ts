/**
 * 2,000-row synthetic BOP benchmark.
 *
 * Measures the reused engine over the V49 exposure-rated-tower plan in
 * three modes:
 *   • single  — executePlan (compile+run) per row → the /score latency,
 *               reported as p50/p95/p99
 *   • batch   — executePlanBatch (compile once, run N) → the book path
 *   • chunked — runBatchChunked (compile once, chunked + yielding) → the
 *               /score-batch worker path
 * plus peak process memory (rss / heapUsed). Run small with `--smoke`.
 *
 *   pnpm --filter @openrater/scoring bench
 *   node --max-old-space-size=512 --import tsx src/bench/benchmark.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getHeapStatistics } from "node:v8";

import {
  compilePlan,
  runPlan,
  executePlanBatch,
  type Plan,
  type RunOptions,
} from "@openrater/contracts";

import { runBatchChunked } from "../core/batch";
import { ensureEngineReady } from "../core/engine";
import { generateRows, type BenchRow } from "./generateRows";

const SMOKE = process.argv.includes("--smoke");
const ROWS = SMOKE ? 50 : 2000;
const CHUNK = 200;
const AS_OF: RunOptions = { as_of: "2024-01-01" };

const PLAN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/contracts/src/__tests__/conformance/V49.exposure-rated-tower.json",
);

function loadPlan(): Plan {
  const vector = JSON.parse(readFileSync(PLAN_PATH, "utf8")) as { plan: Plan };
  return vector.plan;
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx]!;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

async function main(): Promise<void> {
  const registry = ensureEngineReady();
  const plan = loadPlan();
  const rows = generateRows(ROWS);

  // ── single-risk latency (the /score path: compile+run per call) ──
  const perRowMs: number[] = [];
  const singleStart = performance.now();
  for (const row of rows) {
    const t0 = performance.now();
    // executePlan = compilePlan + runPlan, exactly what POST /score does.
    runPlan(compilePlan(plan, registry), row as BenchRow, AS_OF);
    perRowMs.push(performance.now() - t0);
  }
  const singleTotal = performance.now() - singleStart;
  perRowMs.sort((a, b) => a - b);

  // ── batch (executePlanBatch — compile once, run N) ──
  const batchStart = performance.now();
  executePlanBatch(plan, rows, AS_OF, registry);
  const batchTotal = performance.now() - batchStart;

  // ── chunked (runBatchChunked — the worker path) + peak memory ──
  let peakRss = process.memoryUsage().rss;
  let peakHeap = process.memoryUsage().heapUsed;
  const chunkStart = performance.now();
  await runBatchChunked(plan, rows, {
    chunkSize: CHUNK,
    registry,
    run: AS_OF,
    onChunk: () => {
      const m = process.memoryUsage();
      if (m.rss > peakRss) peakRss = m.rss;
      if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
    },
  });
  const chunkTotal = performance.now() - chunkStart;

  const r1 = (n: number): string => n.toFixed(1);
  const r3 = (n: number): string => n.toFixed(3);

  /* eslint-disable no-console */
  console.log(
    `\nOpenRater scoring benchmark — ${ROWS} rows · V49 synthetic exposure-rated tower (${plan.nodes.length} nodes)`,
  );
  console.log(
    `node ${process.version} · heap limit ~${mb(
      getHeapStatistics().heap_size_limit,
    )} MB\n`,
  );
  console.log(
    "| mode | rows | total ms | per-row ms | rows/sec | p50 ms | p95 ms | p99 ms |",
  );
  console.log(
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  console.log(
    `| single (executePlan, /score) | ${ROWS} | ${r1(singleTotal)} | ${r3(
      singleTotal / ROWS,
    )} | ${Math.round((ROWS / singleTotal) * 1000)} | ${r3(
      percentile(perRowMs, 50),
    )} | ${r3(percentile(perRowMs, 95))} | ${r3(percentile(perRowMs, 99))} |`,
  );
  console.log(
    `| batch (executePlanBatch) | ${ROWS} | ${r1(batchTotal)} | ${r3(
      batchTotal / ROWS,
    )} | ${Math.round((ROWS / batchTotal) * 1000)} | — | — | — |`,
  );
  console.log(
    `| chunked (worker, ${CHUNK}/chunk) | ${ROWS} | ${r1(chunkTotal)} | ${r3(
      chunkTotal / ROWS,
    )} | ${Math.round((ROWS / chunkTotal) * 1000)} | — | — | — |`,
  );
  console.log(
    `\npeak rss ${mb(peakRss)} MB · peak heapUsed ${mb(peakHeap)} MB\n`,
  );
  /* eslint-enable no-console */
}

main().catch((err) => {
  console.error("benchmark failed:", err);
  process.exit(1);
});
