/**
 * <OverviewSection> — the plan's landing section (V2_INTERFACE_SPEC §2.3).
 *
 * Orients an actuary or an executive in five seconds: what's built,
 * what's next, what the plan last produced, which versions exist. Six
 * calm elements, all computed from signals the route already owns — no
 * charts, no decoration. (The identity header is the PlanHeader above;
 * this surface is the content.)
 *
 * §2B: pure presentation. The route computes the checklist counts, the
 * last-result summary, and the version rows; this renders them.
 *
 * Layout: a 2-column grid — the build checklist left (~58%), the three
 * smaller panels (last test · versions · plan facts) stacked right.
 */

import type { JSX } from "react";
import { Check } from "lucide-react";
import { Button } from "@openrater/design-system";
import "./overview-section.css";

export interface OverviewChecklistItem {
  readonly id: string;
  /** "Declare inputs", "Build factor tables", … */
  readonly label: string;
  readonly done: boolean;
  /** The count line — "12 inputs", "No gates yet". */
  readonly detail: string;
  /** Deep-link into the owning section. */
  readonly onOpen?: (() => void) | undefined;
  /** Label for the not-done action link (default "Open →"). */
  readonly actionLabel?: string | undefined;
  /** Brief 89 R6 — a second, equally-valid path for this step ("Add
   *  them from a book →" beside "Declare inputs →"). Rendered with a
   *  quiet ·or· separator; only while the step isn't done. */
  readonly secondActionLabel?: string | undefined;
  readonly onSecondOpen?: (() => void) | undefined;
}

export interface OverviewVersionRow {
  readonly id: string;
  readonly name: string;
  /** "2026-06-02" — omitted for the current draft. */
  readonly date?: string | undefined;
  readonly state: "draft" | "frozen" | "published";
}

export interface OverviewLastTest {
  /** "$4,731" — pre-formatted by the route. */
  readonly premiumLabel: string;
  /** "128 rows · ran 2h ago". */
  readonly detail: string;
  readonly onRun?: (() => void) | undefined;
}

export interface OverviewSectionProps {
  readonly checklist: readonly OverviewChecklistItem[];
  /** null → honest "Not run yet" empty card. */
  readonly lastTest: OverviewLastTest | null;
  /** Fires from the "Not run yet" card's action. */
  readonly onRunFirstTest?: (() => void) | undefined;
  readonly versions: readonly OverviewVersionRow[];
  readonly facts: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
  /** The creation note (plan.description — "+ Add a note", Brief 91).
   *  Long-form prose, so it renders as a stacked row under the scalar
   *  facts. null/blank → the row is omitted. */
  readonly note?: string | null | undefined;
  /** Brief 92 — set when the plan was built from a transcription
   *  workbook: the provenance line + the "View build report" opener.
   *  null/undefined → the row is omitted (hand-authored plan). */
  readonly buildReport?: {
    readonly summary: string;
    readonly onView: () => void;
    /** Brief 92.R — the revision door ("Re-ingest a revised workbook"). */
    readonly onReingest?: () => void;
    /** Drift tracking: in-app edits since the build. The
     *  chip renders warn-tinted with the count; title carries the
     *  first few changes; click opens the build report. */
    readonly edits?: {
      readonly count: number;
      readonly title?: string | undefined;
    } | null;
  } | null;
  readonly testId?: string | undefined;
}

// Brief 84 vocabulary: a checkpoint is "Saved" (it serves nobody), the
// published version is "Live" (it IS what callers get). "Frozen" left
// the UI with the stepper.
const VERSION_STATE_LABEL: Record<OverviewVersionRow["state"], string> = {
  draft: "Current draft",
  frozen: "Saved",
  published: "Live",
};

