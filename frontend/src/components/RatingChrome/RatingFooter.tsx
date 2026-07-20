/**
 * <RatingFooter> — Brief 82 D-D (the footer is the state of the build).
 *
 * A slim sticky footer that reads the plan's STRUCTURE: per-coverage
 * chips (name + step count, scroll-anchoring to their cards), the
 * adjustments chip, the readiness verdict from `computePlanReadiness`,
 * and the ONE dollars handoff — "Open in Run". Replaces the deleted
 * COVERAGES side-nav and the Total pseudo-section.
 *
 * O-1 — no dollars here, ever: Run owns them. O-2 — chip labels are
 * the plan's own tower names.
 */

import type { JSX } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@openrater/design-system";
import "./RatingFooter.css";

export interface RatingFooterSection {
  /** The sheet's `data-sheet-section` id this chip scrolls to. */
  readonly sectionId: string;
  readonly name: string;
  /** Chip fact ("9 steps" / "4 adjustments") — authored size, not $. */
  readonly countLabel: string;
}

export interface RatingFooterProps {
  readonly sections: readonly RatingFooterSection[];
  /** compileReady from `computePlanReadiness`. */
  readonly ready: boolean;
  /** blockingHint from `computePlanReadiness` (named blocker). */
  readonly blockingHint?: string | undefined;
  readonly onOpenRun: () => void;
  readonly testId?: string;
}

export function RatingFooter(props: RatingFooterProps): JSX.Element {
  const {
    sections,
    ready,
    blockingHint,
    onOpenRun,
    testId = "rater-rating-footer",
  } = props;

  const jumpTo = (sectionId: string) => {
    const el = document.querySelector(`[data-sheet-section="${sectionId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <footer className="rater-rating-footer" data-testid={testId}>
      <div className="rater-rating-footer__chips">
        {sections.map((s) => (
          <button
            key={s.sectionId}
            type="button"
            className="rater-rating-footer__chip"
            onClick={() => jumpTo(s.sectionId)}
            data-testid={`${testId}-chip-${s.sectionId}`}
          >
            <b>{s.name}</b>
            <small>{s.countLabel}</small>
          </button>
        ))}
      </div>
      <span
        className={`rater-rating-footer__state${ready ? "" : " is-blocked"}`}
        data-testid={`${testId}-state`}
      >
        <i aria-hidden />
        {ready ? "Ready to rate" : (blockingHint ?? "Not ready to rate yet")}
      </span>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onOpenRun}
        data-testid={`${testId}-open-run`}
      >
        Open in Run <ArrowRight size={13} strokeWidth={2} aria-hidden />
      </Button>
    </footer>
  );
}
