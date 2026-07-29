/**
 * <EmptyState> — the canonical "you have nothing here yet" surface.
 *
 * Polish PR 5. Codifies the audit's empty-state north-star:
 *
 *     [hero icon · 24px · muted color]
 *     [title · t-16 · semibold]
 *     [description · t-13 · muted · max 2 sentences]
 *     [optional CTA slot — single <Button>, or N kind cards]
 *     [optional cue · t-11 · muted — "Click X in the tool pane..."]
 *
 * Replaces 4 different empty-state patterns across the workspaces
 * (DimensionsWorkspace's hero+title+hint, GateCanvas's title+lede+
 * 3-CTA grid, plus per-section variants in Dimensions). See
 * `docs/design/UI_AUDIT.md` §F.
 *
 * NOT for functional empty states like dropzones (Inputs CSV
 * dropzone, Assemble TowerSpawnZone) — those are interactive drop
 * targets, not "nothing here yet" placeholders.
 *
 * Accessibility:
 *   - Wrapped in <section role="status"> for screen-reader
 *     announcement of empty / no-results state.
 *   - The icon is `aria-hidden` (decorative).
 *   - Title + description are rendered as plain text inside the
 *     section, not as semantic headings, since the workspace
 *     itself owns the heading hierarchy.
 *
 * BEM:
 *   .rater-empty-state
 *   .rater-empty-state__hero
 *   .rater-empty-state__title
 *   .rater-empty-state__description
 *   .rater-empty-state__actions
 *   .rater-empty-state__cue
 */

import type { ReactNode, HTMLAttributes } from "react";
import "./EmptyState.css";

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /**
   * Hero icon. Consumer passes a sized lucide element
   * (`<Layers size={24} />`) or any ReactNode. The primitive applies
   * `color: var(--rater-text-subtle)` to the wrap so monochrome icons
   * pick up the muted hue automatically; per-kind tinting is the
   * consumer's responsibility (apply via wrapping <span> with a
   * color modifier).
   */
  readonly icon: ReactNode;
  /** Plain text — rendered at t-16, semibold, strong color. */
  readonly title: string;
  /**
   * Plain text — t-13, muted. Per the north-star, keep it to at most
   * two sentences. Verbose explanations belong in docs, not empty
   * states.
   */
  readonly description?: string;
  /**
   * Optional CTA region. Typically a single `<Button>` or a small
   * action group. The container is centered, gap-aware.
   */
  readonly children?: ReactNode;
  /**
   * Optional secondary cue rendered below the CTA region. Used when
   * the action isn't directly inside the empty card (e.g., "Click X
   * in the tool pane on the left"). Plain ReactNode so consumers
   * can include inline <strong> emphasis.
   */
  readonly cue?: ReactNode;
  readonly testId?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  cue,
  testId,
  className,
  ...rest
}: EmptyStateProps) {
  const classes = ["rater-empty-state", className]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      className={classes}
      role="status"
      data-testid={testId}
      {...rest}
    >
      <span className="rater-empty-state__hero" aria-hidden>
        {icon}
      </span>
      <h3 className="rater-empty-state__title">{title}</h3>
      {description ? (
        <p className="rater-empty-state__description">{description}</p>
      ) : null}
      {children ? (
        <div className="rater-empty-state__actions">{children}</div>
      ) : null}
      {cue ? <p className="rater-empty-state__cue">{cue}</p> : null}
    </section>
  );
}
