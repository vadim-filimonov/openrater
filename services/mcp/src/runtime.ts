// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * The packaged-runtime supervisor (Brief 2 §6, D12).
 *
 * Three modes, chosen once per process:
 *
 *  · "external" — RATER_API_URL is set (or nothing signals managed):
 *    the OSS/self-hosted path. Tools talk to whatever the user runs;
 *    this module never spawns anything. `npx @openrater/mcp` keeps
 *    its documented default (http://127.0.0.1:8001).
 *
 *  · "managed" — RATER_RUNTIME=managed or a bundle root is present
 *    (RATER_BUNDLE_ROOT, set by the .mcpb manifest): on the FIRST
 *    tool call, spawn the bundled pair on free loopback ports —
 *    scoring first (the same Node this process runs on:
 *    process.execPath), then the server (the PyInstaller binary; a
 *    dev wrapper script in the repo satisfies the same contract) —
 *    health-check, and reuse for the life of the process. Children
 *    die with us; if one dies early, the next call respawns.
 *
 * The SERVER COMMAND CONTRACT (packaged binary and dev wrapper both
 * honor it): a single executable, no args, configured entirely by
 * env — RATER_PORT, RATER_DB_PATH, RATER_SCORING_URL,
 * RATER_AUTH_MODE, RATER_SPA_DIR, RATER_COLD_TEST_FIXTURE,
 * RATER_SEED_COLD_TEST. Binds 127.0.0.1 only; /health answers when
 * migrations have run and the DB is reachable.
 *
 * Protocol hygiene: this process speaks MCP on stdout, so child
 * stdout/stderr are piped to OUR stderr — a chatty child can never
 * corrupt the JSON-RPC stream.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiConfig } from "./api.js";

export type RuntimeMode = "external" | "managed";

/** The bundled first-run content (design brief: first-run-experience
 *  §5.3) — the seeded reference plan plus the on-disk sample assets
 *  the guided tour rates. Paths are absolute and exist at the moment
 *  of the status call; a field is omitted when its file isn't found
 *  (e.g. a bare `npx @openrater/mcp` against a remote server). */
export interface SampleAssets {
  plan_id: string;
  demo_book?: string;
  filing?: string;
}

export interface RuntimeStatus {
  mode: RuntimeMode;
  api_url: string;
  app_url: string;
  healthy: boolean;
  detail: string;
  /** FCA #18 — who keeps app_url alive, and how to relight it. The
   *  managed engine is a child of the chat host: a bookmarked app_url
   *  opened cold tomorrow is a dead page with nothing product-authored
   *  owning that moment unless this sentence travels with the URL. */
  app_lifecycle?: string;
  data_dir?: string;
  bundle_root?: string;
  server?: { pid: number | undefined; port: number; alive: boolean };
  scoring?: {
    pid: number | undefined;
    port: number;
    alive: boolean;
    /** Present when degraded: what happened + what to do. */
    detail?: string;
  };
  boot_ms?: number;
  /** The doctor's memory (MVP-015): the most recent boot failure,
   *  kept across the failed-boot promise being cleared. */
  last_boot_failure?: {
    when: string;
    child: "server" | "scoring";
    message: string;
    remedy: string;
  };
  sample?: SampleAssets;
}

/** The seeded reference program's stable id (seed.py: plan ids are the
 *  workbooks' own `rating_plan_id`s — same on every box). */
export const SAMPLE_PLAN_ID = "meridian-shopfront-bop-ne-2026";
const SAMPLE_DEMO_BOOK = "meridian-demo-book.csv";
const SAMPLE_FILING = "meridian_shopfront_bop_filing.pdf";

/** Where the sample assets live, first hit wins: the explicit fixture
 *  env (a directory, or a file whose directory we take), the bundle's
 *  fixtures/, or the repo's docs/fixtures (the dev flow). */
function sampleDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = [];
  const fixture = env.RATER_COLD_TEST_FIXTURE;
  if (fixture) {
    try {
      dirs.push(statSync(fixture).isDirectory() ? fixture : dirname(fixture));
    } catch {
      // unset-like: the path doesn't exist; fall through
    }
  }
  const root = bundleRoot(env);
  if (root) dirs.push(join(root, "fixtures"));
  // services/mcp/src/runtime.ts → repo root is three levels up. In the
  // esbuild bundle these resolve somewhere nonexistent and existsSync
  // filters them out — the bundle branch above already matched anyway.
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  dirs.push(join(repo, "docs", "fixtures"));
  // The filing PDF's dev home (the bundle copies it into fixtures/):
  dirs.push(join(repo, "docs", "specs", "examples", "meridian-shopfront-bop"));
  return dirs;
}

/** The guided tour's content, when present on this machine. The filing
 *  PDF ships in the .mcpb and the repo; the demo book beside it. */
export function sampleAssets(env: NodeJS.ProcessEnv = process.env): SampleAssets {
  const sample: SampleAssets = { plan_id: SAMPLE_PLAN_ID };
  for (const dir of sampleDirs(env)) {
    const book = join(dir, SAMPLE_DEMO_BOOK);
    const filing = join(dir, SAMPLE_FILING);
    if (!sample.demo_book && existsSync(book)) sample.demo_book = book;
    if (!sample.filing && existsSync(filing)) sample.filing = filing;
  }
  return sample;
}

interface Managed {
  apiUrl: string;
  server: ChildProcess;
  scoring: ChildProcess;
  serverPort: number;
  scoringPort: number;
  bootMs: number;
  /** False when the sidecar never became healthy — the runtime is
   *  DEGRADED, not dead: every tool that needs only the engine
   *  works; the doctor names what's missing and retries on call. */
  scoringHealthy: boolean;
}

const HEALTH_TIMEOUT_MS = 45_000; // cold first boot of a one-dir bundle
const HEALTH_POLL_MS = 150;

export function runtimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  if (env.RATER_RUNTIME === "managed") return "managed";
  if (env.RATER_RUNTIME === "external") return "external";
  if (!env.RATER_API_URL && env.RATER_BUNDLE_ROOT) return "managed";
  return "external";
}

function bundleRoot(env: NodeJS.ProcessEnv): string | null {
  return env.RATER_BUNDLE_ROOT ?? null;
}

function dataDir(env: NodeJS.ProcessEnv): string {
  return env.RATER_DATA_DIR ?? join(homedir(), ".openrater");
}

function serverCommand(env: NodeJS.ProcessEnv): string {
  if (env.RATER_SERVER_CMD) return env.RATER_SERVER_CMD;
  const root = bundleRoot(env);
  if (root) {
    const exe = process.platform === "win32" ? "openrater-server.exe" : "openrater-server";
    return join(root, "server", exe);
  }
  throw new Error(
    "managed runtime: no server command — set RATER_SERVER_CMD (dev) " +
      "or RATER_BUNDLE_ROOT (packaged).",
  );
}

function scoringEntry(env: NodeJS.ProcessEnv): string {
  if (env.RATER_SCORING_ENTRY) return env.RATER_SCORING_ENTRY;
  const root = bundleRoot(env);
  if (root) return join(root, "scoring", "server.mjs");
  throw new Error(
    "managed runtime: no scoring entry — set RATER_SCORING_ENTRY (dev) " +
      "or RATER_BUNDLE_ROOT (packaged).",
  );
}

