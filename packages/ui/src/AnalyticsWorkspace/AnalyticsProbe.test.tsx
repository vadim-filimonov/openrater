/**
 * Brief 89 §3 (89.3) exhibits + Brief 93 (93.1) — the probe-built
 * exhibits (rate card / structural drivers / probe book) score
 * through the REAL engine with honest degrades, and the PLAN REPORT
 * composes them as Analytics' landing view: the walked reference
 * risk, the counted lede, the R4 boundary as a closing line, and the
 * Book view behind its gate.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";

import { AnalyticsWorkspaceV2 } from "./AnalyticsWorkspaceV2";
import { PlanReport } from "./PlanReport";
import { ProbeBookCard, type ProbeBookState } from "./ProbeBookCard";
import { RateCardExhibit } from "./RateCardExhibit";
import { StructuralDrivers } from "./StructuralDrivers";
import type { ProbeReadout, StructuralDriver } from "./probe-math";
import type { DimensionRow } from "../DimensionsTable";
import type { ScoredBatchResult } from "./exhibit-math";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base × 1.10 × 0.95 × 1.32 = base × 1.3794 → "premium" (the V3 fixture). */
const PLAN: Plan = {
  id: "test.probe-card",
  version: "1.0.0",
  name: "Probe card test",
  line: "bop",
  effective: "2026-01-01",
  nodes: [
    {
      id: "in_base",
      kind: "input",
      params: { fieldName: "base", fieldType: "money" },
    },
    { id: "k_lcm", kind: "constant", params: { value: 1.1, type: "factor" } },
    { id: "k_disc", kind: "constant", params: { value: 0.95, type: "factor" } },
    { id: "k_load", kind: "constant", params: { value: 1.32, type: "factor" } },
    { id: "mul", kind: "chain.mult", params: { stopOnZero: false } },
    {
      id: "out_p",
      kind: "output",
      params: { fieldName: "premium", fieldType: "money" },
    },
  ],
  edges: [
    {
      from: { node: "in_base", port: "value" },
      to: { node: "mul", port: "base" },
    },
    {
      from: { node: "k_lcm", port: "value" },
      to: { node: "mul", port: "factors" },
    },
    {
      from: { node: "k_disc", port: "value" },
      to: { node: "mul", port: "factors" },
    },
    {
      from: { node: "k_load", port: "value" },
      to: { node: "mul", port: "factors" },
    },
    {
      from: { node: "mul", port: "result" },
      to: { node: "out_p", port: "value" },
    },
  ],
};

/** A banded dim whose slug IS the plan's input field — the axis
 *  overrides `base` with each level's raw lo (the rep-value shape). */
const BASE_BAND: DimensionRow = {
  id: "base",
  slug: "base",
  display_name: "Base band",
  data_type: "number",
  shape: "banded",
  levels: [
    { kind: "banded", id: "b1", label: "$1,000", lo: 1000, hi: 2000 },
    { kind: "banded", id: "b2", label: "$2,000", lo: 2000, hi: 3000 },
  ],
} as unknown as DimensionRow;

const CARD_PROPS = {
  plan: PLAN,
  stages: [],
  dimensions: [BASE_BAND],
  factorTables: [],
};

