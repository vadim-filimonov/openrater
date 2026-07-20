// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
import { describe, expect, it } from "vitest";

import { isRunStale } from "./runStaleness";

describe("isRunStale (ADR-0064)", () => {
  it("flags a fingerprint mismatch even when the content hash agrees — the cells-only edit", () => {
    // THE blind spot: a factor-table cell edit changes every premium
    // but content_hash (stages + metadata, ADR-0015) stands still.
    expect(
      isRunStale(
        { plan_content_hash: "aaaa", scoring_fingerprint: "fp1" },
        { contentHash: "aaaa", scoringFingerprint: "fp2" },
      ),
    ).toBe(true);
  });

  it("trusts a fingerprint match even when the content hash moved — the rename-only edit", () => {
    expect(
      isRunStale(
        { plan_content_hash: "aaaa", scoring_fingerprint: "fp1" },
        { contentHash: "bbbb", scoringFingerprint: "fp1" },
      ),
    ).toBe(false);
  });

  it("falls back to the content-hash grammar for runs without a fingerprint", () => {
    const legacy = { plan_content_hash: "aaaa", scoring_fingerprint: null };
    expect(
      isRunStale(legacy, { contentHash: "aaaa", scoringFingerprint: "fp1" }),
    ).toBe(false);
    expect(
      isRunStale(legacy, { contentHash: "bbbb", scoringFingerprint: "fp1" }),
    ).toBe(true);
    // …and for summaries parsed from a backend that predates the column.
    expect(
      isRunStale(
        { plan_content_hash: "aaaa" },
        { contentHash: "bbbb", scoringFingerprint: "fp1" },
      ),
    ).toBe(true);
  });

  it("falls back to the content-hash grammar while the live fingerprint is still hydrating", () => {
    expect(
      isRunStale(
        { plan_content_hash: "aaaa", scoring_fingerprint: "fp1" },
        { contentHash: "aaaa", scoringFingerprint: null },
      ),
    ).toBe(false);
    expect(
      isRunStale(
        { plan_content_hash: "aaaa", scoring_fingerprint: "fp1" },
        { contentHash: "bbbb", scoringFingerprint: null },
      ),
    ).toBe(true);
  });

  it("never flags when neither grammar has both sides", () => {
    expect(
      isRunStale(
        { plan_content_hash: null, scoring_fingerprint: null },
        { contentHash: null, scoringFingerprint: null },
      ),
    ).toBe(false);
  });
});
