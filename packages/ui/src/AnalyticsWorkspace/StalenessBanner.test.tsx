/**
 * Brief 64 PR 64.4 — <StalenessBanner> tests.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StalenessBanner } from "./StalenessBanner";

describe("<StalenessBanner>", () => {
  it("renders nothing when the scored result is fresh", () => {
    const { container } = render(
      <StalenessBanner scoredAt="2026-06-08T00:00:00Z" stale={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("warns + offers a re-score action when stale", () => {
    const onReScore = vi.fn();
    render(
      <StalenessBanner
        scoredAt="2026-06-08T00:00:00Z"
        stale
        onReScore={onReScore}
        now={new Date("2026-06-08T00:10:00Z")}
      />,
    );
    const banner = screen.getByTestId("rater-staleness");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/changed since/i);
    fireEvent.click(screen.getByTestId("rater-staleness-action"));
    expect(onReScore).toHaveBeenCalledTimes(1);
  });
});
