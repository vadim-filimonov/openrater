/**
 * IrpmSourceSpec guard tests (Brief 62.2). The union + `isIrpmSourceSpec`
 * moved here from `policy-adjustments.ts`; 62.2 sharpens the `column` arm
 * to carry EITHER a single net `column` OR a per-category `columns` map
 * (exactly one). The per-row resolver (`resolveIrpmSource`) lands in the
 * next PR and gets its own tests.
 */

import { describe, it, expect } from "vitest";
import {
  isIrpmSourceSpec,
  resolveIrpmSource,
  makeIrpmAdjustmentResolver,
  MODEL_SOURCE_RETIRED_MESSAGE,
} from "./irpm-source";
import type { PolicyAdjustment } from "./policy-adjustments";

describe("isIrpmSourceSpec", () => {
  it("accepts a literal (total, sections, or both, or neither)", () => {
    expect(isIrpmSourceSpec({ from: "literal" })).toBe(true);
    expect(isIrpmSourceSpec({ from: "literal", total: -7 })).toBe(true);
    expect(isIrpmSourceSpec({ from: "literal", sections: { management: -3, location: -4 } })).toBe(true);
    expect(isIrpmSourceSpec({ from: "literal", total: -7, sections: { a: -7 } })).toBe(true);
  });

  it("rejects a literal with a non-numeric total or section", () => {
    expect(isIrpmSourceSpec({ from: "literal", total: "−7" })).toBe(false);
    expect(isIrpmSourceSpec({ from: "literal", sections: { a: "x" } })).toBe(false);
  });

  it("accepts a net column (single `column`)", () => {
    expect(isIrpmSourceSpec({ from: "column", column: "irpm_total_pct" })).toBe(true);
  });

  it("accepts a per-category column map (`columns`)", () => {
    expect(
      isIrpmSourceSpec({ from: "column", columns: { management: "irpm_mgmt_pct", location: "irpm_loc_pct" } }),
    ).toBe(true);
  });

  it("enforces exactly-one-of column / columns", () => {
    // neither
    expect(isIrpmSourceSpec({ from: "column" })).toBe(false);
    // both
    expect(isIrpmSourceSpec({ from: "column", column: "x", columns: { a: "y" } })).toBe(false);
  });

  it("rejects a malformed column / columns", () => {
    expect(isIrpmSourceSpec({ from: "column", column: "" })).toBe(false);
    expect(isIrpmSourceSpec({ from: "column", columns: {} })).toBe(false); // empty map
    expect(isIrpmSourceSpec({ from: "column", columns: { a: 1 } })).toBe(false); // non-string col
  });

  it("validates the connector source by its required fields; the model arm is retired (S1)", () => {
    // A model source is no longer structurally valid, even when fully formed
    // (the resolver refuses it by name).
    expect(isIrpmSourceSpec({ from: "model", model_id: "m1", version: "1.0.0" })).toBe(false);
    expect(isIrpmSourceSpec({ from: "model", model_id: "m1" })).toBe(false);
    // Connector pins a version too (62.6 — "no floating latest").
    expect(isIrpmSourceSpec({ from: "connector", connector_id: "c1", version: "v3" })).toBe(true);
    expect(isIrpmSourceSpec({ from: "connector", connector_id: "c1" })).toBe(false);
    expect(isIrpmSourceSpec({ from: "connector" })).toBe(false);
  });

  it("rejects an unknown source tag or a non-object", () => {
    expect(isIrpmSourceSpec({ from: "telepathy" })).toBe(false);
    expect(isIrpmSourceSpec({})).toBe(false);
    expect(isIrpmSourceSpec(null)).toBe(false);
  });
});

