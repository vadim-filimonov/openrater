/**
 * <GoLiveDialog> — the ONE deploy verb's dialog (Brief 84 D-B).
 *
 * Two modes, one anatomy:
 *   · "first"  — Go live: cut v1 and turn the quote API on.
 *   · "update" — Publish update: cut v{N+1}; callers switch immediately.
 *
 * The what-happens list is the dialog's soul: it states, in plain words,
 * exactly what changes when the primary is pressed — the API turning on,
 * callers switching versions, the draft staying editable, connected apps
 * re-deriving without Hub steps. No jargon, no freeze-then-publish
 * two-step.
 *
 * Pure presentation, same contract as FreezeVersionDialog: the parent
 * owns open state, the goLive mutation, error mapping (409 name
 * collision → inline banner so the user edits the name without losing
 * notes), and success (close + invalidate).
 */

import {
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { Button, Modal } from "@openrater/design-system";
import { Check, Rocket, TriangleAlert } from "lucide-react";
import "./GoLiveDialog.css";

const MAX_VERSION_NAME = 200;
const MAX_NOTES = 2000;

export interface GoLiveDialogProps {
  /** Controls modal visibility — parent owns the state. */
  readonly open: boolean;
  /** "first" = nothing published yet; "update" = a version is live. */
  readonly mode: "first" | "update";
  /** Pre-filled version name — the route passes the first free `v{N}`
   *  (matching the server's auto-namer); the user may override with a
   *  filing tag. */
  readonly defaultVersionName: string;
  /** Update mode: the version callers get TODAY (named in the copy). */
  readonly liveVersionName?: string | undefined;
  /**
   * Update mode — integrations currently serving this plan LIVE. The
   * republish tripwire (audit gap #3, PR #418) pauses them until the
   * NEW version passes a Hub re-test, so the what-happens list must
   * say so BEFORE the confirm — never after the carrier goes quiet.
   */
  readonly liveConnectionNames?: readonly string[] | undefined;
  /** True while the go-live request is in flight. */
  readonly isSubmitting?: boolean;
  /** Inline error (typically the 409 name collision), parent-mapped. */
  readonly errorMessage?: string | null | undefined;
  readonly onClose: () => void;
  /** Confirm: trimmed name + notes (null when blank). */
  readonly onConfirm: (body: {
    readonly version_name: string;
    readonly notes: string | null;
  }) => void;
  readonly testId?: string;
}

export function GoLiveDialog(props: GoLiveDialogProps): JSX.Element | null {
  const {
    open,
    mode,
    defaultVersionName,
    liveVersionName,
    liveConnectionNames = [],
    isSubmitting = false,
    errorMessage,
    onClose,
    onConfirm,
    testId = "rater-go-live-dialog",
  } = props;

  const [versionName, setVersionName] = useState(defaultVersionName);
  const [notes, setNotes] = useState("");

  // Reset on every reopen so the suggested name takes effect and stale
  // input doesn't leak through.
  useEffect(() => {
    if (open) {
      setVersionName(defaultVersionName);
      setNotes("");
    }
  }, [open, defaultVersionName]);

  if (!open) return null;

  const first = mode === "first";
  const trimmedName = versionName.trim();
  const nameOverflow = versionName.length > MAX_VERSION_NAME;
  const notesOverflow = notes.length > MAX_NOTES;
  const canSubmit =
    trimmedName.length > 0 && !nameOverflow && !notesOverflow && !isSubmitting;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    const trimmedNotes = notes.trim();
    onConfirm({
      version_name: trimmedName,
      notes: trimmedNotes.length > 0 ? trimmedNotes : null,
    });
  };

  // The republish tripwire (audit gap #3): live-serving apps PAUSE until
  // the new version passes a Hub re-test. Name them here, before the
  // confirm — "no Hub steps" was true only until the tripwire existed.
  const pausedApps =
    liveConnectionNames.length === 0
      ? null
      : liveConnectionNames.length <= 2
        ? liveConnectionNames.join(" and ")
        : `${liveConnectionNames.slice(0, 2).join(", ")} +${liveConnectionNames.length - 2} more`;
  const newName = trimmedName || "the new version";
  const whatHappens: ReadonlyArray<{
    readonly text: string;
    readonly tone: "ok" | "warn";
  }> = first
    ? [
        {
          text: `The quote API turns on — callers get ${trimmedName || "this version"}`,
          tone: "ok",
        },
        {
          text: "Your draft stays editable; changes become visible drift, never a block",
          tone: "ok",
        },
        {
          text: "The plan reads Live everywhere: header, list, Home",
          tone: "ok",
        },
      ]
    : [
        {
          text: `Callers switch from ${liveVersionName ?? "the live version"} to ${newName} immediately`,
          tone: "ok",
        },
        pausedApps
          ? {
              text: `${pausedApps} pause${liveConnectionNames.length === 1 ? "s" : ""} until ${newName} passes a re-test in the Hub`,
              tone: "warn" as const,
            }
          : {
              text: "No connected apps are serving this plan — nothing pauses",
              tone: "ok" as const,
            },
        {
          text: `${liveVersionName ?? "The prior version"} stays in the timeline`,
          tone: "ok",
        },
      ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={first ? "Go live" : "Publish update"}
      subtitle={
        first
          ? "Publish this plan's first version and turn the quote API on."
          : "Cut a new version from your draft and make it the one callers get."
      }
      size="md"
      dismissable={!isSubmitting}
    >
      <form
        className="rater-go-live-dialog"
        data-testid={testId}
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="rater-modal__body">
          {errorMessage ? (
            <div
              className="rater-go-live-dialog__error"
              role="alert"
              data-testid={`${testId}-error`}
            >
              <span className="rater-go-live-dialog__error-icon" aria-hidden>
                <TriangleAlert size={14} />
              </span>
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <label
            className="rater-go-live-dialog__field"
            htmlFor={`${testId}-name`}
          >
            <span className="rater-go-live-dialog__field-label">
              Version name
            </span>
            <input
              id={`${testId}-name`}
              type="text"
              className="rater-go-live-dialog__input"
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              maxLength={MAX_VERSION_NAME + 50}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
              aria-invalid={nameOverflow || undefined}
              data-testid={`${testId}-name`}
              required
            />
            <span
              className="rater-go-live-dialog__field-hint"
              data-tone={nameOverflow ? "error" : "muted"}
            >
              {nameOverflow
                ? `Trim to ${MAX_VERSION_NAME} characters.`
                : "Keep the suggested name, or use a filing tag."}
            </span>
          </label>

          <label
            className="rater-go-live-dialog__field"
            htmlFor={`${testId}-notes`}
          >
            <span className="rater-go-live-dialog__field-label">
              Note
              <span className="rater-go-live-dialog__field-optional">
                optional
              </span>
            </span>
            <textarea
              id={`${testId}-notes`}
              className="rater-go-live-dialog__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's in this version? Cite the filing memo or change request."
              rows={3}
              maxLength={MAX_NOTES + 200}
              disabled={isSubmitting}
              aria-invalid={notesOverflow || undefined}
              data-testid={`${testId}-notes`}
            />
          </label>

          <div
            className="rater-go-live-dialog__what"
            aria-label="What happens"
          >
            <span className="rater-go-live-dialog__what-title">
              What happens
            </span>
            <ul className="rater-go-live-dialog__what-list">
              {whatHappens.map((line) => (
                <li
                  className={
                    line.tone === "warn"
                      ? "rater-go-live-dialog__what-row rater-go-live-dialog__what-row--warn"
                      : "rater-go-live-dialog__what-row"
                  }
                  key={line.text}
                >
                  {line.tone === "warn" ? (
                    <TriangleAlert size={12} aria-hidden />
                  ) : (
                    <Check size={12} aria-hidden />
                  )}
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="rater-modal__footer">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid={`${testId}-cancel`}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canSubmit}
            icon={<Rocket size={14} />}
            data-testid={`${testId}-confirm`}
          >
            {isSubmitting
              ? "Publishing…"
              : first
                ? "Go live"
                : `Publish ${trimmedName || "update"}`}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
