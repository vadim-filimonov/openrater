/**
 * `modifier.schedule` kind tests (M1.3, Brief 15).
 *
 * Coverage:
 *   - Pure execute: per-category application, cap clamping,
 *     out-of-range per-category clamping, tier filtering
 *   - explainStep readability
 *   - Validate (cap, category invariants)
 *   - Runtime integration via wired application input
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ModifierScheduleKind } from "./modifier-schedule";
import { ConstantKind } from "./constant";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, globalRegistry } from "../registry";
import type { Plan } from "../plan-types";
import type { Schedule, ScheduleApplication } from "../schedule-types";

const SCHEDULE: Schedule = {
  schedule_id: "property_schedule",
  display_name: "Property schedule mod",
  scope: "per_coverage",
  total_cap_pct: 25,
  categories: [
    {
      category_id: "mgmt_exp",
      name: "Management experience",
      range_pct: 5,
      reasoning_required: true,
    },
    {
      category_id: "premises_maint",
      name: "Premises maintenance",
      range_pct: 5,
      reasoning_required: true,
    },
    {
      category_id: "safety_devices",
      name: "Safety devices",
      range_pct: 10,
      reasoning_required: true,
    },
  ],
  citation: "Meridian Rule MS-R4.2",
  reasoning: "Meridian filed schedule rating.",
};

describe("ModifierScheduleKind — contract surface", () => {
  it("has correct id + category + outputs", () => {
    expect(ModifierScheduleKind.id).toBe("modifier.schedule");
    expect(ModifierScheduleKind.category).toBe("chain");
    expect(ModifierScheduleKind.outputs.map((p) => p.name)).toEqual([
      "factor",
      "applied_pct",
      "applied_categories",
      "cap_hit",
    ]);
  });

  it("default schedule has the right shape", () => {
    expect(ModifierScheduleKind.defaultParams.schedule.scope).toBe(
      "per_coverage",
    );
    expect(ModifierScheduleKind.defaultParams.schedule.total_cap_pct).toBe(25);
  });

  it("validate rejects an empty schedule_id", () => {
    const r = ModifierScheduleKind.validate?.({
      schedule: { ...SCHEDULE, schedule_id: "" },
    });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.field).toBe("schedule.schedule_id");
  });

  it("validate rejects negative total_cap_pct", () => {
    const r = ModifierScheduleKind.validate?.({
      schedule: { ...SCHEDULE, total_cap_pct: -5 },
    });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.field).toBe("schedule.total_cap_pct");
  });

  it("validate rejects duplicate category_id", () => {
    const r = ModifierScheduleKind.validate?.({
      schedule: {
        ...SCHEDULE,
        categories: [
          ...SCHEDULE.categories,
          { ...SCHEDULE.categories[0]! },
        ],
      },
    });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.message).toMatch(/Duplicate category_id/);
  });

  it("validate rejects negative range_pct", () => {
    const r = ModifierScheduleKind.validate?.({
      schedule: {
        ...SCHEDULE,
        categories: [
          { ...SCHEDULE.categories[0]!, range_pct: -5 },
          SCHEDULE.categories[1]!,
          SCHEDULE.categories[2]!,
        ],
      },
    });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.message).toMatch(/negative range_pct/);
  });
});

describe("ModifierScheduleKind — execute semantics", () => {
  it("returns factor 1 when no application supplied (all default zero)", () => {
    const result = ModifierScheduleKind.execute(
      {
        application: { schedule_id: "property_schedule", values: {} },
      },
      { schedule: SCHEDULE },
    );
    expect(result.factor).toBe(1);
    expect(result.applied_pct).toBe(0);
    expect(result.cap_hit).toBe(false);
    // All categories listed; all defaulted to zero
    expect(result.applied_categories).toHaveLength(3);
    expect(result.applied_categories.every((c) => c.value_pct === 0)).toBe(
      true,
    );
    expect(result.applied_categories.every((c) => c.source === "default_zero")).toBe(
      true,
    );
  });

  it("sums applied values to a cumulative factor", () => {
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        mgmt_exp: { value_pct: -5, reasoning: "Strong mgmt", source: "underwriter" },
        premises_maint: { value_pct: 3, reasoning: "Some wear", source: "underwriter" },
        safety_devices: { value_pct: -7, reasoning: "Sprinklers", source: "underwriter" },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app },
      { schedule: SCHEDULE },
    );
    // Sum: -5 + 3 + -7 = -9 → factor 0.91
    expect(result.applied_pct).toBe(-9);
    expect(result.factor).toBeCloseTo(0.91, 4);
    expect(result.cap_hit).toBe(false);
  });

  it("clamps per-category out-of-range values to the category cap", () => {
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        mgmt_exp: {
          value_pct: -25, // category cap is 5
          reasoning: "Try to over-credit",
          source: "underwriter",
        },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app },
      { schedule: SCHEDULE },
    );
    // Clamped to -5; other categories default to 0
    expect(result.applied_categories[0]?.value_pct).toBe(-5);
    expect(result.applied_pct).toBe(-5);
  });

  it("clamps the cumulative sum to the schedule cap (cap_hit=true)", () => {
    // Construct a schedule where category ranges allow exceeding cap
    const wideSchedule: Schedule = {
      ...SCHEDULE,
      total_cap_pct: 10,
      categories: [
        {
          category_id: "c1",
          name: "C1",
          range_pct: 10,
          reasoning_required: true,
        },
        {
          category_id: "c2",
          name: "C2",
          range_pct: 10,
          reasoning_required: true,
        },
      ],
    };
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        c1: { value_pct: 10, reasoning: "max", source: "underwriter" },
        c2: { value_pct: 10, reasoning: "max", source: "underwriter" },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app },
      { schedule: wideSchedule },
    );
    // Sum is 20 but cap is 10 → clamped to 10 → factor 1.10
    expect(result.applied_pct).toBe(10);
    expect(result.factor).toBeCloseTo(1.1, 4);
    expect(result.cap_hit).toBe(true);
  });

  it("skips tier-filtered categories when tier doesn't match", () => {
    const tieredSchedule: Schedule = {
      ...SCHEDULE,
      categories: [
        {
          category_id: "premium_only",
          name: "Premier underwriter discount",
          range_pct: 5,
          reasoning_required: false,
          tier_filter: ["preferred"],
        },
        SCHEDULE.categories[1]!,
        SCHEDULE.categories[2]!,
      ],
    };
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        premium_only: { value_pct: -5, reasoning: "x", source: "underwriter" },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app, tier: "standard" },
      { schedule: tieredSchedule },
    );
    // tier is "standard"; "premium_only" filters out → applied_pct 0
    expect(result.applied_pct).toBe(0);
    expect(result.applied_categories[0]?.skipped_by_tier).toBe(true);
  });

  it("applies tier-filtered categories when tier matches", () => {
    const tieredSchedule: Schedule = {
      ...SCHEDULE,
      categories: [
        {
          category_id: "premium_only",
          name: "Premier underwriter discount",
          range_pct: 5,
          reasoning_required: false,
          tier_filter: ["preferred"],
        },
      ],
    };
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        premium_only: { value_pct: -5, reasoning: "x", source: "underwriter" },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app, tier: "preferred" },
      { schedule: tieredSchedule },
    );
    expect(result.applied_pct).toBe(-5);
    expect(result.applied_categories[0]?.skipped_by_tier).toBeUndefined();
  });

  it("ignores an unrecognized tier value (no filtering, all categories apply)", () => {
    const tieredSchedule: Schedule = {
      ...SCHEDULE,
      categories: [
        {
          category_id: "premium_only",
          name: "premier",
          range_pct: 5,
          reasoning_required: false,
          tier_filter: ["preferred"],
        },
      ],
    };
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        premium_only: { value_pct: -5, reasoning: "x", source: "underwriter" },
      },
    };
    // Garbage tier value should not silently filter
    const result = ModifierScheduleKind.execute(
      { application: app, tier: "GOLD" },
      { schedule: tieredSchedule },
    );
    // tier doesn't normalize → treated as undefined → no filter applied
    // → category applies
    expect(result.applied_pct).toBe(-5);
  });

  it("explainStep produces an actuary-readable summary", () => {
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        mgmt_exp: { value_pct: -5, reasoning: "Strong mgmt", source: "underwriter" },
        premises_maint: { value_pct: 3, reasoning: "Some wear", source: "underwriter" },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app },
      { schedule: SCHEDULE },
    );
    const explanation = ModifierScheduleKind.explainStep?.(
      { application: app },
      { schedule: SCHEDULE },
      result,
    );
    expect(explanation).toMatch(/Property schedule mod/);
    expect(explanation).toMatch(/2 of 3 categories applied/);
    expect(explanation).toMatch(/-2.0%/);
    expect(explanation).toMatch(/factor 0\.98/);
  });

  it("explainStep notes cap hit", () => {
    const wide: Schedule = {
      ...SCHEDULE,
      total_cap_pct: 5,
      categories: [
        {
          category_id: "c1",
          name: "C1",
          range_pct: 10,
          reasoning_required: true,
        },
      ],
    };
    const app: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        c1: { value_pct: 10, reasoning: "x", source: "underwriter" },
      },
    };
    const result = ModifierScheduleKind.execute(
      { application: app },
      { schedule: wide },
    );
    const exp = ModifierScheduleKind.explainStep?.(
      { application: app },
      { schedule: wide },
      result,
    );
    expect(exp).toMatch(/capped at ±5%/);
  });
});

describe("modifier.schedule — runtime integration", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(ModifierScheduleKind);
    globalRegistry.register(OutputKind);
  });

  it("runs as part of a Plan with constant application wired in", () => {
    const application: ScheduleApplication = {
      schedule_id: "property_schedule",
      values: {
        mgmt_exp: { value_pct: -3, reasoning: "Above average", source: "underwriter" },
      },
    };
    const plan: Plan = {
      id: "test.mod.schedule",
      version: "0.1.0",
      name: "Test",
      nodes: [
        {
          id: "app_const",
          kind: "constant",
          params: { value: application, type: "record" },
        },
        {
          id: "mod",
          kind: "modifier.schedule",
          params: { schedule: SCHEDULE },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "factor", fieldType: "factor" },
        },
      ],
      edges: [
        {
          from: { node: "app_const", port: "value" },
          to: { node: "mod", port: "application" },
        },
        {
          from: { node: "mod", port: "factor" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.factor).toBeCloseTo(0.97, 4);
  });
});
