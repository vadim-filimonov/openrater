/**
 * Unit tests for `derive.territory` (ADR-0028 — cold-test L13).
 *
 * Locks the runtime contract:
 *   - a raw state code resolves to its grouped territory id
 *   - case-insensitive + trimmed value matching ("ca" / " CA ")
 *   - an already-resolved territory id passes through (idempotent)
 *   - a value in no territory falls back to unmappedTerritoryId
 *     (or empty string if unset) AND reports unmapped=true
 *   - every result reports an `unmapped` boolean (the L22 surfacing
 *     principle — no silent 1.0)
 *   - explainStep renders the auditor-friendly line (with label)
 *   - validate warns on an empty territory map (mid-author state)
 */

import { describe, it, expect } from "vitest";
import { DeriveTerritoryKind } from "./derive-territory";

// Mirrors the CGL cold-test shape: 50+DC grouped into 5 tiers. We only
// need a handful of members per tier to exercise the contract.
const STATE_TIER_MAP: Readonly<Record<string, string>> = {
  CA: "T1", FL: "T1", NY: "T1", // high-cost coastal
  TX: "T2", IL: "T2",
  OH: "T3", PA: "T3",
  WI: "T4", MN: "T4",
  WY: "T5", MT: "T5", // low-cost rural
};

const TIER_LABELS: Readonly<Record<string, string>> = {
  T1: "Tier 1 — high-cost coastal",
  T5: "Tier 5 — low-cost rural",
};

describe("derive.territory — execute", () => {
  it("resolves a state code into its grouped territory id", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "CA" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(out.territory_id).toBe("T1");
    expect(out.unmapped).toBe(false);
  });

  it("resolves a different tier correctly", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "WI" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(out.territory_id).toBe("T4");
    expect(out.unmapped).toBe(false);
  });

  it("matches case-insensitively + trimmed (CSV values are messy)", () => {
    // externalInputs are `unknown`; a CSV cell "ca" or " CA " must
    // resolve the same as the canonical "CA".
    const lower = DeriveTerritoryKind.execute(
      { value: "ca" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(lower.territory_id).toBe("T1");
    const padded = DeriveTerritoryKind.execute(
      { value: "  CA  " },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(padded.territory_id).toBe("T1");
  });

  it("passes through a value that is ALREADY a territory id (idempotent)", () => {
    // Tolerates a pre-resolved column / redundant upstream resolve so
    // it doesn't double-map to "" — the analogue of derive.band's
    // already-banded pass-through.
    const out = DeriveTerritoryKind.execute(
      { value: "T1" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(out.territory_id).toBe("T1");
    expect(out.unmapped).toBe(false);
  });

  it("falls back to unmappedTerritoryId for a state in no tier", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "PR" }, // Puerto Rico — not in the 50+DC tier map
      {
        dimSlug: "state",
        territoryMap: STATE_TIER_MAP,
        unmappedTerritoryId: "T_other",
      },
    );
    expect(out.territory_id).toBe("T_other");
    expect(out.unmapped).toBe(true);
  });

  it("returns empty string for an unmapped value when no fallback set", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "PR" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(out.territory_id).toBe("");
    expect(out.unmapped).toBe(true);
  });

  it("reports unmapped=true for an empty / missing value", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(out.territory_id).toBe("");
    expect(out.unmapped).toBe(true);
  });

  it("coerces a non-string value (defends unknown externalInputs)", () => {
    const out = DeriveTerritoryKind.execute(
      { value: 90210 as unknown as string }, // a numeric ZIP-like value
      {
        dimSlug: "zip",
        territoryMap: { "90210": "T1" },
      },
    );
    expect(out.territory_id).toBe("T1");
    expect(out.unmapped).toBe(false);
  });

  it("reports unmapped=true on every unresolved row (no silent fix)", () => {
    // The L13/L22 anti-pattern: a value in no territory must be visible,
    // not silently priced at the lookup's 1.0 default. `unmapped` is the
    // diagnostic the score-time surface counts on.
    const out = DeriveTerritoryKind.execute(
      { value: "ZZ" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    expect(out.unmapped).toBe(true);
  });
});

describe("derive.territory — explainStep", () => {
  it("renders dim slug + value + territory id + label", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "CA" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP, territoryLabels: TIER_LABELS },
    );
    const explain = DeriveTerritoryKind.explainStep!(
      { value: "CA" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP, territoryLabels: TIER_LABELS },
      out,
    );
    expect(explain).toBe("state = CA → T1 (Tier 1 — high-cost coastal)");
  });

  it("renders without a label when none is supplied", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "TX" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    const explain = DeriveTerritoryKind.explainStep!(
      { value: "TX" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
      out,
    );
    expect(explain).toBe("state = TX → T2");
  });

  it("renders 'value =' fallback when dimSlug is empty", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "CA" },
      { dimSlug: "", territoryMap: STATE_TIER_MAP },
    );
    const explain = DeriveTerritoryKind.explainStep!(
      { value: "CA" },
      { dimSlug: "", territoryMap: STATE_TIER_MAP },
      out,
    );
    expect(explain).toBe("value = CA → T1");
  });

  it("renders 'unmapped' when no territory matches", () => {
    const out = DeriveTerritoryKind.execute(
      { value: "ZZ" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
    );
    const explain = DeriveTerritoryKind.explainStep!(
      { value: "ZZ" },
      { dimSlug: "state", territoryMap: STATE_TIER_MAP },
      out,
    );
    expect(explain).toBe("state = ZZ → unmapped");
  });
});

describe("derive.territory — validate", () => {
  it("accepts a non-empty territory map", () => {
    const result = DeriveTerritoryKind.validate!({
      dimSlug: "state",
      territoryMap: STATE_TIER_MAP,
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("warns on an empty territory map (mid-author state)", () => {
    const result = DeriveTerritoryKind.validate!({
      dimSlug: "state",
      territoryMap: {},
    });
    expect(result.valid).toBe(true);
    expect(result.issues[0]?.severity).toBe("warning");
  });
});
