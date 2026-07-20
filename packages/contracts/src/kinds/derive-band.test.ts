/**
 * Unit tests for `derive.band` (PR D3.2 — Phase D auto-binning).
 *
 * Locks the runtime contract from ADR-0026:
 *   - half-open `[lo, hi)` semantics (delegates to resolveBandedLevel)
 *   - out-of-range / NaN / Infinity fall back to outOfRangeLevelId
 *     (or empty string if unset)
 *   - explainStep renders the auditor-friendly line
 *   - validate flags invalid banded-level lists (gaps, overlaps, etc.)
 *
 * Cold-test L22 — additionally locks:
 *   - every result reports an `out_of_range` boolean
 *   - `clampToNearest` clamps finite tail values onto the nearest band
 *     (below-bottom → first, at/above-top → last) instead of returning
 *     the silent-1.0 fallback
 */

import { describe, it, expect } from "vitest";
import { DeriveBandKind } from "./derive-band";
import type { BandedLevel } from "../dimension-types";

const REVENUE_BANDS: readonly BandedLevel[] = [
  { kind: "banded", id: "01_under_25k",  label: "<$25K",        lo: Number.NEGATIVE_INFINITY, hi: 25000 },
  { kind: "banded", id: "02_25k_50k",    label: "$25K–$50K",    lo: 25000,    hi: 50000 },
  { kind: "banded", id: "03_50k_100k",   label: "$50K–$100K",   lo: 50000,    hi: 100000 },
  { kind: "banded", id: "04_100k_250k",  label: "$100K–$250K",  lo: 100000,   hi: 250000 },
  { kind: "banded", id: "05_over_250k",  label: ">$250K",       lo: 250000,   hi: Number.POSITIVE_INFINITY },
];

