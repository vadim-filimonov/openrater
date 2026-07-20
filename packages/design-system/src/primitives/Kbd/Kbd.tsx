/**
 * <Kbd> — keyboard shortcut display.
 *
 * Renders one or more keycaps; auto-joins with " " separator. Use for
 * inline shortcut hints, command-palette badges, tooltip footers.
 *
 * BEM:
 *   .rater-kbd          (wrapper, inline-flex of keys)
 *   .rater-kbd__key     (single key)
 */

import type { HTMLAttributes } from "react";
import "./Kbd.css";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Array of key labels (e.g. ["Cmd", "K"] renders as ⌘ K). */
  keys: string[];
}

export function Kbd({ keys, className, ...rest }: KbdProps) {
  return (
    <kbd className={["rater-kbd", className].filter(Boolean).join(" ")} {...rest}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="rater-kbd__key">
          {k}
        </span>
      ))}
    </kbd>
  );
}
