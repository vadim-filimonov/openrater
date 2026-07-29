// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * Supervisor tests — hermetic: the "server" is a tiny Node HTTP
 * process honoring the SERVER COMMAND CONTRACT (no args; reads
 * RATER_PORT; answers /health), the "scoring" entry is a sleeper.
 * No Python, no network beyond loopback.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configFromEnv } from "./api.js";
import {
  ensureRuntime,
  maybeOpenApp,
  nodeRuntime,
  resetRuntimeForTests,
  runtimeMode,
  runtimeStatus,
  sampleAssets,
  SAMPLE_PLAN_ID,
} from "./runtime.js";

const scratch = mkdtempSync(join(tmpdir(), "openrater-supervisor-"));
const bootLog = join(scratch, "boots.log");

const fakeServerJs = join(scratch, "fake-server.mjs");
writeFileSync(
  fakeServerJs,
  `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(bootLog)}, "boot " + process.env.RATER_PORT + "\\n");
const srv = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, scoring: process.env.RATER_SCORING_URL }));
    return;
  }
  res.writeHead(404);
  res.end();
});
srv.listen(Number(process.env.RATER_PORT), "127.0.0.1");
`,
);
// The contract is "a single executable, no args" — a shell shim makes
// the .mjs one (POSIX only; the packaged binary needs no shim).
const fakeServerCmd = join(scratch, "fake-server.sh");
writeFileSync(
  fakeServerCmd,
  `#!/bin/sh\nexec "${process.execPath}" "${fakeServerJs}"\n`,
);
chmodSync(fakeServerCmd, 0o755);

const fakeScoringEntry = join(scratch, "fake-scoring.mjs");
// The supervisor health-gates the worker too (the first real install's
// lesson) — the fake must answer /health like the real sidecar.
writeFileSync(
  fakeScoringEntry,
  `
import { createServer } from "node:http";
const srv = createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404);
  res.end();
});
srv.listen(Number(process.env.PORT), process.env.HOST ?? "127.0.0.1");
`,
);

const ENV_KEYS = [
  "RATER_RUNTIME",
  "RATER_API_URL",
  "RATER_APP_URL",
  "RATER_BUNDLE_ROOT",
  "RATER_SERVER_CMD",
  "RATER_SCORING_ENTRY",
  "RATER_DATA_DIR",
  "RATER_DB_PATH",
  "RATER_COLD_TEST_FIXTURE",
  "RATER_APP_AUTOOPEN",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  writeFileSync(bootLog, "");
});

