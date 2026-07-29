/**
 * applyAutoMatchToMapping — Brief 38 PR 38.3 tests (additional
 * coverage; the high-level integration tests are in
 * ColumnMappingTable.test.tsx).
 *
 * Focus: edge cases in the conflict-resolution + mode flag paths.
 */

import { describe, it, expect } from "vitest";
import {
  applyAutoMatchToMapping,
  deriveMappingStatus,
} from "./applyAutoMatch";
import type { MatchCandidate, RequiredInput } from "./autoMatch";

const input = (id: string, name = id): RequiredInput => ({ id, name });

const cand = (
  columnName: string,
  confidence: number,
): MatchCandidate => ({
  columnName,
  confidence,
  nameScore: confidence,
  bucket: confidence >= 0.8 ? "auto" : confidence >= 0.4 ? "suggested" : "empty",
});

describe("applyAutoMatchToMapping — empty / degenerate", () => {
  it("returns empty mapping when no inputs", () => {
    const r = applyAutoMatchToMapping([], {}, {});
    expect(r.mapping).toEqual({});
    expect(r.conflicts).toEqual([]);
  });

  it("returns empty mapping when no candidates for any input", () => {
    const r = applyAutoMatchToMapping([input("a"), input("b")], {}, {});
    expect(r.mapping).toEqual({});
    expect(r.conflicts).toEqual([]);
  });

  it("preserves an existing mapping exactly when no candidates exist", () => {
    const r = applyAutoMatchToMapping(
      [input("a"), input("b")],
      {},
      { a: "COL_A", b: "COL_B" },
    );
    expect(r.mapping).toEqual({ a: "COL_A", b: "COL_B" });
  });
});

