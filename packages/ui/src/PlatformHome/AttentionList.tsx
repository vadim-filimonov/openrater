/**
 * AttentionList — renders `computePlatformAttention`'s ranked groups on
 * OpenRater Home. ONE rendering (Brief 88 P4 — the outcome/specifics
 * registers retired with the lens model, P2): a severity dot, a plain
 * sentence that names its subject, grouped member names muted after it,
 * and the single advancing action. Every row deep-links to the surface
 * that resolves it (it's triage, not a scorecard). Rendered as anchors so
 * the v2-button guard stays satisfied and modifier-click keeps working.
 */

import type { JSX, MouseEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { AttentionGroup } from "./computePlatformAttention";
import "./PlatformHome.css";

export interface AttentionListProps {
  readonly groups: readonly AttentionGroup[];
  readonly onNavigate: (href: string) => void;
}

export function AttentionList({
  groups,
  onNavigate,
}: AttentionListProps): JSX.Element {
  const handle = (href: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(href);
  };
  return (
    <div className="rater-home-attn" role="list" aria-label="Needs attention">
      {groups.map((g) => (
        <div className="rater-home-attn__row" role="listitem" key={g.id}>
          <span
            className={`rater-home-attn__dot rater-home-attn__dot--${g.severity}`}
            aria-hidden
          />
          <span className="rater-home-attn__text">
            {g.subject ? (
              <strong className="rater-home-attn__subject">{g.subject}</strong>
            ) : null}
            {g.text}
            {g.names && g.names.length > 0 ? (
              <span className="rater-home-attn__names">
                {" — "}
                {g.names.join(", ")}.
              </span>
            ) : null}
          </span>
          <a
            className="rater-home-attn__act"
            href={g.href}
            onClick={handle(g.href)}
          >
            {g.actionLabel}
            <ArrowRight className="rater-home-attn__arrow" aria-hidden />
          </a>
        </div>
      ))}
    </div>
  );
}
