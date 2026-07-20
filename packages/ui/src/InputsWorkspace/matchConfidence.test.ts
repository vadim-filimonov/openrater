import { describe, expect, it } from "vitest";

import { matchConfidence } from "./matchConfidence";

describe("matchConfidence", () => {
  it("scores an identical name as strong", () => {
    const r = matchConfidence("Faith Learning Center", "Faith Learning Center");
    expect(r.level).toBe("strong");
    expect(r.similarity).toBe(1);
  });

  it("scores a close variant as strong or partial (not weak)", () => {
    const r = matchConfidence(
      "Faith Learning Center",
      "Faith Learning Center of Brooklyn",
    );
    expect(["strong", "partial"]).toContain(r.level);
    expect(r.similarity).toBeGreaterThan(0.45);
  });

  it("scores a clearly different org as weak (likely wrong business)", () => {
    const r = matchConfidence(
      "Riverside Youth Foundation",
      "Joe's Auto Body & Towing",
    );
    expect(r.level).toBe("weak");
    expect(r.similarity).toBeLessThan(0.45);
  });

  it("treats an empty match (lookup found nothing) as weak", () => {
    const r = matchConfidence("Riverside Youth Foundation", "");
    expect(r.level).toBe("weak");
    expect(r.similarity).toBe(0);
  });

  it("is case/whitespace insensitive at the edges", () => {
    const r = matchConfidence("  ACME, Inc  ", "Acme, Inc");
    expect(r.level).toBe("strong");
  });

  // Brief 57 — matchConfidence reuses the shared `nameSimilarity` scorer.
  // Two orgs that share only a generic token ("Center") must NOT read as
  // a strong match just because of that one shared word (pre-Brief-57 the
  // single-pair prefix scored "Center"↔"Center" at 1.0 → "strong").
  it("does not over-score orgs that share only a generic token", () => {
    const r = matchConfidence(
      "Riverside Community Center",
      "Lakeside Medical Center",
    );
    expect(r.level).not.toBe("strong");
  });
});
