/**
 * <Modal> — centered overlay panel.
 *
 * Used for FOCUSED blocking decisions that interrupt the user's flow:
 *   - delete-confirm + similar destructive confirmations
 *   - ISO class override warnings (Brief 16)
 *   - sign-off / promote dialogs
 *   - "are you sure?" gates before irreversible actions
 *
 * For non-blocking authoring work that should keep the underlying page
 * visible (add a stage, edit a chain), use <Drawer> instead. Modals
 * are explicitly blocking; the user must dismiss before continuing.
 *
 * Behavior:
 *   - 3 sizes (sm/md/lg) — see SIZE_WIDTHS below
 *   - Backdrop dim (matches --rater-surface-overlay)
 *   - Backdrop click closes (unless `dismissable={false}`)
 *   - Escape closes (unless `dismissable={false}`)
 *   - Focus trap: first focusable inside auto-focuses on open;
 *     Tab cycles inside; Shift+Tab loops backwards
 *   - On close: focus returns to the trigger element
 *   - Body scroll-lock while open
 *   - React portal to document.body
 *
 * Slot model:
 *   <Modal open={...} onClose={...} title="Delete plan?" size="sm">
 *     <Modal.Body>Are you sure? This can't be undone.</Modal.Body>
 *     <Modal.Footer>
 *       <Button onClick={cancel}>Cancel</Button>
 *       <Button variant="danger" onClick={confirm}>Delete</Button>
 *     </Modal.Footer>
 *   </Modal>
 *
 * BEM class names:
 *   .rater-modal__backdrop                  (dimming overlay)
 *   .rater-modal                            (the panel)
 *   .rater-modal--sm | --md | --lg          (size variants)
 *   .rater-modal__header
 *   .rater-modal__title
 *   .rater-modal__subtitle
 *   .rater-modal__close
 *   .rater-modal__body
 *   .rater-modal__footer
 *
 * Tokens consumed:
 *   - --rater-surface-1, --rater-surface-overlay, --rater-border-default
 *   - --rater-text-strong, --rater-text-muted
 *   - --rater-r-8, --rater-shadow-floating, --rater-z-overlay, --rater-z-modal
 *   - --rater-d-240, --rater-ease-soft, --rater-space-{6,12,16,20,24}
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
import "./Modal.css";

export type ModalSize = "sm" | "md" | "lg";

const SIZE_WIDTHS: Record<ModalSize, number> = {
  sm: 380,
  md: 520,
  lg: 720,
};

export interface ModalProps {
  /** Controls visibility. */
  readonly open: boolean;
  /** Fired on backdrop click, Escape, or close-button click (when dismissable). */
  readonly onClose: () => void;
  /** Title shown in the modal header. Required for a11y. */
  readonly title: string;
  /** Optional subtitle under the title. */
  readonly subtitle?: string;
  /** Size variant. Default `md` (520px). */
  readonly size?: ModalSize;
  /** When false, backdrop click + Escape do NOT close the modal —
   *  the only path out is an action in the footer. Use sparingly:
   *  the typical pattern is dismissable=true with a primary action
   *  that calls onClose itself. */
  readonly dismissable?: boolean;
  /** Modal body + footer children. */
  readonly children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  dismissable = true,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Remember the trigger so we can restore focus on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
    }
  }, [open]);

  // Auto-focus the first form field (or close button as fallback).
  // Same pattern as Drawer — keyboard users can act immediately.
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
      const id = window.requestAnimationFrame(() => trigger.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Body scroll lock while open.
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
    if (!open || !dismissable) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, dismissable, onClose]);

  // Focus trap on Tab/Shift+Tab.
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
      if (!dismissable) return;
      // Only close on direct backdrop click, not bubbled clicks from the panel.
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [dismissable, onClose],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="rater-modal__backdrop"
      onClick={onBackdropClick}
      data-testid="rater-modal-backdrop"
    >
      <div
        ref={panelRef}
        className={`rater-modal rater-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rater-modal-title"
        style={{ width: `${SIZE_WIDTHS[size]}px` }}
        onKeyDown={onKeyDownTrap}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rater-modal__header">
          <div className="rater-modal__title-block">
            <h2 id="rater-modal-title" className="rater-modal__title">
              {title}
            </h2>
            {subtitle ? (
              <p className="rater-modal__subtitle">{subtitle}</p>
            ) : null}
          </div>
          {dismissable ? (
            <button
              type="button"
              className="rater-modal__close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          ) : null}
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ModalBody({ children }: { children: ReactNode }) {
  return <div className="rater-modal__body">{children}</div>;
}

function ModalFooter({ children }: { children: ReactNode }) {
  return <footer className="rater-modal__footer">{children}</footer>;
}

Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
