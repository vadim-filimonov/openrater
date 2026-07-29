// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * Self-test for the PRE-1 build gate (packaging/desktop/
 * verify-node-runtime.sh) — the script that proves the bundled Node
 * runtime executes REAL JavaScript. v0.1.0 shipped a dead scoring
 * sidecar because its only check was version-shaped: a hardened-
 * runtime signature without JIT entitlements passes `node --version`
 * yet SIGTRAPs on any real script. These tests guard the gate itself
 * from rotting into a no-op: it must PASS a working node and FAIL a
 * binary that can't run the workload.
 *
 * The MCP service owns this test because it is the consumer of the
 * bundled runtime (runtime.ts nodeRuntime()).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GATE = join(
  __dirname,
  "../../../packaging/desktop/verify-node-runtime.sh",
);

// POSIX sh only — the gate runs under Git Bash on the Windows CI leg,
// but this self-test just skips there (no reliable sh on dev boxes).
const canRunSh = process.platform !== "win32";

describe.runIf(canRunSh)("verify-node-runtime.sh (PRE-1 gate)", () => {
  it("exists and is referenced from the packaging pipeline", () => {
    expect(existsSync(GATE)).toBe(true);
  });

  it("passes a working node (the current process's own binary)", () => {
    const r = spawnSync("sh", [GATE, process.execPath], {
      encoding: "utf8",
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("verify-node-runtime: OK");
    expect(r.stdout).toContain("code range + JIT proven");
  });

  it("fails a binary that cannot run the real-JS workload", () => {
    // /bin/ls exits non-zero on `-e <js>` — stands in for the
    // signed-without-entitlements node that dies mid-script.
    const r = spawnSync("sh", [GATE, "/bin/ls"], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("FATAL");
  });

  it("fails on a missing binary with a named message", () => {
    const r = spawnSync("sh", [GATE, "/nonexistent/runtime/node"], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("no node binary");
  });

  it("refuses version-shaped verification by construction", () => {
    // The gate's workload must be real JS (loop + JSON round-trip),
    // never --version: pin the script's own contents so a future
    // "simplification" back to the v0.1.0 trap fails here.
    const r = spawnSync("cat", [GATE], { encoding: "utf8" });
    expect(r.stdout).toContain("JSON.parse(JSON.stringify");
    expect(r.stdout).toContain("for(let i=0;i<1e6;i++)");
    expect(r.stdout).not.toMatch(/\$BIN"?\s+--version"?\s*$/m);
  });
});
