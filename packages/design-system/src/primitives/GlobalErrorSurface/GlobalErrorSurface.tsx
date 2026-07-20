/**
 * <GlobalErrorSurface> — the root host for the global save-failure
 * stack (Brief 58, Pillar A). Mounted once at the app root (next to
 * <ToastProvider>). Subscribes to `apiErrorBus` and renders a small
 * stack of dismissible, persistent `role="alert"` cards.
 *
 * Distinct from <Toast> (which is FYI-only, single, auto-dismissing) and
 * from Brief 13's <PlanStatusBar> (plan-content issues). A failed save is
 * consequential: the card does NOT auto-vanish — it persists until the
 * actuary dismisses or retries it.
 *
 * BEM: .rater-error-surface / __card / __icon / __body / __title /
 *      __count / __message / __detail-toggle / __detail / __actions.
 */

import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, ChevronDown, RefreshCcw, X } from "lucide-react";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { apiErrorBus, type ApiErrorNotice } from "./apiErrorBus";
import "./GlobalErrorSurface.css";

export function GlobalErrorSurface() {
  const notices = useSyncExternalStore(
    apiErrorBus.subscribe,
    apiErrorBus.getSnapshot,
    apiErrorBus.getSnapshot,
  );

  if (notices.length === 0) return null;

  return (
    <div className="rater-error-surface" aria-label="Save errors">
      {notices.map((notice) => (
        <ErrorCard key={notice.id} notice={notice} />
      ))}
    </div>
  );
}

function ErrorCard({ notice }: { notice: ApiErrorNotice }) {
  const [showDetail, setShowDetail] = useState(false);

  const dismiss = () => apiErrorBus.dismiss(notice.id);
  // Retry only on a single, unambiguous failure — when several saves
  // have coalesced (count > 1) "retry which one?" is ambiguous, so we
  // drop the button and let the persistent card prompt the actuary to
  // fix the backend + redo. The newest retry is the one stored.
  const onRetry =
    notice.retry && notice.count === 1
      ? () => {
          notice.retry?.();
          // Dismiss now so the actuary sees the retry take effect; a
          // re-failure re-pushes a fresh card via the MutationCache.
          dismiss();
        }
      : undefined;

  return (
    <div
      className="rater-error-surface__card"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      onKeyDown={(e) => {
        if (e.key === "Escape") dismiss();
      }}
    >
      <span className="rater-error-surface__icon" aria-hidden>
        <AlertTriangle size={18} />
      </span>

      <div className="rater-error-surface__body">
        <div className="rater-error-surface__title">
          {notice.title}
          {notice.count > 1 ? (
            <span className="rater-error-surface__count">×{notice.count}</span>
          ) : null}
        </div>
        <div className="rater-error-surface__message">{notice.message}</div>

        {notice.detail ? (
          <div className="rater-error-surface__detail-wrap">
            <button
              type="button"
              className="rater-error-surface__detail-toggle"
              aria-expanded={showDetail}
              onClick={() => setShowDetail((v) => !v)}
            >
              <ChevronDown
                size={13}
                aria-hidden
                className={
                  "rater-error-surface__chev" +
                  (showDetail ? " rater-error-surface__chev--open" : "")
                }
              />
              Details
            </button>
            {showDetail ? (
              <pre className="rater-error-surface__detail">{notice.detail}</pre>
            ) : null}
          </div>
        ) : null}

        {onRetry ? (
          <div className="rater-error-surface__actions">
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCcw size={13} aria-hidden /> Retry
            </Button>
          </div>
        ) : null}
      </div>

      <IconButton
        variant="ghost"
        size="sm"
        aria-label="Dismiss error"
        icon={<X size={14} />}
        onClick={dismiss}
      />
    </div>
  );
}
