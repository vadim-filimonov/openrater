/**
 * <Tabs> — ARIA-pattern tab navigation.
 *
 * Composition pattern (controlled):
 *
 *   <Tabs value={value} onValueChange={setValue}>
 *     <Tabs.List aria-label="Filter by severity">
 *       <Tabs.Trigger value="all">All</Tabs.Trigger>
 *       <Tabs.Trigger value="error">Errors</Tabs.Trigger>
 *       <Tabs.Trigger value="warning">Warnings</Tabs.Trigger>
 *     </Tabs.List>
 *     <Tabs.Panel value="all">…</Tabs.Panel>
 *     <Tabs.Panel value="error">…</Tabs.Panel>
 *     <Tabs.Panel value="warning">…</Tabs.Panel>
 *   </Tabs>
 *
 * ARIA pattern:
 *   - <Tabs.List role="tablist" aria-label="…">
 *   - <Tabs.Trigger role="tab" aria-selected={…} aria-controls={…}>
 *   - <Tabs.Panel role="tabpanel" aria-labelledby={…}>
 *
 * Keyboard (per WAI-ARIA Authoring Practices):
 *   - ArrowLeft / ArrowRight — move focus between triggers
 *   - Home — focus first trigger
 *   - End — focus last trigger
 *   - Tab moves OUT of the tablist into the active panel (NOT between
 *     triggers — triggers are reachable only via the arrow keys, the
 *     standard tab pattern)
 *   - Activating a trigger (focus alone) auto-selects (manual activation
 *     model NOT used; cold-test prefers immediate feedback)
 *
 * Used in V1 by:
 *   - Brief 13's unified error filter chips (severity + source + section)
 *   - Brief 17's <LobFilterTabs> for the multi-LOB plan section grouping
 *   - Brief 8's classification browser filter (LOB, family)
 *   - Brief 12's compare-view mode switcher
 *
 * BEM class names:
 *   .rater-tabs                                (root)
 *   .rater-tabs__list                          (the tablist)
 *   .rater-tabs__trigger                       (one tab button)
 *   .rater-tabs__trigger--selected             (the active trigger)
 *   .rater-tabs__panel                         (panel content)
 *
 * Tokens consumed:
 *   - --rater-text-default, --rater-text-muted, --rater-text-strong
 *   - --rater-border-subtle, --rater-border-default, --rater-accent
 *   - --rater-surface-1, --rater-surface-2
 *   - --rater-r-4, --rater-r-6
 *   - --rater-s-2, --rater-s-4, --rater-s-6, --rater-s-10, --rater-s-12
 *   - --rater-t-13, --rater-fw-medium
 *   - --rater-d-140, --rater-ease-soft
 *   - --rater-focus-ring
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import "./Tabs.css";

interface TabsContextValue {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  /** Used to build deterministic ARIA ids for trigger ↔ panel pairing. */
  readonly baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (ctx === null) {
    throw new Error(
      `<${component}> must be used inside <Tabs>. Did you forget to wrap it?`,
    );
  }
  return ctx;
}

export interface TabsProps {
  /** The active tab's value. Controlled — pair with `onValueChange`. */
  readonly value: string;
  /** Fired when the active tab changes. */
  readonly onValueChange: (next: string) => void;
  /** Tab list + panel children. */
  readonly children: ReactNode;
}

export function Tabs({ value, onValueChange, children }: TabsProps) {
  const baseId = useId();
  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className="rater-tabs">{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  /** Required for a11y — describes what the tablist filters/navigates. */
  readonly "aria-label": string;
  readonly children: ReactNode;
}

function TabsList({
  children,
  className,
  "aria-label": ariaLabel,
  ...rest
}: TabsListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { onValueChange } = useTabsContext("Tabs.List");

  /**
   * Arrow-key navigation between triggers. We move focus to the
   * adjacent trigger AND activate it (auto-select on focus model
   * — preferred for the actuary cold-test, where tabbing through
   * filters should immediately reveal results).
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const list = listRef.current;
      if (!list) return;
      const triggers = Array.from(
        list.querySelectorAll<HTMLButtonElement>(
          'button[role="tab"]:not([disabled])',
        ),
      );
      if (triggers.length === 0) return;
      const active = document.activeElement as HTMLButtonElement | null;
      const i = active ? triggers.indexOf(active) : -1;
      let nextIndex = -1;
      switch (e.key) {
        case "ArrowLeft":
          nextIndex = i <= 0 ? triggers.length - 1 : i - 1;
          break;
        case "ArrowRight":
          nextIndex = i === -1 || i === triggers.length - 1 ? 0 : i + 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = triggers.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const nextTrigger = triggers[nextIndex];
      if (!nextTrigger) return;
      nextTrigger.focus();
      // Auto-select on focus — matches the cold-test rhythm.
      const nextValue = nextTrigger.dataset["value"];
      if (nextValue !== undefined) {
        onValueChange(nextValue);
      }
    },
    [onValueChange],
  );

  return (
    <div
      ref={listRef}
      className={["rater-tabs__list", className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  /** Stable value identifying this tab. Matches Tabs.Panel value. */
  readonly value: string;
  readonly children: ReactNode;
}

const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  function TabsTrigger({ value, children, className, ...rest }, ref) {
    const ctx = useTabsContext("Tabs.Trigger");
    const selected = ctx.value === value;
    const classes = [
      "rater-tabs__trigger",
      selected ? "rater-tabs__trigger--selected" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={`${ctx.baseId}-panel-${value}`}
        id={`${ctx.baseId}-trigger-${value}`}
        data-value={value}
        tabIndex={selected ? 0 : -1}
        className={classes}
        onClick={() => ctx.onValueChange(value)}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export interface TabsPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Matches the Tabs.Trigger value that activates this panel. */
  readonly value: string;
  readonly children: ReactNode;
}

function TabsPanel({ value, children, className, ...rest }: TabsPanelProps) {
  const ctx = useTabsContext("Tabs.Panel");
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-trigger-${value}`}
      tabIndex={0}
      className={["rater-tabs__panel", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

Tabs.List = TabsList;
Tabs.Trigger = TabsTrigger;
Tabs.Panel = TabsPanel;
