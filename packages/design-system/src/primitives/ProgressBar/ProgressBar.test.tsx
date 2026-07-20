import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders with role=progressbar and correct aria attrs", () => {
    render(<ProgressBar value={3} max={10} label="3 of 10 done" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(bar).toHaveAttribute("aria-label", "3 of 10 done");
  });

  it("clamps value below 0 to 0", () => {
    render(<ProgressBar value={-5} max={10} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("clamps value above max to max", () => {
    render(<ProgressBar value={15} max={10} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });

  it("fills the bar to the correct percentage", () => {
    const { container } = render(<ProgressBar value={3} max={10} />);
    const fill = container.querySelector(".rater-progress__fill") as HTMLElement;
    expect(fill.style.width).toBe("30%");
  });

  it("renders 0% width when value is 0", () => {
    const { container } = render(<ProgressBar value={0} max={10} />);
    const fill = container.querySelector(".rater-progress__fill") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("handles max=0 without crashing (renders empty)", () => {
    const { container } = render(<ProgressBar value={0} max={0} />);
    const fill = container.querySelector(".rater-progress__fill") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("applies tone classes", () => {
    const { rerender, container } = render(
      <ProgressBar value={1} max={2} tone="accent" />,
    );
    expect(container.querySelector(".rater-progress--accent")).toBeTruthy();

    rerender(<ProgressBar value={1} max={2} tone="warning" />);
    expect(container.querySelector(".rater-progress--warning")).toBeTruthy();

    rerender(<ProgressBar value={1} max={2} tone="success" />);
    expect(container.querySelector(".rater-progress--success")).toBeTruthy();
  });

  it("defaults tone to accent", () => {
    const { container } = render(<ProgressBar value={1} max={2} />);
    expect(container.querySelector(".rater-progress--accent")).toBeTruthy();
  });

  it("renders N-1 ticks when segments=N", () => {
    const { container } = render(
      <ProgressBar value={2} max={4} segments={4} />,
    );
    const ticks = container.querySelectorAll(".rater-progress__tick");
    // 4 segments → 3 internal dividers (at 25%, 50%, 75%)
    expect(ticks).toHaveLength(3);
    expect((ticks[0] as HTMLElement).style.left).toBe("25%");
    expect((ticks[1] as HTMLElement).style.left).toBe("50%");
    expect((ticks[2] as HTMLElement).style.left).toBe("75%");
  });

  it("does not render ticks when segments is omitted or ≤1", () => {
    const { container, rerender } = render(<ProgressBar value={1} max={2} />);
    expect(container.querySelectorAll(".rater-progress__tick")).toHaveLength(0);

    rerender(<ProgressBar value={1} max={2} segments={1} />);
    expect(container.querySelectorAll(".rater-progress__tick")).toHaveLength(0);
  });

  it("forwards arbitrary props (data-testid, etc.)", () => {
    render(<ProgressBar value={1} max={2} data-testid="pb" />);
    expect(screen.getByTestId("pb")).toBeInTheDocument();
  });
});
