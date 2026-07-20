/**
 * tailSync tests — Brief 70 Phase 3 (the §8/§9 move).
 *
 * Re-pins the modifier/endorsement conversions that lost their
 * coverage when gatesSync (and its roundtrip test) died with the
 * GateCanvas: draft → stage → draft round-trips, and the Brief 69
 * leading-zero coercion (class codes stay strings).
 */

import { describe, expect, it } from "vitest";
import { emptyModifierDraft } from "@openrater/ui";
import type { EndorsementDraft, ModifierDraft } from "@openrater/ui";
import type { StageSummary } from "@openrater/api-client";
import {
  endorsementDraftToStageRequest,
  modifierDraftToStageRequest,
  planStagesToTailEntries,
} from "./tailSync";

function asStage(req: {
  stage_id: string;
  stage_kind: string;
  display_name: string;
  config_json?: unknown;
}): StageSummary {
  return {
    stage_id: req.stage_id,
    stage_kind: req.stage_kind,
    display_name: req.display_name,
    sequence: 1,
    config_json: (req.config_json ?? null) as Record<string, unknown> | null,
  } as StageSummary;
}

describe("tailSync (Brief 70 Phase 3)", () => {
  it("modifier schedule round-trips draft → stage → draft", () => {
    const draft: ModifierDraft = {
      ...emptyModifierDraft(),
      modifier_id: "mod_irpm",
      display_name: "Schedule rating (IRPM)",
      kind: "schedule",
      cap_pct: 25,
      categories: [
        {
          id: "cat-0",
          name: "Management",
          range_lo_pct: -10,
          range_hi_pct: 10,
          reasoning_required: true,
          tier_filter: [],
        },
      ],
    };
    const req = modifierDraftToStageRequest("mod_irpm", draft);
    expect(req).not.toBeNull();
    expect(req!.stage_kind).toBe("modifier.schedule");
    const [entry] = planStagesToTailEntries([asStage(req!)]);
    expect(entry?.kind).toBe("modifier");
    if (entry?.kind !== "modifier") return;
    expect(entry.draft.cap_pct).toBe(25);
    expect(entry.draft.categories[0]).toMatchObject({
      name: "Management",
      range_lo_pct: -10,
      range_hi_pct: 10,
      reasoning_required: true,
    });
  });

  it("non-schedule modifiers refuse (never silently coerce)", () => {
    const draft: ModifierDraft = {
      ...emptyModifierDraft(),
      kind: "flat",
    };
    expect(modifierDraftToStageRequest("mod_x", draft)).toBeNull();
  });

  it("F06 — a schedule with an unnamed category refuses (would 422)", () => {
    const draft: ModifierDraft = {
      ...emptyModifierDraft(),
      kind: "schedule",
      display_name: "Schedule rating (IRPM)",
      categories: [
        {
          id: "cat-0",
          name: "", // empty — the substrate rejects this (min_length≥1)
          range_lo_pct: -10,
          range_hi_pct: 10,
          reasoning_required: true,
          tier_filter: [],
        },
      ],
    };
    expect(modifierDraftToStageRequest("mod_irpm", draft)).toBeNull();
  });

  it("endorsement trigger values keep leading-zero strings (Brief 69)", () => {
    const draft: EndorsementDraft = {
      endorsement_id: "endo_1",
      form_number: "MS 10 01",
      display_name: "Protective safeguards",
      trigger: { variable: "class_code", op: "eq", value: "0521" },
      effect_kind: "factor",
      factor: 1.05,
      amount: 0,
      sublimit_coverage: "",
      sublimit_value: 0,
      branch_chain: {
        name: "",
        base_input: "",
        exposure_input: "",
        exposure_unit_divisor: 1,
        lcm_input_path: "form_input.lcm",
        output_field: "",
        factor_lookups: [],
      },
      citation: "",
    };
    const req = endorsementDraftToStageRequest("endo_1", draft);
    expect(req!.stage_kind).toBe("endorsement.factor");
    const cfg = req!.config_json as { trigger: { value: unknown } };
    expect(cfg.trigger.value).toBe("0521"); // string, not 521
    const [entry] = planStagesToTailEntries([asStage(req!)]);
    expect(entry?.kind).toBe("endorsement");
    if (entry?.kind !== "endorsement") return;
    expect(entry.draft.trigger.value).toBe("0521");
    expect(entry.draft.factor).toBe(1.05);
  });
});
