/**
 * <CommandPalette> — Cmd+K launcher.
 *
 * PHASE_B_PLAN.md §0.2 (Linear-grade structural principle —
 * "Command palette"). Single entry point for jumping across the
 * plan: navigate to a section, jump to an entity (chain, dimension,
 * factor table, curve, class), trigger an action (compare, export,
 * rate sample).
 *
 *   <CommandPalette
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     commands={[
 *       { id: "nav-risk-inputs", group: "Navigate",
 *         label: "Risk Inputs", hint: "Section 1",
 *         onSelect: () => navigate("risk-inputs") },
 *       { id: "compare-filed", group: "Actions",
 *         label: "Compare to filed version",
 *         shortcut: "C V", onSelect: () => openCompare() },
 *     ]}
 *   />
 *
 * Pair with `useCommandPaletteHotkey({ onOpen })` for the Cmd+K
 * binding (Meta+K on Mac, Ctrl+K on Windows/Linux).
 *
 * Behavior:
 *   - Input field auto-focuses on open; type-to-search filters
 *     case-insensitively on label + hint + group
 *   - ArrowDown / ArrowUp navigate highlighted command (wraps;
 *     respects group order)
 *   - Enter invokes the highlighted command's onSelect + closes
 *   - Escape closes
 *   - Click on a command activates it
 *   - Body scroll lock + focus trap (inherited from Modal pattern)
 *   - Portal-rendered to document.body
 *   - Groups are headers above their commands; empty groups are
 *     hidden
 *
 * BEM:
 *   .rater-command-palette__backdrop
 *   .rater-command-palette
 *   .rater-command-palette__field
 *   .rater-command-palette__list
 *   .rater-command-palette__group
 *   .rater-command-palette__group-title
 *   .rater-command-palette__item
 *   .rater-command-palette__item--highlighted
 *   .rater-command-palette__item-icon
 *   .rater-command-palette__item-label
 *   .rater-command-palette__item-hint
 *   .rater-command-palette__item-shortcut
 *   .rater-command-palette__empty
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./CommandPalette.css";

export interface Command {
  readonly id: string;
  readonly label: string;
  /** Optional secondary text (e.g., "Section 1" or "Brief 12 export"). */
  readonly hint?: string;
  /** Optional grouping (rendered as a section header). Commands with
   *  the same group cluster together; commands with no group fall
   *  into a default "Commands" group. Group order is determined by
   *  first appearance in the commands array. */
  readonly group?: string;
  /** Optional leading icon. */
  readonly icon?: ReactNode;
  /** Optional shortcut hint (e.g., "C V" for "press C then V").
   *  Display-only; the palette doesn't bind anything to it. */
  readonly shortcut?: string;
  /** Disabled commands are non-interactive + skipped by keyboard
   *  navigation. */
  readonly disabled?: boolean;
  /** Fires when the command is activated (click or Enter). The
   *  palette closes itself AFTER onSelect returns. */
  readonly onSelect: () => void;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly commands: readonly Command[];
  readonly placeholder?: string;
  /** Empty state when no commands match the query. Defaults to
   *  "No matches." */
  readonly emptyText?: string;
}

const DEFAULT_GROUP = "Commands";

interface FilteredGroup {
  readonly title: string;
  readonly items: readonly Command[];
}

function filterCommands(
  commands: readonly Command[],
  query: string,
): readonly Command[] {
  const q = query.trim().toLowerCase();
  if (q === "") return commands;
  return commands.filter((c) => {
    if (c.label.toLowerCase().includes(q)) return true;
    if (c.hint?.toLowerCase().includes(q)) return true;
    if (c.group?.toLowerCase().includes(q)) return true;
    return false;
  });
}

