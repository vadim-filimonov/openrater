/**
 * <Toast> — minimal transient notification.
 *
 * Used for low-stakes "FYI" messages like "Saved", "Copied", or
 * "Coming in next PR". NOT for errors — errors get top-of-page
 * banners per VISION Part 0 §2 ("interpretable, not toast-and-pray").
 *
 * Usage:
 *
 *   // 1. Wrap the app in <ToastProvider> (once, in main.tsx).
 *   // 2. From anywhere inside:
 *   const { notify } = useToast();
 *   notify("Plan saved");
 *
 * Single-toast model (intentional): a second notify() replaces the
 * first. We don't stack. Stacked toasts steal too much attention and
 * encourage spammy feedback. If you want a permanent log, that's a
 * different surface.
 *
 * BEM class names:
 *   .rater-toast               (the visible chip — fixed-positioned)
 *   .rater-toast--visible      (enter/exit animation hook)
 *   .rater-toast__message      (text)
 *   .rater-toast__close        (manual dismiss button)
 *
 * Tokens consumed (canonical names per packages/design-system/src/tokens.css):
 *   - --rater-surface-2, --rater-border-default, --rater-text-default,
 *     --rater-text-muted (close-button)
 *   - --rater-r-4, --rater-r-8, --rater-shadow-floating
 *   - --rater-s-8, --rater-s-10, --rater-s-14, --rater-s-24, --rater-s-32
 *   - --rater-t-13, --rater-t-16, --rater-fw-regular, --rater-font-sans,
 *     --rater-tracking-tight
 *   - --rater-d-240, --rater-ease-soft
 *   - --rater-z-toast
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./Toast.css";

interface ToastState {
  id: number;
  message: string;
}

interface ToastContextValue {
  notify: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  // Monotonically increasing id so a fast re-notify replaces the old
  // toast cleanly (otherwise React might bail on identical state).
  const nextId = useRef(0);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setToast(null);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const notify = useCallback((message: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message });
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, DEFAULT_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast must be called inside <ToastProvider>. Wrap your app once at the root.",
    );
  }
  return ctx;
}

function ToastViewport({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`rater-toast${toast ? " rater-toast--visible" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toast ? (
        <>
          <span className="rater-toast__message">{toast.message}</span>
          <button
            type="button"
            className="rater-toast__close"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
