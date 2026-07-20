/**
 * <SavePill> unit tests — the unified save-status pill.
 *
 * Covers the canonical labels per state, the idle→nothing contract, the
 * label override (the "Save failed — retrying" case), and the testId /
 * className passthroughs.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SavePill } from "./SavePill";

describe("<SavePill>", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<SavePill state="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the canonical label + state class per state", () => {
    const cases = [
      { state: "dirty", text: "Unsaved changes" },
      { state: "saving", text: "Saving…" },
      { state: "saved", text: "Saved" },
      { state: "error", text: "Save failed" },
    ] as const;
    for (const { state, text } of cases) {
      const { unmount } = render(
        <SavePill state={state} testId={`pill-${state}`} />,
      );
      const el = screen.getByTestId(`pill-${state}`);
      expect(el).toHaveTextContent(text);
      expect(el).toHaveClass(`rater-savepill--${state}`);
      unmount();
    }
  });

  it("exposes a polite live region for screen readers", () => {
    render(<SavePill state="saving" testId="pill" />);
    expect(screen.getByTestId("pill")).toHaveAttribute("role", "status");
  });

  it("honors a label override (e.g. the auto-retry copy)", () => {
    render(
      <SavePill
        state="error"
        label="Save failed — retrying"
        testId="pill"
      />,
    );
    const el = screen.getByTestId("pill");
    expect(el).toHaveTextContent("Save failed — retrying");
    // still the error color class — override changes copy, not domain
    expect(el).toHaveClass("rater-savepill--error");
  });

  it("passes through a layout className", () => {
    render(<SavePill state="saved" className="my-margin" testId="pill" />);
    expect(screen.getByTestId("pill")).toHaveClass("my-margin");
    expect(screen.getByTestId("pill")).toHaveClass("rater-savepill");
  });
});