/** The Node that runs the scoring sidecar.
 *
 *  `process.execPath` is only correct when THIS process runs on plain
 *  Node (npx, dev, CI). MCP hosts run the extension on embedded
 *  runtimes: Claude Desktop's helper is Electron with the runAsNode
 *  fuse burned OFF, so spawning it — with or without
 *  ELECTRON_RUN_AS_NODE — dies by SIGTRAP (first real install,
 *  2026-07-18: two "Claude Helper (Plugin)" crash reports, parent =
 *  the helper itself). The only host-independent answer is the Node
 *  the .mcpb now ships. Resolution order:
 *    1. RATER_NODE — explicit override, always wins.
 *    2. The BUNDLED runtime (<bundle>/runtime/node) — present in every
 *       packaged install; the build copies the official signed Node of
 *       the building platform, so a clean actuary Mac needs nothing.
 *    3. execPath whose basename IS node — the plain-Node hosts
 *       (npx, dev, CI; also any host that embeds a real node binary).
 *    4. A real node found on PATH or in the well-known install spots
 *       (GUI-launched apps get launchd's minimal PATH — homebrew and
 *       nvm live outside it).
 *    5. Last resort: execPath + ELECTRON_RUN_AS_NODE=1 — works only
 *       on Electron hosts whose runAsNode fuse is still on; when it
 *       isn't, the boot gate turns the SIGTRAP into a named failure
 *       instead of a silent dead worker.
 */
export function nodeRuntime(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): {
  cmd: string;
  env: Record<string, string>;
} {
  if (env.RATER_NODE) return { cmd: env.RATER_NODE, env: {} };
  const bundledName = process.platform === "win32" ? "node.exe" : "node";
  const root = bundleRoot(env);
  if (root) {
    const bundled = join(root, "runtime", bundledName);
    if (existsSync(bundled)) return { cmd: bundled, env: {} };
  }
  const exe = basename(execPath).toLowerCase();
  if (exe === "node" || exe === "node.exe") {
    return { cmd: execPath, env: {} };
  }
  const names = process.platform === "win32" ? ["node.exe", "node"] : ["node"];
  const dirs = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const cand = join(dir, name);
      if (existsSync(cand)) return { cmd: cand, env: {} };
    }
  }
  return { cmd: execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("no port")));
      }
    });
  });
}

