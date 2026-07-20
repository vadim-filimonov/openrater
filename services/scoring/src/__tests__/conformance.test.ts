/**
 * Conformance PARITY — the server must score byte-identically to the
 * engine's own conformance suite (ADR-0045 §1, the core guarantee).
 *
 * For each of the SAME vectors the engine wires
 * (`packages/contracts/src/__tests__/conformance.test.ts`, whose count
 * assertion locksteps with the manifest), we POST the vector's runtime
 * Plan through the
 * SERVICE's real path (`parseScoreRequest` → `scoreOne` → the reused
 * engine) and assert `outputs` deep-equals `expectedOutputs`. Because
 * the service imports the ONE engine (never a port), this can only pass
 * if server-side scoring is identical to client/conformance scoring.
 *
 * We read the canonical vector files at test time (single source of
 * truth — no copies to drift) via the SAME explicit wired list the
 * engine test imports. We do NOT glob the directory: V16/V44/V45/V46
 * and the duplicate V37/V38 prefixes exist on disk but are intentionally
 * NOT wired, and globbing would test vectors the engine doesn't claim.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { parseScoreRequest } from "../core/schema";
import { scoreOne } from "../core/score";
import { buildApp } from "../http/server";


interface JsonVector {
  readonly name: string;
  readonly description: string;
  readonly plan: unknown;
  readonly externalInputs: Record<string, unknown>;
  readonly expectedOutputs: Record<string, unknown>;
  readonly classLibraryEntries?: readonly unknown[];
  readonly asOf?: string;
}

const CONFORMANCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/contracts/src/__tests__/conformance",
);

// P2 G20 — the wired list is LOADED from the manifest the engine suite
// asserts against (packages/contracts .../conformance/manifest.json):
// one source, zero drift by construction (it sat 40 vs 41 hand-synced).
const MANIFEST = JSON.parse(
  readFileSync(join(CONFORMANCE_DIR, "manifest.json"), "utf8"),
) as { engine_vectors: readonly string[] };
const WIRED_VECTORS = MANIFEST.engine_vectors;

function loadVector(stem: string): JsonVector {
  const raw = readFileSync(join(CONFORMANCE_DIR, `${stem}.json`), "utf8");
  return JSON.parse(raw) as JsonVector;
}

const VECTORS = WIRED_VECTORS.map(loadVector);

/** Build a `/score` request body for a vector, mirroring optionsFor(). */
function requestFor(v: JsonVector): unknown {
  return {
    source: "plan",
    plan: v.plan,
    inputs: v.externalInputs,
    trace: "none",
    options: {
      as_of: v.asOf ?? "2024-01-01",
      ...(v.classLibraryEntries
        ? { classLibraryEntries: v.classLibraryEntries }
        : {}),
    },
  };
}

describe("scoring service · vector discovery", () => {
  it("loads exactly the 50 wired conformance vectors", () => {
    // 50 = 49 + V63 (Phase F residual — a gate-ONLY variable has no
    // input port to key the V62 record coercion from; the rule's own
    // boolean RHS types it at the same seam).
    // V15 (chain-from-report-acceptance) is intentionally absent; add a
    // replacement only alongside a new acceptance-flow golden vector.
    expect(VECTORS).toHaveLength(50);
  });

  it("vector names are unique", () => {
    const names = VECTORS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("scoring service · /score parity (server == conformance)", () => {
  for (const v of VECTORS) {
    it(`${v.name} · ${v.description}`, async () => {
      const req = parseScoreRequest(requestFor(v));
      const result = await scoreOne(req);
      expect(result.outputs).toEqual(v.expectedOutputs);
    });
  }
});

describe("scoring service · reproducibility", () => {
  for (const v of VECTORS) {
    it(`${v.name} · two scores produce identical outputs`, async () => {
      const r1 = await scoreOne(parseScoreRequest(requestFor(v)));
      const r2 = await scoreOne(parseScoreRequest(requestFor(v)));
      expect(r1.outputs).toEqual(r2.outputs);
    });
  }
});

describe("scoring service · HTTP /score (full route + schema)", () => {
  it("scores a vector end-to-end through the real route", async () => {
    const app = buildApp();
    const v = loadVector("V7.bop-like-end-to-end");
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: requestFor(v) as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { outputs: Record<string, unknown> };
    expect(body.outputs).toEqual(v.expectedOutputs);
    await app.close();
  });

  it("derives a premium view for a single-numeric-output plan", async () => {
    const app = buildApp();
    const v = loadVector("V1.trivial-constant");
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: requestFor(v) as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { views: { premium: number | null } };
    // V1 emits exactly one numeric output → the premium heuristic resolves it.
    const only = Object.values(v.expectedOutputs).find(
      (x) => typeof x === "number",
    );
    expect(body.views.premium).toBe(only ?? null);
    await app.close();
  });

  it("returns 400 on a malformed body", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: { source: "plan" /* missing plan + inputs */ },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 501 for plan_id when no API Lab base is wired", async () => {
    const app = buildApp(); // no apiLabBase → resolution dep absent
    const res = await app.inject({
      method: "POST",
      url: "/score",
      payload: {
        source: "plan_id",
        planId: "iso.bop.ks",
        snapshotId: "ps_x",
        inputs: {},
      },
    });
    expect(res.statusCode).toBe(501);
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "scoring" });
    await app.close();
  });
});
