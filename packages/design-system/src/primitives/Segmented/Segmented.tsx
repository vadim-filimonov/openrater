/**
 * <Segmented> — radio-style segmented control for 2-N mutually-exclusive
 * choices.
 *
 * Replaces two bespoke segmented-control patterns:
 *
 *   - `.rater-pc-pill-group` + `.rater-pc-pill`   (Parametrize Canvas/Saved)
 *   - `.rater-dsp-toggle` + `.rater-dsp-toggle-btn` (Inputs CSV/Webhook)
 *
 * Both were ~22-24px tall pill groups with surface-3 fill on the
 * active segment. The primitive unifies them at 24px tall (sits one
 * notch denser than `<Button size="sm">` so it reads as a
 * mode-switch, not as a primary action).
 *
 * NOT a replacement for `<Tabs>` — that primitive is for tabbed
 * surfaces with distinct content panels and role="tablist"
 * semantics. `<Segmented>` is for compact mode/view switches inside
 * the same surface (Canvas vs Saved tables; CSV vs Webhook; Map vs
 * List; etc.) where the choice changes how the same data is
 * displayed rather than swapping to a different one.
 *
 * Accessibility:
 *   - role="radiogroup" on the outer wrapper
 *   - role="radio" + aria-checked on each segment button
 *   - Keyboard: arrow keys move between segments, Space/Enter selects
 *
 * Motion (Shell v3 polish): one shared THUMB slides between segments
 * (transform + width over --rater-d-140 --rater-ease-snap) instead of each
 * item repainting its own background — the active fill physically travels.
 * The component measures the active button (offsetLeft/offsetWidth) in a
 * layout effect and writes the result as CSS custom properties on the
 * root; all styling stays in Segmented.css (the inline style is a data
 * channel, not a style rule). Re-measures on resize via ResizeObserver.
 *
 * BEM:
 *   .rater-segmented
 *   .rater-segmented--sm | --md
 *   .rater-segmented__thumb
 *   .rater-segmented__item[.is-active]
 *   .rater-segmented__count
 */

import type { JSX, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import "./Segmented.css";

export type SegmentedSize = "sm" | "md";

export interface SegmentedItem<TValue extends string = string> {
  /** Stable identifier — the value the primitive tracks. */
  readonly value: TValue;
  /** Visible label. */
  readonly label: ReactNode;
  /**
   * Optional count badge rendered after the label (e.g., "Saved · 4").
   * Plain text — wrap in a `<Num>` at the call site if you need
   * locale-aware formatting.
   */
  readonly count?: number;
  /** Optional disabled state for this segment only. */
  readonly disabled?: boolean;
}

export interface SegmentedProps<TValue extends string = string> {
  /** The active segment's value. */
  readonly value: TValue;
  /** Fires when the user picks a segment. */
  readonly onChange: (next: TValue) => void;
  /** The segments in display order, left to right. Must have ≥ 2 items. */
  readonly items: ReadonlyArray<SegmentedItem<TValue>>;
  /**
   * Height + density.
   * - `sm`: 24px tall (default — fits inside dense headers next to titles)
   * - `md`: 28px tall (matches `<Button size="sm">`, useful when the
   *   segmented sits inline with other buttons)
   */
  readonly size?: SegmentedSize;
  /** ARIA label for the radiogroup. Required for SR identity. */
  readonly ariaLabel: string;
  readonly testId?: string;
  readonly className?: string;
}

export function Segmented<TValue extends string = string>(
  props: SegmentedProps<TValue>,
): JSX.Element {
  const {
    value,
    onChange,
    items,
    size = "sm",
    ariaLabel,
    testId,
    className,
  } = props;

  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── Sliding thumb — measure the active segment, expose as custom props ──
  // offsetLeft is relative to the offsetParent (the root, position:relative),
  // so the thumb's translateX lands exactly under the active button. The
  // first measurement happens before paint (no prior painted state → no
  // slide-in from 0); every later one animates via the CSS transition.
  const activeIndex = items.findIndex((it) => it.value === value);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const btn = activeIndex >= 0 ? buttonRefs.current[activeIndex] : null;
    if (!root || !btn) return undefined;
    const measure = () => {
      root.style.setProperty(
        "--rater-segmented-thumb-x",
        `${btn.offsetLeft}px`,
      );
      root.style.setProperty(
        "--rater-segmented-thumb-w",
        `${btn.offsetWidth}px`,
      );
    };
    measure();
    // Segment widths move (count badges, font swap, container resize) —
    // keep the thumb glued. Guarded: jsdom has no ResizeObserver.
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(btn);
    return () => ro.disconnect();
  }, [activeIndex, items, size]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const enabled = items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => !it.disabled);
      if (enabled.length === 0) return;
      const currentEnabledIdx = enabled.findIndex(
        ({ it }) => it.value === value,
      );
      if (currentEnabledIdx < 0) return;
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      const nextEnabledIdx =
        (currentEnabledIdx + step + enabled.length) % enabled.length;
      const next = enabled[nextEnabledIdx];
      if (next) {
        onChange(next.it.value);
        buttonRefs.current[next.i]?.focus();
      }
    },
    [items, value, onChange],
  );

  const classes = [
    "rater-segmented",
    `rater-segmented--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rootRef}
      className={classes}
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={handleKeyDown}
    >
      {/* the sliding fill — width 0 (invisible) until first measurement */}
      <span className="rater-segmented__thumb" aria-hidden />
      {items.map((item, i) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={item.disabled}
            className={`rater-segmented__item${isActive ? " is-active" : ""}`}
            onClick={() => {
              if (!isActive) onChange(item.value);
            }}
            // Make only the active segment tabbable; arrow keys move
            // focus between segments per WAI-ARIA radiogroup spec.
            tabIndex={isActive ? 0 : -1}
          >
            <span className="rater-segmented__label">{item.label}</span>
            {item.count !== undefined ? (
              <span className="rater-segmented__count">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
