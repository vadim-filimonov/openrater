/**
 * NavLabs — the Labs as friendly destination cards on OpenRater
 * Home's Overview lens (Brief 74). Pure navigation: a soft glyph + name +
 * one plain-language purpose + a chevron. No counts, no status chips
 * (those live in Operations). Rendered as anchors so middle-click /
 * open-in-new-tab work and the v2-button guard stays satisfied; the
 * click is intercepted for client-side routing via `onNavigate`.
 */

import type { JSX, ReactNode, MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import "./PlatformHome.css";

export interface NavLabItem {
  readonly name: string;
  readonly what: string;
  /** Destination route (also the anchor href). */
  readonly href: string;
  readonly icon: ReactNode;
}

export interface NavLabsProps {
  readonly heading?: string;
  readonly items: readonly NavLabItem[];
  /** Client-side navigation handler (the route's `navigate`). */
  readonly onNavigate: (href: string) => void;
}

export function NavLabs({
  heading = "Jump to a Lab",
  items,
  onNavigate,
}: NavLabsProps): JSX.Element {
  const handle = (href: string) => (e: MouseEvent) => {
    // Let modified clicks (new tab / window) fall through to the browser.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(href);
  };
  return (
    <nav aria-label={heading}>
      <div className="rater-home-labs-head">{heading}</div>
      <div className="rater-home-labs">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className="rater-home-lab"
            onClick={handle(it.href)}
          >
            <span className="rater-home-lab__ico" aria-hidden>
              {it.icon}
            </span>
            <span className="rater-home-lab__body">
              <span className="rater-home-lab__name">{it.name}</span>
              <span className="rater-home-lab__what">{it.what}</span>
            </span>
            <ChevronRight className="rater-home-lab__go" aria-hidden />
          </a>
        ))}
      </div>
    </nav>
  );
}
