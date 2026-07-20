/**
 * <RunSection> — V2_INTERFACE_SPEC §2.4 tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunSection } from "./RunSection";

const FIELDS = [
  { key: "construction_class", label: "construction_class", value: "frame" },
  { key: "building_limit", label: "building_limit", value: "250000" },
];

describe("<RunSection>", () => {
  it("renders the build nudge when the plan isn't ready", () => {
    const onOpenBuild = vi.fn();
    render(
      <RunSection
        ready={false}
        blockingHint="Add to Factor Tables + Algorithm first."
        onOpenBuild={onOpenBuild}
        fields={[]}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
      />,
    );
    expect(screen.getByText("Finish the build first")).toBeInTheDocument();
    expect(
      screen.getByText("Add to Factor Tables + Algorithm first."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open the build checklist" }),
    );
    expect(onOpenBuild).toHaveBeenCalled();
  });

  it("edits fields and runs on Enter (form submit)", () => {
    const onFieldChange = vi.fn();
    const onRun = vi.fn();
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={onFieldChange}
        onRun={onRun}
        result={null}
      />,
    );
    const input = screen.getByLabelText("building_limit");
    fireEvent.change(input, { target: { value: "500000" } });
    expect(onFieldChange).toHaveBeenCalledWith("building_limit", "500000");
    fireEvent.submit(input.closest("form")!);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("shows the premium + outputs + the Algorithm link", () => {
    const onOpenAlgorithm = vi.fn();
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={{
          premiumLabel: "$4,731",
          ranAtLabel: "ran just now",
          outputs: [
            { field: "building_premium", valueLabel: "$3,205" },
            { field: "liability_premium", valueLabel: "$1,526" },
          ],
          qualifier:
            "Plan premium — policy-level final adjustments apply at policy scoring.",
        }}
        onOpenAlgorithm={onOpenAlgorithm}
      />,
    );
    expect(screen.getByTestId("rater-run-section-premium")).toHaveTextContent(
      "$4,731",
    );
    expect(screen.getByText("building_premium")).toBeInTheDocument();
    expect(
      screen.getByText(/policy-level final adjustments apply/),
    ).toBeInTheDocument();
    // §14 — the affordance is honest now: it opens the AUTHORED
    // structure; the evaluated trace renders in place (own tests below).
    fireEvent.click(
      screen.getByRole("button", { name: "Open the algorithm" }),
    );
    expect(onOpenAlgorithm).toHaveBeenCalled();
  });

  it("renders the honest error state", () => {
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
        error="This plan didn't produce any outputs."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "didn't produce any outputs",
    );
  });
});

// ── §14 (audit P4-01 / FB-1) — the evaluated trace renders in place ──

import { buildServerRunTraceView } from "../TracePanel/serverRunTrace";
import type { ServerRunResultLike } from "../TracePanel/serverRunTrace";

const TRACE_STAGES = [
  {
    stage_kind: "multiplicative_chain",
    config_json: {
      output_total_field: "premium",
      chains: [
        {
          name: "c",
          output_field: "premium",
          factor_lookups: [
            { name: "Class factor", factor_kind: "class_factor" },
          ],
        },
      ],
    },
  },
];

const OK_ENVELOPE: ServerRunResultLike = {
  outputs: { premium: 1360 },
  trace: {
    in_base: { kindId: "input", inputs: {}, outputs: { value: 850 } },
    lk_c_class_factor: {
      kindId: "lookup.direct",
      inputs: {},
      outputs: { value: 1.32 },
      explanation: "Classified c101 → 1.32",
    },
    chain_c: {
      kindId: "chain.mult",
      inputs: {},
      outputs: { result: 1360 },
      explanation: "850 × 1.6 (LCM) = 1360",
    },
    out_premium: { kindId: "output", inputs: {}, outputs: { value: 1360 } },
  },
  as_of: "2026-07-13",
  durationMs: 3,
  row_status: "ok",
};

const RESULT_VIEW = {
  premiumLabel: "$1,360",
  outputs: [{ field: "premium", valueLabel: "$1,360" }],
  ranAtLabel: "ran just now",
  qualifier: "Plan premium — server-scored.",
};

describe("<RunSection> §14 — the evaluated trace renders in place (FB-1)", () => {
  const traceView = buildServerRunTraceView({
    result: OK_ENVELOPE,
    stages: TRACE_STAGES,
  });

  it("renders the collapsible 'How this was computed' region under the result", () => {
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={RESULT_VIEW}
        traceView={traceView}
      />,
    );
    expect(
      screen.getByText("How this was computed · 4 steps"),
    ).toBeInTheDocument();
    // FB-1: each step's evaluated math + the final premium are IN the
    // region (native <details> keeps content in the DOM).
    expect(screen.getByText("850 × 1.6 (LCM) = 1360")).toBeInTheDocument();
    expect(screen.getByText("Classified c101 → 1.32")).toBeInTheDocument();
    // The mined lookup label renders instead of the runtime node id.
    expect(screen.getByText("Class factor")).toBeInTheDocument();
  });

  it("relabels the Algorithm link honestly (no more trace over-promise)", () => {
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={RESULT_VIEW}
        traceView={traceView}
        onOpenAlgorithm={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open the algorithm" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("View the step-by-step trace in Algorithm"),
    ).not.toBeInTheDocument();
  });

  it("a REFUSAL renders the trace too — the failing step is the diagnosis", () => {
    const refusedView = buildServerRunTraceView({
      result: {
        ...OK_ENVELOPE,
        outputs: {},
        row_status: "error",
      },
      stages: TRACE_STAGES,
    });
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
        error="This risk can't be rated — the step-by-step trace below shows where it failed."
        traceView={refusedView}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("How this was computed · 4 steps"),
    ).toBeInTheDocument();
    // ADR-0056 — the declared output renders withheld, never a number.
    expect(screen.getByText("— withheld")).toBeInTheDocument();
  });

  it("no run yet → no trace region", () => {
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
        traceView={null}
      />,
    );
    expect(
      screen.queryByText(/How this was computed/),
    ).not.toBeInTheDocument();
  });
});

// ── Brief 95 D1 + D2 — the book template link + the seed provenance ──

describe("<RunSection> Brief 95 — submitter ergonomics", () => {
  it("D2: a seedHint replaces the representative-values line", () => {
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
        seedHint="Seeded from IT-01 — the filing's own verified example. Edit any field, then press Enter or Rate sample."
      />,
    );
    expect(screen.getByText(/Seeded from IT-01/)).toBeInTheDocument();
    expect(
      screen.queryByText(/representative values/),
    ).not.toBeInTheDocument();
  });

  it("D2: no seedHint → the representative-values line stays", () => {
    render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
      />,
    );
    expect(screen.getByText(/representative values/)).toBeInTheDocument();
  });

  it("D1: bookTemplateUrl renders the download link; absent renders none", () => {
    const { rerender } = render(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
        bookTemplateUrl="/api/v1/plans/p1/book-template.csv"
      />,
    );
    const link = screen.getByTestId("rater-run-section-book-template");
    expect(link).toHaveAttribute(
      "href",
      "/api/v1/plans/p1/book-template.csv",
    );
    rerender(
      <RunSection
        ready
        fields={FIELDS}
        onFieldChange={() => {}}
        onRun={() => {}}
        result={null}
      />,
    );
    expect(
      screen.queryByTestId("rater-run-section-book-template"),
    ).not.toBeInTheDocument();
  });
});
