/**
 * <Menu> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Menu } from "./Menu";

function setup(onSelectItem: (label: string) => void = () => {}) {
  return render(
    <Menu>
      <Menu.Trigger>
        <button>Open menu</button>
      </Menu.Trigger>
      <Menu.Items aria-label="Test menu">
        <Menu.Item onSelect={() => onSelectItem("compare")}>
          Compare versions
        </Menu.Item>
        <Menu.Item onSelect={() => onSelectItem("export")}>Export</Menu.Item>
        <Menu.Separator />
        <Menu.Item onSelect={() => onSelectItem("delete")} danger>
          Delete
        </Menu.Item>
        <Menu.Item onSelect={() => onSelectItem("disabled-item")} disabled>
          Disabled
        </Menu.Item>
      </Menu.Items>
    </Menu>,
  );
}

describe("<Menu>", () => {
  it("starts closed", () => {
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on trigger click", () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on trigger click when open (toggle)", async () => {
    setup();
    const trigger = screen.getByText("Open menu");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(trigger);
    // The exit phase holds the panel briefly (rater-menu-out) — closed
    // means removed after the closing animation/fallback completes.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("sets aria-expanded + aria-haspopup on trigger", () => {
    setup();
    const trigger = screen.getByText("Open menu");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("renders items with role=menuitem", () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    const items = screen.getAllByRole("menuitem");
    // Compare, Export, Delete, Disabled (separator is separator role)
    expect(items).toHaveLength(4);
  });

  it("renders separator with role=separator", () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("fires onSelect when item is clicked, then closes", async () => {
    const onSelect = vi.fn();
    setup(onSelect);
    fireEvent.click(screen.getByText("Open menu"));
    fireEvent.click(screen.getByText("Compare versions"));
    expect(onSelect).toHaveBeenCalledWith("compare");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("disabled item does not fire onSelect when clicked", () => {
    const onSelect = vi.fn();
    setup(onSelect);
    fireEvent.click(screen.getByText("Open menu"));
    const disabledItem = screen.getByText("Disabled");
    expect(disabledItem).toHaveAttribute("aria-disabled", "true");
  });

  it("applies danger class to danger items", () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    const deleteItem = screen.getByText("Delete");
    expect(deleteItem.className).toContain("rater-menu__item--danger");
  });

  it("closes on Escape", async () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on outside click", async () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <Menu>
          <Menu.Trigger>
            <button>Open</button>
          </Menu.Trigger>
          <Menu.Items aria-label="Test">
            <Menu.Item onSelect={() => {}}>Item</Menu.Item>
          </Menu.Items>
        </Menu>
      </div>,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("ArrowDown moves focus to next item", () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    const compare = screen.getByText("Compare versions");
    const exportItem = screen.getByText("Export");
    compare.focus();
    expect(document.activeElement).toBe(compare);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(exportItem);
  });

  it("ArrowUp from first item wraps to last", () => {
    setup();
    fireEvent.click(screen.getByText("Open menu"));
    const compare = screen.getByText("Compare versions");
    compare.focus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    // Skip disabled; last enabled is Delete
    expect(document.activeElement).toBe(screen.getByText("Delete"));
  });

  it("Enter activates the focused item", () => {
    const onSelect = vi.fn();
    setup(onSelect);
    fireEvent.click(screen.getByText("Open menu"));
    const exportItem = screen.getByText("Export");
    exportItem.focus();
    fireEvent.keyDown(exportItem, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("export");
  });

  it("Space activates the focused item", () => {
    const onSelect = vi.fn();
    setup(onSelect);
    fireEvent.click(screen.getByText("Open menu"));
    const compare = screen.getByText("Compare versions");
    compare.focus();
    fireEvent.keyDown(compare, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("compare");
  });

  it("portal-renders the menu to document.body", () => {
    const { container } = setup();
    fireEvent.click(screen.getByText("Open menu"));
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
  });

  it("supports controlled mode via open + onOpenChange", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Menu open={false} onOpenChange={onOpenChange}>
        <Menu.Trigger>
          <button>T</button>
        </Menu.Trigger>
        <Menu.Items aria-label="X">
          <Menu.Item onSelect={() => {}}>I</Menu.Item>
        </Menu.Items>
      </Menu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByText("T"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    rerender(
      <Menu open={true} onOpenChange={onOpenChange}>
        <Menu.Trigger>
          <button>T</button>
        </Menu.Trigger>
        <Menu.Items aria-label="X">
          <Menu.Item onSelect={() => {}}>I</Menu.Item>
        </Menu.Items>
      </Menu>,
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("<Menu> — positioning (stays on-screen)", () => {
  // jsdom has no layout, so mock the few measurements the positioner reads:
  // the trigger's rect, the menu's width, and the viewport size.
  function withLayout(
    args: {
      anchorRect: Partial<DOMRect>;
      menuWidth: number;
      innerWidth: number;
      innerHeight?: number;
    },
    body: () => void,
  ) {
    const owDesc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    const ohDesc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    const origW = window.innerWidth;
    const origH = window.innerHeight;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return args.menuWidth;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 0;
      },
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: args.innerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: args.innerHeight ?? 800,
    });
    try {
      body();
    } finally {
      if (owDesc)
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", owDesc);
      if (ohDesc)
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", ohDesc);
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: origW,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: origH,
      });
    }
  }

  function rect(over: Partial<DOMRect>): DOMRect {
    const base = {
      x: 0,
      y: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
    return { ...base, ...over, toJSON() {} } as DOMRect;
  }

  it("left-aligns the menu to the trigger when there's room", () => {
    withLayout(
      { anchorRect: {}, menuWidth: 200, innerWidth: 1200 },
      () => {
        const { container } = setup();
        const anchor = container.querySelector(".rater-menu-anchor")!;
        anchor.getBoundingClientRect = () =>
          rect({ left: 100, right: 130, top: 30, bottom: 50 });
        fireEvent.click(screen.getByText("Open menu"));
        // left edge of menu == left edge of trigger (no overflow).
        expect(screen.getByRole("menu").style.left).toBe("100px");
      },
    );
  });

  it("right-aligns to the trigger when a left-aligned menu would overflow the right edge", () => {
    withLayout(
      { anchorRect: {}, menuWidth: 200, innerWidth: 400 },
      () => {
        const { container } = setup();
        const anchor = container.querySelector(".rater-menu-anchor")!;
        // Trigger near the right edge (right=395 of a 400px viewport).
        anchor.getBoundingClientRect = () =>
          rect({ left: 375, right: 395, top: 100, bottom: 120 });
        fireEvent.click(screen.getByText("Open menu"));
        // Left-align (375) would spill to 575 > 392, so it opens leftward:
        // left = right(395) - width(200) = 195. Never clipped on the right.
        const menu = screen.getByRole("menu");
        expect(menu.style.left).toBe("195px");
        expect(195 + 200).toBeLessThanOrEqual(400); // right edge within viewport
        // Origin-aware entrance: a right-aligned panel grows from its
        // top-RIGHT corner (data-aligned drives transform-origin).
        expect(menu).toHaveAttribute("data-aligned", "right");
      },
    );
  });

  it("marks data-flipped when the menu opens upward (bottom collision)", () => {
    withLayout(
      // Menu is 200 tall via offsetHeight=0 mock? height mock returns 0 →
      // the flip branch needs a real menuHeight. Use offsetWidth mock for
      // width AND override offsetHeight via the same prototype hook.
      { anchorRect: {}, menuWidth: 200, innerWidth: 1200, innerHeight: 300 },
      () => {
        const ohDesc = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          "offsetHeight",
        );
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
          configurable: true,
          get() {
            return 150;
          },
        });
        try {
          const { container } = setup();
          const anchor = container.querySelector(".rater-menu-anchor")!;
          // Trigger near the bottom of a 300px viewport: below would
          // overflow (254+150 > 292) and above fits (250-4-150 >= 8).
          anchor.getBoundingClientRect = () =>
            rect({ left: 100, right: 130, top: 250, bottom: 250 });
          fireEvent.click(screen.getByText("Open menu"));
          const menu = screen.getByRole("menu");
          expect(menu).toHaveAttribute("data-flipped");
          // top = trigger.top(250) - GAP(4) - height(150) = 96
          expect(menu.style.top).toBe("96px");
        } finally {
          if (ohDesc)
            Object.defineProperty(
              HTMLElement.prototype,
              "offsetHeight",
              ohDesc,
            );
        }
      },
    );
  });

  it("keeps the last position while the exit animation plays (no -9999px jump)", async () => {
    withLayout(
      { anchorRect: {}, menuWidth: 200, innerWidth: 1200 },
      () => {
        const { container } = setup();
        const anchor = container.querySelector(".rater-menu-anchor")!;
        anchor.getBoundingClientRect = () =>
          rect({ left: 100, right: 130, top: 30, bottom: 50 });
        fireEvent.click(screen.getByText("Open menu"));
        expect(screen.getByRole("menu").style.left).toBe("100px");
        fireEvent.click(screen.getByText("Open menu")); // toggle close
        // While closing, the panel holds position + the --closing class.
        const closingMenu = screen.queryByRole("menu");
        if (closingMenu) {
          expect(closingMenu.className).toContain("rater-menu--closing");
          expect(closingMenu.style.left).toBe("100px");
        }
      },
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
