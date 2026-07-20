/**
 * <Modal> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("<Modal>", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Test">
        <Modal.Body>Hidden</Modal.Body>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders with title + body when open", () => {
    render(
      <Modal open onClose={() => {}} title="Delete plan?">
        <Modal.Body>Are you sure?</Modal.Body>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete plan?")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <Modal open onClose={() => {}} title="Title" subtitle="Subtitle here">
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    expect(screen.getByText("Subtitle here")).toBeInTheDocument();
  });

  it("fires onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test">
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("rater-modal-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT fire onClose when the panel itself is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test">
        <Modal.Body>
          <p>Click me</p>
        </Modal.Body>
      </Modal>,
    );
    fireEvent.click(screen.getByText("Click me"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires onClose on Escape (when dismissable)", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test">
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT fire onClose on Escape when dismissable=false", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test" dismissable={false}>
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT fire onClose on backdrop click when dismissable=false", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test" dismissable={false}>
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("rater-modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hides the close button when dismissable=false", () => {
    render(
      <Modal open onClose={() => {}} title="Test" dismissable={false}>
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows the close button when dismissable=true (default)", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test">
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    const closeBtn = screen.getByRole("button", { name: "Close" });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders footer slot when provided", () => {
    render(
      <Modal open onClose={() => {}} title="Test">
        <Modal.Body>Body</Modal.Body>
        <Modal.Footer>
          <button>Cancel</button>
          <button>Confirm</button>
        </Modal.Footer>
      </Modal>,
    );
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("applies size classes correctly", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { unmount } = render(
        <Modal open onClose={() => {}} title="Test" size={size}>
          <Modal.Body>Body</Modal.Body>
        </Modal>,
      );
      const panel = screen.getByRole("dialog");
      expect(panel.className).toContain(`rater-modal--${size}`);
      unmount();
    }
  });

  it("sets ARIA attributes correctly", () => {
    render(
      <Modal open onClose={() => {}} title="ARIA test">
        <Modal.Body>Body</Modal.Body>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      screen.getByText("ARIA test").id,
    );
  });
});