describe("applyAutoMatchToMapping — conflict resolution", () => {
  it("first input in iteration order wins the conflict", () => {
    const r = applyAutoMatchToMapping(
      [input("a"), input("b")],
      {
        a: [cand("X", 0.95)],
        b: [cand("X", 0.92)],
      },
      {},
    );
    expect(r.mapping).toEqual({ a: "X" });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.columnName).toBe("X");
    expect(r.conflicts[0]?.winnerInputId).toBe("a");
    expect(r.conflicts[0]?.loserInputIds).toEqual(["b"]);
  });

  it("loser falls back to next-best candidate when one is auto-bucket", () => {
    const r = applyAutoMatchToMapping(
      [input("a"), input("b")],
      {
        a: [cand("X", 0.95)],
        b: [cand("X", 0.92), cand("Y", 0.85)],
      },
      {},
    );
    expect(r.mapping).toEqual({ a: "X", b: "Y" });
  });

  it("loser stays unmapped when fallback is below auto threshold", () => {
    const r = applyAutoMatchToMapping(
      [input("a"), input("b")],
      {
        a: [cand("X", 0.95)],
        b: [cand("X", 0.92), cand("Y", 0.6)], // suggested only
      },
      {},
    );
    expect(r.mapping).toEqual({ a: "X" });
    expect(r.mapping.b).toBeUndefined();
  });

  it("three-way conflict records all losers", () => {
    const r = applyAutoMatchToMapping(
      [input("a"), input("b"), input("c")],
      {
        a: [cand("X", 0.95)],
        b: [cand("X", 0.93)],
        c: [cand("X", 0.91)],
      },
      {},
    );
    expect(r.mapping.a).toBe("X");
    expect(r.conflicts).toHaveLength(1);
    expect([...(r.conflicts[0]?.loserInputIds ?? [])].sort()).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("applyAutoMatchToMapping — existing-mapping respect", () => {
  it("never overwrites an existing mapping even if auto candidate differs", () => {
    const r = applyAutoMatchToMapping(
      [input("a")],
      { a: [cand("X", 0.95)] },
      { a: "MANUAL_OVERRIDE" },
    );
    expect(r.mapping.a).toBe("MANUAL_OVERRIDE");
  });

  it("seeds claimedBy with existing mappings (later auto-applies can't trample)", () => {
    // input b's auto candidate is X, but X is already claimed by a's
    // existing mapping. b should NOT auto-apply X.
    const r = applyAutoMatchToMapping(
      [input("a"), input("b")],
      { b: [cand("X", 0.95)] },
      { a: "X" },
    );
    expect(r.mapping.a).toBe("X");
    expect(r.mapping.b).toBeUndefined();
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.winnerInputId).toBe("a");
  });
});

describe("applyAutoMatchToMapping — mode flag", () => {
  it("auto mode (default) skips suggested-bucket top candidates", () => {
    const r = applyAutoMatchToMapping(
      [input("a")],
      { a: [cand("X", 0.55)] }, // suggested
      {},
    );
    expect(r.mapping.a).toBeUndefined();
  });

  it("auto+suggested mode applies suggested-bucket top candidates", () => {
    const r = applyAutoMatchToMapping(
      [input("a")],
      { a: [cand("X", 0.55)] },
      {},
      { mode: "auto+suggested" },
    );
    expect(r.mapping.a).toBe("X");
  });
});

describe("applyAutoMatchToMapping — exact-identity priority (Brief 55 item 5)", () => {
  // Repro of the Sample BOP walkthrough bug: the `class_code` column
  // name-collides at confidence 1.0 with every input that merely shares a
  // token ("bceg_grade" via "code"), because tokenPrefixSimilarity returns
  // 1.0 on a single shared token and value-match is skipped for level-less
  // dims. Greedy first-wins gave the column to whoever iterated first.
  it("the input the column NAMES wins it, even when a token-collision input iterates first", () => {
    const r = applyAutoMatchToMapping(
      [input("bceg_grade"), input("class_code")], // bceg_grade iterates FIRST
      {
        bceg_grade: [cand("class_code", 1.0)], // spurious 1.0 (shared "code")
        class_code: [cand("class_code", 1.0)], // the definitional match
      },
      {},
    );
    expect(r.mapping.class_code).toBe("class_code"); // not starved
    expect(r.mapping.bceg_grade).toBeUndefined(); // loses the contested column
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.winnerInputId).toBe("class_code");
    expect(r.conflicts[0]?.loserInputIds).toEqual(["bceg_grade"]);
  });

  it("each input still claims its OWN exact column when both are present", () => {
    const r = applyAutoMatchToMapping(
      [input("bceg_grade"), input("class_code")],
      {
        bceg_grade: [cand("class_code", 1.0), cand("bceg_grade", 1.0)],
        class_code: [cand("class_code", 1.0)],
      },
      {},
    );
    expect(r.mapping).toEqual({
      bceg_grade: "bceg_grade",
      class_code: "class_code",
    });
    expect(r.conflicts).toEqual([]);
  });

  it("matches on display name / matching name, not only id", () => {
    // id is namespaced but the matching name equals the column exactly.
    const ns: RequiredInput = { id: "submission.class_code", name: "class_code" };
    const other: RequiredInput = { id: "bceg_grade", name: "bceg_grade" };
    const r = applyAutoMatchToMapping(
      [other, ns],
      {
        bceg_grade: [cand("class_code", 1.0)],
        "submission.class_code": [cand("class_code", 1.0)],
      },
      {},
    );
    expect(r.mapping["submission.class_code"]).toBe("class_code");
    expect(r.mapping.bceg_grade).toBeUndefined();
  });

  it("respects apply mode — an exact match below the auto bar is not force-applied in auto mode", () => {
    const r = applyAutoMatchToMapping(
      [input("class_code")],
      { class_code: [cand("class_code", 0.6)] }, // suggested bucket
      {},
    );
    expect(r.mapping.class_code).toBeUndefined(); // auto mode: not applied
    const r2 = applyAutoMatchToMapping(
      [input("class_code")],
      { class_code: [cand("class_code", 0.6)] },
      {},
      { mode: "auto+suggested" },
    );
    expect(r2.mapping.class_code).toBe("class_code"); // suggested accepted
  });

  it("does not override an existing manual mapping via the exact pass", () => {
    const r = applyAutoMatchToMapping(
      [input("class_code")],
      { class_code: [cand("class_code", 1.0)] },
      { class_code: "SomeOtherColumn" },
    );
    expect(r.mapping.class_code).toBe("SomeOtherColumn");
  });
});

describe("deriveMappingStatus — invariants", () => {
  it("is monotonic in the value's presence", () => {
    const c = cand("X", 0.95);
    const empty = deriveMappingStatus(undefined, [c], false);
    const mapped = deriveMappingStatus("X", [c], false);
    expect(empty).toBe("empty");
    expect(mapped).toBe("auto");
  });

  it("treats absent + empty-string identically", () => {
    expect(deriveMappingStatus(undefined, [], false)).toBe("empty");
    expect(deriveMappingStatus("", [], false)).toBe("empty");
  });
});
