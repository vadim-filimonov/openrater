/**
 * <WorkspaceToolPane> — sub-brief 24.F.
 *
 * Compound primitive for the left-pane content of a <WorkspaceShell>.
 * Section heading + tool buttons in labeled groups, with consistent
 * vertical rhythm + dividers.
 *
 * Usage:
 *
 *   <WorkspaceToolPane>
 *     <WorkspaceToolPane.Section label="ADD">
 *       <WorkspaceToolPane.Button
 *         icon={<Variable size={16} />}
 *         onClick={() => onAddStandard()}
 *       >
 *         Standard
 *       </WorkspaceToolPane.Button>
 *       …
 *     </WorkspaceToolPane.Section>
 *
 *     <WorkspaceToolPane.Section label="TEMPLATES">
 *       …
 *     </WorkspaceToolPane.Section>
 *   </WorkspaceToolPane>
 *
 * Per docs/design-briefs/24f-workspace-shell.md §Tool pane.
 */

import type {
  DragEventHandler,
  JSX,
  MouseEventHandler,
  ReactNode,
} from "react";
import "./WorkspaceToolPane.css";

export interface WorkspaceToolPaneProps {
  readonly children: ReactNode;
  readonly testId?: string;
}

function WorkspaceToolPaneRoot(props: WorkspaceToolPaneProps): JSX.Element {
  const { children, testId = "rater-workspace-tool-pane" } = props;
  return (
    <div className="rater-workspace-tool-pane" data-testid={testId}>
      {children}
    </div>
  );
}

export interface WorkspaceToolPaneSectionProps {
  /** Uppercase section label (e.g., "ADD", "TEMPLATES"). */
  readonly label: string;
  readonly children: ReactNode;
}

function WorkspaceToolPaneSection(
  props: WorkspaceToolPaneSectionProps,
): JSX.Element {
  const { label, children } = props;
  return (
    <section className="rater-workspace-tool-pane__section">
      <h3 className="rater-workspace-tool-pane__section-heading">{label}</h3>
      <div className="rater-workspace-tool-pane__section-body">{children}</div>
    </section>
  );
}

export interface WorkspaceToolPaneButtonProps {
  readonly icon?: ReactNode;
  /** Optional descriptive subtext rendered on a second line, smaller. */
  readonly sublabel?: string;
  readonly onClick?: MouseEventHandler<HTMLButtonElement>;
  readonly disabled?: boolean;
  readonly children: ReactNode;
  /**
   * Draggable affordance — when true, the button can be dragged.
   * Used by ASSEMBLE's stage palette (sub-brief 24.H) to let users
   * drag a stage kind onto the canvas.
   */
  readonly draggable?: boolean;
  /**
   * Fired on dragStart when `draggable` is true. The consumer is
   * responsible for setting `event.dataTransfer` (typically a
   * `setData(mime, kindId)` call) so the drop target knows what was
   * dragged.
   */
  readonly onDragStart?: DragEventHandler<HTMLButtonElement>;
  /**
   * Subtle category tint for the icon square. Drives the
   * `--*-soft` background + colored icon. One of the 6 ADR-0023
   * categorical roles. When unset, the icon stays neutral.
   */
  readonly tone?:
    | "input"
    | "transform"
    | "lookup"
    | "math"
    | "loading"
    | "output";
  readonly testId?: string;
}

function WorkspaceToolPaneButton(
  props: WorkspaceToolPaneButtonProps,
): JSX.Element {
  const {
    icon,
    sublabel,
    onClick,
    disabled,
    children,
    draggable,
    onDragStart,
    tone,
    testId,
  } = props;
  const toneClass = tone
    ? ` rater-workspace-tool-pane__button--tone-${tone}`
    : "";
  return (
    <button
      type="button"
      className={`rater-workspace-tool-pane__button${toneClass}`}
      onClick={onClick}
      disabled={disabled}
      {...(draggable !== undefined ? { draggable } : {})}
      {...(onDragStart !== undefined ? { onDragStart } : {})}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {icon ? (
        <span className="rater-workspace-tool-pane__button-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="rater-workspace-tool-pane__button-text">
        <span className="rater-workspace-tool-pane__button-label">{children}</span>
        {sublabel ? (
          <span className="rater-workspace-tool-pane__button-sublabel">
            {sublabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Composite — `<WorkspaceToolPane>` exposes `.Section` + `.Button` slots. */
export const WorkspaceToolPane: typeof WorkspaceToolPaneRoot & {
  Section: typeof WorkspaceToolPaneSection;
  Button: typeof WorkspaceToolPaneButton;
} = Object.assign(WorkspaceToolPaneRoot, {
  Section: WorkspaceToolPaneSection,
  Button: WorkspaceToolPaneButton,
});