function groupCommands(commands: readonly Command[]): readonly FilteredGroup[] {
  const groups = new Map<string, Command[]>();
  const order: string[] = [];
  for (const c of commands) {
    const g = c.group ?? DEFAULT_GROUP;
    if (!groups.has(g)) {
      groups.set(g, []);
      order.push(g);
    }
    groups.get(g)!.push(c);
  }
  return order.map((title) => ({ title, items: groups.get(title)! }));
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = "Search commands…",
  emptyText = "No matches.",
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );
  const grouped = useMemo(() => groupCommands(filtered), [filtered]);

  // Flat list of enabled, in-order command ids — for keyboard nav.
  const navigableIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of grouped) {
      for (const c of g.items) {
        if (!c.disabled) ids.push(c.id);
      }
    }
    return ids;
  }, [grouped]);

  // Reset query + highlight when the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  // Default highlight to first navigable command whenever the
  // navigable set changes (on open + on every keystroke).
  useEffect(() => {
    if (!open) {
      setHighlightedId(null);
      return;
    }
    if (navigableIds.length === 0) {
      setHighlightedId(null);
      return;
    }
    setHighlightedId((prev) => {
      if (prev !== null && navigableIds.includes(prev)) return prev;
      return navigableIds[0]!;
    });
  }, [open, navigableIds]);

  // Auto-focus the input on open.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSelect = useCallback(
    (cmd: Command) => {
      if (cmd.disabled) return;
      cmd.onSelect();
      onClose();
    },
    [onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (navigableIds.length === 0) return;
      const i = highlightedId ? navigableIds.indexOf(highlightedId) : -1;
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = i === -1 || i === navigableIds.length - 1 ? 0 : i + 1;
          setHighlightedId(navigableIds[next]!);
          return;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev =
            i <= 0 ? navigableIds.length - 1 : i - 1;
          setHighlightedId(navigableIds[prev]!);
          return;
        }
        case "Enter": {
          e.preventDefault();
          if (highlightedId !== null) {
            const cmd = filtered.find((c) => c.id === highlightedId);
            if (cmd) handleSelect(cmd);
          }
          return;
        }
        default:
          return;
      }
    },
    [navigableIds, highlightedId, filtered, handleSelect],
  );

  // Scroll highlighted item into view on highlight change.
  useEffect(() => {
    if (highlightedId === null) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(
      `[data-command-id="${CSS.escape(highlightedId)}"]`,
    );
    // scrollIntoView is unimplemented in some test harnesses (JSDOM);
    // guard the call so the production behavior isn't blocked.
    if (el && typeof el.scrollIntoView === "function") {
      // "nearest" so we don't yank the viewport for items already visible.
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedId]);

  if (!open) return null;

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const listboxId = `${baseId}-list`;

  return createPortal(
    <div
      className="rater-command-palette__backdrop"
      onClick={onBackdropClick}
      data-testid="rater-command-palette-backdrop"
    >
      <div
        className="rater-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={true}
          aria-controls={listboxId}
          aria-activedescendant={
            highlightedId ? `${baseId}-item-${highlightedId}` : undefined
          }
          className="rater-command-palette__field"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Commands"
          className="rater-command-palette__list"
        >
          {grouped.length === 0 ? (
            <div className="rater-command-palette__empty">{emptyText}</div>
          ) : (
            grouped.map((g) => (
              <section key={g.title} className="rater-command-palette__group">
                <h3 className="rater-command-palette__group-title">{g.title}</h3>
                {g.items.map((cmd) => {
                  const highlighted = cmd.id === highlightedId;
                  return (
                    <div
                      key={cmd.id}
                      id={`${baseId}-item-${cmd.id}`}
                      data-command-id={cmd.id}
                      role="option"
                      aria-selected={highlighted}
                      aria-disabled={cmd.disabled || undefined}
                      className={[
                        "rater-command-palette__item",
                        highlighted ? "rater-command-palette__item--highlighted" : null,
                        cmd.disabled ? "rater-command-palette__item--disabled" : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(cmd);
                      }}
                      onPointerEnter={() => {
                        if (!cmd.disabled) setHighlightedId(cmd.id);
                      }}
                    >
                      {cmd.icon ? (
                        <span
                          className="rater-command-palette__item-icon"
                          aria-hidden
                        >
                          {cmd.icon}
                        </span>
                      ) : null}
                      <span className="rater-command-palette__item-label">
                        {cmd.label}
                      </span>
                      {cmd.hint ? (
                        <span className="rater-command-palette__item-hint">
                          {cmd.hint}
                        </span>
                      ) : null}
                      {cmd.shortcut ? (
                        <span className="rater-command-palette__item-shortcut">
                          {cmd.shortcut}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Wire Cmd+K (Meta+K on Mac, Ctrl+K on Windows/Linux) to open the
 * command palette. Pair with the parent's open state setter:
 *
 *   const [open, setOpen] = useState(false);
 *   useCommandPaletteHotkey({ onOpen: () => setOpen(true) });
 *
 * Suppresses the hotkey when the user is already typing in an input,
 * textarea, or contenteditable so we don't steal Ctrl+K from rich
 * text editors etc. The palette itself catches its own Ctrl+K (when
 * `enabled` stays true) so the actuary can press Ctrl+K to close.
 *
 * Returns a cleanup function automatically via useEffect; the hook
 * yields nothing.
 */
export function useCommandPaletteHotkey({
  onOpen,
  enabled = true,
  hotkey = "k",
}: {
  readonly onOpen: () => void;
  readonly enabled?: boolean;
  /** Hotkey letter pressed with Cmd / Ctrl. Defaults to "k". */
  readonly hotkey?: string;
}) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      // Cmd+K on Mac, Ctrl+K elsewhere
      const metaOrCtrl = e.metaKey || e.ctrlKey;
      if (!metaOrCtrl) return;
      if (e.key.toLowerCase() !== hotkey.toLowerCase()) return;
      // Don't steal from rich-text editing surfaces
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        if (active.isContentEditable) return;
      }
      e.preventDefault();
      onOpen();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, hotkey, onOpen]);
}
