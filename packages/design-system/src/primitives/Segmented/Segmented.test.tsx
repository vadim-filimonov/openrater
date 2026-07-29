/**
 * <Segmented> tests — Polish PR 8.
 *
 * Layered:
 *   1. Render contract — items, active state, count badge
 *   2. Click selection invokes onChange with the new value
 *   3. Keyboard nav — arrows move between segments + select
 *   4. aria-checked + role wiring matches WAI-ARIA radiogroup
 *   5. Disabled segments are not selectable
 *   6. testId + className passthrough
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Segmented, type SegmentedItem } from "./Segmented";

const ITEMS: ReadonlyArray<SegmentedItem<"canvas" | "saved">> = [
  { value: "canvas", label: "Canvas" },
  { value: "saved", label: "Saved", count: 4 },
] as const;

describe("<Segmented>", () => {
  it("renders all items with active state on the matching value", () => {
    render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    const canvas = screen.getByRole("radio", { name: /Canvas/ });
    const saved = screen.getByRole("radio", { name: /Saved/ });
    expect(canvas).toHaveAttribute("aria-checked", "true");
    expect(saved).toHaveAttribute("aria-checked", "false");
    expect(canvas).toHaveClass("is-active");
    expect(saved).not.toHaveClass("is-active");
  });

  it("renders the count badge when provided", () => {
    render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("invokes onChange when an inactive segment is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        value="canvas"
        onChange={onChange}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    await user.click(screen.getByRole("radio", { name: /Saved/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("saved");
  });

  it("does NOT invoke onChange when the active segment is re-clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        value="canvas"
        onChange={onChange}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    await user.click(screen.getByRole("radio", { name: /Canvas/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("arrow keys move selection between segments", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        value="canvas"
        onChange={onChange}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    const canvas = screen.getByRole("radio", { name: /Canvas/ });
    canvas.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("saved");
  });

  it("arrow keys wrap around at the ends", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        value="canvas"
        onChange={onChange}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    const canvas = screen.getByRole("radio", { name: /Canvas/ });
    canvas.focus();
    await user.keyboard("{ArrowLeft}");
    // Wraps to last item
    expect(onChange).toHaveBeenLastCalledWith("saved");
  });

  it("only the active segment is tabbable (tabIndex 0); others are -1", () => {
    render(
      <Segmented
        value="saved"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    expect(screen.getByRole("radio", { name: /Canvas/ })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("radio", { name: /Saved/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("disabled segments cannot be selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        value="canvas"
        onChange={onChange}
        items={[
          { value: "canvas", label: "Canvas" },
          { value: "saved", label: "Saved", disabled: true },
        ]}
        ariaLabel="Canvas mode"
      />,
    );
    const saved = screen.getByRole("radio", { name: /Saved/ });
    expect(saved).toBeDisabled();
    await user.click(saved);
    expect(onChange).not.toHaveBeenCalled();
  });

  // FCA #10 follow-through — the Run form's boolean control starts
  // UNSET (value matches no item). The group must stay reachable and
  // answerable by keyboard, per the WAI-ARIA radiogroup pattern.
  it("an unset group keeps its first enabled segment tabbable", () => {
    render(
      <Segmented
        value={"" as "canvas" | "saved"}
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    expect(screen.getByRole("radio", { name: /Canvas/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("radio", { name: /Saved/ })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("an unset group selects the first enabled segment on arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        value={"" as "canvas" | "saved"}
        onChange={onChange}
        items={[
          { value: "canvas", label: "Canvas", disabled: true },
          { value: "saved", label: "Saved" },
        ]}
        ariaLabel="Canvas mode"
      />,
    );
    screen.getByRole("radio", { name: /Saved/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("saved");
  });

  it("renders with the radiogroup role + aria-label", () => {
    render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
      />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Canvas mode" }),
    ).toBeInTheDocument();
  });

  it("passes testId through to data-testid", () => {
    render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
        testId="my-segmented"
      />,
    );
    expect(screen.getByTestId("my-segmented")).toBeInTheDocument();
  });

  it("composes a custom className with the base class", () => {
    render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
        className="my-extra"
        testId="seg"
      />,
    );
    const node = screen.getByTestId("seg");
    expect(node).toHaveClass("rater-segmented");
    expect(node).toHaveClass("my-extra");
  });

  it("applies the size modifier class (sm by default)", () => {
    const { rerender } = render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
        testId="seg"
      />,
    );
    expect(screen.getByTestId("seg")).toHaveClass("rater-segmented--sm");
    rerender(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
        size="md"
        testId="seg"
      />,
    );
    expect(screen.getByTestId("seg")).toHaveClass("rater-segmented--md");
  });
});

describe("<Segmented> — sliding thumb (Shell v3 polish)", () => {
  // jsdom reports offsetLeft/offsetWidth as 0 — mock them so the
  // measurement effect produces real values (same approach as the
  // Menu collision-positioning tests).
  const mockOffsets = (left: number, width: number) => {
    const leftSpy = vi
      .spyOn(HTMLElement.prototype, "offsetLeft", "get")
      .mockReturnValue(left);
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(width);
    return () => {
      leftSpy.mockRestore();
      widthSpy.mockRestore();
    };
  };

  it("renders one thumb element behind the items", () => {
    render(
      <Segmented
        value="canvas"
        onChange={() => {}}
        items={ITEMS}
        ariaLabel="Canvas mode"
        testId="seg"
      />,
    );
    const root = screen.getByTestId("seg");
    const thumb = root.querySelector(".rater-segmented__thumb");
    expect(thumb).not.toBeNull();
    expect(thumb).toHaveAttribute("aria-hidden");
  });

  it("measures the active segment into the thumb custom properties", () => {
    const restore = mockOffsets(42, 87);
    try {
      render(
        <Segmented
          value="saved"
          onChange={() => {}}
          items={ITEMS}
          ariaLabel="Canvas mode"
          testId="seg"
        />,
      );
      const root = screen.getByTestId("seg");
      expect(root.style.getPropertyValue("--rater-segmented-thumb-x")).toBe(
        "42px",
      );
      expect(root.style.getPropertyValue("--rater-segmented-thumb-w")).toBe(
        "87px",
      );
    } finally {
      restore();
    }
  });

  it("re-measures when the value changes (the slide)", () => {
    const restore = mockOffsets(4, 60);
    try {
      const { rerender } = render(
        <Segmented
          value="canvas"
          onChange={() => {}}
          items={ITEMS}
          ariaLabel="Canvas mode"
          testId="seg"
        />,
      );
      restore();
      const restore2 = mockOffsets(70, 88);
      rerender(
        <Segmented
          value="saved"
          onChange={() => {}}
          items={ITEMS}
          ariaLabel="Canvas mode"
          testId="seg"
        />,
      );
      const root = screen.getByTestId("seg");
      expect(root.style.getPropertyValue("--rater-segmented-thumb-x")).toBe(
        "70px",
      );
      expect(root.style.getPropertyValue("--rater-segmented-thumb-w")).toBe(
        "88px",
      );
      restore2();
    } finally {
      // restore() already called above; double-restore is a no-op via spy semantics
    }
  });
});
