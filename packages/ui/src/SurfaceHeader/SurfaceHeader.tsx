/**
 * <SurfaceHeader> — Brief 88 §3.3 / P6: the ONE greeting every Lab
 * landing mounts. Before it, the five rooms greeted users with five
 * different first pixel rows (big H1 / bare act tabs / an eyebrow / a
 * Segmented inside a title / a centered form) — most of the platform's
 * "disjointed" feeling.
 *
 * Anatomy: title (always the nav word that brought you here —
 * orientation loop: nav word = page word = document-title word) · the
 * room's own view controls, UNCHANGED (the acts slot standardizes
 * placement, never the control) · actions. 48px, one hairline.
 *
 * Deliberately three slots and one height (R3) — anything a room wants
 * beyond that lives in the room's body, not here. The plan workspace
 * does NOT mount this: PlanHeader is an object page's chrome, a
 * different altitude.
 */

import type { JSX, ReactNode } from "react";
import "./SurfaceHeader.css";

export interface SurfaceHeaderProps {
  /** The room's name — the same word as the nav item. */
  readonly title: string;
  /** The room's own second level (underline acts, a Segmented). */
  readonly acts?: ReactNode | undefined;
  /** Right-side working cluster (search, filters, the page's primary). */
  readonly actions?: ReactNode | undefined;
}

export function SurfaceHeader({
  title,
  acts,
  actions,
}: SurfaceHeaderProps): JSX.Element {
  return (
    <header className="rater-surface-header">
      <h1 className="rater-surface-header__title">{title}</h1>
      {acts ? <div className="rater-surface-header__acts">{acts}</div> : null}
      <span className="rater-surface-header__spacer" aria-hidden />
      {actions ? (
        <div className="rater-surface-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
