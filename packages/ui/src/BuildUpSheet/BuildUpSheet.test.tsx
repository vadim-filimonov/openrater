/**
 * <BuildUpSheet> tests — Brief 70 §2, rescoped by Brief 82.
 *
 * Pins the sheet's contract:
 *   - ONE COLUMN of coverage cards: numbered steps with binding
 *     sentences and the Step · Value column contract (D-E);
 *   - O-1: NO computed number anywhere — a scalar step shows its
 *     AUTHORED value, a table step shows its SHAPE; headers carry the
 *     build's size (step counts), never dollars;
 *   - D-B (R1): selecting a step opens the IN-PLACE row editor
 *     (rename · predicate · value · duplicate · delete); selecting
 *     again closes it;
 *   - the picker refuses a third submission field (refuse ≠ discard)
 *     and carries the models-are-tail footnote;
 *   - reorder keeps the base pinned first and the output cap last;
 *   - inline base-rate editing commits through onPlanChange;
 *   - the empty state is the creation question (single premium or a
 *     coverage-dim pick; zero-level dims never offered);
 *   - "+ Add coverage" (re-homed from the dead side-nav) commits an
 *     empty tower;
 *   - exposure_options coverages stay editable and name their mode;
 *   - the ONE tail ledger: provenance tags + policy-tail dispatch +
 *     the four create verbs (G16);
 *   - read-only withholds every authoring affordance.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BuildUpSheet } from "./BuildUpSheet";
import type { SheetPickerItem } from "./BuildUpSheet";
import type {
  Tower,
  TowerNode,
  TowerPlan,
} from "../CalculationTower/types";
import type { DimensionRow } from "../DimensionsTable";

// ── Fixture: one Building coverage — base × construction factor × LCM ─

const BASE_NODE: TowerNode = {
  id: "n_base",
  category: "math",
  subtype: "constant",
  title: "Base rate",
  valueChip: { primary: "$0.350", secondary: "authored" },
  icon: "DollarSign",
  ref: { kind: "chain-base", baseValue: 0.35 },
};
const FACTOR_NODE: TowerNode = {
  id: "n_fac",
  category: "lookup",
  subtype: "table",
  title: "Construction factor",
  valueChip: { primary: "4 values · 0.85–1.40" },
  icon: "List",
  ref: { kind: "factor-table", tableId: "construction_factor" },
};
const LCM_NODE: TowerNode = {
  id: "n_lcm",
  category: "math",
  subtype: "constant",
  title: "LCM",
  valueChip: { primary: "× 1.401", secondary: "carrier-set" },
  icon: "Target",
  ref: { kind: "constant", constantId: "LCM", role: "lcm", value: 1.401 },
};
const CAP_NODE: TowerNode = {
  id: "n_out",
  category: "output",
  title: "Building",
  valueChip: { primary: "bld_premium", secondary: "money" },
  icon: "Circle",
  ref: { kind: "output", outputField: "bld_premium" },
};

const TOWER: Tower = {
  id: "tower_bld",
  ratingDimensionValue: "building",
  name: "Building premium",
  outputField: "bld_premium",
  entries: [
    { kind: "node", nodeId: "n_base" },
    { kind: "node", nodeId: "n_fac" },
    { kind: "node", nodeId: "n_lcm" },
    { kind: "node", nodeId: "n_out" },
  ],
  entryOps: ["multiply", "multiply", "multiply"],
  exposureInput: "building_limit",
  exposureUnitDivisor: 100,
};

function makePlan(over: Partial<TowerPlan> = {}): TowerPlan {
  return {
    ratingDimension: "coverage",
    ratingDimensionValues: ["building"],
    towers: [TOWER],
    nodes: new Map(
      [BASE_NODE, FACTOR_NODE, LCM_NODE, CAP_NODE].map((n) => [n.id, n]),
    ),
    groups: new Map(),
    constants: new Map(),
    models: new Map(),
    ...over,
  };
}

const PICKER_ITEMS: readonly SheetPickerItem[] = [
  {
    id: "ft:protection_factor",
    kind: "factor-table",
    title: "Protection factor",
    sentence: "keyed by Protection class",
    range: "0.90–1.20",
    tableId: "protection_factor",
  },
  {
    id: "const:FLAT",
    kind: "constant",
    title: "Flat factor",
    sentence: "a fixed multiplier",
    constantId: "FLAT",
    constantValue: 1.05,
  },
  {
    id: "input:sqft",
    kind: "input",
    title: "Square footage",
    field: "sqft",
    dtype: "number",
  },
];

const SPAWN_DIM: DimensionRow = {
  id: "coverage",
  slug: "coverage",
  display_name: "Coverage",
  data_type: "string",
  levels: [
    { kind: "categorical", id: "building", label: "Building" },
    { kind: "categorical", id: "bpp", label: "BPP" },
  ],
};
const EMPTY_DIM: DimensionRow = {
  id: "empty_dim",
  slug: "empty_dim",
  display_name: "No levels yet",
  data_type: "string",
  levels: [],
};

function setup(over: Record<string, unknown> = {}) {
  const onPlanChange = vi.fn();
  const plan = (over["plan"] as TowerPlan) ?? makePlan();
  render(
    <BuildUpSheet
      plan={plan}
      onPlanChange={onPlanChange}
      pickerItems={PICKER_ITEMS}
      factorTableMeta={
        new Map([
          [
            "construction_factor",
            {
              title: "Construction factor",
              keyDims: ["construction"],
              count: 4,
              range: "0.85–1.40",
            },
          ],
        ])
      }
      dimDisplayNames={new Map([["construction", "Construction class"]])}
      {...over}
    />,
  );
  return { onPlanChange, plan };
}

describe("<BuildUpSheet> (Brief 70 §2 · Brief 82)", () => {
  it("renders the coverage card as a numbered worksheet with sentences + the column contract", () => {
    setup();
    expect(screen.getByText("Building premium")).toBeInTheDocument();
    // base pinned at 1., factors numbered from 2.
    expect(screen.getByTestId("rater-buildup-sheet-base-tower_bld"))
      .toHaveTextContent("1.");
    expect(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    ).toHaveTextContent("2.");
    // the binding sentence speaks product words — and carries the
    // demoted slug (MVP-017: display name leads, identifier subtitles)
    expect(
      screen.getByText("construction_factor · keyed by Construction class"),
    ).toBeInTheDocument();
    // the exposure pill reads as a sentence — display words, never
    // snake_case (R3 D-H)
    expect(
      screen.getByText("Rated per $100 of building limit"),
    ).toBeInTheDocument();
    // D-E — the column contract is stated once per card
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("O-1: the header carries the build's SIZE, never a dollar", () => {
    setup();
    // 3 authored steps (base + factor + LCM; the output cap is not a row)
    expect(
      screen.getByTestId("rater-buildup-sheet-covcount-tower_bld"),
    ).toHaveTextContent("3 steps");
    // No computed running column exists anywhere.
    expect(document.querySelector(".rater-buildup__col-running")).toBeNull();
  });

  it("D-E: a table step shows its SHAPE; scalar steps show their authored value", () => {
    setup();
    // shape from factorTableMeta (count + range)
    const factorRow = screen.getByTestId(
      "rater-buildup-sheet-steps-tower_bld-row-n_fac",
    );
    expect(factorRow).toHaveTextContent("4 values · 0.85–1.40");
    // the base's authored value renders (editable), not a computation
    expect(
      screen.getByTestId("rater-buildup-sheet-inline-open-n_base"),
    ).toHaveTextContent("$0.35"); // FCA #35 — authored precision, no invented zero
    // the LCM's authored value renders
    expect(
      screen.getByTestId("rater-buildup-sheet-inline-open-n_lcm"),
    ).toHaveTextContent("1.401");
  });

  it("D-B (R1): selecting a step opens the IN-PLACE row editor; selecting again closes it", () => {
    setup();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    const editor = screen.getByTestId("rater-buildup-sheet-inspector");
    expect(editor).toBeInTheDocument();
    // it renders IN the document flow (a row child), not a floating aside
    expect(editor.closest("[data-testid$='-row-n_fac']")).not.toBeNull();
    // rename + duplicate + delete live here
    expect(
      screen.getByTestId("rater-buildup-sheet-insp-rename"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-insp-duplicate"),
    ).toBeInTheDocument();
    // toggle: clicking the row again closes the editor
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-inspector"),
    ).not.toBeInTheDocument();
  });

  it("the picker groups steps, refuses a third submission field, and says where models live", () => {
    // Tower already reads TWO submission fields.
    const inputA: TowerNode = {
      id: "n_inp_a",
      category: "input",
      title: "Building limit",
      valueChip: { primary: "number" },
      icon: "FileInput",
      ref: { kind: "submission-field", field: "building_limit" },
    };
    const inputB: TowerNode = {
      id: "n_inp_b",
      category: "input",
      title: "Year built",
      valueChip: { primary: "number" },
      icon: "FileInput",
      ref: { kind: "submission-field", field: "year_built" },
    };
    const plan = makePlan({
      towers: [
        {
          ...TOWER,
          entries: [
            { kind: "node", nodeId: "n_base" },
            { kind: "node", nodeId: "n_inp_a" },
            { kind: "node", nodeId: "n_inp_b" },
            { kind: "node", nodeId: "n_out" },
          ],
          entryOps: ["multiply", "multiply", "multiply"],
        },
      ],
      nodes: new Map(
        [BASE_NODE, inputA, inputB, CAP_NODE].map((n) => [n.id, n]),
      ),
    });
    setup({ plan });
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-add-step-tower_bld"),
    );
    expect(screen.getByText("Factor tables")).toBeInTheDocument();
    expect(screen.getByText("Constants")).toBeInTheDocument();
    // the cap refuses with the reason — the row is disabled, not hidden
    expect(
      screen.getByTestId("rater-buildup-sheet-pick-input-cap"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-pick-input:sqft"),
    ).toBeDisabled();
    // models are named, not hidden
    expect(
      screen.getByText(/Models join in Final adjustments/),
    ).toBeInTheDocument();
  });

  it("picking a factor table inserts a fully-referenced node above the cap", () => {
    const { onPlanChange } = setup();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-add-step-tower_bld"),
    );
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-pick-ft:protection_factor"),
    );
    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    const tower = next.towers[0]!;
    // inserted above the output cap
    const ids = tower.entries.map((e) =>
      e.kind === "node" ? e.nodeId : "",
    );
    expect(ids[ids.length - 1]).toBe("n_out");
    const newId = ids[ids.length - 2]!;
    const node = next.nodes.get(newId)!;
    expect(node.ref).toMatchObject({
      kind: "factor-table",
      tableId: "protection_factor",
    });
  });

  it("Alt+ArrowDown reorders factors while the base stays pinned first", () => {
    const { onPlanChange } = setup();
    fireEvent.keyDown(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
      { key: "ArrowDown", altKey: true },
    );
    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    const ids = next.towers[0]!.entries.map((e) =>
      e.kind === "node" ? e.nodeId : "",
    );
    expect(ids).toEqual(["n_base", "n_lcm", "n_fac", "n_out"]);
  });

  it("inline base-rate editing commits through onPlanChange", () => {
    const { onPlanChange } = setup();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-inline-open-n_base"),
    );
    const input = screen.getByTestId("rater-buildup-sheet-inline-n_base");
    fireEvent.change(input, { target: { value: "0.42" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    const base = next.nodes.get("n_base")!;
    expect(base.ref).toMatchObject({ kind: "chain-base", baseValue: 0.42 });
  });

  it("R2 (F15): no hover-delete on the reading surface — delete lives in the row editor and arms the prompt", () => {
    const { onPlanChange } = setup();
    // The reading surface carries NO per-row delete control.
    expect(
      screen.queryByTestId("rater-buildup-sheet-delete-n_fac"),
    ).not.toBeInTheDocument();
    // Open the row editor → Delete step arms the impact prompt.
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-insp-delete"));
    expect(onPlanChange).not.toHaveBeenCalled(); // armed, not deleted
    expect(
      screen.getByText(/The chain stops multiplying this step/),
    ).toBeInTheDocument();
  });

  it("EMPTY STATE: the creation question offers single premium + coverage dims (zero-level excluded)", () => {
    const { onPlanChange } = setup({
      plan: makePlan({ towers: [], nodes: new Map() }),
      spawnDims: [SPAWN_DIM, EMPTY_DIM],
    });
    expect(
      screen.getByText("How does this plan build a premium?"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-spawn-coverage"),
    ).toBeInTheDocument();
    // zero-level dim is not offered at all
    expect(
      screen.queryByTestId("rater-buildup-sheet-spawn-empty_dim"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-start-single"));
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    expect(next.towers).toHaveLength(1);
    expect(next.towers[0]!.outputField).toBe("premium");
  });

  it("spawning from a coverage dimension creates one tower per level", () => {
    const { onPlanChange } = setup({
      plan: makePlan({ towers: [], nodes: new Map() }),
      spawnDims: [SPAWN_DIM],
    });
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-spawn-coverage"));
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    expect(next.towers).toHaveLength(2);
    expect(next.ratingDimension).toBe("coverage");
  });

  it("D-A: '+ Add coverage' (re-homed from the dead side-nav) commits an empty tower", () => {
    const { onPlanChange } = setup();
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-add-coverage"));
    const input = screen.getByLabelText("Coverage name");
    fireEvent.change(input, { target: { value: "Liability" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    expect(next.towers).toHaveLength(2);
    expect(next.towers[1]!.name).toBe("Liability premium");
  });

  it("a class-conditional coverage stays EDITABLE and names its mode (Brief 78 P5.3c — the banner is dead)", () => {
    const towers: Tower[] = [
      { ...TOWER, exposureOptionCount: 3, chainVerbatim: { name: "Building" } },
    ];
    setup({
      plan: makePlan({ towers }),
    });
    // The old read-only banner is GONE…
    expect(
      screen.queryByTestId("rater-buildup-sheet-expo-options-tower_bld"),
    ).not.toBeInTheDocument();
    // …the steps are writable…
    expect(
      screen.getByTestId("rater-buildup-sheet-add-step-tower_bld"),
    ).toBeInTheDocument();
    // …and the exposure pill names the varies-by-class mode instead of
    // mislabeling one option as THE base.
    expect(
      screen.getByTestId("rater-buildup-sheet-expo-tower_bld"),
    ).toHaveTextContent(/varies by class · 3 options/i);
    // Its popover is honest: the per-class map is frozen verbatim.
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-expo-tower_bld"));
    expect(screen.getByTestId("rater-buildup-sheet-expo-pop")).toHaveTextContent(
      /preserved verbatim/,
    );
  });

  it("final adjustments render as authored tail rows and delete arms the prompt", () => {
    const onDeleteAdjustment = vi.fn();
    setup({
      finalAdjustments: [
        {
          id: "stage_irpm",
          name: "IRPM — schedule rating",
          sentence: "underwriter judgment, capped ±25%",
          kind: "modifier",
          meta: "± 25%",
        },
      ],
      onAddAdjustment: vi.fn(),
      onDeleteAdjustment,
    });
    expect(screen.getByText("IRPM — schedule rating")).toBeInTheDocument();
    // the Effect column carries the AUTHORED effect
    expect(
      screen.getByTestId("rater-buildup-sheet-fa-stage_irpm"),
    ).toHaveTextContent("± 25%");
    // O-1 — the ledger's header counts, and the old preview caption
    // ("…in this preview…") is dead.
    expect(
      screen.getByTestId("rater-buildup-sheet-covcount-final"),
    ).toHaveTextContent("1 adjustment");
    expect(
      screen.queryByText(/in this preview/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-fa-delete-stage_irpm"),
    );
    expect(onDeleteAdjustment).not.toHaveBeenCalled(); // armed first
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-fa-delete-prompt-confirm"),
    );
    expect(onDeleteAdjustment).toHaveBeenCalledWith("stage_irpm");
  });

  it("ONE tail ledger: policy-tail rows carry the tag and dispatch to the policy-tail handlers (Brief 78 P5.4 D-F)", () => {
    const onOpenPolicyTail = vi.fn();
    const onDeletePolicyTail = vi.fn();
    const onDeleteAdjustment = vi.fn();
    setup({
      finalAdjustments: [
        {
          id: "stage_irpm",
          name: "IRPM — schedule rating",
          sentence: "underwriter judgment, capped ±25%",
          kind: "modifier",
          provenance: "plan-stage",
        },
        {
          id: "ptail_glm",
          name: "IRPM — GLM model",
          sentence: "IRPM from model glm_1 — composes per policy",
          kind: "modifier",
          provenance: "policy-tail",
        },
      ],
      onAddAdjustment: vi.fn(),
      onEditAdjustment: vi.fn(),
      onDeleteAdjustment,
      onOpenPolicyTail,
      onDeletePolicyTail,
    });
    // R4 (D-F) — the DEFAULT substrate is untagged; only the
    // exception (policy tail) names itself.
    expect(
      screen.queryByTestId("rater-buildup-sheet-fa-prov-stage_irpm"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-fa-prov-ptail_glm"),
    ).toHaveTextContent(/policy tail/i);
    // A policy-tail row opens the tail editor (never the stage drawers)…
    fireEvent.click(screen.getByText("IRPM — GLM model"));
    expect(onOpenPolicyTail).toHaveBeenCalled();
    // …and its armed delete dispatches to the policy-tail handler.
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-fa-delete-ptail_glm"),
    );
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-fa-delete-prompt-confirm"),
    );
    expect(onDeletePolicyTail).toHaveBeenCalledWith("ptail_glm");
    expect(onDeleteAdjustment).not.toHaveBeenCalled();
    // The add menu's "Policy tail…" entry opens the same editor.
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-fa-add"));
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-fa-policy-tail"));
    expect(onOpenPolicyTail).toHaveBeenCalledTimes(2);
    // …and picking an entry dismisses the menu (one summoned surface).
    expect(
      screen.queryByTestId("rater-buildup-sheet-fa-menu"),
    ).not.toBeInTheDocument();
  });

  it("R4 (D-F): ONE add menu offers the four create verbs (G16 kept) and joins the summoned-surface rule", () => {
    const onAddAdjustment = vi.fn();
    setup({ finalAdjustments: [], onAddAdjustment });
    // The five permanent buttons are gone — one ghost row remains.
    expect(
      screen.getByTestId("rater-buildup-sheet-fa-add"),
    ).toBeInTheDocument();
    for (const [testId, kind] of [
      ["rater-buildup-sheet-fa-add-modifier", "modifier"],
      // G16 — endorsements had NO create path anywhere before P5.3.
      ["rater-buildup-sheet-fa-add-endorsement", "endorsement"],
      ["rater-buildup-sheet-fa-add-loading", "loading"],
      ["rater-buildup-sheet-fa-add-min", "min_premium"],
    ] as const) {
      fireEvent.click(screen.getByTestId("rater-buildup-sheet-fa-add"));
      fireEvent.click(screen.getByTestId(testId));
      expect(onAddAdjustment).toHaveBeenLastCalledWith(kind);
      // Picking dismisses the menu.
      expect(
        screen.queryByTestId("rater-buildup-sheet-fa-menu"),
      ).not.toBeInTheDocument();
    }
    expect(onAddAdjustment).toHaveBeenCalledTimes(4);
    // D-H: the schedule verb speaks generic grammar, not "IRPM".
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-fa-add"));
    expect(screen.getByText("Schedule modifier")).toBeInTheDocument();
    // The menu is a summoned surface: summoning the picker dismisses it.
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-add-step-tower_bld"),
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-fa-menu"),
    ).not.toBeInTheDocument();
  });

  it("read-only withholds every authoring affordance", () => {
    setup({ readOnly: true, onPlanChange: undefined });
    expect(
      screen.queryByTestId("rater-buildup-sheet-add-step-tower_bld"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-buildup-sheet-delete-n_fac"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-buildup-sheet-add-coverage"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-inline-open-n_base"),
    ).toBeDisabled();
  });

  // ── Brief 82 R2 — the one-summoned-surface contract (F4) ─────────

  it("R2 (F4): summoning any surface dismisses the previous one — at most ONE is open", () => {
    setup();
    // 1. Open the add-step picker…
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-add-step-tower_bld"),
    );
    expect(screen.getByTestId("rater-buildup-sheet-picker")).toBeInTheDocument();
    // 2. …then summon a ROW editor: the picker dismisses.
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-picker"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-inspector"),
    ).toBeInTheDocument();
    // 3. …then the exposure popover: the row editor dismisses.
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-expo-tower_bld"));
    expect(
      screen.queryByTestId("rater-buildup-sheet-inspector"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-expo-pop"),
    ).toBeInTheDocument();
    // 4. Escape always returns to the reading state.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByTestId("rater-buildup-sheet-expo-pop"),
    ).not.toBeInTheDocument();
  });

  it("R2 (F4): onSummon fires on open; a summonEpoch bump dismisses the sheet's surfaces", () => {
    const onSummon = vi.fn();
    const { rerender, plan, onPlanChange } = (() => {
      const onPlanChangeFn = vi.fn();
      const planV = makePlan();
      const view = render(
        <BuildUpSheet
          plan={planV}
          onPlanChange={onPlanChangeFn}
          pickerItems={PICKER_ITEMS}
          onSummon={onSummon}
          summonEpoch={0}
        />,
      );
      return { rerender: view.rerender, plan: planV, onPlanChange: onPlanChangeFn };
    })();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    expect(onSummon).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("rater-buildup-sheet-inspector"),
    ).toBeInTheDocument();
    // The consumer summons ITS surface → epoch bump → sheet dismisses.
    rerender(
      <BuildUpSheet
        plan={plan}
        onPlanChange={onPlanChange}
        pickerItems={PICKER_ITEMS}
        onSummon={onSummon}
        summonEpoch={1}
      />,
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-inspector"),
    ).not.toBeInTheDocument();
  });

  it("R2 (D-B): the expanded row hosts the consumer's inline table editor + Full screen", () => {
    const onOpenFactorTable = vi.fn();
    setup({
      onOpenFactorTable,
      renderTableEditor: (tableId: string) => (
        <div data-testid={`fake-grid-${tableId}`}>grid</div>
      ),
    });
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    // The grid renders IN the expanded row…
    expect(
      screen.getByTestId("fake-grid-construction_factor"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-insp-grid"),
    ).toBeInTheDocument();
    // …and Full screen opens the takeover for the big ones.
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-insp-open-table"),
    );
    expect(onOpenFactorTable).toHaveBeenCalledWith("construction_factor");
  });

  it("R2: Enter on a focused row opens its editor (the hot loop is walkable)", () => {
    setup();
    const row = screen.getByTestId(
      "rater-buildup-sheet-steps-tower_bld-row-n_fac",
    );
    fireEvent.keyDown(row, { key: "Enter" });
    expect(
      screen.getByTestId("rater-buildup-sheet-inspector"),
    ).toBeInTheDocument();
    // Enter INSIDE the editor's rename input must NOT toggle it shut.
    const rename = screen.getByTestId("rater-buildup-sheet-insp-rename");
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(
      screen.getByTestId("rater-buildup-sheet-inspector"),
    ).toBeInTheDocument();
  });

  it("R2 (D-G): the predicate builder seeds equals by dtype and renders a typed value control", () => {
    const { onPlanChange, plan } = setup();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    // Pick the NUMBER-typed field → equals seeds to 1 (not true).
    fireEvent.change(
      screen.getByTestId("rater-buildup-sheet-insp-predicate-path"),
      { target: { value: "form_input.sqft" } },
    );
    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    expect(next.nodes.get("n_fac")!.ref).toMatchObject({
      kind: "factor-table",
      predicate: { path: "form_input.sqft", equals: 1 },
    });
    void plan;
  });

  // ── Brief 82 R3 — structural Law 2 + the D-H copy sweep ──────────

  it("R3 (Law 2): a step whose table left the catalog refuses with a named chip", () => {
    // The catalog is PROVIDED but doesn't know construction_factor.
    setup({
      factorTableMeta: new Map([
        ["some_other_table", { title: "Other", keyDims: [] }],
      ]),
    });
    const chip = screen.getByTestId("rater-buildup-sheet-blocked-n_fac");
    expect(chip).toHaveTextContent("references a deleted table");
    // The shape never renders over a broken reference.
    expect(
      screen.queryByText("4 values · 0.85–1.40"),
    ).not.toBeInTheDocument();
  });

  it("R3 (D-H): exposure + predicate copy speak display names — no snake_case", () => {
    const facWithPred: TowerNode = {
      ...FACTOR_NODE,
      ref: {
        kind: "factor-table",
        tableId: "construction_factor",
        predicate: { path: "form_input.sqft", equals: 100 },
      },
    };
    setup({
      plan: makePlan({
        nodes: new Map(
          [BASE_NODE, facWithPred, LCM_NODE, CAP_NODE].map((n) => [n.id, n]),
        ),
      }),
    });
    // The exposure pill humanizes an undeclared field (building_limit
    // is not in PICKER_ITEMS): underscores never reach the surface.
    expect(
      screen.getByTestId("rater-buildup-sheet-expo-tower_bld"),
    ).toHaveTextContent("Rated per $100 of building limit");
    // The predicate chip uses the DECLARED display name (sqft →
    // "Square footage").
    expect(
      screen.getByText("applies when Square footage is 100"),
    ).toBeInTheDocument();
  });

  it("R2 (D-G): a boolean predicate renders the true/false segmented control", () => {
    const facWithPred: TowerNode = {
      ...FACTOR_NODE,
      ref: {
        kind: "factor-table",
        tableId: "construction_factor",
        predicate: { path: "form_input.sprinklered", equals: true },
      },
    };
    const { onPlanChange } = setup({
      plan: makePlan({
        nodes: new Map(
          [BASE_NODE, facWithPred, LCM_NODE, CAP_NODE].map((n) => [n.id, n]),
        ),
      }),
    });
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    expect(
      screen.getByTestId("rater-buildup-sheet-insp-predicate-true"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-insp-predicate-false"),
    );
    const next = onPlanChange.mock.calls[0]![0] as TowerPlan;
    expect(next.nodes.get("n_fac")!.ref).toMatchObject({
      predicate: { path: "form_input.sprinklered", equals: false },
    });
  });
});

// ── v4 G6 — predicate rendering (the row editor's APPLIES control) ──
describe("<BuildUpSheet> — predicate rendering (v4 G6 / G7-full)", () => {
  function planWithPredicate(
    predicate: { path: string; equals: boolean | number | string },
  ): TowerPlan {
    const facWithPred: TowerNode = {
      ...FACTOR_NODE,
      ref: {
        kind: "factor-table",
        tableId: "construction_factor",
        predicate,
      },
    };
    return makePlan({
      nodes: new Map(
        [BASE_NODE, facWithPred, LCM_NODE, CAP_NODE].map((n) => [n.id, n]),
      ),
    });
  }

  it("a STRING-equality predicate carries NO unpriced qualifier (G7-full: it gates now)", () => {
    setup({
      plan: planWithPredicate({
        path: "form_input.class",
        equals: "restaurant",
      }),
    });
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    // No editor warning…
    expect(
      screen.queryByTestId("rater-buildup-sheet-insp-predicate-warn-string"),
    ).not.toBeInTheDocument();
    // …and the card chip is a plain condition, no "(not yet priced)".
    expect(
      screen.getByText(/applies when class is restaurant$/),
    ).toBeInTheDocument();
  });

  it("a predicate over a two-axis (dual-input) table carries NO warning (G7-full)", () => {
    setup({
      plan: planWithPredicate({ path: "form_input.sprinklered", equals: true }),
      factorTableMeta: new Map([
        [
          "construction_factor",
          {
            title: "Deductible × limit band",
            keyDims: ["deductible", "limit_band"],
          },
        ],
      ]),
    });
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-insp-predicate-warn-2d"),
    ).not.toBeInTheDocument();
  });

  it("a boolean predicate over a 1-axis table carries no warning (unchanged)", () => {
    setup({
      plan: planWithPredicate({ path: "form_input.sprinklered", equals: true }),
    });
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-steps-tower_bld-row-n_fac"),
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-insp-predicate-warn-string"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-buildup-sheet-insp-predicate-warn-2d"),
    ).not.toBeInTheDocument();
  });
});

describe("<BuildUpSheet> — Brief 89 R5: the picker finishes the sentence", () => {
  function openPickerWithQuery(query: string, over: Record<string, unknown> = {}) {
    const result = setup(over);
    fireEvent.click(
      screen.getByTestId("rater-buildup-sheet-add-step-tower_bld"),
    );
    fireEvent.change(screen.getByLabelText("Search steps"), {
      target: { value: query },
    });
    return result;
  }

  it("a no-match query grows CREATE rows instead of the full stop", () => {
    const onCreateFactorTable = vi.fn();
    const onDeclareInput = vi.fn();
    openPickerWithQuery("construction", {
      onCreateFactorTable,
      onDeclareInput,
    });
    expect(
      screen.getByText('Nothing named "construction" in this plan yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-buildup-sheet-create-table"),
    ).toHaveTextContent('Factor table "construction"');
    expect(
      screen.getByTestId("rater-buildup-sheet-create-input"),
    ).toHaveTextContent('Input "construction"');
  });

  it("Factor table \"…\" fires the create hook with the typed name + the waiting tower, then dismisses", () => {
    const onCreateFactorTable = vi.fn();
    openPickerWithQuery("Construction class", { onCreateFactorTable });
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-create-table"));
    expect(onCreateFactorTable).toHaveBeenCalledWith(
      "Construction class",
      "tower_bld",
    );
    expect(
      screen.queryByTestId("rater-buildup-sheet-picker"),
    ).not.toBeInTheDocument();
  });

  it("Input \"…\" declares with the picked type — and ONLY declares (no phantom step: a submission-field node would fold into the chain's exposure on save)", () => {
    const onDeclareInput = vi.fn();
    const { onPlanChange } = openPickerWithQuery("Year built", {
      onDeclareInput,
    });
    // Pick "Text" on the inline type segment, then create.
    fireEvent.click(screen.getByRole("radio", { name: "Text" }));
    fireEvent.click(screen.getByTestId("rater-buildup-sheet-create-input"));
    expect(onDeclareInput).toHaveBeenCalledWith({
      fieldName: "year_built",
      displayName: "Year built",
      dtype: "string",
    });
    expect(onPlanChange).not.toHaveBeenCalled();
    // The picker closed — the declared row is the artifact.
    expect(
      screen.queryByTestId("rater-buildup-sheet-picker"),
    ).not.toBeInTheDocument();
  });

  it("read-only (or hookless) keeps the old full stop", () => {
    openPickerWithQuery("construction");
    expect(
      screen.getByText('Nothing matches "construction".'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-buildup-sheet-create-table"),
    ).not.toBeInTheDocument();
  });
});
