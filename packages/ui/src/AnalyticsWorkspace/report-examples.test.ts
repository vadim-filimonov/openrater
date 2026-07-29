/**
 * report-examples — Brief 93 §1.1.7 / R5 (93.3): the verified
 * filing-examples view model.
 */

import { describe, expect, it } from "vitest";
import {
  buildVerifiedExamples,
  type VectorResultLike,
} from "./report-examples";

function check(over: Partial<VectorResultLike> = {}): VectorResultLike {
  return {
    case_id: "case_1",
    name: "Restaurant · territory 1",
    field: "total_premium",
    expected: 4112,
    actual: 4112,
    delta: 0,
    status: "match",
    ...over,
  };
}

function report(args: {
  checks: readonly VectorResultLike[];
  matched: number;
  near?: number;
  mismatched?: number;
  status?: "ran" | "unavailable" | "none";
}) {
  return {
    vectors: {
      status: args.status ?? ("ran" as const),
      total_cases: args.checks.length,
      checks: args.checks,
      matched: args.matched,
      near: args.near ?? 0,
      mismatched: args.mismatched ?? 0,
    },
    created_at: "2026-07-15T18:00:00+00:00",
  };
}

describe("buildVerifiedExamples (Brief 93 §1.1.7)", () => {
  it("all-match: the exact-reproduction verdict, success tone, formatted rows", () => {
    const v = buildVerifiedExamples(
      report({
        checks: [check(), check({ case_id: "case_2", name: null })],
        matched: 2,
      }),
    );
    expect(v).not.toBeNull();
    // FCA #19 — the ONE shared vocabulary (vectorChecksSummary):
    // counts CHECKS, same sentence as Exhibits and the build report.
    expect(v!.verdict).toBe("2 of 2 checks reproduce the filing exactly");
    expect(v!.tone).toBe("success");
    expect(v!.rows[0]).toMatchObject({
      label: "Restaurant · territory 1",
      // FCA #35 (finding 125) — steady 2dp in the trust table.
      expected: "4,112.00",
      actual: "4,112.00",
      delta: "0.00",
      status: "match",
    });
    // A nameless case falls back to its id.
    expect(v!.rows[1]!.label).toBe("case_2");
    expect(v!.moreCount).toBe(0);
    expect(v!.builtAt).toContain("2026-07-15");
  });

  it("a mismatch headlines honestly with an error tone and a signed delta", () => {
    const v = buildVerifiedExamples(
      report({
        checks: [
          check(),
          check({
            case_id: "case_2",
            actual: 4200,
            delta: 88,
            status: "mismatch",
          }),
        ],
        matched: 1,
        mismatched: 1,
      }),
    );
    expect(v!.verdict).toBe(
      "1 of 2 checks reproduce the filing — 1 MISMATCHED",
    );
    expect(v!.tone).toBe("error");
    expect(v!.rows[1]!.delta).toBe("+88.00");
  });

  it("nears stay a success count but warn in tone; multi-field checks disambiguate labels", () => {
    const v = buildVerifiedExamples(
      report({
        checks: [
          check(),
          check({ field: "bpp_premium", delta: 0.4, status: "near" }),
        ],
        matched: 1,
        near: 1,
      }),
    );
    expect(v!.verdict).toBe(
      "2 of 2 checks reproduce the filing (1 within tolerance)",
    );
    expect(v!.tone).toBe("warn");
    // Two distinct fields → the field rides the label.
    expect(v!.rows[0]!.label).toContain("— total_premium");
    expect(v!.rows[1]!.label).toContain("— bpp_premium");
    expect(v!.rows[1]!.delta).toBe("+0.40");
  });

  it("caps rows and states the remainder; null on no report / no run / zero cases", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      check({ case_id: `case_${i}` }),
    );
    const v = buildVerifiedExamples(report({ checks: many, matched: 12 }));
    expect(v!.rows).toHaveLength(8);
    expect(v!.moreCount).toBe(4);

    expect(buildVerifiedExamples(null)).toBeNull();
    expect(
      buildVerifiedExamples(report({ checks: [], matched: 0, status: "none" })),
    ).toBeNull();
    expect(
      buildVerifiedExamples(
        report({ checks: [check()], matched: 0, status: "unavailable" }),
      ),
    ).toBeNull();
  });
});
