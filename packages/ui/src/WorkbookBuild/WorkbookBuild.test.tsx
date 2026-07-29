/**
 * WorkbookBuild tests — Brief 92 scenes 2–5.
 *
 * Covers the flow's contract:
 *
 *   1. The drop scene states the zero-AI posture + the spec hand-off.
 *   2. A dirty check renders the cell-addressed, rule-numbered report
 *      grouped by sheet, and Build stays disabled.
 *   3. A clean check renders the dry-run manifest (provenance chips +
 *      count tiles) and enables Build.
 *   4. Build → the report scene (verdict + vectors + gaps) + Open the
 *      plan fires with the new plan id.
 *   5. Duplicate awareness surfaces "Open the existing plan".
 *   6. BuildReportView folds all-matching vectors and tints misses.
 *
 * The api-client seam is mocked — endpoint coverage lives in the
 * backend suite (tests/test_ingest_*.py).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BuildReportView } from "./BuildReportView";
import { buildPinsCaption } from "../AnalyticsWorkspace/PlanReport";
import { formatVectorDelta } from "./vectorDelta";
import {
  WorkbookBuildPanel,
  checkFailedHeadline,
  citationLine,
  groupIssuesBySheet,
  manifestTiles,
} from "./WorkbookBuildPanel";
import type {
  BuildReportLike as BuildReport,
  BuildWorkbookFn,
  BuildWorkbookResponseLike as BuildWorkbookResponse,
  CheckWorkbookFn,
  WorkbookCheckResultLike as WorkbookCheckResult,
} from "./types";

// The two operations are injected props (labs-ui never talks HTTP);
// these stand in for api-client's checkWorkbook / buildWorkbookPlan.
const mockedCheck = vi.fn<CheckWorkbookFn>();
const mockedBuild = vi.fn<BuildWorkbookFn>();

const MANIFEST = {
  provenance: {
    carrier: "Demo Mutual",
    product: "do",
    state: null,
    effective_date: "2026-05-25",
    serff_tracking_number: null,
    display_name: "Nonprofit 990",
  },
  counts: {
    dimensions: 7,
    dimension_levels: 105,
    factor_tables: 11,
    factor_cells: 199,
    factor_cells_cited: 184,
    chains: 2,
    chain_stages: 15,
    gates: 6,
    modifier_categories: 2,
    endorsements: 2,
    loadings: 1,
    final_adjustments: 1,
    outputs: 3,
    inputs: 7,
    inputs_with_defaults: 2,
    test_cases: 20,
    geo_rows: 0,
    declared_gaps: 5,
  },
  gap_kinds: { unsupported: 3, assumption: 1, gap: 1 },
};

const CLEAN: WorkbookCheckResult = {
  ok: true,
  spec_version: "1.0",
  workbook_hash: "abc123",
  filename: "demo.xlsx",
  sheet_count: 22,
  errors: [],
  warnings: [],
  notices: [],
  manifest: MANIFEST,
  already_built: null,
};

const DIRTY: WorkbookCheckResult = {
  ...CLEAN,
  ok: false,
  manifest: null,
  errors: [
    {
      rule: "R-104",
      severity: "error",
      sheet: "ft.limit_factor",
      cell: "B9",
      message: "Row key '5000' isn't a level of dimension 'limit'.",
    },
    {
      rule: "R-020",
      severity: "error",
      sheet: null,
      cell: null,
      message: "Required sheet 'inputs' is missing.",
    },
  ],
  warnings: [
    {
      rule: "R-201",
      severity: "warning",
      sheet: "ft.limit_factor",
      cell: null,
      message: "No citation_rule — where does this table come from?",
    },
  ],
};

const REPORT: BuildReport = {
  report_id: "br_1",
  rating_plan_id: "do_multi_blank_1234",
  workbook_hash: "abc123",
  filename: "demo.xlsx",
  spec_version: "1.0",
  workbook_plan_id: "nonprofit-do-gl-multi-2026",
  manifest: MANIFEST,
  issues: [
    {
      rule: "R-203",
      severity: "notice",
      sheet: "README",
      cell: null,
      message: "Sheet 'README' is not a data sheet — ignored.",
    },
  ],
  vectors: {
    status: "ran",
    detail: null,
    total_cases: 2,
    matched: 3,
    near: 0,
    mismatched: 1,
    checks: [
      {
        case_id: "np_001",
        name: "Faith Community Church",
        field: "do_premium",
        expected: 658,
        actual: 657.92,
        delta: -0.08,
        status: "match",
        detail: null,
      },
      {
        case_id: "np_001",
        name: "Faith Community Church",
        field: "tier",
        expected: "standard",
        actual: "standard",
        delta: null,
        status: "match",
        detail: null,
      },
      {
        case_id: "np_002",
        name: "Riverside",
        field: "gl_premium",
        expected: 525,
        actual: 525.0,
        delta: 0,
        status: "match",
        detail: null,
      },
      {
        case_id: "np_016",
        name: "Restaurant",
        field: "total_premium",
        expected: 2847,
        actual: 2633,
        delta: -214,
        status: "mismatch",
        detail: null,
      },
    ],
  },
  gaps: [
    {
      kind: "unsupported",
      description: "Ratios arrive pre-computed.",
      impact: "Datasets must supply expense_ratio.",
    },
  ],
  created_at: "2026-07-14T12:00:00Z",
};

const BUILT: BuildWorkbookResponse = {
  rating_plan_id: "do_multi_blank_1234",
  display_name: "Nonprofit 990 — D&O + GL — v1",
  report: REPORT,
};

function dropFile(container: HTMLElement, name = "demo.xlsx") {
  const input = container.querySelector('input[type="file"]')!;
  const file = new File([new Uint8Array([1, 2, 3])], name);
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  mockedCheck.mockReset();
  mockedBuild.mockReset();
});

const KIT = {
  spec: "http://api.test/assets/spec",
  template: "http://api.test/assets/template",
  example: "http://api.test/assets/example",
};

describe("WorkbookBuildPanel (Brief 92)", () => {
  const noop = () => {};

  it("states the posture + offers the starter kit on the drop scene", () => {
    render(
      <WorkbookBuildPanel checkWorkbook={mockedCheck} buildWorkbook={mockedBuild} onStartBlank={noop} onCancel={noop} onOpenPlan={noop} assetUrls={KIT} />,
    );
    expect(
      screen.getByText(/no AI, no guessing/i),
    ).toBeTruthy();
    // Brief 94 §2 (U1) — the empty-hands fix: three real downloads,
    // never an un-clickable repo path.
    expect(
      screen.getByRole("link", { name: /format spec/i }),
    ).toHaveAttribute("href", KIT.spec);
    expect(
      screen.getByRole("link", { name: /template workbook/i }),
    ).toHaveAttribute("href", KIT.template);
    expect(
      screen.getByRole("link", { name: /worked example/i }),
    ).toHaveAttribute("href", KIT.example);
    expect(screen.queryByText(/docs\/specs\//)).toBeNull();
    expect(screen.getByText("Start blank instead")).toBeTruthy();
  });

  it("renders a dirty check as a sheet-grouped, rule-numbered report with Build disabled", async () => {
    mockedCheck.mockResolvedValueOnce(DIRTY);
    const { container } = render(
      <WorkbookBuildPanel checkWorkbook={mockedCheck} buildWorkbook={mockedBuild} onStartBlank={noop} onCancel={noop} onOpenPlan={noop} assetUrls={KIT} />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(screen.getByText(/didn't pass the check/)).toBeTruthy(),
    );
    expect(screen.getByText(/2 errors, 1 warning/)).toBeTruthy();
    expect(screen.getByText("ft.limit_factor")).toBeTruthy();
    expect(screen.getByText("B9")).toBeTruthy();
    expect(screen.getByText("R-104")).toBeTruthy();
    const build = screen.getByRole("button", { name: "Build the plan" });
    expect((build as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Drop a corrected workbook")).toBeTruthy();
  });

  it("renders the dry-run manifest for a clean check and builds to the report", async () => {
    mockedCheck.mockResolvedValueOnce(CLEAN);
    mockedBuild.mockResolvedValueOnce(BUILT);
    const onOpenPlan = vi.fn();
    const { container } = render(
      <WorkbookBuildPanel
        checkWorkbook={mockedCheck}
        buildWorkbook={mockedBuild}
        onStartBlank={noop}
        onCancel={noop}
        onOpenPlan={onOpenPlan}
        assetUrls={KIT}
      />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(screen.getByText(/22 sheets · spec 1.0/)).toBeTruthy(),
    );
    expect(screen.getByText("Demo Mutual")).toBeTruthy();
    expect(
      screen.getByText(/factor tables · 199 cells/),
    ).toBeTruthy();
    expect(
      screen.getByText(/5 items flagged by the transcriber ride along/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Build the plan" }));
    await waitFor(() =>
      expect(screen.getByText(/Plan created as a draft/)).toBeTruthy(),
    );
    expect(mockedBuild).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open the plan" }));
    expect(onOpenPlan).toHaveBeenCalledWith("do_multi_blank_1234");
  });

  it("surfaces duplicate awareness with an open-existing affordance", async () => {
    const openExisting = vi.fn();
    mockedCheck.mockResolvedValueOnce({
      ...CLEAN,
      already_built: {
        rating_plan_id: "do_multi_blank_prior",
        report_id: "br_0",
        created_at: "2026-07-13T00:00:00Z",
      },
    });
    const { container } = render(
      <WorkbookBuildPanel
        checkWorkbook={mockedCheck}
        buildWorkbook={mockedBuild}
        onStartBlank={noop}
        onCancel={noop}
        onOpenPlan={openExisting}
        assetUrls={KIT}
      />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(screen.getByText(/was already built/)).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Open the existing plan/ }),
    );
    expect(openExisting).toHaveBeenCalledWith("do_multi_blank_prior");
  });
});

describe("BuildReportView", () => {
  it("renders verdict, tints mismatches, and echoes the gaps", () => {
    render(<BuildReportView report={REPORT} />);
    // FCA #19 — the ONE shared verdict vocabulary; a mismatch leads.
    expect(
      screen.getByText(/3 of 4 checks reproduce the filing — 1 MISMATCHED/),
    ).toBeTruthy();
    expect(screen.getByText("np_016").closest("tr")!.className).toContain(
      "miss",
    );
    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(screen.getByText(/Datasets must supply expense_ratio/)).toBeTruthy();
    expect(screen.getByText(/not a data sheet/)).toBeTruthy();
  });

  it("folds an all-matching table down to a summary line", () => {
    const allMatch: BuildReport = {
      ...REPORT,
      vectors: {
        ...REPORT.vectors,
        mismatched: 0,
        matched: 4,
        checks: REPORT.vectors.checks.map((c): typeof c => ({
          ...c,
          status: "match" as const,
          delta: 0,
        })),
      },
    };
    render(<BuildReportView report={allMatch} />);
    expect(
      screen.getByText(/4 of 4 checks reproduce the filing exactly/),
    ).toBeTruthy();
    expect(screen.getByText(/2 more, all matching/)).toBeTruthy();
  });

  it("FCA #19 — names eligibility rules no test case exercises, and stays quiet at full coverage", () => {
    const partial: BuildReport = {
      ...REPORT,
      vectors: {
        ...REPORT.vectors,
        gate_rules_total: 2,
        gate_rules_exercised: 1,
        unexercised_gate_rules: ["decline_big"],
      },
    };
    const { rerender } = render(<BuildReportView report={partial} />);
    expect(
      screen.getByText(/1 of 2 eligibility rules exercised/),
    ).toBeTruthy();
    expect(screen.getByText(/decline_big/)).toBeTruthy();

    rerender(
      <BuildReportView
        report={{
          ...REPORT,
          vectors: {
            ...REPORT.vectors,
            gate_rules_total: 2,
            gate_rules_exercised: 2,
            unexercised_gate_rules: [],
          },
        }}
      />,
    );
    expect(screen.queryByText(/eligibility rules exercised/)).toBeNull();
  });
});

describe("pure helpers", () => {
  it("groupIssuesBySheet keeps first-seen order and buckets sheetless issues", () => {
    const groups = groupIssuesBySheet([...DIRTY.errors, ...DIRTY.warnings]);
    expect(groups.map((g) => g.sheet)).toEqual([
      "ft.limit_factor",
      "(workbook)",
    ]);
    expect(groups[0]!.issues).toHaveLength(2);
  });

  it("checkFailedHeadline pluralizes honestly", () => {
    expect(checkFailedHeadline(DIRTY)).toBe(
      "The workbook didn't pass the check — 2 errors, 1 warning.",
    );
  });

  it("manifestTiles = the eight base tiles + render-if-nonzero extras (Brief 94 U5)", () => {
    const tiles = manifestTiles(CLEAN);
    // 8 base + endorsements(2) + modifier categories(2) + loading(1) +
    // final adjustment(1); geo_rows: 0 stays hidden.
    expect(tiles).toHaveLength(12);
    expect(tiles[1]).toEqual({
      value: "11",
      label: "factor tables · 199 cells",
    });
    expect(tiles.some((t) => t.label.includes("geo row"))).toBe(false);
  });
});

describe("WorkbookBuildPanel (Brief 94 — flow polish)", () => {
  const noop = () => {};
  const panel = (
    <WorkbookBuildPanel
      checkWorkbook={mockedCheck}
      buildWorkbook={mockedBuild}
      onStartBlank={noop}
      onCancel={noop}
      onOpenPlan={noop}
      assetUrls={KIT}
    />
  );

  it("refuses a non-.xlsx in place — zero network (U3)", async () => {
    const { container } = render(panel);
    dropFile(container, "filing.pdf");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That's a .pdf — the workbook is an .xlsx",
    );
    expect(
      screen.getByText(/hand it to your AI with the format spec/i),
    ).toBeTruthy();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("shows honest progress while the check runs (U4)", async () => {
    // The deferred is constructed BEFORE the mock can fire, and we wait
    // for the mock to actually be called before resolving — the check
    // runs after an async file read, so resolving on the phase text
    // alone is a race (caught on CI: the un-resolved zombie call then
    // consumed the NEXT test's mockResolvedValueOnce).
    let resolveCheck: (r: WorkbookCheckResult) => void = () => {};
    const pending = new Promise<WorkbookCheckResult>((resolve) => {
      resolveCheck = resolve;
    });
    mockedCheck.mockReturnValueOnce(pending);
    const { container } = render(panel);
    dropFile(container);
    expect(await screen.findByText(/Checking demo\.xlsx/)).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing is created",
    );
    await waitFor(() => expect(mockedCheck).toHaveBeenCalledTimes(1));
    resolveCheck(CLEAN);
    await waitFor(() =>
      expect(screen.getByText(/22 sheets · spec 1.0/)).toBeTruthy(),
    );
  });

  it("states everything parsed + citation coverage + the product label (U5 · U6)", async () => {
    mockedCheck.mockResolvedValueOnce(CLEAN);
    const { container } = render(panel);
    dropFile(container);
    await waitFor(() =>
      expect(screen.getByText(/22 sheets · spec 1.0/)).toBeTruthy(),
    );
    // Render-if-nonzero extras (fixture: 2 endorsements, 2 modifier
    // categories, 1 loading, 1 final adjustment, 0 geo rows).
    expect(screen.getByText("endorsements")).toBeTruthy();
    expect(screen.getByText("modifier categories")).toBeTruthy();
    expect(screen.getByText("loading")).toBeTruthy();
    expect(screen.getByText("final adjustment")).toBeTruthy();
    expect(screen.queryByText(/geo row/)).toBeNull();
    // Citation coverage — 184 of 199.
    expect(
      screen.getByText(/184 of 199 factor cells cite a filing page — 15 don't/),
    ).toBeTruthy();
    // The chip speaks the label; the raw code rides the tooltip.
    expect(screen.getByText("Directors & Officers")).toBeTruthy();
    expect(screen.getByTitle("do")).toBeTruthy();
    expect(screen.queryByText(/^do$/)).toBeNull();
  });

  it("citationLine + tiles pluralize honestly (U9)", () => {
    expect(citationLine(6, 6)).toBe("All 6 factor cells cite a filing page.");
    expect(citationLine(1, 1)).toBe("All 1 factor cell cites a filing page.");
    expect(citationLine(5, 6)).toBe(
      "5 of 6 factor cells cite a filing page — 1 doesn't (they ride the build report).",
    );
    const single = manifestTiles({
      ...CLEAN,
      manifest: {
        ...MANIFEST,
        counts: { ...MANIFEST.counts, gates: 1, chains: 1, chain_stages: 1 },
      },
    });
    expect(single.some((t) => t.label === "eligibility gate")).toBe(true);
    expect(single.some((t) => t.label === "chain · 1 stage")).toBe(true);
  });
});

describe("formatVectorDelta — ONE Δ grammar (Brief 94 U8)", () => {
  it("tolerated-but-nonzero matches show signed cents, never '0'", () => {
    expect(
      formatVectorDelta({ status: "match", expected: 658, delta: -0.08 }),
    ).toBe("-0.08");
  });
  it("exact matches show 0.00; tier checks show —", () => {
    expect(
      formatVectorDelta({ status: "match", expected: 525, delta: 0 }),
    ).toBe("0.00");
    expect(
      formatVectorDelta({ status: "match", expected: "standard", delta: null }),
    ).toBe("—");
  });
  it("mismatches keep signed cents; failure words pass through", () => {
    expect(
      formatVectorDelta({ status: "mismatch", expected: 2847, delta: -214 }),
    ).toBe("-214.00");
    expect(
      formatVectorDelta({ status: "not_run", expected: 1, delta: null }),
    ).toBe("not run");
    expect(
      formatVectorDelta({ status: "error", expected: 1, delta: null }),
    ).toBe("error");
  });
  it("the drawer and the plan report render the same -0.08 (the twin test)", () => {
    render(<BuildReportView report={REPORT} />);
    // np_001 do_premium: 658 vs 657.92, a tolerance-match — signed
    // cents, not "—" (the drawer's old grammar) nor "0" (the report's).
    expect(screen.getByText("-0.08")).toBeTruthy();
  });
});

describe("buildPinsCaption value resolution (Brief 94 U7)", () => {
  it("values resolve through level labels; unresolved values stay raw", () => {
    const labels = new Map([
      ["revenue", "Revenue band"],
      ["state", "State"],
      ["tiv", "TIV"],
    ]);
    const valueLabels = new Map<string, (v: string | number) => string | null>([
      ["revenue", (v) => (Number(v) < 25000 ? "<$25K" : null)],
      ["state", (v) => (v === "ak" ? "Alaska" : null)],
    ]);
    expect(
      buildPinsCaption(
        { revenue: 0, state: "ak", tiv: 850000 },
        labels,
        valueLabels,
      ),
    ).toBe("Revenue band <$25K · State Alaska · TIV 850,000");
  });
});

describe("WorkbookBuildPanel (Brief 92.R — the revision loop)", () => {
  const noop = () => {};
  const REVISES = {
    rating_plan_id: "do_multi_blank_1234",
    display_name: "Nonprofit 990 — D&O + GL — v1",
    built_at: "2026-07-16T10:00:00+00:00",
    version_from: "1.0.0",
    version_to: "1.1.0",
  };
  const CLEAN_REVISING: WorkbookCheckResult = {
    ...CLEAN,
    manifest: {
      ...MANIFEST,
      provenance: {
        ...MANIFEST.provenance,
        rating_plan_id: "nonprofit-do-gl-multi-2026",
        version: "1.1.0",
      },
    },
    revises: REVISES,
  };
  const REVIEW = {
    check: CLEAN_REVISING,
    diff: {
      totals: { added: 0, changed: 1, removed: 1, sections_changed: 2 },
      sections: [
        {
          section: "factor_tables",
          label: "Factor Tables",
          added: 0,
          changed: 1,
          removed: 0,
          unchanged: 10,
          items: [
            {
              state: "changed" as const,
              key: "ft.do_revenue",
              summary: "ft.do_revenue — 1 of 7 factors changed.",
              changes: [{ field: "rev_0_25k", from: 1.0, to: 1.05, pct: 5.0 }],
            },
          ],
        },
        {
          section: "endorsements",
          label: "Endorsements",
          added: 0,
          changed: 0,
          removed: 1,
          unchanged: 0,
          items: [
            {
              state: "removed" as const,
              key: "vol_accident",
              summary:
                "Removes endorsement vol_accident (form NP 04 12, always attached).",
            },
          ],
        },
      ],
      ignored: [],
    },
    base: {
      report_id: "br_1",
      workbook_version: "1.0.0",
      built_at: "2026-07-16T10:00:00+00:00",
    },
    base_missing_reason: null,
    hand_edited_since_build: false,
    plan_content_hash: "hash-1",
  };
  const APPLIED: BuildWorkbookResponse = {
    ...BUILT,
    report: {
      ...REPORT,
      workbook_version: "1.1.0",
      drift: {
        compared: 4,
        median_pct: 5.0,
        max_pct: 7.1,
        expectations_revised: 1,
        cases: [
          {
            case_id: "np_001",
            field: "do_premium",
            was: 657.92,
            now: 690.82,
            pct: 5.0,
          },
        ],
      },
    },
  };

  it("discovery: offers Review the revision BESIDE Build a separate plan (D2)", async () => {
    mockedCheck.mockResolvedValueOnce(CLEAN_REVISING);
    const mockedReingestCheck = vi.fn().mockResolvedValue(REVIEW);
    const mockedReingestApply = vi.fn().mockResolvedValue(APPLIED);
    const { container } = render(
      <WorkbookBuildPanel
        checkWorkbook={mockedCheck}
        buildWorkbook={mockedBuild}
        onStartBlank={noop}
        onCancel={noop}
        onOpenPlan={noop}
        assetUrls={KIT}
        reingestCheck={mockedReingestCheck}
        reingestApply={mockedReingestApply}
      />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(
        screen.getByText(/This workbook revises Nonprofit 990/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/v1\.0\.0 → v1\.1\.0/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Review the revision" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Build a separate plan" }),
    ).toBeTruthy();
  });

  it("review → apply: the diff renders and apply carries If-Match (D3 · D7)", async () => {
    mockedCheck.mockResolvedValueOnce(CLEAN_REVISING);
    const mockedReingestCheck = vi.fn().mockResolvedValue(REVIEW);
    const mockedReingestApply = vi.fn().mockResolvedValue(APPLIED);
    const { container } = render(
      <WorkbookBuildPanel
        checkWorkbook={mockedCheck}
        buildWorkbook={mockedBuild}
        onStartBlank={noop}
        onCancel={noop}
        onOpenPlan={noop}
        assetUrls={KIT}
        reingestCheck={mockedReingestCheck}
        reingestApply={mockedReingestApply}
      />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review the revision" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review the revision" }));
    await waitFor(() =>
      expect(
        screen.getByText(/The revision changes 2 constructs across 2 sections/),
      ).toBeTruthy(),
    );
    expect(mockedReingestCheck).toHaveBeenCalledWith(
      "do_multi_blank_1234",
      expect.anything(),
      "demo.xlsx",
    );
    // The cell-grain change with its % chip.
    expect(screen.getByText("rev_0_25k")).toBeTruthy();
    expect(screen.getByText("+5.0%")).toBeTruthy();
    // The removal is loud BEFORE it happens.
    expect(screen.getByText(/Removes endorsement vol_accident/)).toBeTruthy();
    // "Build a separate plan instead" stays available (D2).
    expect(
      screen.getByRole("button", { name: "Build a separate plan instead" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply the revision" }));
    await waitFor(() =>
      expect(
        screen.getByText(/The filing's examples moved \+5\.0% median/),
      ).toBeTruthy(),
    );
    expect(mockedReingestApply).toHaveBeenCalledWith(
      "do_multi_blank_1234",
      expect.anything(),
      { filename: "demo.xlsx", ifMatch: "hash-1" },
    );
    // The drift table shows the measured move.
    expect(screen.getByText("690.82")).toBeTruthy();
  });

  it("hand-edit and missing-base banners are loud (D5 · D1)", async () => {
    mockedCheck.mockResolvedValueOnce(CLEAN_REVISING);
    const warned = {
      ...REVIEW,
      diff: null,
      base: null,
      base_missing_reason:
        "This plan was built before revisions stored the workbook bytes.",
      hand_edited_since_build: true,
    };
    const { container } = render(
      <WorkbookBuildPanel
        checkWorkbook={mockedCheck}
        buildWorkbook={mockedBuild}
        onStartBlank={noop}
        onCancel={noop}
        onOpenPlan={noop}
        assetUrls={KIT}
        reingestCheck={vi.fn().mockResolvedValue(warned)}
        reingestApply={vi.fn().mockResolvedValue(APPLIED)}
      />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review the revision" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review the revision" }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByText(/duplicate the plan first/)).toBeTruthy();
    expect(
      screen.getByText(/before revisions stored the workbook bytes/),
    ).toBeTruthy();
  });

  it("without the reingest operations the panel behaves exactly as before", async () => {
    mockedCheck.mockResolvedValueOnce(CLEAN_REVISING);
    const { container } = render(
      <WorkbookBuildPanel
        checkWorkbook={mockedCheck}
        buildWorkbook={mockedBuild}
        onStartBlank={noop}
        onCancel={noop}
        onOpenPlan={noop}
        assetUrls={KIT}
      />,
    );
    dropFile(container);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Build the plan" })).toBeTruthy(),
    );
    expect(screen.queryByText(/This workbook revises/)).toBeNull();
  });
});
