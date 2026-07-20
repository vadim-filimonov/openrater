/**
 * PlanStatusChip — THE plan's headline status (Brief 84 D-C).
 *
 * Replaces PlanLifecycleStepper, whose thumb was hardcoded to Draft (the
 * F1 defect): a status display that was also a freeze control could never
 * be honest about state. This chip is a **display that navigates** (click
 * → the Ship tab, the one home of the lifecycle verbs) — never a control
 * that mutates.
 *
 * One derived status, three words (Brief 84 §1):
 *   ● Draft                  — being built; the quote API is off.
 *   ● Live · v2              — a published version serves the quote API.
 *   ● Live · v2  + edits     — live, and the working draft has moved
 *                              (Brief 76 P4.4 divergence — the warn-tinted
 *                              suffix; the count arrives with 84.2).
 *   ● Archived               — retired; read-only; API off.
 *
 * Governance (plans-table grammar): the chip stays neutral, status rides
 * the DOT — success for Live, focus-blue for Draft, disabled for Archived.
 *
 * Renders a button element when `onOpenShip` is provided (the plan
 * header), a plain span otherwise (list rows live inside row links — no
 * nested interactive elements).
 */

import type { DerivedPlanStatus } from "@openrater/contracts";
import "./plan-header.css";

export interface PlanStatusChipProps {
  readonly status: DerivedPlanStatus;
  /** Present on the plan header: click deep-links to the Ship tab. */
  readonly onOpenShip?: (() => void) | undefined;
}

function chipTitle(status: DerivedPlanStatus): string {
  switch (status.kind) {
    case "draft":
      return "Not live yet — callers can't quote this plan. Go live from the Ship tab.";
    case "live":
      return status.diverged
        ? `Live — callers get ${status.versionName}, and your draft has changes since it. Publish an update from the Ship tab.`
        : `Live — the quote API serves ${status.versionName}.`;
    case "archived":
      return "Archived — read-only; the quote API is off.";
  }
}

export function PlanStatusChip({
  status,
  onOpenShip,
}: PlanStatusChipProps): JSX.Element {
  const className = [
    "rater-plan-status",
    `rater-plan-status--${status.kind}`,
  ].join(" ");
  const body = (
    <>
      <span className="rater-plan-status__dot" aria-hidden />
      {status.kind === "draft" ? "Draft" : null}
      {status.kind === "archived" ? "Archived" : null}
      {status.kind === "live" ? (
        <>
          Live
          <span className="rater-plan-status__name" aria-hidden>
            · {status.versionName}
          </span>
          {status.diverged ? (
            <span className="rater-plan-status__drift">+ edits</span>
          ) : null}
        </>
      ) : null}
    </>
  );
  if (onOpenShip) {
    return (
      <button
        type="button"
        className={className}
        title={chipTitle(status)}
        onClick={onOpenShip}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={className} title={chipTitle(status)}>
      {body}
    </span>
  );
}
