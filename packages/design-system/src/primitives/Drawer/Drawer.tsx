/**
 * <Drawer> — right-side overlay panel.
 *
 * Used for focused authoring work that should keep the underlying
 * page visible for context (e.g., adding a stage in a section card
 * on /plans/:id while keeping the spine visible underneath).
 *
 * Behavior:
 *   - Configurable width via `size` (sm 380 / md 480 / lg 640 / xl 820);
 *     `widthPx` still accepted for one-off overrides
 *   - Dimmed backdrop (matches --rater-surface-overlay)
 *   - Escape key, backdrop click, or close button all dismiss
 *   - Focus trap: first focusable inside auto-focuses on open;
 *     Tab cycles inside; Shift+Tab loops backwards
 *   - On close: focus returns to the trigger element (if it still
 *     exists in the DOM)
 *   - Body scroll-lock while open (prevents the page underneath
 *     scrolling when the user wheels inside the drawer)
 *   - React portal to document.body so z-index is sane regardless
 *     of where the trigger lives in the tree
 *
 * Slot model:
 *   <Drawer open={...} onClose={...} title="…" subtitle="…" size="md">
 *     <Drawer.Body>form fields go here</Drawer.Body>
 *     <Drawer.Footer>cancel + save buttons</Drawer.Footer>
 *   </Drawer>
 *
 * Size tiers:
 *   - sm (380px) — confirmation drawers, picker drawers
 *   - md (480px, default) — edit drawers
 *   - lg (640px) — import / compare / history drawers (room for tables)
 *   - xl (820px) — reserved (cascade view + plan templates)
 *
 * Tokens consumed:
 *   - --rater-surface-1, --rater-surface-overlay, --rater-border-default
 *   - --rater-text-strong, --rater-text-muted
 *   - --rater-r-8, --rater-shadow-floating, --rater-z-overlay, --rater-z-modal
 *   - --rater-d-240, --rater-ease-soft, --rater-space-{4,6,12,16,20,24}
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./Drawer.css";

export type DrawerSize = "sm" | "md" | "lg" | "xl";

const SIZE_WIDTHS: Record<DrawerSize, number> = {
  sm: 380,
  md: 480,
  lg: 640,
  xl: 820,
};

export interface DrawerProps {
  /** Controls visibility. */
  open: boolean;
  /** Fired on backdrop click, Escape, or close-button click. */
  onClose: () => void;
  /** Title displayed in the drawer header. Required for a11y. */
  title: string;
  /** Optional subtitle directly under the title (e.g. context). */
  subtitle?: string;
  /** Drawer body + footer. */
  children: ReactNode;
  /**
   * Width tier. Pick from the canonical four:
   * sm 380 / md 480 / lg 640 / xl 820. Default: md.
   * See design-language §8.1 for when to use each.
   */
  size?: DrawerSize;
  /**
   * Escape hatch — pass an explicit pixel width and ignore `size`.
   * Use only when a content-driven constraint requires it; default
   * to `size` whenever possible.
   */
  widthPx?: number;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
  widthPx,
}: DrawerProps) {
  const resolvedWidth = widthPx ?? SIZE_WIDTHS[size];
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Remember the trigger so we can restore focus on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
    }
  }, [open]);

  // Auto-focus the first form field (input/select/textarea/[href]) on
  // open so the user can type immediately. Skip the close button — it's
  // first in DOM order but rarely what the user wants on entry. If the
  // drawer has no form fields, fall back to the close button so SOMETHING
  // is focused for keyboard users.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const formField = panel.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
    );
    if (formField) {
      formField.focus();
      return;
    }
    const fallback = panel.querySelector<HTMLElement>(
      "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    fallback?.focus();
  }, [open]);

  // Restore focus to the trigger on close.
  useEffect(() => {
    if (open) return;
    const trigger = triggerRef.current;
    if (trigger && document.contains(trigger)) {
      // Defer one tick so the drawer's own focus-changes settle first.
      const id = window.requestAnimationFrame(() => trigger.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Body scroll lock.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const onKeyDownTrap = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((el) => !el.hasAttribute("aria-hidden"));
      if (focusables.length === 0) return;
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    },
    [],
  );

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // Only close on direct backdrop click, not bubbled clicks from the panel.
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="rater-drawer__backdrop"
        onClick={onBackdropClick}
        data-testid="rater-drawer-backdrop"
      />
      <div
        ref={panelRef}
        className="rater-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rater-drawer-title"
        style={{ width: `${resolvedWidth}px` }}
        onKeyDown={onKeyDownTrap}
      >
        <header className="rater-drawer__header">
          <div className="rater-drawer__title-block">
            <h2 id="rater-drawer-title" className="rater-drawer__title">
              {title}
            </h2>
            {subtitle ? (
              <p className="rater-drawer__subtitle">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rater-drawer__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X aria-hidden size={16} />
          </button>
        </header>
        {children}
      </div>
    </>,
    document.body,
  );
}

function DrawerBody({ children }: { children: ReactNode }) {
  return <div className="rater-drawer__body">{children}</div>;
}

function DrawerFooter({ children }: { children: ReactNode }) {
  return <footer className="rater-drawer__footer">{children}</footer>;
}

Drawer.Body = DrawerBody;
Drawer.Footer = DrawerFooter;
