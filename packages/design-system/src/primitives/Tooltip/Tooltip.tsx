/**
 * <Tooltip> — accessible hover/focus label.
 *
 * Composes around any focusable child: wraps the child in a span so we
 * can attach hover + focus handlers without modifying the child's
 * behavior, then renders the tooltip via React portal so overflow:hidden
 * ancestors can't clip it.
 *
 *   <Tooltip content="Open the trace panel">
 *     <IconButton icon={<Search />} aria-label="…" />
 *   </Tooltip>
 *
 * Behavior:
 *   - Show on pointer-enter (after `delay` ms; default 400ms — feels
 *     intentional, not laggy)
 *   - Show on focus immediately (no delay — keyboard users get fast feedback)
 *   - Hide on pointer-leave / blur / Escape
 *   - Hide instantly if the anchor is clicked (the activated action
 *     supersedes the tooltip)
 *   - Mouse-over the tooltip itself keeps it visible (lets the user
 *     read longer text without it disappearing as they track to it)
 *
 * Placement:
 *   - V1 supports `top` (default), `right`, `bottom`, `left`
 *   - Position computed from the anchor's getBoundingClientRect at
 *     show time + on scroll/resize while visible
 *   - No collision detection in V1 — the caller chooses a placement
 *     that fits. V2 (post-cold-test) adds auto-flip.
 *
 * Accessibility:
 *   - role="tooltip" on the floating element
 *   - aria-describedby on the anchor wrapper (synced via useId)
 *   - prefers-reduced-motion: collapses transition to 1ms (per the
 *     tokens system)
 *
 * BEM class names:
 *   .rater-tooltip                          (root floating panel)
 *   .rater-tooltip--top | --right | --bottom | --left
 *   .rater-tooltip__arrow                   (caret pointing at anchor)
 *   .rater-tooltip__content                 (text)
 *   .rater-tooltip-anchor                   (inline wrapper around child)
 *
 * Tokens consumed:
 *   - --rater-surface-3 (panel background)
 *   - --rater-text-strong (panel text)
 *   - --rater-border-strong (panel border)
 *   - --rater-shadow-floating
 *   - --rater-r-6, --rater-t-12, --rater-fw-medium
 *   - --rater-space-{4,6,8,10}
 *   - --rater-d-140, --rater-ease-soft
 *   - --rater-z-tooltip
 *
 * Implementation note: no third-party positioning lib (no Popper, no
 * Floating-UI). V1 math is trivial; the cost of adding a dep is higher
 * than the gain.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  /** The label shown in the tooltip. Plain text or a short ReactNode. */
  readonly content: ReactNode;
  /** Where the tooltip floats relative to the anchor. Default `top`. */
  readonly placement?: TooltipPlacement;
  /** Delay (ms) before showing on pointer-enter. Default 400. Focus
   *  always shows immediately (no delay). */
  readonly delayMs?: number;
  /** When false, the tooltip is suppressed (anchor renders unchanged).
   *  Useful when the parent conditionally disables hover hints. */
  readonly enabled?: boolean;
  /** The element the tooltip anchors to. Must be a single ReactElement
   *  (not a fragment / multiple children). The component wraps it in a
   *  span to attach handlers — the wrapper has display:inline-block so
   *  it doesn't break inline layout. */
  readonly children: ReactElement;
}

interface TooltipPosition {
  readonly top: number;
  readonly left: number;
}

const GAP_PX = 6;

export function Tooltip({
  content,
  placement = "top",
  delayMs = 400,
  enabled = true,
  children,
}: TooltipProps) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const computePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const aRect = anchor.getBoundingClientRect();
    const tRect = tooltip.getBoundingClientRect();
    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = aRect.top - tRect.height - GAP_PX;
        left = aRect.left + aRect.width / 2 - tRect.width / 2;
        break;
      case "bottom":
        top = aRect.bottom + GAP_PX;
        left = aRect.left + aRect.width / 2 - tRect.width / 2;
        break;
      case "left":
        top = aRect.top + aRect.height / 2 - tRect.height / 2;
        left = aRect.left - tRect.width - GAP_PX;
        break;
      case "right":
        top = aRect.top + aRect.height / 2 - tRect.height / 2;
        left = aRect.right + GAP_PX;
        break;
    }
    // Add scroll offsets — getBoundingClientRect is viewport-relative
    // but the portal renders into document.body so we need page coords.
    top += window.scrollY;
    left += window.scrollX;
    setPosition({ top, left });
  }, [placement]);

  // Compute position SYNCHRONOUSLY after layout (before paint) so the
  // tooltip is positioned by the time the user sees it — no visible
  // flash at top:0 / left:0 on first render. useLayoutEffect runs
  // after DOM mutations but before the browser paints.
  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
  }, [open, computePosition]);

  // Keep position fresh on scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    const handler = () => computePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, computePosition]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const scheduleShow = useCallback(() => {
    clearShowTimer();
    showTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, delayMs);
  }, [clearShowTimer, delayMs]);

  const showImmediately = useCallback(() => {
    clearShowTimer();
    setOpen(true);
  }, [clearShowTimer]);

  const hide = useCallback(() => {
    clearShowTimer();
    setOpen(false);
  }, [clearShowTimer]);

  // Cleanup pending timers on unmount.
  useEffect(() => () => clearShowTimer(), [clearShowTimer]);

  if (!enabled) return children;

  if (!isValidElement(children)) {
    return children;
  }

  // Wrap the anchor in a span to attach handlers. The wrapper is
  // inline-block so it doesn't break the layout flow of the child.
  return (
    <>
      <span
        ref={anchorRef}
        className="rater-tooltip-anchor"
        aria-describedby={open ? tooltipId : undefined}
        onPointerEnter={scheduleShow}
        onPointerLeave={hide}
        onFocus={showImmediately}
        onBlur={hide}
        onClick={hide}
      >
        {cloneElement(children)}
      </span>
      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className={`rater-tooltip rater-tooltip--${placement}`}
              style={
                position
                  ? { top: `${position.top}px`, left: `${position.left}px` }
                  : // Position not yet computed (very brief — synchronous
                    // useLayoutEffect normally sets it before paint).
                    // Render off-screen so we don't flash at 0,0 on the
                    // rare scheduling miss.
                    { top: "-9999px", left: "-9999px" }
              }
              onPointerEnter={showImmediately}
              onPointerLeave={hide}
            >
              <span className="rater-tooltip__content">{content}</span>
              <span
                className="rater-tooltip__arrow"
                aria-hidden
                data-placement={placement}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