describe("<RateCardExhibit> (R9 B1)", () => {
  it("scores the axis levels through the real engine and renders dollar cells", () => {
    render(<RateCardExhibit {...CARD_PROPS} />);
    // 1000 × 1.3794 = $1,379 ; 2000 × 1.3794 = $2,759 (banded lo values).
    expect(screen.getByText("$1,379")).toBeInTheDocument();
    expect(screen.getByText("$2,759")).toBeInTheDocument();
    // One-axis card: the single value column.
    expect(screen.getByText("Premium")).toBeInTheDocument();
  });

  it("exports the scored card as CSV through the consumer callback", () => {
    const onExportCsv = vi.fn();
    render(<RateCardExhibit {...CARD_PROPS} onExportCsv={onExportCsv} />);
    fireEvent.click(screen.getByTestId("rater-rate-card-export"));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
    const [filename, csv] = onExportCsv.mock.calls[0]! as [string, string];
    expect(filename).toBe("rate-card-base.csv");
    expect(csv).toContain("Base band,premium");
    expect(csv).toContain("1379.4");
  });

  it("a gate-declined cell shows the verdict, not the indicative number (B1 — the verdict outranks dollars)", () => {
    const gated: Plan = {
      ...PLAN,
      nodes: [
        ...PLAN.nodes,
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: [
              {
                op: "eq",
                rule_id: "r1",
                tier: "decline",
                value: 2000,
                variable: "base",
                reasoning: "No appetite at this base.",
              },
            ],
            default_tier: "standard",
            default_reasoning: "OK.",
          },
        },
      ],
    };
    render(<RateCardExhibit {...CARD_PROPS} plan={gated} />);
    // $1,000 row still prices; the $2,000 row declines visibly.
    expect(screen.getByText("$1,379")).toBeInTheDocument();
    expect(screen.queryByText("$2,759")).toBeNull();
    expect(screen.getByText(/Decline/)).toBeInTheDocument();
  });

  it("degrades honestly: no rating chain → author-a-step line", () => {
    render(<RateCardExhibit {...CARD_PROPS} plan={null} />);
    expect(screen.getByTestId("rater-rate-card-no-chain")).toHaveTextContent(
      /can't rate anything yet/,
    );
  });

  it("degrades honestly: no keyable dims → author-a-dimension line", () => {
    render(<RateCardExhibit {...CARD_PROPS} dimensions={[]} />);
    expect(screen.getByTestId("rater-rate-card-no-axes")).toHaveTextContent(
      /needs a dimension with levels/,
    );
  });
});

describe("<StructuralDrivers> (R9 B2)", () => {
  const DRIVERS: readonly StructuralDriver[] = [
    {
      id: "tiv",
      label: "TIV band",
      swing: 2,
      spreadMin: 0.8,
      spreadMax: 1.6,
      tableCount: 1,
      flat: false,
    },
    {
      id: "constr",
      label: "Construction",
      swing: 1.54,
      spreadMin: 0.65,
      spreadMax: 1,
      tableCount: 1,
      flat: false,
    },
    {
      id: "rev",
      label: "Annual revenue",
      swing: null,
      spreadMin: null,
      spreadMax: null,
      tableCount: 0,
      flat: true,
    },
  ];

  it("renders ranked min→max swing bands (93.2) and the flat note", () => {
    render(<StructuralDrivers drivers={DRIVERS} />);
    expect(
      screen.getByLabelText("TIV band — swings premium 0.80× to 1.60×"),
    ).toBeInTheDocument();
    expect(screen.getByText("0.65× – 1.00×")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-structural-drivers-flat"),
    ).toHaveTextContent("Annual revenue — carries no authored spread yet");
  });

  it("empty state names the fix", () => {
    render(<StructuralDrivers drivers={[DRIVERS[2]!]} />);
    expect(
      screen.getByTestId("rater-structural-drivers-empty"),
    ).toHaveTextContent(/No authored spread yet/);
  });
});

