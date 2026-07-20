/**
 * Brief 80 (platform-test finding E7) — the plan-total resolver + the
 * three named composition issues. Each issue is tested both firing and
 * resolving, because the whole point is that a broken composition
 * chain SAYS why composed premiums would come back null.
 */

import { describe, expect, it } from "vitest";
import {
  collectCompositionIssues,
  planTotalOutputField,
} from "./policyBookConfig";
import type { StageLike } from "./deriveRequiredInputs";

// ──────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────

function roundStage(outputField?: string): StageLike {
  return {
    stage_id: "round_minimum_premium",
    stage_kind: "round",
    config_json: {
      input_path: "chain.total_premium",
      increment_input: "literal:1",
      min_value_input: "literal:500",
      ...(outputField !== undefined ? { output_field: outputField } : {}),
    },
  };
}

const CHAIN_STAGE: StageLike = {
  stage_id: "multiplicative_chain_main",
  stage_kind: "multiplicative_chain",
  config_json: { chains: [] },
};

const GROUPED_MAPPING = {
  grouping_config: {
    policy_id_column: "policy_id",
    location_id_column: "location_id",
  },
  rollup_fields: [{ fieldName: "total_premium", reducer: "sum" as const }],
};

// ──────────────────────────────────────────────────────────────────
// planTotalOutputField
// ──────────────────────────────────────────────────────────────────

describe("planTotalOutputField (Brief 80 D-C)", () => {
  it("returns the round stage's authored output_field", () => {
    expect(planTotalOutputField([CHAIN_STAGE, roundStage("total_premium")])).toBe(
      "total_premium",
    );
    // A bespoke field is still THE answer — the plan emits what it
    // emits; the nonstandard ISSUE is a separate concern.
    expect(
      planTotalOutputField([CHAIN_STAGE, roundStage("final_premium_usd")]),
    ).toBe("final_premium_usd");
  });

  it("falls back to the total_premium convention when no round stage (or a blank field) exists", () => {
    expect(planTotalOutputField([CHAIN_STAGE])).toBe("total_premium");
    expect(planTotalOutputField([CHAIN_STAGE, roundStage("")])).toBe(
      "total_premium",
    );
    expect(planTotalOutputField([CHAIN_STAGE, roundStage()])).toBe(
      "total_premium",
    );
  });
});

// ──────────────────────────────────────────────────────────────────
// collectCompositionIssues
// ──────────────────────────────────────────────────────────────────

describe("collectCompositionIssues (Brief 80 D-E)", () => {
  it("a fully-wired composition raises NO issues", () => {
    const issues = collectCompositionIssues(
      [CHAIN_STAGE, roundStage("total_premium")],
      GROUPED_MAPPING,
      ["policy_id", "location_id", "tiv"],
    );
    expect(issues).toEqual([]);
  });

  it("round_output_nonstandard fires on a bespoke total field — grouping or not", () => {
    // The E7 third leg: the legacy drawer hardwired final_premium_usd.
    const issues = collectCompositionIssues(
      [CHAIN_STAGE, roundStage("final_premium_usd")],
      null,
    );
    expect(issues.map((i) => i.code)).toEqual(["round_output_nonstandard"]);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.stageId).toBe("round_minimum_premium");
    expect(issues[0]!.message).toContain("final_premium_usd");
    expect(issues[0]!.message).toContain("total_premium");
  });

  it("round_output_nonstandard resolves when the field is normalized", () => {
    expect(
      collectCompositionIssues(
        [CHAIN_STAGE, roundStage("total_premium")],
        null,
      ),
    ).toEqual([]);
  });

  it("grouping_missing_rollup fires when grouping is on but the plan total is not rolled", () => {
    const issues = collectCompositionIssues(
      [CHAIN_STAGE, roundStage("total_premium")],
      {
        grouping_config: { policy_id_column: "policy_id" },
        rollup_fields: [{ fieldName: "tiv", reducer: "sum" }],
      },
      ["policy_id", "tiv"],
    );
    expect(issues.map((i) => i.code)).toEqual(["grouping_missing_rollup"]);
    expect(issues[0]!.message).toContain("total_premium");
  });

  it("⭐ grouping_missing_rollup stands down for a total-less plan", () => {
    // 93.4 — the total-less transcription composes fine with NO premium
    // roll-up declared (that absence is what lets the composers sum the
    // dec page). Warning here would name the bug as the cure, and read
    // as a lie beside a policy list showing real summed premiums —
    // exactly what the live panel surfaced.
    const issues = collectCompositionIssues(
      [CHAIN_STAGE],
      {
        grouping_config: { policy_id_column: "policy_id" },
        rollup_fields: [{ fieldName: "tiv", reducer: "sum" }],
      },
      ["policy_id", "tiv"],
      { aggregateField: null, moneyFields: ["building_premium", "contents_premium"] },
    );
    expect(issues).toEqual([]);
  });

  it("grouping_missing_rollup still fires when a DECLARED basis overrides the sum", () => {
    // A premium-named declaration is an explicit basis, so the book is
    // no longer coverage-sum — the ordinary check applies again.
    const issues = collectCompositionIssues(
      [CHAIN_STAGE, roundStage("total_premium")],
      {
        grouping_config: { policy_id_column: "policy_id" },
        rollup_fields: [{ fieldName: "contents_premium", reducer: "sum" }],
      },
      ["policy_id"],
      { aggregateField: null, moneyFields: ["building_premium", "contents_premium"] },
    );
    expect(issues.map((i) => i.code)).toEqual(["grouping_missing_rollup"]);
  });

  it("grouping_missing_rollup keys on the plan's ACTUAL total field", () => {
    // A (nonstandard) round output means the required roll-up is that
    // field — both issues fire, each naming its own fact.
    const issues = collectCompositionIssues(
      [CHAIN_STAGE, roundStage("final_premium_usd")],
      {
        grouping_config: { policy_id_column: "policy_id" },
        rollup_fields: [{ fieldName: "total_premium", reducer: "sum" }],
      },
    );
    expect(issues.map((i) => i.code).sort()).toEqual([
      "grouping_missing_rollup",
      "round_output_nonstandard",
    ]);
    const rollupIssue = issues.find(
      (i) => i.code === "grouping_missing_rollup",
    )!;
    expect(rollupIssue.message).toContain("final_premium_usd");
  });

  it("grouping_column_missing fires per missing grouping column", () => {
    const issues = collectCompositionIssues(
      [CHAIN_STAGE, roundStage("total_premium")],
      GROUPED_MAPPING,
      ["tiv", "class_code"], // book carries neither key column
    );
    expect(issues.map((i) => i.code)).toEqual([
      "grouping_column_missing",
      "grouping_column_missing",
    ]);
    expect(issues[0]!.message).toContain("policy_id");
    expect(issues[1]!.message).toContain("location_id");
  });

  it("the column check is SKIPPED without a loaded book", () => {
    expect(
      collectCompositionIssues(
        [CHAIN_STAGE, roundStage("total_premium")],
        GROUPED_MAPPING,
        undefined,
      ),
    ).toEqual([]);
  });

  it("no grouping ⇒ only the round check runs", () => {
    expect(
      collectCompositionIssues(
        [CHAIN_STAGE, roundStage("total_premium")],
        { rollup_fields: [] },
        ["tiv"],
      ),
    ).toEqual([]);
  });
});
