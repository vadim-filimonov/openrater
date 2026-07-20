import { describe, it, expect } from "vitest";
import { RangeLookupKind } from "./lookup-range";
import type { RangeBucket } from "./lookup-range";

const TIV_BUCKETS: readonly RangeBucket[] = [
  { lo: 0, hi: 250_000, factor: 0.95 },
  { lo: 250_000, hi: 1_000_000, factor: 1.0 },
  { lo: 1_000_000, hi: Number.POSITIVE_INFINITY, factor: 1.1 },
];

describe("RangeLookupKind", () => {
  it("returns the first bucket whose [lo, hi) contains value", () => {
    expect(
      RangeLookupKind.execute(
        { value: 100_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
      ).value,
    ).toBe(0.95);
    expect(
      RangeLookupKind.execute(
        { value: 500_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
      ).value,
    ).toBe(1.0);
    expect(
      RangeLookupKind.execute(
        { value: 2_000_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
      ).value,
    ).toBe(1.1);
  });

  it("bucket boundary is inclusive on lo, half-open on hi", () => {
    // value === lo → in bucket
    expect(
      RangeLookupKind.execute(
        { value: 250_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
      ).value,
    ).toBe(1.0);
    // value === hi → NOT in bucket (falls to next)
    expect(
      RangeLookupKind.execute(
        { value: 1_000_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
      ).value,
    ).toBe(1.1);
  });

  it("returns defaultValue when no bucket matches", () => {
    expect(
      RangeLookupKind.execute(
        { value: -1 },
        { buckets: TIV_BUCKETS, defaultValue: 2.0 },
      ).value,
    ).toBe(2.0);
  });

  it("returns defaultValue when buckets is empty", () => {
    expect(
      RangeLookupKind.execute(
        { value: 100 },
        { buckets: [], defaultValue: 1.42 },
      ).value,
    ).toBe(1.42);
  });

  it("validate flags NaN defaultValue", () => {
    const r = RangeLookupKind.validate!({
      buckets: [],
      defaultValue: NaN,
    });
    expect(r.valid).toBe(false);
  });

  it("validate flags a bucket with lo > hi", () => {
    const r = RangeLookupKind.validate!({
      buckets: [{ lo: 5, hi: 1, factor: 1 }],
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/bucket 0: lo > hi/);
  });

  it("validate warns on empty buckets (but stays valid)", () => {
    const r = RangeLookupKind.validate!({
      buckets: [],
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });

  it("validate accepts well-formed buckets", () => {
    const r = RangeLookupKind.validate!({
      buckets: TIV_BUCKETS,
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("explainStep names the matched bucket range", () => {
    expect(
      RangeLookupKind.explainStep!(
        { value: 500_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
        { value: 1.0 },
      ),
    ).toBe("500000 in [250000, 1000000) → 1");
  });

  it("explainStep renders 1e308 as ∞ for the open-top bucket", () => {
    expect(
      RangeLookupKind.explainStep!(
        { value: 2_000_000 },
        { buckets: TIV_BUCKETS, defaultValue: 1.0 },
        { value: 1.1 },
      ),
    ).toContain("∞");
  });

  it("explainStep flags the no-bucket fallback", () => {
    expect(
      RangeLookupKind.explainStep!(
        { value: -1 },
        { buckets: TIV_BUCKETS, defaultValue: 2.0 },
        { value: 2.0 },
      ),
    ).toBe("-1 matched no bucket → 2 (default)");
  });

  // Platform-test finding E5 — JSON has no Infinity, so open-ended
  // bands persist their bound as null. The matcher must treat null as
  // the matching infinity instead of dropping/mismatching the bucket.
  describe("null bounds = JSON-safe open ends (finding E5)", () => {
    const NULL_TOP_BUCKETS: readonly RangeBucket[] = [
      { lo: 0, hi: 250_000, factor: 0.95 },
      { lo: 250_000, hi: 1_000_000, factor: 1.0 },
      { lo: 1_000_000, hi: null, factor: 1.1 },
    ];

    it("a value past the last bounded band matches the null-hi bucket", () => {
      // TV-14's shape: exactly $1,000,000 must hit the open band, not
      // clamp onto [250k, 1M).
      expect(
        RangeLookupKind.execute(
          { value: 1_000_000 },
          { buckets: NULL_TOP_BUCKETS, defaultValue: 1.0 },
        ).value,
      ).toBe(1.1);
      expect(
        RangeLookupKind.execute(
          { value: 123_456_789 },
          { buckets: NULL_TOP_BUCKETS, defaultValue: 1.0 },
        ).value,
      ).toBe(1.1);
    });

    it("a null-lo bucket is open below", () => {
      const buckets: readonly RangeBucket[] = [
        { lo: null, hi: 0, factor: 0.5 },
        { lo: 0, hi: null, factor: 2.0 },
      ];
      expect(
        RangeLookupKind.execute(
          { value: -1_000_000 },
          { buckets, defaultValue: 1.0 },
        ).value,
      ).toBe(0.5);
      expect(
        RangeLookupKind.execute({ value: 1 }, { buckets, defaultValue: 1.0 })
          .value,
      ).toBe(2.0);
    });

    it("collectRowIssues does NOT flag a null-bound match as a miss", () => {
      expect(
        RangeLookupKind.collectRowIssues!(
          { value: 5_000_000 },
          { buckets: NULL_TOP_BUCKETS, defaultValue: 1.0 },
          { value: 1.1 },
        ),
      ).toBeUndefined();
    });

    it("validate accepts null bounds", () => {
      const r = RangeLookupKind.validate!({
        buckets: NULL_TOP_BUCKETS,
        defaultValue: 1.0,
      });
      expect(r.valid).toBe(true);
      expect(r.issues).toHaveLength(0);
    });

    it("explainStep renders a null hi as ∞", () => {
      expect(
        RangeLookupKind.explainStep!(
          { value: 2_000_000 },
          { buckets: NULL_TOP_BUCKETS, defaultValue: 1.0 },
          { value: 1.1 },
        ),
      ).toBe("2000000 in [1000000, ∞) → 1.1");
    });
  });
});
