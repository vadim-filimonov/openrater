/**
 * <InputsPanelV2> — ADR-0056 tri-facet ledger (error ≠ decline ≠ $0).
 *
 * Fixture: base × class_rel(class_code) with the Law-2 `error` policy
 * stamped on the lookup (what the projector authors by default). Row 1
 * resolves (c101 → 1.32); row 2's class code is unknown → the row
 * REFUSES: an "Error" chip (never "—", never a dollar), a red note in
 * the headline, and the audit trace naming the unknown key. Plus the
 * projection-issues strip: a degraded plan can't sit under a confident
 * preview.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan, ProjectionIssue } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base × class_rel(class_code), error policy on the lookup (Law 2 default). */
const PLAN: Plan = {
  id: "test.inputs-v2-issues",
  version: "1.0.0",
  name: "Inputs v2 issues test",
  effective: "2026-01-01",
  nodes: [
    {
      id: "in_base",
      kind: "input",
      params: { fieldName: "base", fieldType: "money" },
    },
    {
      id: "in_cls",
      kind: "input",
      params: { fieldName: "class_code", fieldType: "string" },
    },
    {
      id: "lk_class",
      kind: "lookup.direct",
      params: {
        table: { "c101": 1.32 },
        defaultValue: 1.0,
        tableName: "class_rel",
        keySource: "class_code",
        onMiss: { mode: "error" },
      },
    },
    { id: "mul", kind: "chain.mult", params: { stopOnZero: false } },
    {
      id: "out_p",
      kind: "output",
      params: { fieldName: "premium", fieldType: "money" },
    },
  ],
  edges: [
    { from: { node: "in_cls", port: "value" }, to: { node: "lk_class", port: "key" } },
    { from: { node: "in_base", port: "value" }, to: { node: "mul", port: "base" } },
    { from: { node: "lk_class", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "mul", port: "result" }, to: { node: "out_p", port: "value" } },
  ],
} as unknown as Plan;

const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["base", "class_code"],
    sample_rows: [
      { base: "1000", class_code: "c101" },
      { base: "1000", class_code: "99999" },
    ],
  },
  column_map: { base: "base", class_code: "class_code" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
  { id: "class_code", name: "Class code", dtype: "string", category: "inputs" },
];

function renderPanel(projectionIssues?: readonly ProjectionIssue[]) {
  return render(
    <InputsPanelV2
      stages={[]}
      inputMapping={MAPPING}
      onMappingChange={() => {}}
      requiredInputs={REQUIRED}
      dimensions={[]}
      plan={PLAN}
      inputDtypes={{ base: "number", class_code: "string" }}
      {...(projectionIssues ? { projectionIssues } : {})}
    />,
  );
}

describe("<InputsPanelV2> — ADR-0056 error facet", () => {
  it("renders an ERROR chip for the unrateable row — never a dollar, never the em-dash", () => {
    const { container } = renderPanel();
    const chips = container.querySelectorAll<HTMLButtonElement>(
      ".rater-inputs2__prem-chip",
    );
    expect(chips).toHaveLength(2);
    // Row 1 rated: 1000 × 1.32.
    expect(chips[0]!.textContent).toContain("1,320");
    // Row 2 refused: labeled Error with the red dot.
    expect(chips[1]!.textContent).toContain("Error");
    expect(chips[1]!.className).toContain("is-error");
    const dot = chips[1]!.querySelector(".rater-inputs2__prem-dot");
    expect(dot?.getAttribute("data-tier")).toBe("error");
    // The chip's tooltip carries the structured reason.
    expect(chips[1]!.title).toContain("cannot rate");
  });

  it("counts unrateable rows in the headline note (excluded from totals)", () => {
    const { container } = renderPanel();
    const note = container.querySelector(".rater-inputs2__prem-err");
    expect(note).toBeInTheDocument();
    expect(note!.textContent).toContain("1 row cannot be rated");
  });

  it("expanding an error row shows 'cannot rate' + the structured issues", () => {
    const { container } = renderPanel();
    const chips = container.querySelectorAll<HTMLButtonElement>(
      ".rater-inputs2__prem-chip",
    );
    fireEvent.click(chips[1]!);
    const trace = container.querySelector(".rater-inputs2__trace");
    expect(trace).toBeInTheDocument();
    expect(trace!.textContent).toContain("cannot rate");
    // The row's issues list names the unknown key + the withheld output.
    const issues = container.querySelectorAll(".rater-inputs2__trace-issue");
    expect(issues.length).toBeGreaterThan(0);
    expect(trace!.textContent).toContain("99999");
  });

  it("renders the projection-issues strip when the plan is degraded", () => {
    const { container } = renderPanel([
      {
        severity: "error",
        code: "factor_table_missing",
        message:
          "Factor `sprinkler_rel` on stage `x` matched no factor table — no key can resolve.",
      },
      {
        severity: "warning",
        code: "package_scope_fallback",
        message: "Schedule `s1` applies per-coverage instead.",
      },
    ]);
    const strip = container.querySelector(".rater-inputs2__proj-issues");
    expect(strip).toBeInTheDocument();
    expect(strip!.textContent).toContain("1 authoring issue blocks pricing");
    expect(strip!.textContent).toContain("1 warning");
    expect(strip!.textContent).toContain("sprinkler_rel");
  });

  it("no strip when the projection is clean", () => {
    const { container } = renderPanel([]);
    expect(
      container.querySelector(".rater-inputs2__proj-issues"),
    ).not.toBeInTheDocument();
  });
});
