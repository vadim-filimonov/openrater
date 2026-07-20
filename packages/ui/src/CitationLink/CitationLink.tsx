/**
 * <CitationLink> — citation reference rendering.
 *
 * Brief 3 (trace panel) — every node's `citation` field (e.g.,
 * "ISO BP-2024-RLC §3.4") renders through this primitive. The
 * citation can be a bare string (the runtime captures it from
 * `node.params.citation ?? kind.citation`) or a richer URL-bearing
 * PlanCitation object — both surface cleanly here.
 *
 *   <CitationLink citation="ISO BP-2024-RLC §3.4" />
 *   <CitationLink citation={{ id: "iso-bp", ref: "ISO BP §3.4", url: "..." }} />
 *
 * When a URL is present the citation renders as an external-link
 * anchor; otherwise it's a muted italic string. Either way it sits
 * inline (no block-level layout) so consumers can place it under
 * an explanation line or in a trace-step row.
 *
 * BEM:
 *   .rater-citation-link
 *   .rater-citation-link__icon
 *   .rater-citation-link__text
 */

import type { PlanCitation } from "@openrater/contracts";
import { ExternalLink } from "lucide-react";
import "./CitationLink.css";

export interface CitationLinkProps {
  /** Either a bare reference string OR a structured PlanCitation. */
  readonly citation: string | PlanCitation;
  /** Optional override for the displayed text. When omitted, the
   *  citation's `ref` (for PlanCitation) or the bare string is used. */
  readonly text?: string;
}

export function CitationLink({ citation, text }: CitationLinkProps) {
  if (typeof citation === "string") {
    return (
      <span className="rater-citation-link" aria-label={`Citation: ${citation}`}>
        <span className="rater-citation-link__text">{text ?? citation}</span>
      </span>
    );
  }
  const displayText = text ?? citation.ref;
  if (citation.url) {
    return (
      <a
        className="rater-citation-link rater-citation-link--external"
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Citation: ${displayText} (opens in new tab)`}
      >
        <span className="rater-citation-link__text">{displayText}</span>
        <span className="rater-citation-link__icon" aria-hidden>
          <ExternalLink size={11} />
        </span>
      </a>
    );
  }
  return (
    <span
      className="rater-citation-link"
      aria-label={`Citation: ${displayText}`}
    >
      <span className="rater-citation-link__text">{displayText}</span>
    </span>
  );
}