afterEach(() => {
  resetRuntimeForTests();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// A scoring entry that dies immediately — the degraded-runtime shape
// (the first real install's SIGTRAP, reproduced as a fast exit).
const brokenScoringEntry = join(scratch, "broken-scoring.mjs");
writeFileSync(brokenScoringEntry, `process.exit(7);\n`);

function managedEnv(): void {
  process.env.RATER_RUNTIME = "managed";
  process.env.RATER_SERVER_CMD = fakeServerCmd;
  process.env.RATER_SCORING_ENTRY = fakeScoringEntry;
  process.env.RATER_DATA_DIR = join(scratch, "data");
  // Tests must never pop a browser.
  process.env.RATER_APP_AUTOOPEN = "never";
}

describe("runtimeMode", () => {
  it("defaults to external (the npx / self-hosted path is unchanged)", () => {
    expect(runtimeMode({})).toBe("external");
    expect(runtimeMode({ RATER_API_URL: "http://127.0.0.1:9" })).toBe("external");
  });

  it("a bundle root without an explicit API URL means managed", () => {
    expect(runtimeMode({ RATER_BUNDLE_ROOT: "/x" })).toBe("managed");
    expect(
      runtimeMode({ RATER_BUNDLE_ROOT: "/x", RATER_API_URL: "http://y" }),
    ).toBe("external");
    expect(runtimeMode({ RATER_RUNTIME: "managed" })).toBe("managed");
  });
});

describe("managed runtime", () => {
  it("boots the pair on a free port, repoints the config, and reuses across calls", async () => {
    managedEnv();
    const config = configFromEnv();
    const before = config.baseUrl;

    await ensureRuntime(config);
    expect(config.baseUrl).not.toBe(before);
    expect(config.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // The SPA is served by the managed server — deep links follow it.
    expect(config.appUrl).toBe(config.baseUrl);

    const health = await fetch(`${config.baseUrl}/health`);
    expect(health.ok).toBe(true);
    // The server was told where scoring lives.
    const body = (await health.json()) as { scoring: string };
    expect(body.scoring).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const firstUrl = config.baseUrl;
    await ensureRuntime(config);
    expect(config.baseUrl).toBe(firstUrl);
    expect(readFileSync(bootLog, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("reports through the doctor and respawns after a crash", async () => {
    managedEnv();
    const config = configFromEnv();
    await ensureRuntime(config);

    let status = await runtimeStatus(config);
    expect(status.mode).toBe("managed");
    expect(status.healthy).toBe(true);
    expect(status.server?.alive).toBe(true);
    expect(status.scoring?.alive).toBe(true);
    expect(status.boot_ms).toBeGreaterThanOrEqual(0);

    // Kill the managed server; the next ensure boots a fresh pair.
    process.kill(status.server!.pid!, "SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
    await ensureRuntime(config);
    const boots = readFileSync(bootLog, "utf8").trim().split("\n");
    expect(boots).toHaveLength(2);
    status = await runtimeStatus(config);
    expect(status.healthy).toBe(true);
  });

  it("the doctor BOOTS an unbooted managed runtime (the ignition contract)", async () => {
    managedEnv();
    const config = configFromEnv();
    // No ensureRuntime first — the doctor itself is the first call.
    const status = await runtimeStatus(config);
    expect(status.healthy).toBe(true);
    expect(status.server?.alive).toBe(true);
    expect(status.scoring?.alive).toBe(true);
    expect(readFileSync(bootLog, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("a broken boot becomes the doctor's diagnosis, never a thrown error", async () => {
    managedEnv();
    process.env.RATER_SERVER_CMD = join(scratch, "no-such-server");
    const status = await runtimeStatus(configFromEnv());
    expect(status.healthy).toBe(false);
    expect(status.detail).toMatch(/failed to boot/i);
  });

  it("external down-message leads with the HUMAN step and FORBIDS starting a server (FCA PRE-5 + #18)", async () => {
    // The reader is an AI assistant with a shell; the user hearing
    // the relay is an actuary. The old "Start yours" hint talked the
    // assistant into booting a stray server against the real user's
    // data directory (H-5), and the pre-#18 lead handed a
    // non-engineer environment variables. The message must name the
    // configured backend, give a step a non-engineer can take (ask
    // whoever set it up), and explicitly warn AGAINST starting a
    // replacement.
    process.env.RATER_API_URL = "http://127.0.0.1:1"; // nothing there
    const config = configFromEnv();
    const status = await runtimeStatus(config);
    expect(status.mode).toBe("external");
    expect(status.healthy).toBe(false);
    expect(status.detail).toContain("http://127.0.0.1:1");
    expect(status.detail).toMatch(/isn't running right now/);
    expect(status.detail).toMatch(/ask whoever set up OpenRater/i);
    expect(status.detail).toMatch(/do not start a new server/i);
    expect(status.detail).not.toMatch(/Start yours/);
    // No nudge toward replacing the configured backend either.
    expect(status.detail).not.toMatch(/install the desktop bundle/i);
    // FCA #18 — external mode: the app link outlives the chat, and
    // the payload says so.
    expect(status.app_lifecycle).toMatch(/independent of this chat/i);
  });

  it("managed status carries the app-lifecycle sentence (FCA #18 — the dead-bookmark moment)", async () => {
    // Finding 84: the engine + app are children of the chat host; a
    // bookmarked app_url opened cold after the host quit is a dead
    // page nothing product-authored owned. The doctor's payload now
    // owns it: the chat is the door, a message relights the link.
    managedEnv();
    const config = configFromEnv();
    const status = await runtimeStatus(config);
    expect(status.mode).toBe("managed");
    expect(status.app_lifecycle).toMatch(/only while the chat host is open/i);
    expect(status.app_lifecycle).toMatch(/send any OpenRater message/i);
    expect(status.app_lifecycle).toMatch(/bookmark alone is not/i);
  });
});

describe("nodeRuntime (the scoring worker's runtime — the first real install's bug)", () => {
  it("RATER_NODE always wins", () => {
    const r = nodeRuntime({ RATER_NODE: "/custom/node" });
    expect(r.cmd).toBe("/custom/node");
    expect(r.env).toEqual({});
  });

  it("a plain-Node host uses its own execPath (npx / dev / CI)", () => {
    // The test process IS plain node, so this exercises the real branch.
    const r = nodeRuntime({});
    expect(r.cmd).toBe(process.execPath);
    expect(r.env).toEqual({});
  });

  it("the bundled runtime wins on a packaged install (the SIGTRAP fix)", () => {
    const root = join(scratch, "fake-bundle");
    mkdirSync(join(root, "runtime"), { recursive: true });
    const bundled = join(root, "runtime", process.platform === "win32" ? "node.exe" : "node");
    writeFileSync(bundled, "#!/bin/sh\n");
    const r = nodeRuntime(
      { RATER_BUNDLE_ROOT: root },
      "/Applications/Claude.app/Contents/MacOS/Claude Helper",
    );
    expect(r.cmd).toBe(bundled);
    expect(r.env).toEqual({});
  });

  it("an Electron host NEVER beats a findable real node (its runAsNode fuse may be off)", () => {
    const versions = process.versions as Record<string, string | undefined>;
    versions.electron = "31.0.0";
    try {
      const r = nodeRuntime(
        { PATH: dirname(process.execPath) },
        "/Applications/Claude.app/Contents/MacOS/Claude Helper",
      );
      // The first real install proved the helper dies by SIGTRAP when
      // spawned as node — a real node must always be preferred.
      expect(r.cmd).toBe(process.execPath);
      expect(r.env).toEqual({});
    } finally {
      delete versions.electron;
    }
  });

  it("an unmarked embedded host falls through to a real node on PATH", () => {
    // No electron marker, execPath isn't node → the scan must find the
    // node this test itself runs on (its bin dir rides PATH in dev/CI).
    const r = nodeRuntime(
      { PATH: dirname(process.execPath) },
      "/opt/somehost/embedded-runtime",
    );
    expect(r.cmd).toBe(process.execPath);
    expect(r.env).toEqual({});
  });

  it("with nothing else, the last resort is execPath + the electron flag", () => {
    const r = nodeRuntime({ PATH: "/nonexistent-dir" }, "/opt/somehost/embedded-runtime");
    // On machines with node in a well-known dir the scan finds it;
    // otherwise the flag-carrying fallback fires. Both are correct —
    // assert the invariant: the result is runnable-or-flagged.
    if (r.cmd === "/opt/somehost/embedded-runtime") {
      expect(r.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    } else {
      expect(r.env).toEqual({});
    }
  });
});

describe("maybeOpenApp (the app shows itself once — the sixth cliff)", () => {
  function fakeOpener(): { calls: string[][]; open: (c: string, a: string[]) => void } {
    const calls: string[][] = [];
    return { calls, open: (c, a) => calls.push([c, ...a]) };
  }

  it("opens once on a fresh install, then never again", () => {
    const dir = join(scratch, "autoopen-fresh");
    mkdirSync(dir, { recursive: true });
    const env = { RATER_DATA_DIR: dir };
    const first = fakeOpener();
    expect(maybeOpenApp(env, "http://127.0.0.1:1234", first.open)).toBe(true);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0].join(" ")).toContain("http://127.0.0.1:1234");
    const second = fakeOpener();
    expect(maybeOpenApp(env, "http://127.0.0.1:1234", second.open)).toBe(false);
    expect(second.calls).toHaveLength(0);
  });

  it("never opens under never / CI", () => {
    const dir = join(scratch, "autoopen-never");
    mkdirSync(dir, { recursive: true });
    const o = fakeOpener();
    expect(
      maybeOpenApp({ RATER_DATA_DIR: dir, RATER_APP_AUTOOPEN: "never" }, "http://x", o.open),
    ).toBe(false);
    expect(
      maybeOpenApp({ RATER_DATA_DIR: dir, CI: "1" }, "http://x", o.open),
    ).toBe(false);
    expect(o.calls).toHaveLength(0);
  });

  it("always reopens when asked to", () => {
    const dir = join(scratch, "autoopen-always");
    mkdirSync(dir, { recursive: true });
    const env = { RATER_DATA_DIR: dir, RATER_APP_AUTOOPEN: "always" };
    const o = fakeOpener();
    expect(maybeOpenApp(env, "http://x", o.open)).toBe(true);
    expect(maybeOpenApp(env, "http://x", o.open)).toBe(true);
    expect(o.calls).toHaveLength(2);
  });
});

describe("sampleAssets (the guided tour's content)", () => {
  it("in the dev repo it finds the demo book and the sample filing", () => {
    const s = sampleAssets({});
    expect(s.plan_id).toBe(SAMPLE_PLAN_ID);
    expect(s.demo_book).toMatch(/meridian-demo-book\.csv$/);
    expect(s.filing).toMatch(/meridian_shopfront_bop_filing\.pdf$/);
  });

  it("an explicit fixture dir wins over the repo fallback", () => {
    const dir = join(scratch, "fixtures");
    writeFileSync(join(scratch, "sentinel"), ""); // ensure scratch exists
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meridian-demo-book.csv"), "case_id\n");
    const s = sampleAssets({ RATER_COLD_TEST_FIXTURE: dir });
    expect(s.demo_book).toBe(join(dir, "meridian-demo-book.csv"));
    // The filing isn't in the override dir — the repo fallback still finds it.
    expect(s.filing).toMatch(/meridian_shopfront_bop_filing\.pdf$/);
  });

  it("a fixture FILE resolves to its directory (the single-fixture deploy shape)", () => {
    const dir = join(scratch, "one-file");
    mkdirSync(dir, { recursive: true });
    const fixture = join(dir, "x.plan.json");
    writeFileSync(fixture, "{}");
    writeFileSync(join(dir, "meridian-demo-book.csv"), "case_id\n");
    const s = sampleAssets({ RATER_COLD_TEST_FIXTURE: fixture });
    expect(s.demo_book).toBe(join(dir, "meridian-demo-book.csv"));
  });

  it("rides the doctor's status payload", async () => {
    process.env.RATER_API_URL = "http://127.0.0.1:1";
    const status = await runtimeStatus(configFromEnv());
    expect(status.sample?.plan_id).toBe(SAMPLE_PLAN_ID);
  });
});

describe("degraded runtime (MVP-001/MVP-015)", () => {
  it("a dead scoring sidecar degrades the boot instead of killing it", async () => {
    managedEnv();
    process.env.RATER_SCORING_ENTRY = brokenScoringEntry;
    const config = configFromEnv(process.env);
    // Boot succeeds — the engine is the gate, not the sidecar.
    await ensureRuntime(config);
    const status = await runtimeStatus(config);
    expect(status.healthy).toBe(true); // the engine answers
    expect(status.scoring?.alive).toBe(false);
    expect(status.scoring?.detail).toMatch(/scoring/i);
    expect(status.scoring?.detail).toMatch(/RATER_NODE|node/i);
    expect(status.last_boot_failure?.child).toBe("scoring");
    expect(status.last_boot_failure?.remedy).toBeTruthy();
    // The engine is REUSED across calls — no reboot loop chasing the
    // dead sidecar (one boot line, not one per tool call).
    await ensureRuntime(config);
    await ensureRuntime(config);
    expect(readFileSync(bootLog, "utf8").trim().split("\n")).toHaveLength(1);
  }, 60_000);

  it("the doctor retries the sidecar and heals when the runtime recovers", async () => {
    managedEnv();
    process.env.RATER_SCORING_ENTRY = brokenScoringEntry;
    const config = configFromEnv(process.env);
    await ensureRuntime(config);
    let status = await runtimeStatus(config);
    expect(status.scoring?.alive).toBe(false);
    // The environment heals (the operator installed node / fixed the
    // entry) — the next doctor call respawns the sidecar.
    process.env.RATER_SCORING_ENTRY = fakeScoringEntry;
    status = await runtimeStatus(config);
    expect(status.healthy).toBe(true);
    expect(status.scoring?.alive).toBe(true);
    expect(status.scoring?.detail).toBeUndefined();
  }, 60_000);

  it("two consecutive scoring failures escalate the remedy", async () => {
    managedEnv();
    process.env.RATER_SCORING_ENTRY = brokenScoringEntry;
    const config = configFromEnv(process.env);
    await ensureRuntime(config); // failure 1 (boot)
    const status = await runtimeStatus(config); // failure 2 (retry)
    expect(status.scoring?.detail).toMatch(/twice/i);
  }, 60_000);
});
