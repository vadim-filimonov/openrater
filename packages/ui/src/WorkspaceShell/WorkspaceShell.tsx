/**
 * <WorkspaceShell> — the consistent chrome wrapping every Brief 24
 * workspace (sub-brief 24.F).
 *
 * The shell provides the 3-slot layout every workspace inherits:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  HEADER STRIP                                       │
 *   │   - title + description on the left                 │
 *   │   - headerActions on the right                      │
 *   ├──────────────────┬──────────────────────────────────┤
 *   │  TOOL PANE       │  CONTENT                         │
 *   │  ~268px fixed    │  fills remaining width           │
 *   │  surface-2       │  surface-1                       │
 *   │  authoring       │  the actual list / canvas /      │
 *   │  affordances     │  whatever the workspace renders  │
 *   └──────────────────┴──────────────────────────────────┘
 *
 * Pure chrome — no business logic. Each workspace owns its own
 * tool-pane contents (via <WorkspaceToolPane>) and content area.
 *
 * The shell is the "card" — no extra card chrome inside the content
 * area. The shell renders its own outer border + radius + bg.
 */

import type { JSX, ReactNode } from "react";
import "./WorkspaceShell.css";

export interface WorkspaceShellProps {
  /** Workspace title (e.g., "DIMENSIONS"). Rendered as h2. */
  readonly title: string;
  /**
   * Optional one-line description below the title. Sets the mental
   * frame ("Define the variables your plan reads from each submission.").
   */
  readonly description?: string;
  /**
   * Right-aligned actions in the header strip. Typically a row of
   * ghost-variant Buttons (Run sample, Compare to filed, ⚙ Settings).
   */
  readonly headerActions?: ReactNode;
  /**
   * The left tool pane. Typically `<WorkspaceToolPane>...</WorkspaceToolPane>`
   * but any ReactNode works (e.g., for custom palettes in ASSEMBLE).
   */
  readonly toolPane: ReactNode;
  /**
   * The right content area. The workspace's actual list / grid / canvas.
   */
  readonly children: ReactNode;
  readonly testId?: string;
}

export function WorkspaceShell(props: WorkspaceShellProps): JSX.Element {
  const {
    title,
    description,
    headerActions,
    toolPane,
    children,
    testId = "rater-workspace-shell",
  } = props;

  // 24.F3 — the big h2 title is dropped (the active tab labels the
  // workspace). We retain the strip ONLY when there's something to
  // show on it (description and/or actions). The aria-label keeps
  // the screen-reader workspace identity.
  const hasContextStrip =
    (description !== undefined && description !== "") || headerActions;

  return (
    <section
      className="rater-workspace-shell"
      data-testid={testId}
      aria-label={title}
    >
      {hasContextStrip ? (
        <header className="rater-workspace-shell__context">
          {description ? (
            <p className="rater-workspace-shell__description">{description}</p>
          ) : (
            // Spacer keeps actions right-aligned when there's no description
            <span />
          )}
          {headerActions ? (
            <div className="rater-workspace-shell__actions">{headerActions}</div>
          ) : null}
        </header>
      ) : null}
      <div className="rater-workspace-shell__body">
        <aside
          className="rater-workspace-shell__tool-pane"
          aria-label={`${title} tools`}
        >
          {toolPane}
        </aside>
        <div className="rater-workspace-shell__content">{children}</div>
      </div>
    </section>
  );
}
