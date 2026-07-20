/**
 * Brief 45 PR 45.5 — <UniformCallout> tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UniformCallout } from "./UniformCallout";

describe("<UniformCallout>", () => {
  it("renders 'Nothing has been tuned yet' when value equals baseline", () => {
    render(<UniformCallout value={1.0} baseline={1.0} />);
    expect(
      screen.getByTestId("rater-uniform-callout-title").textContent,
    ).toBe("Nothing has been tuned yet");
  });

  it("renders 'All factors equal X' when value diverges from baseline", () => {
    render(<UniformCallout value={2.5} baseline={1.0} />);
    const title = screen.getByTestId("rater-uniform-callout-title");
    expect(title.textContent).toContain("All factors equal");
    expect(title.textContent).toContain("2.5");
  });

  it("body copy mentions the identity when value matches baseline", () => {
    render(<UniformCallout value={1.0} />);
    expect(
      screen.getByTestId("rater-uniform-callout-body").textContent,
    ).toContain("identity");
  });

  it("body copy mentions 'differentiate' when value diverges from baseline", () => {
    render(<UniformCallout value={1.5} baseline={1.0} />);
    expect(
      screen.getByTestId("rater-uniform-callout-body").textContent,
    ).toContain("differentiat");
  });

  it("uses the bodyOverride when supplied", () => {
    render(
      <UniformCallout value={1.0} bodyOverride="Custom body line." />,
    );
    expect(
      screen.getByTestId("rater-uniform-callout-body").textContent,
    ).toBe("Custom body line.");
  });

  it("renders the CTA when onEditFirst is supplied + fires on click", () => {
    const onEditFirst = vi.fn();
    render(
      <UniformCallout value={1.0} onEditFirst={onEditFirst} />,
    );
    const cta = screen.getByTestId("rater-uniform-callout-cta");
    expect(cta.textContent).toContain("Edit first cell");
    fireEvent.click(cta);
    expect(onEditFirst).toHaveBeenCalledTimes(1);
  });

  it("omits the CTA when onEditFirst is not supplied", () => {
    render(<UniformCallout value={1.0} />);
    expect(screen.queryByTestId("rater-uniform-callout-cta")).toBeNull();
  });

  it("displays em-dash for a null value (defensive case)", () => {
    render(<UniformCallout value={null} />);
    // Body should not crash; title is "Nothing has been tuned yet"
    // because |null - 1.0| > 0.005 evaluates to NaN > 0.005 = false
    // so atIdentity is false → "All factors equal —"
    const title = screen.getByTestId("rater-uniform-callout-title");
    expect(title.textContent).toContain("—");
  });

  it("respects a custom testId", () => {
    render(<UniformCallout value={1.0} testId="my-callout" />);
    expect(screen.getByTestId("my-callout")).toBeInTheDocument();
    expect(screen.getByTestId("my-callout-title")).toBeInTheDocument();
    expect(screen.getByTestId("my-callout-body")).toBeInTheDocument();
  });
});
