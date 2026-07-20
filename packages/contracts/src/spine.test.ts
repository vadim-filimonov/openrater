/**
 * Spine tests — sub-brief 24.B.
 *
 * Verifies the 4-workspace + 1-verify-sibling taxonomy
 * (`PlanBuilderWorkspace`) per Brief 24 v3 §2. Every section carries
 * a `workspace` field; the rail iterates `WORKSPACE_ORDER` and
 * buckets via `PLAN_SECTIONS_BY_WORKSPACE`.
 */

import { describe, expect, it } from "vitest";
import {
  AUTHORING_WORKSPACES,
  DEFAULT_WORKSPACE,
  isPlanBuilderWorkspace,
  PLAN_SECTIONS,
  PLAN_SECTION_COUNT,
  PLAN_SECTIONS_BY_ID,
  PLAN_SECTIONS_BY_WORKSPACE,
  WORKSPACE_DESCRIPTIONS,
  WORKSPACE_LABELS,
  WORKSPACE_ORDER,
  type PlanBuilderWorkspace,
} from "./spine";

describe("Spine — section count", () => {
  it("declares 13 canonical sections (curves removed in Brief 34 PR 34.7)", () => {
    expect(PLAN_SECTIONS.length).toBe(13);
    expect(PLAN_SECTION_COUNT).toBe(13);
  });
});

describe("Spine — workspace taxonomy (24.B → 24.F2 + Brief 43)", () => {
  it("declares 7 entries in WORKSPACE_ORDER (4 authoring + verify + analytics + ship — Brief 78 merged parametrize into assemble)", () => {
    expect(WORKSPACE_ORDER.length).toBe(7);
    // V2_INTERFACE_SPEC §2.1 — build then run then ship: the Rating
    // workspace (tables + sheet, Brief 78/D9) precedes its gates; Run
    // precedes Analytics on the run side; Ship (Brief 76) closes the
    // strip — publish is the last verb.
    expect(WORKSPACE_ORDER).toEqual([
      "inputs",
      "dimensions",
      "assemble",
      "gate",
      "verify",
      "analytics",
      "ship",
    ]);
    // Brief 78 — the parametrize tab is GONE; legacy URLs redirect in
    // the router, the id must never validate again.
    expect(isPlanBuilderWorkspace("parametrize")).toBe(false);
  });

  it("AUTHORING_WORKSPACES is the 4 user-authored surfaces (analytics + verify + ship excluded)", () => {
    expect(AUTHORING_WORKSPACES.length).toBe(4);
    expect(AUTHORING_WORKSPACES).toEqual([
      "inputs",
      "dimensions",
      "gate",
      "assemble",
    ]);
    expect(AUTHORING_WORKSPACES).not.toContain("verify");
    expect(AUTHORING_WORKSPACES).not.toContain("analytics");
  });

  it("DEFAULT_WORKSPACE is inputs (the first authoring surface)", () => {
    expect(DEFAULT_WORKSPACE).toBe("inputs");
  });

  it("isPlanBuilderWorkspace identifies valid workspace ids", () => {
    expect(isPlanBuilderWorkspace("inputs")).toBe(true);
    expect(isPlanBuilderWorkspace("dimensions")).toBe(true);
    expect(isPlanBuilderWorkspace("verify")).toBe(true);
    expect(isPlanBuilderWorkspace("unknown")).toBe(false);
    expect(isPlanBuilderWorkspace("")).toBe(false);
  });

  it("every workspace has a label + description", () => {
    for (const workspace of WORKSPACE_ORDER) {
      expect(WORKSPACE_LABELS[workspace]).toBeTruthy();
      expect(WORKSPACE_DESCRIPTIONS[workspace]).toBeTruthy();
      // descriptions are real sentences, not stubs
      expect(WORKSPACE_DESCRIPTIONS[workspace].length).toBeGreaterThan(20);
    }
  });

  it("every section has a workspace field set to a valid workspace", () => {
    for (const section of PLAN_SECTIONS) {
      expect(section.workspace).toBeTruthy();
      expect(WORKSPACE_ORDER).toContain(section.workspace);
    }
  });

  it("PLAN_SECTIONS_BY_WORKSPACE buckets every section exactly once", () => {
    let totalBucketed = 0;
    const seen = new Set<string>();
    for (const workspace of WORKSPACE_ORDER) {
      for (const section of PLAN_SECTIONS_BY_WORKSPACE[workspace]) {
        // No section appears in two workspaces.
        expect(seen.has(section.id)).toBe(false);
        seen.add(section.id);
        totalBucketed++;
      }
    }
    expect(totalBucketed).toBe(PLAN_SECTION_COUNT);
  });
});

describe("Spine — workspace mappings (Brief 24 v3 §2 alignment)", () => {
  it("inputs contains Risk Inputs (24.F2 — broken back out of dimensions)", () => {
    const ids = PLAN_SECTIONS_BY_WORKSPACE.inputs.map((s) => s.id);
    expect(ids).toEqual(["risk-inputs"]);
  });

  it("dimensions contains Dimensions + Territories + Classification (24.F2 — Risk Inputs moved out)", () => {
    const ids = PLAN_SECTIONS_BY_WORKSPACE.dimensions.map((s) => s.id);
    expect(ids).toEqual(["dimensions", "territories", "classification"]);
  });

  it("gate contains Eligibility + Modifiers + Endorsements", () => {
    const ids = PLAN_SECTIONS_BY_WORKSPACE.gate.map((s) => s.id);
    expect(ids).toEqual(["eligibility", "modifiers", "endorsements"]);
  });

  it("assemble (Rating) contains Rating Chains + Factor Tables + Loadings + Final Adjustments + Outputs (Brief 78 fold)", () => {
    const ids = PLAN_SECTIONS_BY_WORKSPACE.assemble.map((s) => s.id);
    expect(ids).toEqual([
      "rating-chains",
      "factor-tables",
      "loadings",
      "final-adjustments",
      "outputs",
    ]);
    // The workspace anchor (PlanDetailRoute's activeSectionId) is the
    // FIRST bucketed section — the sheet must stay the landing, so
    // rating-chains must stay ahead of factor-tables in PLAN_SECTIONS.
    expect(PLAN_SECTIONS_BY_WORKSPACE.assemble[0]?.id).toBe("rating-chains");
  });

  it("verify contains only Rate Against Sample (sibling to the 4)", () => {
    const ids = PLAN_SECTIONS_BY_WORKSPACE.verify.map((s) => s.id);
    expect(ids).toEqual(["rate-against-sample"]);
  });
});

describe("Spine — optional workspaces (computed from section.required)", () => {
  // A workspace is "optional" iff none of its sections is required.
  const isOptional = (workspace: PlanBuilderWorkspace): boolean =>
    PLAN_SECTIONS_BY_WORKSPACE[workspace].every((s) => !s.required);

  it("GATE has no required sections (it's optional)", () => {
    expect(isOptional("gate")).toBe(true);
  });

  it("DIMENSIONS has at least one required section", () => {
    expect(isOptional("dimensions")).toBe(false);
  });

  it("ASSEMBLE has at least one required section", () => {
    expect(isOptional("assemble")).toBe(false);
  });
});

describe("Spine — section lookup helpers", () => {
  it("PLAN_SECTIONS_BY_ID resolves every section by stable id", () => {
    for (const section of PLAN_SECTIONS) {
      expect(PLAN_SECTIONS_BY_ID[section.id]).toBe(section);
    }
  });

  it("section ordinals are 1-based + contiguous", () => {
    PLAN_SECTIONS.forEach((section, i) => {
      expect(section.num).toBe(i + 1);
    });
  });
});