export function OverviewSection({
  checklist,
  lastTest,
  onRunFirstTest,
  versions,
  facts,
  note,
  buildReport,
  testId = "rater-overview-section",
}: OverviewSectionProps): JSX.Element {
  const doneCount = checklist.filter((c) => c.done).length;
  const noteText = note?.trim() ?? "";
  return (
    <div className="rater-overview" data-testid={testId}>
      {/* ── the build checklist (the golden path made visible) ──── */}
      <section className="rater-overview__panel rater-overview__checklist">
        <div className="rater-overview__panel-head">
          <h2 className="rater-overview__eyebrow">Build checklist</h2>
          <span className="rater-overview__count">
            {doneCount} of {checklist.length} complete
          </span>
        </div>
        <ol className="rater-overview__steps">
          {checklist.map((item) => (
            <li key={item.id} className="rater-overview__step">
              <span
                className={`rater-overview__step-mark${
                  item.done ? " rater-overview__step-mark--done" : ""
                }`}
                aria-hidden
              >
                {item.done ? <Check size={14} strokeWidth={2.5} /> : null}
              </span>
              <span className="rater-overview__step-label">{item.label}</span>
              <span className="rater-overview__step-detail">{item.detail}</span>
              {!item.done && item.onOpen ? (
                <Button variant="plain" size="xs" onClick={item.onOpen}>
                  {item.actionLabel ?? "Open →"}
                </Button>
              ) : null}
              {!item.done && item.onSecondOpen ? (
                <>
                  <span className="rater-overview__step-or" aria-hidden>
                    ·or·
                  </span>
                  <Button
                    variant="plain"
                    size="xs"
                    onClick={item.onSecondOpen}
                  >
                    {item.secondActionLabel ?? "Open →"}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <div className="rater-overview__side">
        {/* ── last test ───────────────────────────────────────── */}
        <section className="rater-overview__panel">
          <div className="rater-overview__panel-head">
            <h2 className="rater-overview__eyebrow">Last run</h2>
          </div>
          {lastTest ? (
            <>
              <p className="rater-overview__premium">{lastTest.premiumLabel}</p>
              <p className="rater-overview__subline">{lastTest.detail}</p>
              {lastTest.onRun ? (
                <Button variant="plain" size="xs" onClick={lastTest.onRun}>
                  Run again →
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <p className="rater-overview__subline">
                Not run yet — score the book or rate a sample risk.
              </p>
              {onRunFirstTest ? (
                <Button variant="plain" size="xs" onClick={onRunFirstTest}>
                  Run a test →
                </Button>
              ) : null}
            </>
          )}
        </section>

        {/* ── versions ────────────────────────────────────────── */}
        <section className="rater-overview__panel">
          <div className="rater-overview__panel-head">
            <h2 className="rater-overview__eyebrow">Versions</h2>
          </div>
          <ul className="rater-overview__versions">
            {versions.map((v) => (
              <li key={v.id} className="rater-overview__version">
                <span className="rater-overview__version-name">{v.name}</span>
                {v.date ? (
                  <span className="rater-overview__version-date">{v.date}</span>
                ) : null}
                <span className="rater-overview__version-chip">
                  <span
                    className={`rater-overview__version-dot rater-overview__version-dot--${v.state}`}
                    aria-hidden
                  />
                  {VERSION_STATE_LABEL[v.state]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── plan facts ──────────────────────────────────────── */}
        <section className="rater-overview__panel">
          <div className="rater-overview__panel-head">
            <h2 className="rater-overview__eyebrow">Plan facts</h2>
          </div>
          <dl className="rater-overview__facts">
            {facts.map((f) => (
              <div key={f.label} className="rater-overview__fact">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
            {buildReport ? (
              <div className="rater-overview__fact rater-overview__fact--note">
                <dt>Built from</dt>
                <dd>
                  {buildReport.summary}{" "}
                  {buildReport.edits && buildReport.edits.count > 0 ? (
                    <span
                      className="rater-overview__drift"
                      title={buildReport.edits.title}
                      data-testid="rater-overview-drift"
                    >
                      edited since build —{" "}
                      {buildReport.edits.count === 1
                        ? "1 change"
                        : `${buildReport.edits.count} changes`}
                    </span>
                  ) : null}{" "}
                  <Button variant="plain" size="xs" onClick={buildReport.onView}>
                    View build report →
                  </Button>
                  {buildReport.onReingest ? (
                    <Button
                      variant="plain"
                      size="xs"
                      onClick={buildReport.onReingest}
                    >
                      Re-ingest a revised workbook →
                    </Button>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {noteText ? (
              <div className="rater-overview__fact rater-overview__fact--note">
                <dt>Note</dt>
                <dd>{noteText}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>
    </div>
  );
}
