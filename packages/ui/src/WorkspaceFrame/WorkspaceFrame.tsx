/**
 * <WorkspaceFrame> — the canonical 3-column shell for every workspace.
 *
 * Polish PR 6. Closes the P0 "5 different inspector widths + 4 different
 * rail widths" finding from `docs/design/UI_AUDIT.md` §I. Locks the
 * north-star geometry:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  RAIL 240   │       STAGE 1fr       │   INSPECTOR 320      │
 *   │  surface-2  │       surface-1       │   surface-1          │
 *   │  ↑ tool     │  ↑ list / canvas /    │   ↑ selected-row     │
 *   │    pane     │    editor / picker    │     summary / live   │
 *   │             │                       │     preview / trace  │
 *   └─────────────┴───────────────────────┴──────────────────────┘
 *
 * The frame is pure geometry — no padding inside the slots, no inner
 * chrome. Each workspace owns its slot density. The audit prescribes:
 *
 *   - rail = 240px               (Dimensions = 240 ✓, Gate = 240 ✓,
 *                                 Parametrize = 260 ✗, Assemble = 280 ✗)
 *   - inspector = 320px          (Dimensions = 320 ✓, Parametrize = 320 ✓,
 *                                 Gate = 280 ✗, Inputs = 340 ✗)
 *   - gap = 0                    (hairline column dividers do the work)
 *   - inspector bg = surface-1   (Parametrize had canvas-zinc-950 ✗)
 *   - root has no border-radius, no border  — it's the body of the
 *     route, not a card (the 10px rounding currently on Gate/Dimensions/
 *     Assemble is invisible behind the surrounding zinc-950 canvas).
 *
 * Optional slots: omit `rail` to render stage + inspector only (e.g.,
 * Inputs); omit `inspector` to render rail + stage only (e.g., canvases
 * that don't have a selection-aware right pane); omit both for a
 * single-column workspace.
 *
 * Accessibility: the root is a `<section>` with the consumer's
 * `ariaLabel` (typically the workspace name — "Dimensions", "Gate").
 * The rail/stage/inspector slots become `<aside>` / `<main>` / `<aside>`
 * with role-appropriate labels for screen-reader navigation.
 *
 * BEM:
 *   .rater-workspace-frame
 *   .rater-workspace-frame--rail-stage-inspector
 *   .rater-workspace-frame--rail-stage
 *   .rater-workspace-frame--stage-inspector
 *   .rater-workspace-frame--stage
 *   .rater-workspace-frame__rail
 *   .rater-workspace-frame__stage
 *   .rater-workspace-frame__inspector
 */

import type { HTMLAttributes, JSX, ReactNode } from "react";
import "./WorkspaceFrame.css";

export interface WorkspaceFrameProps
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /**
   * Left rail content (240px). Typically a tool pane / inventory
   * list / add-affordance set. Omit for workspaces without a rail
   * (e.g., Inputs, which has a top-level data-source picker instead).
   */
  readonly rail?: ReactNode;
  /**
   * Center stage content. The workspace's actual list / canvas /
   * editor. Required.
   */
  readonly children: ReactNode;
  /**
   * Right inspector content (320px). Typically a selected-row
   * summary, live preview, or trace panel. Omit for workspaces
   * that don't have a selection-aware right pane.
   */
  readonly inspector?: ReactNode;
  /**
   * Required accessible label for the workspace section (e.g.,
   * "Dimensions", "Gate"). Lifts the visible WorkspaceTabs identity
   * into the accessibility tree so SR users get the same "where am
   * I" cue as sighted users.
   */
  readonly ariaLabel: string;
  /**
   * Optional accessible label for the rail (when present). Defaults
   * to `${ariaLabel} tools`. Override when the rail isn't a "tools"
   * surface (e.g., Assemble's inventory rail is more of a palette
   * than a toolbox).
   */
  readonly railLabel?: string;
  /**
   * Optional accessible label for the inspector (when present).
   * Defaults to `${ariaLabel} inspector`.
   */
  readonly inspectorLabel?: string;
  readonly testId?: string;
  readonly className?: string;
}

export function WorkspaceFrame(props: WorkspaceFrameProps): JSX.Element {
  const {
    rail,
    children,
    inspector,
    ariaLabel,
    railLabel,
    inspectorLabel,
    testId,
    className,
    ...rest
  } = props;

  const hasRail = rail !== undefined && rail !== null && rail !== false;
  const hasInspector =
    inspector !== undefined && inspector !== null && inspector !== false;

  const variant: WorkspaceFrameVariant = hasRail
    ? hasInspector
      ? "rail-stage-inspector"
      : "rail-stage"
    : hasInspector
      ? "stage-inspector"
      : "stage";

  const classes = [
    "rater-workspace-frame",
    `rater-workspace-frame--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      {...rest}
      className={classes}
      aria-label={ariaLabel}
      data-testid={testId}
      data-variant={variant}
    >
      {hasRail ? (
        <aside
          className="rater-workspace-frame__rail"
          aria-label={railLabel ?? `${ariaLabel} tools`}
        >
          {rail}
        </aside>
      ) : null}
      <main className="rater-workspace-frame__stage">{children}</main>
      {hasInspector ? (
        <aside
          className="rater-workspace-frame__inspector"
          aria-label={inspectorLabel ?? `${ariaLabel} inspector`}
        >
          {inspector}
        </aside>
      ) : null}
    </section>
  );
}

type WorkspaceFrameVariant =
  | "rail-stage-inspector"
  | "rail-stage"
  | "stage-inspector"
  | "stage";