describe("resolveIrpmSource", () => {
  const noInputs = { externalInputs: {} };

  it("passes a literal through (total, or sum of sections)", () => {
    expect(resolveIrpmSource({ from: "literal", total: -7 }, noInputs)).toEqual({
      kind: "factor",
      net: -7,
      provenance: { source: "literal" },
    });
    expect(
      resolveIrpmSource({ from: "literal", sections: { a: -3, b: -4 } }, noInputs),
    ).toEqual({
      kind: "factor",
      net: -7,
      sections: { a: -3, b: -4 },
      provenance: { source: "literal" },
    });
  });

  it("reads a net column", () => {
    const r = resolveIrpmSource(
      { from: "column", column: "irpm_total_pct" },
      { externalInputs: { irpm_total_pct: -7 } },
    );
    expect(r).toEqual({ kind: "factor", net: -7, provenance: { source: "column" } });
  });

  it("reads a per-category column map and sums the net", () => {
    const r = resolveIrpmSource(
      { from: "column", columns: { management: "m_pct", location: "l_pct" } },
      { externalInputs: { m_pct: -3, l_pct: -4 } },
    );
    expect(r).toEqual({
      kind: "factor",
      net: -7,
      sections: { management: -3, location: -4 },
      provenance: { source: "column" },
    });
  });

  it("does NOT cap (the composer's schedule_rating step clamps the net)", () => {
    const r = resolveIrpmSource(
      { from: "column", column: "c" },
      { externalInputs: { c: -40 } },
    );
    expect(r.kind === "factor" && r.net).toBe(-40); // raw — cap binds later
  });

  it("throws loudly on a missing or non-numeric column (never a silent 0)", () => {
    expect(() =>
      resolveIrpmSource({ from: "column", column: "missing" }, noInputs),
    ).toThrow(/did not resolve to a finite number/i);
    expect(() =>
      resolveIrpmSource({ from: "column", column: "c" }, { externalInputs: { c: "x" } }),
    ).toThrow(/string "x"/);
    expect(() =>
      resolveIrpmSource(
        { from: "column", columns: { a: "present", b: "absent" } },
        { externalInputs: { present: -3 } },
      ),
    ).toThrow(/column "absent"/);
  });

  it("throws when a connector source has no injected evaluator (62.6)", () => {
    expect(() =>
      resolveIrpmSource({ from: "connector", connector_id: "c", version: "v1" }, noInputs),
    ).toThrow(/62\.6/);
  });

  it("resolves a connector source via the injected ConnectorEvaluator (62.6) — capped later", () => {
    // A fixture evaluator standing in for a frozen snapshot replay (no network).
    const evaluateConnector = (
      ref: { connector_id: string; version: string },
      _features: Readonly<Record<string, unknown>>,
    ) => ({
      net: -8,
      sections: { a: -5, b: -3 },
      version: ref.version,
      snapshot_id: "es_abc123",
      cost_usd: 0.012,
    });
    const r = resolveIrpmSource(
      { from: "connector", connector_id: "loss_geo", version: "v3" },
      { externalInputs: { state: "KS" } },
      evaluateConnector,
    );
    expect(r).toEqual({
      kind: "factor",
      net: -8, // raw — the composer's schedule_rating step clamps to cap_pct
      sections: { a: -5, b: -3 },
      provenance: {
        source: "connector",
        connector: "loss_geo",
        version: "v3",
        snapshot_id: "es_abc123",
        cost_usd: 0.012,
      },
    });
  });

  it("carries a connector fallback_reason into provenance (degraded live call)", () => {
    const evaluateConnector = () => ({
      net: 0,
      version: "v3",
      fallback_reason: "timeout after 5s",
    });
    const r = resolveIrpmSource(
      { from: "connector", connector_id: "c", version: "v3" },
      noInputs,
      evaluateConnector,
    );
    expect(r.provenance).toEqual({
      source: "connector",
      connector: "c",
      version: "v3",
      fallback_reason: "timeout after 5s",
    });
  });
});

describe("makeIrpmAdjustmentResolver", () => {
  const resolver = makeIrpmAdjustmentResolver();
  const ctx = { externalInputs: { irpm_total_pct: -7 }, lines: [] };

  it("resolves a schedule_rating item's source", () => {
    const adj: PolicyAdjustment = {
      kind: "schedule_rating",
      id: "irpm",
      display_name: "IRPM",
      cap_pct: 25,
      source: { from: "column", column: "irpm_total_pct" },
    };
    expect(resolver(adj, ctx)).toEqual({ kind: "factor", net: -7, provenance: { source: "column" } });
  });

  it("throws for an adjustment that carries no source (package_factor / minimum_premium)", () => {
    const pkg: PolicyAdjustment = { kind: "package_factor", id: "p", display_name: "P", factor: 0.9 };
    expect(() => resolver(pkg, ctx)).toThrow(/has no source/i);
  });
});

// ── retired model arm ──────────────────────────────────────
//
// Regression coverage: a legacy `{from:"model"}`
// source — persisted before the cut, or hand-authored — is refused BY
// NAME with the canonical message, at both the resolver and the
// resolver-factory seams. Never a silent no-op, never identity.

describe("retired model source (S1)", () => {
  const legacyModelSource = {
    from: "model",
    model_id: "irpm-glm",
    version: "v1",
  } as const;

  it("resolveIrpmSource refuses a legacy model source with the canonical message", () => {
    expect(() =>
      resolveIrpmSource(
        legacyModelSource as unknown as Parameters<typeof resolveIrpmSource>[0],
        { externalInputs: { revenue_band: 5 } },
      ),
    ).toThrow(MODEL_SOURCE_RETIRED_MESSAGE);
  });

  it("makeIrpmAdjustmentResolver surfaces the same refusal for a model-sourced schedule_rating", () => {
    const resolver = makeIrpmAdjustmentResolver();
    const adj = {
      kind: "schedule_rating",
      id: "irpm",
      display_name: "IRPM",
      cap_pct: 25,
      source: legacyModelSource,
    } as unknown as PolicyAdjustment;
    expect(() => resolver(adj, { externalInputs: {}, lines: [] })).toThrow(
      MODEL_SOURCE_RETIRED_MESSAGE,
    );
  });

  it("the message tells the author the supported path (typed input + column source)", () => {
    expect(MODEL_SOURCE_RETIRED_MESSAGE).toMatch(/typed input/i);
    expect(MODEL_SOURCE_RETIRED_MESSAGE).toMatch(/column/i);
  });
});
