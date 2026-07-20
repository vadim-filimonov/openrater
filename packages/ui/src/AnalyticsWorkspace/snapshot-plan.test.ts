/**
 * snapshot-plan normalizers (ADR-0055 / v4 G15 live-verify find) — the
 * body's singleton substrates are serialized by the API as ENVELOPES,
 * while fixtures (and the module's original docstring) carry them bare.
 * A reader that assumes one shape silently gets nothing; these accept
 * both. `snapshotBodyToRuntimePlan` itself is covered end-to-end by the
 * Sample BOP cold-test guard.
 */

import { describe, it, expect } from "vitest";
import {
  snapshotBodyInputMapping,
  snapshotBodyPolicyTail,
} from "./snapshot-plan";

const MAPPING = {
  source: { kind: "csv", columns: ["a"] },
  column_map: { a: "a" },
  rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
  grouping_config: { policy_id_column: "policy_id" },
};
const TAIL = [{ kind: "minimum_premium", id: "min", floor: 500 }];

describe("snapshotBodyInputMapping", () => {
  it("unwraps the API envelope (the PRODUCTION body shape)", () => {
    const body = {
      input_mapping: {
        rating_plan_id: "p1",
        mapping: MAPPING,
        created_at: "t",
        updated_at: "t",
        content_hash: "abc",
      },
    };
    expect(snapshotBodyInputMapping(body)).toEqual(MAPPING);
  });

  it("passes a bare mapping through (fixture / legacy shape)", () => {
    expect(snapshotBodyInputMapping({ input_mapping: MAPPING })).toEqual(
      MAPPING,
    );
  });

  it("returns null when absent or null (plan never authored a mapping)", () => {
    expect(snapshotBodyInputMapping({})).toBeNull();
    expect(snapshotBodyInputMapping({ input_mapping: null })).toBeNull();
  });
});

describe("snapshotBodyPolicyTail", () => {
  it("unwraps the API envelope (the PRODUCTION body shape)", () => {
    const body = {
      policy_tail: {
        rating_plan_id: "p1",
        tail: TAIL,
        created_at: "t",
        updated_at: "t",
        content_hash: "abc",
      },
    };
    expect(snapshotBodyPolicyTail(body)).toEqual(TAIL);
  });

  it("passes a bare tail array through (fixture / legacy shape)", () => {
    expect(snapshotBodyPolicyTail({ policy_tail: TAIL })).toEqual(TAIL);
  });

  it("returns null when absent or null (plan never authored a tail)", () => {
    expect(snapshotBodyPolicyTail({})).toBeNull();
    expect(snapshotBodyPolicyTail({ policy_tail: null })).toBeNull();
  });

  it("returns null for a malformed envelope (tail not an array)", () => {
    expect(
      snapshotBodyPolicyTail({ policy_tail: { tail: "corrupt" } }),
    ).toBeNull();
  });
});
