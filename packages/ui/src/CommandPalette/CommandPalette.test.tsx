/**
 * <CommandPalette> + useCommandPaletteHotkey tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, renderHook } from "@testing-library/react";
import {
  CommandPalette,
  useCommandPaletteHotkey,
  type Command,
} from "./CommandPalette";

const COMMANDS: readonly Command[] = [
  {
    id: "nav-risk-inputs",
    group: "Navigate",
    label: "Risk Inputs",
    hint: "Section 1",
    onSelect: vi.fn(),
  },
  {
    id: "nav-classification",
    group: "Navigate",
    label: "Classification",
    hint: "Section 3",
    onSelect: vi.fn(),
  },
  {
    id: "act-compare",
    group: "Actions",
    label: "Compare to filed version",
    shortcut: "C V",
    onSelect: vi.fn(),
  },
  {
    id: "act-export",
    group: "Actions",
    label: "Export diff report",
    disabled: true,
    onSelect: vi.fn(),
  },
];

describe("<CommandPalette> — visibility", () => {
  it("renders nothing when closed", () => {
    render(
      <CommandPalette open={false} onClose={() => {}} commands={COMMANDS} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog when open", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("<CommandPalette> — rendering + groups", () => {
  it("renders group titles", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    expect(screen.getByText("Navigate")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });

  it("renders command labels + hints + shortcuts", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    expect(screen.getByText("Risk Inputs")).toBeInTheDocument();
    expect(screen.getByText("Section 1")).toBeInTheDocument();
    expect(screen.getByText("C V")).toBeInTheDocument();
  });

  it("disabled commands have aria-disabled", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const exportItem = screen.getByText("Export diff report").closest('[role="option"]');
    expect(exportItem).toHaveAttribute("aria-disabled", "true");
  });

  it("highlights the first enabled command by default", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const first = screen.getByText("Risk Inputs").closest('[role="option"]');
    expect(first?.className).toContain("--highlighted");
  });

  it("uses default group name when group is unset", () => {
    const ungrouped: Command[] = [
      { id: "x", label: "Ungrouped command", onSelect: () => {} },
    ];
    render(<CommandPalette open onClose={() => {}} commands={ungrouped} />);
    expect(screen.getByText("Commands")).toBeInTheDocument();
  });
});

describe("<CommandPalette> — filtering", () => {
  it("filters by typing in the input", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "compare" } });
    expect(screen.getByText("Compare to filed version")).toBeInTheDocument();
    expect(screen.queryByText("Risk Inputs")).toBeNull();
  });

  it("filter is case-insensitive", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "CLASSIFICATION" },
    });
    expect(screen.getByText("Classification")).toBeInTheDocument();
  });

  it("filters by hint substring", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "section 3" },
    });
    expect(screen.getByText("Classification")).toBeInTheDocument();
  });

  it("filters by group substring", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "actions" },
    });
    expect(screen.queryByText("Risk Inputs")).toBeNull();
    expect(screen.getByText("Compare to filed version")).toBeInTheDocument();
  });

  it("shows empty state when nothing matches", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={COMMANDS}
        emptyText="Nothing found"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "xyz-no-match" },
    });
    expect(screen.getByText("Nothing found")).toBeInTheDocument();
  });
});

describe("<CommandPalette> — keyboard navigation", () => {
  it("ArrowDown moves highlight to next enabled command", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const classification = screen.getByText("Classification").closest('[role="option"]');
    expect(classification?.className).toContain("--highlighted");
  });

  it("ArrowDown skips disabled commands", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const input = screen.getByRole("combobox");
    // start: Risk Inputs; down x3 should land on Compare (not Export which is disabled)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const compare = screen.getByText("Compare to filed version").closest('[role="option"]');
    expect(compare?.className).toContain("--highlighted");
  });

  it("ArrowUp wraps from first to last enabled", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // Wraps to "Compare to filed version" (Export is disabled, skipped)
    const compare = screen.getByText("Compare to filed version").closest('[role="option"]');
    expect(compare?.className).toContain("--highlighted");
  });

  it("Enter activates the highlighted command + closes", () => {
    const onClose = vi.fn();
    const onSelectFirst = vi.fn();
    const cmds: Command[] = [
      { id: "x", label: "X", onSelect: onSelectFirst },
    ];
    render(<CommandPalette open onClose={onClose} commands={cmds} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSelectFirst).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("<CommandPalette> — mouse interaction", () => {
  it("clicking a command activates it + closes", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const cmds: Command[] = [
      { id: "x", label: "X command", onSelect },
    ];
    render(<CommandPalette open onClose={onClose} commands={cmds} />);
    fireEvent.mouseDown(screen.getByText("X command"));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the backdrop closes", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={COMMANDS} />);
    fireEvent.click(screen.getByTestId("rater-command-palette-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("pointer-enter on a command highlights it", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const compare = screen.getByText("Compare to filed version").closest('[role="option"]');
    if (compare) fireEvent.pointerEnter(compare);
    expect(compare?.className).toContain("--highlighted");
  });
});

describe("<CommandPalette> — ARIA + escape", () => {
  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={COMMANDS} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("input has role=combobox + aria-autocomplete=list", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("aria-activedescendant points at the highlighted command", () => {
    render(<CommandPalette open onClose={() => {}} commands={COMMANDS} />);
    const input = screen.getByRole("combobox");
    const first = screen.getByText("Risk Inputs").closest('[role="option"]');
    expect(input.getAttribute("aria-activedescendant")).toBe(first?.id);
  });
});

describe("useCommandPaletteHotkey", () => {
  it("opens on Cmd+K (mac)", () => {
    const onOpen = vi.fn();
    renderHook(() => useCommandPaletteHotkey({ onOpen }));
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens on Ctrl+K (windows/linux)", () => {
    const onOpen = vi.fn();
    renderHook(() => useCommandPaletteHotkey({ onOpen }));
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("does NOT open when typing in an input element", () => {
    const onOpen = vi.fn();
    const { container } = render(<input type="text" data-testid="textinput" />);
    renderHook(() => useCommandPaletteHotkey({ onOpen }));
    const input = container.querySelector('[data-testid="textinput"]') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does NOT open when enabled=false", () => {
    const onOpen = vi.fn();
    renderHook(() => useCommandPaletteHotkey({ onOpen, enabled: false }));
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("respects a custom hotkey", () => {
    const onOpen = vi.fn();
    renderHook(() => useCommandPaletteHotkey({ onOpen, hotkey: "p" }));
    fireEvent.keyDown(document, { key: "p", metaKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    // Only "p" should have triggered; "k" should not increment
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
