import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("does not render anything when open=false", () => {
    render(
      <Drawer open={false} onClose={() => {}} title="Edit">
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title + body when open=true", () => {
    render(
      <Drawer open onClose={() => {}} title="Add input source" subtitle="Section 1">
        <Drawer.Body>
          <input data-testid="first-input" />
        </Drawer.Body>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Add input source")).toBeInTheDocument();
    expect(screen.getByText("Section 1")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="x">
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="x">
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="x">
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("rater-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when clicking inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="x">
        <Drawer.Body>
          <span data-testid="inner">content</span>
        </Drawer.Body>
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("inner"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("auto-focuses the first form field (skips the close button)", () => {
    render(
      <Drawer open onClose={() => {}} title="x">
        <Drawer.Body>
          <input data-testid="first-input" />
        </Drawer.Body>
      </Drawer>,
    );
    expect(document.activeElement).toBe(screen.getByTestId("first-input"));
  });

  it("falls back to the close button when there are no form fields", () => {
    render(
      <Drawer open onClose={() => {}} title="x">
        <Drawer.Body>
          <p>Read-only content</p>
        </Drawer.Body>
      </Drawer>,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
  });

  it("renders body + footer slots in the right order", () => {
    render(
      <Drawer open onClose={() => {}} title="x">
        <Drawer.Body>
          <span data-testid="body-content">body</span>
        </Drawer.Body>
        <Drawer.Footer>
          <span data-testid="footer-content">footer</span>
        </Drawer.Footer>
      </Drawer>,
    );
    expect(screen.getByTestId("body-content")).toBeInTheDocument();
    expect(screen.getByTestId("footer-content")).toBeInTheDocument();
  });

  it("respects a custom widthPx (override escape hatch)", () => {
    render(
      <Drawer open onClose={() => {}} title="x" widthPx={600}>
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "600px" });
  });

  it("defaults to md (480px) when neither size nor widthPx is provided", () => {
    render(
      <Drawer open onClose={() => {}} title="x">
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "480px" });
  });

  it.each([
    ["sm", "380px"],
    ["md", "480px"],
    ["lg", "640px"],
    ["xl", "820px"],
  ] as const)("size=%s maps to %s", (size, expectedWidth) => {
    render(
      <Drawer open onClose={() => {}} title="x" size={size}>
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByRole("dialog")).toHaveStyle({ width: expectedWidth });
  });

  it("widthPx takes precedence over size", () => {
    render(
      <Drawer open onClose={() => {}} title="x" size="sm" widthPx={777}>
        <Drawer.Body>content</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "777px" });
  });
});