describe("<PlanReport> (Brief 93 §1.1)", () => {
  /** PLAN, with the base input carrying a default — the projector
   *  injects base the same way (options.defaults), so the report's
   *  reference risk rates without a stored row. */
  const WALK_PLAN: Plan = {
    ...PLAN,
    nodes: PLAN.nodes.map((n) =>
      n.id === "in_base"
        ? {
            ...n,
            label: "Base rate",
            params: {
              fieldName: "base",
              fieldType: "money",
              defaultValue: 1000,
            },
          }
        : n,
    ),
  };

  it("walks the reference risk through the real engine to the exact premium", () => {
    render(
      <PlanReport
        planLabel="Probe plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={WALK_PLAN}
        hasBook={false}
      />,
    );
    expect(screen.getByText("Plan report")).toBeInTheDocument();
    // 1000 (band lo) × 1.1 × 0.95 × 1.32 = 1379.40 — engine-exact.
    expect(screen.getByTestId("rater-plan-report-walk")).toBeInTheDocument();
    expect(screen.getAllByText("$1,379.40").length).toBeGreaterThan(0);
    expect(screen.getByText("× 1.1")).toBeInTheDocument();
    expect(screen.getByText("× 0.95")).toBeInTheDocument();
    expect(screen.getByText("× 1.32")).toBeInTheDocument();
  });

  it("the counted lede is a deterministic template over the substrate", () => {
    render(
      <PlanReport
        planLabel="Lede plan"
        productLabel="Businessowners"
        stateLabel="Kansas"
        stages={[
          { stage_id: "s1", stage_kind: "input_node", display_name: "TIV" },
          {
            stage_id: "s2",
            stage_kind: "multiplicative_chain",
            display_name: "Chain",
            // MVP-013 — the lede states the public counting (the
            // Rating tab's rows), so the chain carries real structure:
            // base + 1 factor = 2 steps across 1 chain.
            config_json: {
              output_total_field: "premium",
              chains: [
                {
                  name: "building premium",
                  base_value: 0.5,
                  output_field: "building_premium",
                  factor_lookups: [{ name: "cls", factor_kind: "cls" }],
                },
              ],
            },
          },
          {
            stage_id: "s3",
            stage_kind: "eligibility.gate",
            display_name: "Gate",
          },
        ]}
        dimensions={[]}
        factorTables={[{ id: "ft1" } as never]}
        plan={null}
        workbookBuilt
        hasBook={false}
      />,
    );
    const lede = screen.getByTestId("rater-plan-report-lede");
    expect(lede).toHaveTextContent("Lede plan rates Businessowners in Kansas");
    expect(lede).toHaveTextContent("2 steps across 1 chain");
    expect(lede).toHaveTextContent("1 application input");
    expect(lede).toHaveTextContent("1 factor table carries the rates");
    expect(lede).toHaveTextContent("1 eligibility rule can decline a risk");
    expect(lede).toHaveTextContent("Built from a transcribed workbook");
    // plan: null → the cost section degrades to its author line.
    expect(
      screen.getByText(/needs a rating step before it can cost a policy/),
    ).toBeInTheDocument();
  });

  it("gates section (93.2): stated rules with tier chips + the default line; no rules says so honestly", () => {
    const { rerender } = render(
      <PlanReport
        planLabel="Gated plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={null}
        hasBook={false}
        gates={[
          {
            id: "r1",
            text: "Construction class is Fire Resistive",
            tier: "decline",
          },
          { id: "r2", text: "Year built is less than 1,950", tier: "submit" },
        ]}
        defaultTierLabel="Standard"
      />,
    );
    const sec = screen.getByTestId("rater-plan-report-gates");
    expect(sec).toHaveTextContent("Where the plan says no");
    expect(sec).toHaveTextContent("when Construction class is Fire Resistive");
    expect(sec).toHaveTextContent("when Year built is less than 1,950");
    // Outcomes ride the canonical TierVerdictChip (tier's own label).
    expect(sec).toHaveTextContent("Decline");
    expect(sec).toHaveTextContent("Submit");
    expect(sec).toHaveTextContent("Everything else rates Standard");

    rerender(
      <PlanReport
        planLabel="Gateless plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={null}
        hasBook={false}
        gates={[]}
      />,
    );
    expect(screen.getByTestId("rater-plan-report-no-gates")).toHaveTextContent(
      /No eligibility rules — every risk rates/,
    );
  });

  it("the boundary closes the page (R4): inputs door bookless, Book door with data", () => {
    const onOpenInputs = vi.fn();
    const { rerender } = render(
      <PlanReport
        planLabel="Probe plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={PLAN}
        hasBook={false}
        onOpenInputs={onOpenInputs}
      />,
    );
    const boundary = screen.getByTestId("rater-plan-report-boundary");
    expect(boundary).toHaveTextContent(/need your real book/);
    fireEvent.click(screen.getByText("connect one in Inputs"));
    expect(onOpenInputs).toHaveBeenCalledTimes(1);

    const onOpenBook = vi.fn();
    rerender(
      <PlanReport
        planLabel="Probe plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={PLAN}
        hasBook={true}
        onOpenBook={onOpenBook}
      />,
    );
    expect(screen.getByTestId("rater-plan-report-boundary")).toHaveTextContent(
      /scored book .* lives under/,
    );
    fireEvent.click(screen.getByTestId("rater-plan-report-open-book"));
    expect(onOpenBook).toHaveBeenCalledTimes(1);
  });
});

