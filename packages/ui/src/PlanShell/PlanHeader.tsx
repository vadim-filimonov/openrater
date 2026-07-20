/**
 * PlanHeader — the 64px plan identity strip (V2_INTERFACE_SPEC §2.1).
 *
 * Replaces PlanFrameV3: the pipeline rail is retired by owner ruling
 * ("icons that reveal the name of the tab — that's a gimmick");
 * navigation is the full-text <WorkspaceTabs> strip rendered below
 * this header by the route.
 *
 *   LEFT  — identity: t-20 title (+ a neutral status chip only when
 *           read-only — drafts carry their state in the lifecycle
 *           stepper) · one muted meta line with the health dot inline.
 *   RIGHT — the `actions` slot: the route passes the lifecycle
 *           stepper, the page's ONE primary (Rate sample), and the ⋯
 *           overflow. §2B — all wiring stays in the route.
 *
 * Alignment law: the header carries no horizontal padding of its own —
 * the page container owns the gutter, so the title shares the content
 * left edge with the tab labels and section bodies.
 */

import type { ReactNode } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";
import { Menu } from "@openrater/design-system";
import "./plan-header.css";

export interface PlanHeaderChecklistItem {
  readonly label: string;
  readonly done: boolean;
  /** Deep-link into the owning section. */
  readonly onOpen: () => void;
}

export interface PlanHeaderProps {
  readonly title: string;
  readonly meta: string;
  /** Hover text for the meta line (e.g. the content hash). */
  readonly metaTitle?: string | undefined;
  readonly health: string;
  readonly healthTone?: "ok" | "warn" | undefined;
  /** Non-draft (archived / active / proposed): the title row shows the
   *  status chip + the health line shows a lock. */
  readonly readOnly?: boolean | undefined;
  readonly statusLabel?: string | undefined;
  /**
   * V2_INTERFACE_SPEC §2.4 — the readiness checkpoints. When present,
   * the health pill becomes a Menu trigger and each checkpoint
   * deep-links to its section (the same checklist Overview shows).
   */
  readonly checklist?: readonly PlanHeaderChecklistItem[] | undefined;
  /** The right-side cluster (stepper · primary · overflow). */
  readonly actions?: ReactNode;
}

export function PlanHeader({
  title,
  meta,
  metaTitle,
  health,
  healthTone = "ok",
  readOnly = false,
  statusLabel,
  checklist,
  actions,
}: PlanHeaderProps): JSX.Element {
  const healthBody = (
    <>
      {readOnly ? (
        <Lock size={11} aria-hidden />
      ) : (
        <span className="rater-planhdr__health-dot" aria-hidden />
      )}
      {health}
    </>
  );
  return (
    <header className="rater-planhdr">
      <div className="rater-planhdr__identity">
        <div className="rater-planhdr__titlerow">
          <h1 className="rater-planhdr__title">{title}</h1>
          {readOnly && statusLabel ? (
            <span className="rater-planhdr__status">{statusLabel}</span>
          ) : null}
        </div>
        <div className="rater-planhdr__meta" title={metaTitle}>
          <span className="rater-planhdr__meta-text">{meta}</span>
          <span className="rater-planhdr__meta-sep" aria-hidden />
          {checklist && checklist.length > 0 && !readOnly ? (
            <Menu>
              <Menu.Trigger>
                <button
                  type="button"
                  className={`rater-planhdr__health rater-planhdr__health--${healthTone} rater-planhdr__health--button`}
                >
                  {healthBody}
                  {/* The caret signals "this opens the checkpoint menu" at rest,
                      so the pill doesn't read as plain text. */}
                  <ChevronDown
                    size={12}
                    className="rater-planhdr__health-caret"
                    aria-hidden
                  />
                </button>
              </Menu.Trigger>
              <Menu.Items aria-label="Build checkpoints">
                {checklist.map((item) => (
                  <Menu.Item key={item.label} onSelect={item.onOpen}>
                    <span
                      className={`rater-planhdr__check${
                        item.done ? " rater-planhdr__check--done" : ""
                      }`}
                      aria-hidden
                    >
                      {item.done ? <Check size={12} strokeWidth={2.5} /> : null}
                    </span>
                    {item.label}
                  </Menu.Item>
                ))}
              </Menu.Items>
            </Menu>
          ) : (
            <span
              className={`rater-planhdr__health rater-planhdr__health--${
                readOnly ? "readonly" : healthTone
              }`}
            >
              {healthBody}
            </span>
          )}
        </div>
      </div>
      {actions ? (
        <div className="rater-planhdr__actions">{actions}</div>
      ) : null}
    </header>
  );
}
