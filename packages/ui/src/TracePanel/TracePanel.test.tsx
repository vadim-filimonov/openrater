/**
 * <TracePanel> + <TraceCascade> tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  TracePanel,
  TraceCascade,
  buildOrderedSteps,
  pickFeaturedOutput,
} from "./TracePanel";
import type { RunResult, TraceEntry } from "@openrater/contracts";

const STUB_ENTRY = (overrides: Partial<TraceEntry> = {}): TraceEntry => ({
  kindId: "constant",
  inputs: {},
  outputs: { value: 1 },
  ...overrides,
});

const SAMPLE_RUN: RunResult = {
  outputs: { total_premium: 5200, factor: 1.25 },
  trace: {
    base: STUB_ENTRY({ outputs: { value: 1000 } }),
    cls_factor: STUB_ENTRY({
      kindId: "lookup.classification",
      outputs: { value: 1.32 },
      explanation: "Classified c101 → 1.32",
    }),
    lcm: STUB_ENTRY({ outputs: { value: 1.2 } }),
    mul: STUB_ENTRY({
      kindId: "chain.mult",
      inputs: { base: 1000, factors: [1.32, 1.2] },
      outputs: { result: 1584 },
    }),
  },
  startedAt: 1_700_000_000_000,
  durationMs: 4,
  as_of: "2026-05-20",
  row_status: "ok",
};

describe("buildOrderedSteps", () => {
  it("uses nodeOrder when provided", () => {
    const ordered = buildOrderedSteps(SAMPLE_RUN.trace, [
      "base",
      "cls_factor",
      "lcm",
      "mul",
    ]);
    expect(ordered.map((s) => s.nodeId)).toEqual([
      "base",
      "cls_factor",
      "lcm",
      "mul",
    ]);
  });

  it("appends ids not in nodeOrder (lex-sorted)", () => {
    // nodeOrder mentions only the first two; rest should append in lex order
    const ordered = buildOrderedSteps(SAMPLE_RUN.trace, ["mul", "base"]);
    expect(ordered.map((s) => s.nodeId)).toEqual([
      "mul",
      "base",
      "cls_factor",
      "lcm",
    ]);
  });

  it("lex-sorts when nodeOrder omitted", () => {
    const ordered = buildOrderedSteps(SAMPLE_RUN.trace);
    expect(ordered.map((s) => s.nodeId)).toEqual([
      "base",
      "cls_factor",
      "lcm",
      "mul",
    ]);
  });

  it("ignores ids in nodeOrder that aren't in the trace", () => {
    const ordered = buildOrderedSteps(SAMPLE_RUN.trace, [
      "ghost",
      "base",
      "cls_factor",
    ]);
    expect(ordered.map((s) => s.nodeId)).toEqual([
      "base",
      "cls_factor",
      "lcm",
      "mul",
    ]);
  });
});

describe("pickFeaturedOutput", () => {
  it("prefers total_premium", () => {
    expect(pickFeaturedOutput({ total_premium: 5200, factor: 1.5 })).toEqual({
      key: "total_premium",
      value: 5200,
    });
  });

  it("falls back through premium → total → factor", () => {
    expect(pickFeaturedOutput({ premium: 100 })).toEqual({
      key: "premium",
      value: 100,
    });
    expect(pickFeaturedOutput({ total: 500 })).toEqual({
      key: "total",
      value: 500,
    });
    expect(pickFeaturedOutput({ factor: 1.2 })).toEqual({
      key: "factor",
      value: 1.2,
    });
  });

  it("falls back to first numeric output when no canonical name", () => {
    expect(pickFeaturedOutput({ x: "a", y: 5, z: 9 })).toEqual({
      key: "y",
      value: 5,
    });
  });

  it("returns null when no numeric outputs", () => {
    expect(pickFeaturedOutput({ x: "a", y: "b" })).toBeNull();
    expect(pickFeaturedOutput({})).toBeNull();
  });

  it("rejects non-finite numbers (NaN, Infinity)", () => {
    expect(pickFeaturedOutput({ total_premium: NaN })).toBeNull();
    expect(pickFeaturedOutput({ total_premium: Infinity })).toBeNull();
  });
});

describe("<TracePanel>", () => {
  it("renders empty state when trace + outputs are empty", () => {
    const empty: RunResult = {
      outputs: {},
      trace: {},
      startedAt: 0,
      durationMs: 0,
      as_of: "2026-05-20",
      row_status: "ok",
    };
    render(<TracePanel run={empty} />);
    expect(screen.getByText(/No trace/)).toBeInTheDocument();
  });

  it("uses emptyText override", () => {
    const empty: RunResult = {
      outputs: {},
      trace: {},
      startedAt: 0,
      durationMs: 0,
      as_of: "2026-05-20",
      row_status: "ok",
    };
    render(<TracePanel run={empty} emptyText="Custom empty" />);
    expect(screen.getByText("Custom empty")).toBeInTheDocument();
  });

  it("renders header with as_of + duration + step count", () => {
    render(<TracePanel run={SAMPLE_RUN} />);
    expect(screen.getByText("As of 2026-05-20")).toBeInTheDocument();
    expect(screen.getByText("4 ms · 4 steps")).toBeInTheDocument();
  });

  it("renders featured total in header (total_premium)", () => {
    const { container } = render(<TracePanel run={SAMPLE_RUN} />);
    // The featured value lives inside .rater-trace-panel__total-value;
    // the same value also appears in the outputs section, so target
    // the header slot specifically.
    const totalValue = container.querySelector(
      ".rater-trace-panel__total-value",
    );
    expect(totalValue?.textContent).toBe("5,200");
    // Featured label uses the key with underscores replaced (no
    // outputLabels override).
    const totalLabel = container.querySelector(
      ".rater-trace-panel__total-label",
    );
    expect(totalLabel?.textContent).toBe("total premium");
  });

  it("uses outputLabels override for the featured label", () => {
    const { container } = render(
      <TracePanel
        run={SAMPLE_RUN}
        outputLabels={{ total_premium: "Total premium" }}
      />,
    );
    const totalLabel = container.querySelector(
      ".rater-trace-panel__total-label",
    );
    expect(totalLabel?.textContent).toBe("Total premium");
  });

  it("renders outputs section with each key:value row", () => {
    render(<TracePanel run={SAMPLE_RUN} />);
    expect(screen.getByText("Outputs")).toBeInTheDocument();
    expect(screen.getByText("total_premium")).toBeInTheDocument();
    expect(screen.getByText("factor")).toBeInTheDocument();
  });

  it("renders cascade section with steps in topo order", () => {
    const { container } = render(
      <TracePanel
        run={SAMPLE_RUN}
        nodeOrder={["base", "cls_factor", "lcm", "mul"]}
      />,
    );
    expect(screen.getByText(/Cascade \(4 steps\)/)).toBeInTheDocument();
    // Step labels live inside .rater-trace-step__node-label. Other DOM
    // elements (input keys in collapsed I/O tables) may also contain
    // these strings, so target the label slot specifically.
    const labels = Array.from(
      container.querySelectorAll(".rater-trace-step__node-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["base", "cls_factor", "lcm", "mul"]);
  });

  it("uses nodeLabels for step display labels", () => {
    render(
      <TracePanel
        run={SAMPLE_RUN}
        nodeLabels={{
          cls_factor: "Construction class factor",
        }}
      />,
    );
    expect(screen.getByText("Construction class factor")).toBeInTheDocument();
  });

  it("highlights a specific node when highlightedNodeId is set", () => {
    const { container } = render(
      <TracePanel run={SAMPLE_RUN} highlightedNodeId="cls_factor" />,
    );
    const highlighted = container.querySelector('[data-node-id="cls_factor"]');
    expect(highlighted?.className).toContain("--highlighted");
  });
});

describe("<TraceCascade>", () => {
  it("renders each step in given order", () => {
    const steps = [
      { nodeId: "a", entry: STUB_ENTRY({ outputs: { value: 1 } }) },
      { nodeId: "b", entry: STUB_ENTRY({ outputs: { value: 2 } }) },
    ];
    const { container } = render(<TraceCascade steps={steps} />);
    const order = Array.from(
      container.querySelectorAll(".rater-trace-step"),
    ).map((el) => el.getAttribute("data-node-id"));
    expect(order).toEqual(["a", "b"]);
  });

  it("uses nodeLabels for individual steps", () => {
    const steps = [
      { nodeId: "x", entry: STUB_ENTRY() },
    ];
    render(<TraceCascade steps={steps} nodeLabels={{ x: "Custom label" }} />);
    expect(screen.getByText("Custom label")).toBeInTheDocument();
  });

  it("renders empty cascade as empty div", () => {
    const { container } = render(<TraceCascade steps={[]} />);
    expect(container.querySelector(".rater-trace-step")).toBeNull();
  });
});

// ── §14 (audit P4-01) — grouped cascade, withheld outputs, composed ──

describe("<TracePanel> §14 — grouped cascade", () => {
  it("renders one titled section per group, in group order", () => {
    render(
      <TracePanel
        run={SAMPLE_RUN}
        nodeOrder={["base", "cls_factor", "lcm", "mul"]}
        groups={[
          { id: "inputs", title: "Inputs", nodeIds: ["base"] },
          {
            id: "chain-x",
            title: "Build-up — building",
            nodeIds: ["cls_factor", "lcm", "mul"],
          },
        ]}
      />,
    );
    // Heading role disambiguates from TraceStep's "Inputs" io-caption.
    expect(
      screen.getByRole("heading", { name: "Inputs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Build-up — building" }),
    ).toBeInTheDocument();
    // The flat "Cascade (N steps)" header is replaced by the sections.
    expect(screen.queryByText(/^Cascade \(/)).not.toBeInTheDocument();
  });

  it("NEVER drops an unclaimed step — it lands in 'Other steps'", () => {
    render(
      <TracePanel
        run={SAMPLE_RUN}
        nodeOrder={["base", "cls_factor", "lcm", "mul"]}
        groups={[{ id: "inputs", title: "Inputs", nodeIds: ["base"] }]}
      />,
    );
    expect(screen.getByText("Other steps")).toBeInTheDocument();
    // The unclaimed lookup step still renders (by its explanation).
    expect(screen.getByText("Classified c101 → 1.32")).toBeInTheDocument();
  });
});

describe("<TracePanel> §14 — withheld outputs (ADR-0056 / Law 2)", () => {
  const REFUSED_RUN: RunResult = {
    ...SAMPLE_RUN,
    // A refusal keeps diagnostic partials in outputs — the panel must
    // not headline them as THE premium.
    outputs: { building_premium: 1510 },
    row_status: "error",
  };

  it("renders each withheld field as '— withheld', never a number", () => {
    render(
      <TracePanel run={REFUSED_RUN} withheldOutputs={["total_premium"]} />,
    );
    expect(screen.getByText("total_premium")).toBeInTheDocument();
    expect(screen.getByText("— withheld")).toBeInTheDocument();
  });

  it("suppresses the featured header total while anything is withheld", () => {
    const { container } = render(
      <TracePanel run={REFUSED_RUN} withheldOutputs={["total_premium"]} />,
    );
    expect(
      container.querySelector(".rater-trace-panel__total"),
    ).not.toBeInTheDocument();
  });

  it("keeps the featured total when nothing is withheld", () => {
    const { container } = render(<TracePanel run={SAMPLE_RUN} />);
    expect(
      container.querySelector(".rater-trace-panel__total"),
    ).toBeInTheDocument();
  });
});

describe("<TracePanel> §14 — Final adjustments (composed)", () => {
  it("renders subtotal → steps → filed premium with running totals", () => {
    render(
      <TracePanel
        run={SAMPLE_RUN}
        composed={{
          subtotal: 2127,
          final: 2430,
          adjustments: [
            {
              id: "irpm",
              applied: true,
              before: 2127,
              after: 2430,
              factor_or_delta: 1.1424,
              detail: "+14.2% (Σ 3 sections, cap ±25%)",
            },
            {
              id: "new_business_credit",
              applied: false,
              before: 2430,
              after: 2430,
              factor_or_delta: 1,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Final adjustments")).toBeInTheDocument();
    expect(screen.getByText("Plan subtotal")).toBeInTheDocument();
    expect(screen.getByText("Filed premium")).toBeInTheDocument();
    expect(screen.getByText("2,430")).toBeInTheDocument();
    expect(
      screen.getByText("+14.2% (Σ 3 sections, cap ±25%)"),
    ).toBeInTheDocument();
    // A guard-skipped step is a VISIBLE no-op, not a hidden one.
    expect(screen.getByText("not applied")).toBeInTheDocument();
  });
});

describe("<TracePanel> §14 — header honesty guards", () => {
  it("hides the duration when the record carries none (0)", () => {
    const run: RunResult = { ...SAMPLE_RUN, durationMs: 0 };
    const { container } = render(<TracePanel run={run} />);
    const duration = container.querySelector(
      ".rater-trace-panel__duration",
    )!;
    expect(duration.textContent).toBe("4 steps");
    expect(duration.textContent).not.toContain("ms");
  });

  it("hides the as-of line when the record carries none", () => {
    const run: RunResult = { ...SAMPLE_RUN, as_of: "" };
    render(<TracePanel run={run} />);
    expect(screen.queryByText(/^As of/)).not.toBeInTheDocument();
  });
});