function pipeToStderr(child: ChildProcess, label: string): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[${label}] ${chunk}`);
    });
  }
}

async function waitHealthy(
  url: string,
  child: ChildProcess,
  label = "the OpenRater engine",
  spawnError: () => Error | null = () => null,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "not attempted";
  while (Date.now() < deadline) {
    // A spawn that never started (bad command → async ENOENT) leaves
    // exitCode null forever; the recorded 'error' event is the only
    // signal, so surface it promptly instead of polling to timeout.
    const spawned = spawnError();
    if (spawned) {
      throw new Error(`${label} failed to start: ${spawned.message}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${label} exited during boot (code ${child.exitCode ?? child.signalCode}) — ` +
          "run the runtime_status tool for details.",
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(
    `${label} did not become healthy within ` +
      `${HEALTH_TIMEOUT_MS / 1000}s (${url}: ${lastErr}).`,
  );
}

function alive(c: ChildProcess): boolean {
  // A signal-killed child keeps exitCode === null; signalCode tells.
  return c.exitCode === null && c.signalCode === null;
}

let managed: Promise<Managed> | null = null;
let killers: (() => void) | null = null;
/** The most recent scoring spawn/exit failure, surfaced by the doctor. */
let lastScoringFailure: string | null = null;
/** The doctor's memory (MVP-015): survives the failed-boot promise
 *  being cleared, so "run runtime_status for details" has details. */
let lastBootFailure: RuntimeStatus["last_boot_failure"] | undefined;
/** Consecutive scoring-boot failures — two in a row reads as
 *  environmental, and the remedy escalates accordingly. */
let scoringFailureCount = 0;

function scoringRemedy(): string {
  const twice =
    scoringFailureCount >= 2
      ? "This has failed the same way twice — likely environmental. "
      : "";
  return (
    `${twice}Everything except the scoring sidecar works (quotes and ` +
    "books compute in the engine). To restore the sidecar, set " +
    "RATER_NODE to a Node 18+ binary (or install node on PATH) and " +
    "run runtime_status again — the doctor retries it."
  );
}

/** First-run brief, sixth cliff (owner, 2026-07-18): "if you don't
 *  know the app is there, you won't find it." Describing a door is
 *  not opening a door — on a FRESH install's first successful boot,
 *  the app opens itself in the default browser, once. A marker in the
 *  data dir makes it once-ever; RATER_APP_AUTOOPEN=always|first|never
 *  overrides; CI and tests never open anything. */
export function maybeOpenApp(
  env: NodeJS.ProcessEnv,
  appUrl: string,
  opener: (cmd: string, args: string[]) => void = (cmd, args) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      // A missing opener never breaks a boot — the chat carries links.
    });
    child.unref();
  },
): boolean {
  const pref = env.RATER_APP_AUTOOPEN ?? "first";
  if (pref === "never" || env.CI) return false;
  const marker = join(dataDir(env), ".app-opened");
  if (pref !== "always" && existsSync(marker)) return false;
  try {
    writeFileSync(marker, new Date().toISOString() + "\n");
  } catch {
    // Unwritable data dir — skip rather than reopen every boot.
    return false;
  }
  if (process.platform === "darwin") opener("open", [appUrl]);
  else if (process.platform === "win32") opener("cmd", ["/c", "start", "", appUrl]);
  else opener("xdg-open", [appUrl]);
  return true;
}

function installExitHooks(server: ChildProcess, scoring: ChildProcess): void {
  const kill = () => {
    for (const c of [server, scoring]) {
      try {
        c.kill();
      } catch {
        // already gone
      }
    }
  };
  killers = kill;
  process.once("exit", kill);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      kill();
      process.exit(0);
    });
  }
}

/** Spawn the scoring sidecar (shared by boot and the doctor's retry).
 *  'error' on a child with no listener is a fatal uncaught exception
 *  in Node — capture it so a bad runtime becomes a caught rejection,
 *  not a crash. waitHealthy polls the getter. */
function spawnScoring(
  env: NodeJS.ProcessEnv,
  serverPort: number,
  scoringPort: number,
  dir: string,
): { child: ChildProcess; spawnError: () => Error | null } {
  const runtime = nodeRuntime(env);
  if (runtime.cmd !== process.execPath || Object.keys(runtime.env).length > 0) {
    process.stderr.write(
      `[supervisor] scoring runtime: ${runtime.cmd}` +
        `${runtime.env.ELECTRON_RUN_AS_NODE ? " (ELECTRON_RUN_AS_NODE)" : ""}\n`,
    );
  }
  const scoring = spawn(runtime.cmd, [scoringEntry(env)], {
    env: {
      ...env,
      ...runtime.env,
      PORT: String(scoringPort),
      HOST: "127.0.0.1",
      API_LAB_BASE: `http://127.0.0.1:${serverPort}`,
      // The sidecar's job store defaults to ./.scoring-data (CWD-
      // relative) — in a packaged run the CWD is wherever Claude
      // Desktop spawned us, possibly read-only. Pin it beside the
      // SQLite file in the data dir.
      STORE_DIR: env.STORE_DIR ?? join(dir, "scoring"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeToStderr(scoring, "scoring");
  let scoringSpawnError: Error | null = null;
  scoring.on("error", (err) => {
    scoringSpawnError = err;
    lastScoringFailure = `scoring runtime failed to spawn (${runtime.cmd}): ${err.message}`;
    process.stderr.write(`[supervisor] ${lastScoringFailure}\n`);
  });
  scoring.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      lastScoringFailure = `scoring worker exited (code ${code}) — runtime ${runtime.cmd}`;
      process.stderr.write(`[supervisor] ${lastScoringFailure}\n`);
    } else if (signal && signal !== "SIGTERM") {
      lastScoringFailure = `scoring worker killed by ${signal}`;
    }
  });
  return { child: scoring, spawnError: () => scoringSpawnError };
}

