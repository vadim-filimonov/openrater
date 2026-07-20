/**
 * <BreakpointScrubber> tests — Brief 26 PR 4.
 *
 * Smoke-level coverage for the pure-render pieces + keyboard /
 * pointer interactions. Pointer drag's per-frame snapshots aren't
 * tested directly (vitest + jsdom can't simulate full pointer
 * capture deterministically); we test the boundary commits
 * (pointerup) + the keyboard nudge path.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  BreakpointScrubber,
  formatNumber,
  resolveScrubberMode,
  COMPACT_MODE_THRESHOLD,
} from "./BreakpointScrubber";

describe("BreakpointScrubber — render", () => {
  it("renders one slider per breakpoint", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 5, 15, 50]}
        onChange={() => {}}
      />,
    );
    const handles = screen.getAllByRole("slider");
    expect(handles).toHaveLength(4);
  });

  it("renders endpoint labels for min and max", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 50, 100]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders auto-derived band labels", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 5, 15]}
        onChange={() => {}}
      />,
    );
    // SVG <text> nodes appear as text nodes in the document.
    expect(screen.getByText("0–5")).toBeInTheDocument();
    expect(screen.getByText("5–15")).toBeInTheDocument();
  });

  it("uses custom labels when supplied", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 5, 15]}
        labels={["New", "Modern"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Modern")).toBeInTheDocument();
  });

  it("falls back to auto-label for empty custom labels", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 5, 15]}
        labels={["New", ""]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("5–15")).toBeInTheDocument();
  });

  it("sets aria-valuemin / max / now on every handle", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 50, 100]}
        onChange={() => {}}
      />,
    );
    const handles = screen.getAllByRole("slider");
    expect(handles[0]).toHaveAttribute("aria-valuemin", "0");
    expect(handles[0]).toHaveAttribute("aria-valuemax", "100");
    expect(handles[0]).toHaveAttribute("aria-valuenow", "0");
    expect(handles[1]).toHaveAttribute("aria-valuenow", "50");
    expect(handles[2]).toHaveAttribute("aria-valuenow", "100");
  });

  it("applies the custom ariaLabel + testId", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={10}
        breakpoints={[0, 10]}
        ariaLabel="Building age axis"
        testId="my-scrubber"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Building age axis"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("my-scrubber")).toBeInTheDocument();
  });
});

describe("BreakpointScrubber — keyboard nudge", () => {
  it("ArrowRight nudges by step (or default = span/100)", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 90]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[1]!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[1]).toBeCloseTo(51); // 50 + 100/100 = 51
  });

  it("ArrowLeft nudges by negative step", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 90]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[1]!, { key: "ArrowLeft" });
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[1]).toBeCloseTo(49);
  });

  it("Shift+Arrow = 10× nudge", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 90]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[1]!, { key: "ArrowRight", shiftKey: true });
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[1]).toBeCloseTo(60); // 50 + 10 = 60
  });

  it("Home clamps to min (or lower-neighbor bound)", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 90]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    // First handle has no lower neighbor; Home should clamp to min.
    fireEvent.keyDown(handles[0]!, { key: "Home" });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[0]).toBe(0);
  });

  it("End clamps to max (or upper-neighbor bound)", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 90]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[2]!, { key: "End" });
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[2]).toBe(100);
  });

  it("clamps against the upper neighbor — ArrowRight near edge", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 51]} // second handle is 1 below third
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    // ArrowRight wants to step 1 (default = 100/100); upper bound
    // is 51 - epsilon; will clamp just below 51.
    fireEvent.keyDown(handles[1]!, { key: "ArrowRight" });
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[1]).toBeLessThan(51);
    // And strictly above 50 (it moved at least a hair).
    expect(next[1]).toBeGreaterThanOrEqual(50);
  });

  it("ignores non-arrow keys", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[0, 50, 100]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[1]!, { key: "Enter" });
    fireEvent.keyDown(handles[1]!, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("respects custom step in keyboard nudge", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={[10, 50, 90]}
        step={5}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[1]!, { key: "ArrowRight" });
    const next = onChange.mock.calls[0]![0] as readonly number[];
    expect(next[1]).toBeCloseTo(55);
  });
});

describe("BreakpointScrubber — degenerate inputs", () => {
  it("renders gracefully when min === max", () => {
    render(
      <BreakpointScrubber
        min={5}
        max={5}
        breakpoints={[5, 5]}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("does not fire onChange when min === max + key pressed", () => {
    const onChange = vi.fn();
    render(
      <BreakpointScrubber
        min={5}
        max={5}
        breakpoints={[5, 5]}
        onChange={onChange}
      />,
    );
    const handles = screen.getAllByRole("slider");
    fireEvent.keyDown(handles[0]!, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("formatNumber", () => {
  it("renders integers without decimals", () => {
    expect(formatNumber(5)).toBe("5");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-3)).toBe("-3");
  });

  it("trims trailing zeros from decimals", () => {
    expect(formatNumber(5.1)).toBe("5.1");
    expect(formatNumber(5.123)).toBe("5.123");
    expect(formatNumber(5.1230000001)).toBe("5.123");
  });

  it("renders ±∞ for infinities", () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("+∞");
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe("−∞");
  });
});

// ── Brief 27 PR 2 — Scale-adaptive density ─────────────────────

describe("resolveScrubberMode", () => {
  it("threshold constant is 11 (per Brief 27 §−1 Q3)", () => {
    expect(COMPACT_MODE_THRESHOLD).toBe(11);
  });

  it("auto → full for 0 bands (1 breakpoint)", () => {
    expect(resolveScrubberMode("auto", 1)).toBe("full");
  });

  it("auto → full for 10 bands (11 breakpoints)", () => {
    expect(resolveScrubberMode("auto", 11)).toBe("full");
  });

  it("auto → compact for 11 bands (12 breakpoints)", () => {
    expect(resolveScrubberMode("auto", 12)).toBe("compact");
  });

  it("auto → compact for 40 bands", () => {
    expect(resolveScrubberMode("auto", 41)).toBe("compact");
  });

  it("explicit full overrides auto threshold", () => {
    expect(resolveScrubberMode("full", 50)).toBe("full");
  });

  it("explicit compact overrides auto threshold", () => {
    expect(resolveScrubberMode("compact", 3)).toBe("compact");
  });

  it("undefined mode is treated as auto", () => {
    expect(resolveScrubberMode(undefined, 5)).toBe("full");
    expect(resolveScrubberMode(undefined, 25)).toBe("compact");
  });
});

describe("BreakpointScrubber — scale-adaptive mode (Brief 27 PR 2)", () => {
  // 5 bands → 6 breakpoints
  const FIVE_BANDS: readonly number[] = [0, 5, 15, 30, 50, 100];
  // 12 bands → 13 breakpoints (just past the threshold)
  const TWELVE_BANDS: readonly number[] = [
    0, 8, 16, 25, 33, 41, 50, 58, 66, 75, 83, 91, 100,
  ];

  it("renders per-band labels in full mode (≤ 10 bands)", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={FIVE_BANDS}
        labels={["New", "Modern", "Standard", "Older", "Vintage"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Vintage")).toBeInTheDocument();
  });

  it("suppresses per-band labels in auto-resolved compact mode (11+ bands)", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        labels={[
          "A",
          "B",
          "C",
          "D",
          "E",
          "F",
          "G",
          "H",
          "I",
          "J",
          "K",
          "L",
        ]}
        onChange={() => {}}
      />,
    );
    // None of the per-band labels render in compact.
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.queryByText("L")).not.toBeInTheDocument();
    // Endpoint labels still render.
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("data-mode attribute exposes the resolved mode", () => {
    const { rerender } = render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={FIVE_BANDS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "data-mode",
      "full",
    );
    rerender(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "data-mode",
      "compact",
    );
  });

  it("mode='compact' override suppresses labels even with 5 bands", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={FIVE_BANDS}
        labels={["New", "Modern", "Standard", "Older", "Vintage"]}
        mode="compact"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.queryByText("Vintage")).not.toBeInTheDocument();
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "data-mode",
      "compact",
    );
  });

  it("mode='full' override renders labels even at 12 bands", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        labels={[
          "A",
          "B",
          "C",
          "D",
          "E",
          "F",
          "G",
          "H",
          "I",
          "J",
          "K",
          "L",
        ]}
        mode="full"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "data-mode",
      "full",
    );
  });

  it("default height is shorter (50 px) in compact mode", () => {
    const { rerender } = render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={FIVE_BANDS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "height",
      "80",
    );
    rerender(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "height",
      "50",
    );
  });

  it("explicit height prop overrides the mode default", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        height={120}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-breakpoint-scrubber")).toHaveAttribute(
      "height",
      "120",
    );
  });

  it("hover on a compact handle reveals the tooltip", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        onChange={() => {}}
      />,
    );
    const handle = screen.getByTestId("rater-breakpoint-scrubber-handle-3");
    // Before hover, the tooltip text is not in the DOM
    // (TWELVE_BANDS[3] === 25, so look for "25").
    // Use the SVG handle-tooltip class to disambiguate from
    // aria-valuetext on the slider.
    expect(
      document.querySelector(".rater-breakpoint-scrubber__handle-tooltip"),
    ).toBeNull();
    fireEvent.pointerEnter(handle);
    expect(
      document.querySelector(".rater-breakpoint-scrubber__handle-tooltip"),
    ).not.toBeNull();
    fireEvent.pointerLeave(handle);
    expect(
      document.querySelector(".rater-breakpoint-scrubber__handle-tooltip"),
    ).toBeNull();
  });

  it("focus on a compact handle reveals the tooltip", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={TWELVE_BANDS}
        onChange={() => {}}
      />,
    );
    const handle = screen.getByTestId("rater-breakpoint-scrubber-handle-5");
    fireEvent.focus(handle);
    expect(
      document.querySelector(".rater-breakpoint-scrubber__handle-tooltip"),
    ).not.toBeNull();
    fireEvent.blur(handle);
    expect(
      document.querySelector(".rater-breakpoint-scrubber__handle-tooltip"),
    ).toBeNull();
  });

  it("does NOT show hover tooltip in full mode (label row carries the info)", () => {
    render(
      <BreakpointScrubber
        min={0}
        max={100}
        breakpoints={FIVE_BANDS}
        onChange={() => {}}
      />,
    );
    const handle = screen.getByTestId("rater-breakpoint-scrubber-handle-2");
    fireEvent.pointerEnter(handle);
    // No hover-induced tooltip in full mode — the label row below the
    // axis already labels each band.
    expect(
      document.querySelector(".rater-breakpoint-scrubber__handle-tooltip"),
    ).toBeNull();
  });
});