describe("<ProbeBookCard> (89.4 B3)", () => {
  const READOUT: ProbeReadout = {
    total: 40,
    priced: 30,
    declined: 8,
    errors: 2,
    premiumMin: 1138,
    premiumMax: 2430,
    crossCells: 12,
    baseDeclined: false,
    variables: [
      {
        inputKey: "construction_class",
        cells: 3,
        premiumMin: 1138,
        premiumMax: 1751,
        swing: 1751 / 1138,
        declined: 8,
        declinedValues: [{ value: "Fire Resistive", count: 8 }],
      },
      {
        inputKey: "tiv",
        cells: 5,
        premiumMin: null,
        premiumMax: null,
        swing: null,
        declined: 0,
        declinedValues: [],
      },
    ],
  };

  it("idle: names the planned sweep and fires onGenerate", () => {
    const onGenerate = vi.fn();
    render(
      <ProbeBookCard
        state={{ phase: "idle", plannedCells: 42, plannedVariables: 3 }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByText("42 cells")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-probe-book-generate"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("done: range, decline share, gate clusters, observed swing, provenance + stale regenerate", () => {
    const onGenerate = vi.fn();
    render(
      <ProbeBookCard
        state={{
          phase: "done",
          readout: READOUT,
          labels: new Map([["construction_class", "Construction class"]]),
          metaLabel: "Probe run · 40 cells · draft@ab12cd34 · Jul 13",
          stale: true,
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByTestId("rater-probe-book-range")).toHaveTextContent(
      "$1,138 – $2,430",
    );
    expect(screen.getByTestId("rater-probe-book-declined")).toHaveTextContent(
      "20%",
    );
    expect(screen.getByText("8 of 40 cells")).toBeInTheDocument();
    expect(screen.getByText("2 cannot be rated")).toBeInTheDocument();
    // The gate cluster names the variable BY LABEL and the value.
    expect(screen.getByTestId("rater-probe-book-clusters")).toHaveTextContent(
      "Construction class = Fire Resistive → 8 cells declined",
    );
    // Observed swing bars: the labeled variable renders; flat one noted.
    expect(
      screen.getByLabelText(/Construction class — observed swing 1\.54 times/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 variable showed no premium spread in this sweep."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rater-probe-book-stale")).toHaveTextContent(
      "plan changed since this probe",
    );
    fireEvent.click(screen.getByTestId("rater-probe-book-regenerate"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("a declining base names itself", () => {
    render(
      <ProbeBookCard
        state={{
          phase: "done",
          readout: { ...READOUT, baseDeclined: true },
          labels: new Map(),
          metaLabel: "Probe run",
          stale: false,
        }}
      />,
    );
    expect(
      screen.getByTestId("rater-probe-book-base-declined"),
    ).toHaveTextContent(/representative risk itself declines/);
    expect(screen.queryByTestId("rater-probe-book-stale")).toBeNull();
  });

  it("empty and error states degrade honestly", () => {
    const { rerender } = render(
      <ProbeBookCard
        state={{ phase: "empty", reason: "Needs a rating step first." }}
      />,
    );
    expect(screen.getByTestId("rater-probe-book-empty")).toHaveTextContent(
      "Needs a rating step first.",
    );
    const state: ProbeBookState = {
      phase: "error",
      message: "The probe run failed — regenerate to re-score.",
    };
    rerender(<ProbeBookCard state={state} onGenerate={vi.fn()} />);
    expect(screen.getByTestId("rater-probe-book-error")).toHaveTextContent(
      /failed/,
    );
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });
});

describe("<PlanReport> embedded exhibits (Brief 93 §1.1.5/.7)", () => {
  it("verified filing examples REPLACE the probe book (93.3, R5): verdict + table + honesty cap", () => {
    render(
      <PlanReport
        planLabel="Workbook plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={null}
        hasBook={false}
        probeBookSlot={<div data-testid="probe-book-content">book</div>}
        verifiedExamples={{
          verdict: "40 of 40 checks reproduce the filing exactly",
          tone: "success",
          rows: [
            {
              id: "c1:total_premium:0",
              label: "Restaurant · territory 1",
              expected: "4,112",
              actual: "4,112",
              delta: "0",
              status: "match",
            },
          ],
          moreCount: 39,
          builtAt: "2026-07-14T12:00:00+00:00",
        }}
      />,
    );
    expect(screen.getByTestId("rater-plan-report-verdict")).toHaveTextContent(
      "40 of 40 checks reproduce the filing exactly",
    );
    const table = screen.getByTestId("rater-plan-report-ex-table");
    // FCA #19/#20 — the expected column is the workbook's test case,
    // not a number the filing necessarily prints.
    expect(table).toHaveTextContent("Expected (test case)");
    expect(table).toHaveTextContent("Restaurant · territory 1");
    // The probe book yields to the verified variant…
    expect(screen.queryByTestId("probe-book-content")).toBeNull();
    // …and the cap + provenance are stated, never silent.
    expect(
      screen.getByText(/\+39 more — the build report on Overview/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Verified at build, 2026-07-14/),
    ).toBeInTheDocument();
  });

  it("renders the rate card and worked-examples sections around the consumer slots", () => {
    render(
      <PlanReport
        planLabel="Probe plan"
        stages={[]}
        dimensions={[BASE_BAND]}
        factorTables={[]}
        plan={PLAN}
        hasBook={false}
        rateCardSlot={<div data-testid="card-content">card</div>}
        probeBookSlot={<div data-testid="probe-book-content">book</div>}
      />,
    );
    expect(screen.getByText("The rate card")).toBeInTheDocument();
    expect(screen.getByTestId("card-content")).toBeInTheDocument();
    expect(screen.getByText("Worked examples")).toBeInTheDocument();
    expect(screen.getByTestId("probe-book-content")).toBeInTheDocument();
    // The drivers section speaks the R10 boundary once, in its head.
    expect(
      screen.getByText("from the plan's tables — unweighted by any book"),
    ).toBeInTheDocument();
  });
});

describe("<AnalyticsWorkspaceV2> report/book views (Brief 93 §1.3)", () => {
  const PREMIUM = "premium";
  const scored = (): ScoredBatchResult => ({
    scoredAt: "2026-07-13T00:00:00Z",
    rowCount: 2,
    premiumColumn: PREMIUM,
    rows: [
      { inputs: { cls: "a" }, outputs: { [PREMIUM]: 100 } },
      { inputs: { cls: "b" }, outputs: { [PREMIUM]: 200 } },
    ],
  });
  const baseProps = {
    hasSnapshots: false,
    hasGeographicDim: false,
    onFreezeVersion: vi.fn(),
    variables: [],
    premiumColumn: PREMIUM,
    planLabel: "Report plan",
    snapshots: [],
    onExport: vi.fn(),
  } as const;

  it("the report is the landing view — it renders alone, no band, no acts (R1/R2)", () => {
    render(
      <AnalyticsWorkspaceV2
        {...baseProps}
        hasScoredResult={true}
        scoredResult={scored()}
        reportSlot={<div data-testid="report-content">report</div>}
        view="report"
        onViewChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("rater-analytics-report")).toBeInTheDocument();
    expect(screen.getByTestId("report-content")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-analytics-band")).toBeNull();
    expect(screen.queryByTestId("rater-analytics-act-overview")).toBeNull();
  });

  it("the Book view gates on a scored result — bookless view='book' still shows the report", () => {
    render(
      <AnalyticsWorkspaceV2
        {...baseProps}
        hasScoredResult={false}
        scoredResult={null}
        reportSlot={<div data-testid="report-content">report</div>}
        view="book"
        onViewChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("report-content")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-analytics-band")).toBeNull();
  });

  it("view='book' with data renders the acts + the Report way back; the book carries no rate card", () => {
    const onViewChange = vi.fn();
    render(
      <AnalyticsWorkspaceV2
        {...baseProps}
        hasScoredResult={true}
        scoredResult={scored()}
        variables={[
          { id: "cls", label: "Class", kind: "categorical", column: "cls" },
        ]}
        reportSlot={<div>report never shows here</div>}
        view="book"
        onViewChange={onViewChange}
      />,
    );
    expect(screen.getByTestId("rater-analytics-band")).toBeInTheDocument();
    expect(screen.queryByText("report never shows here")).toBeNull();
    // Brief 93 — the rate card lives on the report, not the book.
    expect(screen.queryByTestId("rater-analytics-rate-card")).toBeNull();
    fireEvent.click(screen.getByTestId("rater-analytics-act-report"));
    expect(onViewChange).toHaveBeenCalledWith("report");
  });
});