async function boot(env: NodeJS.ProcessEnv): Promise<Managed> {
  const t0 = Date.now();
  const [serverPort, scoringPort] = [await freePort(), await freePort()];
  const dir = dataDir(env);
  mkdirSync(dir, { recursive: true });

  const { child: scoring, spawnError: scoringSpawnError } = spawnScoring(
    env,
    serverPort,
    scoringPort,
    dir,
  );

  const root = bundleRoot(env);
  const serverEnv: NodeJS.ProcessEnv = {
    ...env,
    RATER_PORT: String(serverPort),
    RATER_DB_PATH: env.RATER_DB_PATH ?? join(dir, "openrater.db"),
    RATER_SCORING_URL: `http://127.0.0.1:${scoringPort}`,
    RATER_AUTH_MODE: env.RATER_AUTH_MODE ?? "none",
    RATER_SEED_COLD_TEST: env.RATER_SEED_COLD_TEST ?? "1",
  };
  if (root) {
    serverEnv.RATER_SPA_DIR = env.RATER_SPA_DIR ?? join(root, "spa");
    serverEnv.RATER_COLD_TEST_FIXTURE =
      env.RATER_COLD_TEST_FIXTURE ?? join(root, "fixtures");
  }
  const server = spawn(serverCommand(env), [], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeToStderr(server, "server");
  // Same guard as the scoring child: a bad server command (or a
  // packaged binary the OS refuses) must not crash the process.
  let serverSpawnError: Error | null = null;
  server.on("error", (err) => {
    serverSpawnError = err;
    process.stderr.write(`[supervisor] server failed to spawn: ${err.message}\n`);
  });

  installExitHooks(server, scoring);
  const apiUrl = `http://127.0.0.1:${serverPort}`;
  // The ENGINE is the boot gate — every tool needs it, so its failure
  // is fatal and remembered.
  try {
    await waitHealthy(`${apiUrl}/health`, server, "the OpenRater engine", () => serverSpawnError);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastBootFailure = {
      when: new Date().toISOString(),
      child: "server",
      message,
      remedy:
        "The engine itself failed to start — check the data directory " +
        "is writable and re-run runtime_status; if it repeats, " +
        "reinstall the bundle.",
    };
    killers?.();
    throw err;
  }
  // The scoring sidecar DEGRADES, never kills the boot (MVP-001): the
  // first real install died here because the host's execPath couldn't
  // run JS — and took the healthy engine down with it. Every current
  // tool computes in the engine; a dead sidecar is a named limitation,
  // not an outage. The doctor retries it on every runtime_status call.
  let scoringHealthy = true;
  try {
    await waitHealthy(
      `http://127.0.0.1:${scoringPort}/health`,
      scoring,
      "the scoring worker",
      scoringSpawnError,
    );
    scoringFailureCount = 0;
  } catch (err) {
    scoringHealthy = false;
    scoringFailureCount += 1;
    const message =
      lastScoringFailure ?? (err instanceof Error ? err.message : String(err));
    lastBootFailure = {
      when: new Date().toISOString(),
      child: "scoring",
      message,
      remedy: scoringRemedy(),
    };
    process.stderr.write(
      `[supervisor] degraded boot: engine up, scoring down (${message})\n`,
    );
    try {
      scoring.kill();
    } catch {
      // already gone
    }
  }
  // Engine healthy — on a fresh install, show the app.
  maybeOpenApp(env, apiUrl);
  return {
    apiUrl,
    server,
    scoring,
    serverPort,
    scoringPort,
    bootMs: Date.now() - t0,
    scoringHealthy,
  };
}

/** The doctor's retry: respawn a dead sidecar on the SAME port the
 *  engine was configured with. Returns the updated health. */
async function retryScoring(m: Managed, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (m.scoringHealthy && alive(m.scoring)) return true;
  const { child, spawnError } = spawnScoring(
    env,
    m.serverPort,
    m.scoringPort,
    dataDir(env),
  );
  try {
    // A doctor call must answer promptly even when the sidecar is
    // permanently broken — 10s, not the 45s cold-boot allowance.
    await waitHealthy(
      `http://127.0.0.1:${m.scoringPort}/health`,
      child,
      "the scoring worker",
      spawnError,
      10_000,
    );
    m.scoring = child;
    m.scoringHealthy = true;
    scoringFailureCount = 0;
    installExitHooks(m.server, child);
    return true;
  } catch (err) {
    scoringFailureCount += 1;
    const message =
      lastScoringFailure ?? (err instanceof Error ? err.message : String(err));
    lastBootFailure = {
      when: new Date().toISOString(),
      child: "scoring",
      message,
      remedy: scoringRemedy(),
    };
    try {
      child.kill();
    } catch {
      // already gone
    }
    return false;
  }
}

/** The one entry tools use: resolve (booting if needed) and MUTATE the
 *  shared config so every handler's captured reference now points at
 *  the managed runtime. Single-threaded: the mutation completes before
 *  any tool body runs. */
export async function ensureRuntime(config: ApiConfig): Promise<ApiConfig> {
  if (runtimeMode() === "external") return config;
  if (managed) {
    const m = await managed;
    // The ENGINE alive is the reuse gate (MVP-001): quotes and books
    // compute there, and every current tool needs only it. A dead
    // sidecar is a degraded runtime the doctor names and retries —
    // killing a healthy engine to chase the sidecar (the first real
    // install's failure shape) turned one broken child into a total
    // outage, one full reboot per tool call.
    if (alive(m.server)) {
      if (m.scoringHealthy && !alive(m.scoring)) {
        m.scoringHealthy = false; // died since boot — the doctor reports it
      }
      apply(config, m.apiUrl);
      return config;
    }
    for (const c of [m.server, m.scoring]) {
      try {
        c.kill();
      } catch {
        // already gone
      }
    }
    managed = null; // engine died — respawn below
  }
  managed = boot(process.env).catch((err) => {
    managed = null;
    throw err;
  });
  const m = await managed;
  apply(config, m.apiUrl);
  return config;
}

function apply(config: ApiConfig, apiUrl: string): void {
  // ApiConfig is readonly to tools; the supervisor is its one writer.
  (config as { baseUrl: string }).baseUrl = apiUrl;
  (config as { appUrl: string }).appUrl = apiUrl; // the server serves the SPA
}

/** The doctor: what mode we're in, what's running, and what to do. */
export async function runtimeStatus(config: ApiConfig): Promise<RuntimeStatus> {
  const mode = runtimeMode();
  if (mode === "external") {
    let healthy = false;
    let detail: string;
    try {
      const res = await fetch(`${config.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      healthy = res.ok;
      detail = healthy
        ? "the OpenRater server is reachable."
        : `the server answered HTTP ${res.status} — check its logs.`;
    } catch {
      // FCA fca-2026-07-25 PRE-5 — this message is read by an AI
      // assistant with a shell. The old text ("Start yours") talked
      // one into booting a fresh server on this port with the DEFAULT
      // data directory — the real user's data — silently splitting
      // the backend mid-session (H-5). The down-message must never
      // instruct starting a server; external mode's contract is that
      // someone else operates the backend at RATER_API_URL.
      // FCA fca-2026-07-25 #18 — the user reading the relay of this
      // message is an actuary, not a server operator: the actionable
      // step must LEAD, in human terms. The old lead ("Start yours
      // (RATER_API_URL…)") handed a non-engineer environment
      // variables and stranded the journey at hello.
      detail =
        "the OpenRater backend this chat is configured to use " +
        `(${config.baseUrl}) isn't running right now. Tell the user ` +
        "in plain language: ask whoever set up OpenRater here to " +
        "start it back up, then try again. Do NOT start a new server " +
        "to fix this yourself — a fresh server would run against a " +
        "different data directory and silently split this user's " +
        "work. When it's back, run runtime_status again.";
    }
    return {
      mode,
      api_url: config.baseUrl,
      app_url: config.appUrl,
      healthy,
      detail,
      // FCA #18 — external mode: the backend is operated out-of-band,
      // so the app link outlives any one chat.
      app_lifecycle:
        "The app link is served by the standing OpenRater backend — " +
        "it stays up (and bookmarkable) as long as that backend runs, " +
        "independent of this chat.",
      sample: sampleAssets(),
    };
  }

  const status: RuntimeStatus = {
    mode,
    api_url: config.baseUrl,
    app_url: config.appUrl,
    healthy: false,
    detail: "managed runtime not booted yet — it starts on the first tool call.",
    // FCA fca-2026-07-25 #18 (finding 84) — the engine and app are
    // children of the chat host: a bookmarked app_url opened cold
    // after the host quits is a dead page. Nothing product-authored
    // owned that moment; this sentence does. Share it whenever the
    // user asks about coming back to the app later.
    app_lifecycle:
      "The app runs only while the chat host is open — quitting the " +
      "desktop app takes the engine (and the app link) down with it. " +
      "To come back later: open this chat and send any OpenRater " +
      "message; the engine relights and the same link works again. " +
      "The chat is the reliable door — a bookmark alone is not.",
    data_dir: dataDir(process.env),
    ...(bundleRoot(process.env) ? { bundle_root: bundleRoot(process.env)! } : {}),
    sample: sampleAssets(),
  };
  // The doctor is the instructed FIRST call of a session — so it also
  // BOOTS the engine (which auto-opens the app on a fresh install).
  // Crash-proof by construction: a failed boot becomes the diagnosis,
  // never a thrown error.
  if (!managed) {
    try {
      await ensureRuntime(config);
      status.api_url = config.baseUrl;
      status.app_url = config.appUrl;
    } catch (err) {
      status.detail = `managed runtime failed to boot: ${
        err instanceof Error ? err.message : String(err)
      }`;
      if (lastBootFailure) status.last_boot_failure = lastBootFailure;
      return status;
    }
  }
  if (!managed) return status;
  try {
    const m = await managed;
    status.server = {
      pid: m.server.pid,
      port: m.serverPort,
      alive: alive(m.server),
    };
    status.boot_ms = m.bootMs;
    const res = await fetch(`${m.apiUrl}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    // The doctor HEALS what it can: a dead sidecar gets one respawn
    // attempt per status call (MVP-001 — degraded, never dead).
    let scoringUp = m.scoringHealthy && alive(m.scoring);
    if (res.ok && !scoringUp) {
      scoringUp = await retryScoring(m, process.env);
    }
    status.scoring = {
      pid: m.scoring.pid,
      port: m.scoringPort,
      alive: scoringUp,
      ...(scoringUp
        ? {}
        : {
            detail: `${lastScoringFailure ?? "not healthy"} — ${scoringRemedy()}`,
          }),
    };
    // Healthy = the ENGINE answers; a degraded sidecar is named, not
    // an outage (every current tool computes in the engine).
    status.healthy = res.ok;
    status.detail = !res.ok
      ? `server process alive but /health answered HTTP ${res.status}.`
      : !scoringUp
        ? `engine up (booted in ${m.bootMs} ms); the scoring sidecar is ` +
          `down — ${lastScoringFailure ?? "it never became healthy"}. ` +
          scoringRemedy()
        : `managed runtime up (booted in ${m.bootMs} ms).`;
  } catch (err) {
    status.detail = `managed runtime failed: ${
      err instanceof Error ? err.message : String(err)
    }${lastScoringFailure ? ` (${lastScoringFailure})` : ""}`;
  }
  if (lastBootFailure) status.last_boot_failure = lastBootFailure;
  return status;
}

/** Test seam: forget the managed pair (kills nothing by itself). */
export function resetRuntimeForTests(): void {
  killers?.();
  killers = null;
  managed = null;
  lastScoringFailure = null;
  lastBootFailure = undefined;
  scoringFailureCount = 0;
}