describe("derive.band — execute", () => {
  it("bins a typical value into the matching half-open band", () => {
    const out = DeriveBandKind.execute(
      { value: 45000 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("02_25k_50k");
  });

  it("coerces a numeric STRING (CSV values arrive as strings)", () => {
    // externalInputs are `unknown`; a CSV cell "45000" must bin the
    // same as the number 45000. Before this the kind did
    // Number.isFinite("45000") === false → out-of-range → factor 1.0.
    const out = DeriveBandKind.execute(
      { value: "45000" as unknown as number },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("02_25k_50k");
  });

  it("passes through a value that is ALREADY a level id (idempotent)", () => {
    // Tolerates a pre-binned column / redundant upstream bin so it
    // doesn't double-bin to "" (the cold-test banded-factor bug).
    const out = DeriveBandKind.execute(
      { value: "03_50k_100k" as unknown as number },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("03_50k_100k");
  });

  it("returns fallback for a non-numeric, non-level string", () => {
    const out = DeriveBandKind.execute(
      { value: "garbage" as unknown as number },
      {
        dimSlug: "revenue_band",
        levels: REVENUE_BANDS,
        outOfRangeLevelId: "99_unknown",
      },
    );
    expect(out.level_id).toBe("99_unknown");
  });

  it("uses [lo, hi) half-open semantics — boundary value lands in next band", () => {
    // 50000 is the boundary between band #2 and band #3. Half-open
    // means it lands in #3 (50000 ≤ 50000 < 100000), NOT in #2.
    const out = DeriveBandKind.execute(
      { value: 50000 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("03_50k_100k");
  });

  it("handles +Infinity upper bound for the top band", () => {
    const out = DeriveBandKind.execute(
      { value: 999_999_999 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("05_over_250k");
  });

  it("handles -Infinity lower bound for the bottom band", () => {
    const out = DeriveBandKind.execute(
      { value: -1000 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("01_under_25k");
  });

  it("falls back to outOfRangeLevelId for NaN", () => {
    const out = DeriveBandKind.execute(
      { value: Number.NaN },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS, outOfRangeLevelId: "99_unknown" },
    );
    expect(out.level_id).toBe("99_unknown");
  });

  it("returns empty string for NaN when no outOfRangeLevelId set", () => {
    const out = DeriveBandKind.execute(
      { value: Number.NaN },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.level_id).toBe("");
  });

  it("returns empty string when value falls in a gap (no covering band)", () => {
    // A discontinuous band set: [0, 100) and [200, 300). Values in
    // [100, 200) have no band.
    const gappy: readonly BandedLevel[] = [
      { kind: "banded", id: "a", label: "0-100", lo: 0, hi: 100 },
      { kind: "banded", id: "b", label: "200-300", lo: 200, hi: 300 },
    ];
    const out = DeriveBandKind.execute(
      { value: 150 },
      { dimSlug: "x", levels: gappy },
    );
    expect(out.level_id).toBe("");
  });

  it("reports out_of_range=false for an in-range value", () => {
    const out = DeriveBandKind.execute(
      { value: 45000 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.out_of_range).toBe(false);
  });

  it("reports out_of_range=true for a NaN / unmatched value", () => {
    const out = DeriveBandKind.execute(
      { value: Number.NaN },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    expect(out.out_of_range).toBe(true);
  });
});

describe("derive.band — clampToNearest (cold-test L22)", () => {
  // A FINITE-tailed band set — the cold-test shape that triggered the
  // silent-1.0 bug. The top band stops at 5,000,000 (no +Infinity), so
  // a $6M revenue row falls out of every band → factor 1.0 unless we
  // clamp. Mirrors the CGL revenue dim (top band 1.75/2.1).
  const FINITE_BANDS: readonly BandedLevel[] = [
    { kind: "banded", id: "01_under_1m", label: "<$1M",      lo: 0,       hi: 1_000_000 },
    { kind: "banded", id: "02_1m_5m",    label: "$1M–$5M",   lo: 1_000_000, hi: 5_000_000 },
  ];

  it("clamps a value above the top band onto the LAST band", () => {
    const out = DeriveBandKind.execute(
      { value: 6_000_000 },
      { dimSlug: "revenue", levels: FINITE_BANDS, clampToNearest: true },
    );
    expect(out.level_id).toBe("02_1m_5m");
    expect(out.out_of_range).toBe(true);
  });

  it("clamps a value below the bottom band onto the FIRST band", () => {
    const out = DeriveBandKind.execute(
      { value: -500 },
      { dimSlug: "revenue", levels: FINITE_BANDS, clampToNearest: true },
    );
    expect(out.level_id).toBe("01_under_1m");
    expect(out.out_of_range).toBe(true);
  });

  it("does NOT clamp when clampToNearest is off (silent-1.0 legacy path)", () => {
    const out = DeriveBandKind.execute(
      { value: 6_000_000 },
      { dimSlug: "revenue", levels: FINITE_BANDS },
    );
    expect(out.level_id).toBe("");
    expect(out.out_of_range).toBe(true);
  });

  it("does NOT clamp NaN (no nearest band) — falls back instead", () => {
    const out = DeriveBandKind.execute(
      { value: Number.NaN },
      {
        dimSlug: "revenue",
        levels: FINITE_BANDS,
        clampToNearest: true,
        outOfRangeLevelId: "99_unknown",
      },
    );
    expect(out.level_id).toBe("99_unknown");
    expect(out.out_of_range).toBe(true);
  });

  it("does NOT clamp a value in a gap between non-contiguous bands", () => {
    // [0,100) and [200,300); value 150 is between bands, not past a
    // tail — clamp-to-nearest is ambiguous, so we fall back.
    const gappy: readonly BandedLevel[] = [
      { kind: "banded", id: "a", label: "0-100", lo: 0, hi: 100 },
      { kind: "banded", id: "b", label: "200-300", lo: 200, hi: 300 },
    ];
    const out = DeriveBandKind.execute(
      { value: 150 },
      { dimSlug: "x", levels: gappy, clampToNearest: true },
    );
    expect(out.level_id).toBe("");
    expect(out.out_of_range).toBe(true);
  });

  it("leaves in-range values untouched even with clampToNearest on", () => {
    const out = DeriveBandKind.execute(
      { value: 2_000_000 },
      { dimSlug: "revenue", levels: FINITE_BANDS, clampToNearest: true },
    );
    expect(out.level_id).toBe("02_1m_5m");
    expect(out.out_of_range).toBe(false);
  });
});

describe("derive.band — explainStep", () => {
  it("renders dim slug + value + level id + label", () => {
    const out = DeriveBandKind.execute(
      { value: 45000 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    const explain = DeriveBandKind.explainStep!(
      { value: 45000 },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
      out,
    );
    expect(explain).toBe("revenue_band = 45000 → 02_25k_50k ($25K–$50K)");
  });

  it("renders 'value =' fallback when dimSlug is empty", () => {
    const out = DeriveBandKind.execute(
      { value: 45000 },
      { dimSlug: "", levels: REVENUE_BANDS },
    );
    const explain = DeriveBandKind.explainStep!(
      { value: 45000 },
      { dimSlug: "", levels: REVENUE_BANDS },
      out,
    );
    expect(explain).toBe("value = 45000 → 02_25k_50k ($25K–$50K)");
  });

  it("renders 'out of range' when no band matches", () => {
    const out = DeriveBandKind.execute(
      { value: Number.NaN },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
    );
    const explain = DeriveBandKind.explainStep!(
      { value: Number.NaN },
      { dimSlug: "revenue_band", levels: REVENUE_BANDS },
      out,
    );
    expect(explain).toBe("revenue_band = NaN → out of range");
  });

  it("flags a clamped band as '(clamped — out of range)' (L22)", () => {
    const FINITE_BANDS: readonly BandedLevel[] = [
      { kind: "banded", id: "02_1m_5m", label: "$1M–$5M", lo: 1_000_000, hi: 5_000_000 },
    ];
    const out = DeriveBandKind.execute(
      { value: 6_000_000 },
      { dimSlug: "revenue", levels: FINITE_BANDS, clampToNearest: true },
    );
    const explain = DeriveBandKind.explainStep!(
      { value: 6_000_000 },
      { dimSlug: "revenue", levels: FINITE_BANDS, clampToNearest: true },
      out,
    );
    expect(explain).toBe(
      "revenue = 6000000 → 02_1m_5m ($1M–$5M) (clamped — out of range)",
    );
  });
});

describe("derive.band — validate", () => {
  it("accepts a valid non-overlapping band set", () => {
    const result = DeriveBandKind.validate!({
      dimSlug: "revenue_band",
      levels: REVENUE_BANDS,
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects overlapping bands (validateBandedLevels surfaces the gap)", () => {
    const overlapping: readonly BandedLevel[] = [
      { kind: "banded", id: "a", label: "0-100", lo: 0, hi: 100 },
      { kind: "banded", id: "b", label: "50-150", lo: 50, hi: 150 },
    ];
    const result = DeriveBandKind.validate!({
      dimSlug: "x",
      levels: overlapping,
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.severity).toBe("error");
  });

  it("warns on empty levels (mid-author state)", () => {
    const result = DeriveBandKind.validate!({
      dimSlug: "revenue_band",
      levels: [],
    });
    expect(result.valid).toBe(true);
    expect(result.issues[0]?.severity).toBe("warning");
  });
});

// Platform-test finding E5 — levels persisted through levels_json
// carry `null` for open ends (JSON has no Infinity). The resolver
// must treat null as ±∞ instead of "outside every band".
describe("derive.band — null bounds = JSON-safe open ends (E5)", () => {
  const NULL_END_BANDS: readonly BandedLevel[] = [
    { kind: "banded", id: "01_low", label: "<$25K", lo: null, hi: 25000 },
    { kind: "banded", id: "02_mid", label: "$25K–$250K", lo: 25000, hi: 250000 },
    { kind: "banded", id: "03_top", label: ">$250K", lo: 250000, hi: null },
  ];

  it("a value past the last bounded edge resolves the null-hi band IN RANGE", () => {
    const out = DeriveBandKind.execute(
      { value: 1_000_000 },
      { dimSlug: "limit_band", levels: NULL_END_BANDS, clampToNearest: true },
    );
    // A natural [lo, ∞) hit — not a clamp, not out of range.
    expect(out).toEqual({ level_id: "03_top", out_of_range: false });
  });

  it("a value below the first edge resolves the null-lo band", () => {
    const out = DeriveBandKind.execute(
      { value: -5 },
      { dimSlug: "limit_band", levels: NULL_END_BANDS },
    );
    expect(out).toEqual({ level_id: "01_low", out_of_range: false });
  });

  it("validate accepts null open ends at the tails only", () => {
    const ok = DeriveBandKind.validate!({
      dimSlug: "limit_band",
      levels: NULL_END_BANDS,
    });
    expect(ok.valid).toBe(true);
    expect(ok.issues).toHaveLength(0);

    const midNull: readonly BandedLevel[] = [
      { kind: "banded", id: "a", label: "a", lo: 0, hi: null },
      { kind: "banded", id: "b", label: "b", lo: 100, hi: 200 },
    ];
    const bad = DeriveBandKind.validate!({ dimSlug: "x", levels: midNull });
    expect(bad.valid).toBe(false);
  });
});
