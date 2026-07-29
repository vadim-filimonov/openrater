/**
 * FCA fca-2026-07-25 #11 — the Overview must not show pure green over
 * a build whose verification mismatched the filing. These pin the two
 * pure derivations the plan route wires into the checklist + pill.
 */

import { describe, expect, it } from "vitest";

import {
  verificationChecklistItem,
  verificationHealthOverride,
} from "./verificationStatus";

const RAN = (over: Partial<{ matched: number; near: number; mismatched: number; total: number }>) => ({
  status: "ran",
  matched: over.matched ?? 12,
  near: over.near ?? 0,
  mismatched: over.mismatched ?? 0,
  checks: Array.from({ length: over.total ?? 12 }, (_, i) => ({ i })),
});

describe("verificationChecklistItem", () => {
  it("a MISMATCHED build renders an UNDONE row naming the counts (the audited shape)", () => {
    // The S4 build: 9 of 12 matched, 3 mismatched — the Overview used
    // to show '5 of 5 complete' anyway.
    const onOpen = () => {};
    const item = verificationChecklistItem(
      RAN({ matched: 9, mismatched: 3 }),
      onOpen,
    );
    expect(item).not.toBeNull();
    expect(item!.done).toBe(false);
    expect(item!.detail).toBe("9 of 12 match · 3 mismatched");
    expect(item!.actionLabel).toMatch(/build report/i);
    expect(item!.onOpen).toBe(onOpen);
  });

  it("a clean build renders a DONE row with the full count", () => {
    const item = verificationChecklistItem(RAN({ matched: 12 }), () => {});
    expect(item!.done).toBe(true);
    expect(item!.detail).toBe("12 of 12 checks match");
  });

  it("near-but-not-mismatched stays done, disclosed", () => {
    const item = verificationChecklistItem(
      RAN({ matched: 10, near: 2 }),
      () => {},
    );
    expect(item!.done).toBe(true);
    expect(item!.detail).toBe("10 of 12 checks match · 2 near");
  });

  it("no report / vectors that never ran → no row (hand-authored plans unchanged)", () => {
    expect(verificationChecklistItem(null, () => {})).toBeNull();
    expect(
      verificationChecklistItem(
        { status: "unavailable", matched: 0, near: 0, mismatched: 0, checks: [] },
        () => {},
      ),
    ).toBeNull();
    expect(
      verificationChecklistItem(
        { status: "ran", matched: 0, near: 0, mismatched: 0, checks: [] },
        () => {},
      ),
    ).toBeNull();
  });
});

describe("verificationHealthOverride", () => {
  it("mismatches qualify the pill — never an unqualified 'Ready to rate'", () => {
    expect(verificationHealthOverride(RAN({ matched: 9, mismatched: 3 }))).toBe(
      "Rates — 3 checks mismatched",
    );
    expect(verificationHealthOverride(RAN({ matched: 11, mismatched: 1 }))).toBe(
      "Rates — 1 check mismatched",
    );
  });

  it("clean or near builds leave the pill alone", () => {
    expect(verificationHealthOverride(RAN({ matched: 12 }))).toBeNull();
    expect(verificationHealthOverride(RAN({ matched: 10, near: 2 }))).toBeNull();
    expect(verificationHealthOverride(null)).toBeNull();
  });
});
