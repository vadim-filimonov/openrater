/**
 * <WorkspaceTabs> — the top tab strip for the Plan-Builder workspaces
 * (sub-brief 24.F2).
 *
 * Replaces the 24.B left rail. Each tab is a Brief-24-v3 workspace
 * (Inputs / Dimensions / Parametrize / Gate / Assemble / Verify). The
 * primitive is pure presentation — the route owns URL state + the
 * active-workspace lookup.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Inputs   Dimensions   Parametrize   Gate   Assemble   Verify    │
 *   │  ──────                                                          │  ← 2px accent underline
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * ARIA pattern follows WAI-ARIA tabs guidance:
 *   - role="tablist" on the <nav>
 *   - role="tab" + aria-selected on each button
 *   - Keyboard: arrow keys navigate, Home/End jump to ends
 *
 * Apple-grade visual:
 *   - Tab labels in t-13 medium, no icons (clean type-only nav)
 *   - Inactive: text-muted, surface-1 bg
 *   - Hover: text-default, subtle row-hover bg
 *   - Active: text-strong + 2px accent underline (cat-input azure)
 *   - Strip bottom-bordered with hairline-base; sits below the
 *     studio header, above the workspace content
 */

import type { JSX, KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
import "./WorkspaceTabs.css";

/**
 * One workspace tab. Aligned with @openrater/contracts'
 * `WORKSPACE_ORDER` + `WORKSPACE_LABELS` — but the primitive doesn't
 * import from contracts directly to stay layer-clean.
 */
export interface WorkspaceTabSpec {
  /** The workspace ID — used as the value the active tab tracks. */
  readonly id: string;
  /** Visible label — e.g., "Inputs", "Dimensions". */
  readonly label: string;
  /**
   * Optional 14px icon rendered before the label. Use lucide-react
   * icons (sized 14). Keeps the type-only labels readable while
   * adding faster pattern recognition (24.F3 polish).
   */
  readonly icon?: ReactNode;
  /**
   * Optional status indicator — a tiny tone-keyed dot rendered to the
   * right of the label. Use for "required-empty" / "in progress" /
   * etc. Keep total count of dots low for readability.
   */
  readonly status?: "required-empty" | "in-progress" | "complete";
  /**
   * Optional decorator that puts the tab on the right side of the
   * strip after a flexible spacer. Use for Verify (which is an
   * execution surface, not an authoring step).
   */
  readonly isSibling?: boolean;
}

export interface WorkspaceTabsProps {
  /** Tabs in display order, left to right. */
  readonly tabs: readonly WorkspaceTabSpec[];
  /** The currently-active tab id. */
  readonly active: string;
  /** Fires when the user picks a tab (click or keyboard activation). */
  readonly onSelect: (id: string) => void;
  /** Aria label for the tablist (defaults to "Plan workspaces"). */
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function WorkspaceTabs(props: WorkspaceTabsProps): JSX.Element {
  const {
    tabs,
    active,
    onSelect,
    ariaLabel = "Plan workspaces",
    testId = "rater-workspace-tabs",
  } = props;
  const listRef = useRef<HTMLDivElement | null>(null);

  // Split into authoring tabs (left side) + sibling tabs (right side,
  // e.g., Verify). The spacer between them is a flex-grow div.
  const authoring = tabs.filter((t) => !t.isSibling);
  const siblings = tabs.filter((t) => t.isSibling);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const flat = [...authoring, ...siblings];
    const currentIdx = flat.findIndex((t) => t.id === active);
    if (currentIdx === -1) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") {
      nextIdx = (currentIdx + 1) % flat.length;
    } else if (e.key === "ArrowLeft") {
      nextIdx = (currentIdx - 1 + flat.length) % flat.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = flat.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const target = flat[nextIdx];
      if (target !== undefined) {
        onSelect(target.id);
        // Move focus to the next tab — visual feedback for keyboard nav.
        const node = listRef.current?.querySelector<HTMLButtonElement>(
          `[data-tab-id="${target.id}"]`,
        );
        node?.focus();
      }
    }
  };

  const renderTab = (tab: WorkspaceTabSpec) => {
    const isActive = tab.id === active;
    return (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={isActive}
        // Brief 82 R3 (F16) — the name is explicit: some a11y-tree
        // consumers don't compose role=tab names from nested spans.
        aria-label={tab.label}
        tabIndex={isActive ? 0 : -1}
        data-tab-id={tab.id}
        // Polish PR 8 — `data-kind` lets the CSS tint the active
        // tab's underline with the workspace's canonical category
        // color (audit §C5 + §G4). Inputs=azure, Dimensions=violet,
        // Parametrize=amber, Gate=red, Assemble=emerald. Verify falls
        // back to the default accent-primary.
        data-kind={tab.id}
        className={`rater-workspace-tabs__tab${
          isActive ? " rater-workspace-tabs__tab--active" : ""
        }${tab.isSibling ? " rater-workspace-tabs__tab--sibling" : ""}`}
        onClick={() => onSelect(tab.id)}
      >
        {tab.icon ? (
          <span className="rater-workspace-tabs__tab-icon" aria-hidden>
            {tab.icon}
          </span>
        ) : null}
        <span className="rater-workspace-tabs__tab-label">{tab.label}</span>
        {tab.status ? (
          <span
            className={`rater-workspace-tabs__tab-status rater-workspace-tabs__tab-status--${tab.status}`}
            aria-hidden
          />
        ) : null}
      </button>
    );
  };

  return (
    <nav
      className="rater-workspace-tabs"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className="rater-workspace-tabs__list"
        onKeyDown={handleKeyDown}
      >
        {authoring.map(renderTab)}
        {siblings.length > 0 ? (
          <span className="rater-workspace-tabs__spacer" aria-hidden />
        ) : null}
        {/*  — a hairline + eyebrow names the right group, so
            its quieter tint reads as grouping, not disabled. */}
        {siblings.length > 0 ? (
          <span className="rater-workspace-tabs__group" aria-hidden>
            <span className="rater-workspace-tabs__group-rule" />
            <span className="rater-workspace-tabs__group-eyebrow">
              Run &amp; ship
            </span>
          </span>
        ) : null}
        {siblings.map(renderTab)}
      </div>
    </nav>
  );
}
