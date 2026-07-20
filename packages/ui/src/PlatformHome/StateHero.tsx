/**
 * StateHero — the one plain-language "is everything okay?" answer at the
 * top of OpenRater Home (Brief 74; single voice per Brief 88 P2). Two
 * shapes:
 *   - default: a feedback-colored badge + display headline + optional sub
 *     (the first-run welcome and the backend-down state);
 *   - `compact`: ONE line — a feedback dot + the status sentence (Brief 88
 *     §3.2 Block 1 — the CEO's five-second answer, one line tall, never a
 *     warning-triangle panel).
 * Status rides the feedback tokens (four-domain governance); it is
 * informational, never decorative.
 */

import type { JSX, ReactNode } from "react";
import { Check, TriangleAlert, WifiOff } from "lucide-react";
import "./PlatformHome.css";

export type HeroTone = "ok" | "warn" | "error" | "neutral";

export interface StateHeroProps {
  readonly tone: HeroTone;
  readonly title: string;
  readonly sub?: string;
  /** Override the default tone icon (e.g. a first-run file glyph). */
  readonly icon?: ReactNode;
  /** Brief 88 §3.2 — render as the one-line status (dot + sentence). */
  readonly compact?: boolean;
}

const DEFAULT_ICON: Record<HeroTone, ReactNode> = {
  ok: <Check aria-hidden />,
  warn: <TriangleAlert aria-hidden />,
  error: <WifiOff aria-hidden />,
  neutral: <Check aria-hidden />,
};

export function StateHero({
  tone,
  title,
  sub,
  icon,
  compact = false,
}: StateHeroProps): JSX.Element {
  if (compact) {
    return (
      <div
        className="rater-home-hero rater-home-hero--compact"
        role="status"
        aria-live="polite"
      >
        <span
          className={`rater-home-hero__dot rater-home-hero__dot--${tone}`}
          aria-hidden
        />
        <h1 className="rater-home-hero__title rater-home-hero__title--compact">
          {title}
        </h1>
      </div>
    );
  }
  return (
    <div className="rater-home-hero">
      <span
        className={`rater-home-hero__badge rater-home-hero__badge--${tone}`}
        aria-hidden
      >
        {icon ?? DEFAULT_ICON[tone]}
      </span>
      <div className="rater-home-hero__text">
        <h1 className="rater-home-hero__title">{title}</h1>
        {sub ? <p className="rater-home-hero__sub">{sub}</p> : null}
      </div>
    </div>
  );
}
