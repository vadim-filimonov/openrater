/**
 * RevisionReview — Brief 92.R scene 2, the centerpiece surface.
 *
 * What the revision changes, construct by construct, in spine order —
 * rendered from the diff the backend computed against the workbook the
 * plan was actually built from (D3). Nothing changes until "Apply the
 * revision"; a removed construct is loud BEFORE it happens; hand edits
 * and the pre-92R missing-base caveat are banners, never footnotes.
 *
 * Pure presentation: the panel that hosts it owns the apply call and
 * the If-Match hash (D7).
 */

import { Plus, Minus, TriangleAlert, RefreshCw } from "lucide-react";
import type {
  DiffFieldChangeLike,
  DiffItemLike,
  ReingestCheckResultLike,
} from "./types";

const CHANGES_FOLD = 10;

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}

function fmtPct(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined) return null;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** "The revision changes 9 constructs across 4 sections" (§8 copy). */
export function revisionVerdictLine(diff: {
  readonly totals: {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly sections_changed: number;
  };
}): string {
  const t = diff.totals;
  const constructs = t.added + t.changed + t.removed;
  const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return (
    `The revision changes ${constructs} ${s(constructs, "construct", "constructs")} ` +
    `across ${t.sections_changed} ${s(t.sections_changed, "section", "sections")}`
  );
}

function ChangeRow({ change }: { readonly change: DiffFieldChangeLike }) {
  const pct = fmtPct(change.pct);
  return (
    <div className="rater-revision-review__change">
      <code className="rater-revision-review__change-field">{change.field}</code>
      <span className="rater-revision-review__change-move">
        <span className="rater-revision-review__change-old">
          {fmtVal(change.from)}
        </span>
        <span aria-hidden> → </span>
        {fmtVal(change.to)}
      </span>
      {pct ? (
        <span className="rater-revision-review__change-pct">{pct}</span>
      ) : (
        <span />
      )}
    </div>
  );
}

function ItemRow({ item }: { readonly item: DiffItemLike }) {
  const changes = item.changes ?? [];
  const shown = changes.slice(0, CHANGES_FOLD);
  const folded = changes.length - shown.length;
  return (
    <div
      className={
        "rater-revision-review__item rater-revision-review__item--" + item.state
      }
    >
      <span className="rater-revision-review__item-mark" aria-hidden>
        {item.state === "added" ? (
          <Plus />
        ) : item.state === "removed" ? (
          <Minus />
        ) : (
          <RefreshCw />
        )}
      </span>
      <div className="rater-revision-review__item-body">
        <span className="rater-revision-review__item-summary">
          <span className="rater-revision-review__item-state">{item.state}</span>{" "}
          {item.summary}
        </span>
        {shown.map((c) => (
          <ChangeRow key={c.field} change={c} />
        ))}
        {folded > 0 ? (
          <span className="rater-revision-review__fold">
            …{folded} more in this construct.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface RevisionReviewProps {
  readonly review: ReingestCheckResultLike;
  /** The plan the revision targets (for the header line). */
  readonly planLabel: string;
}

export function RevisionReview({ review, planLabel }: RevisionReviewProps) {
  const diff = review.diff;
  const quiet =
    diff?.sections.filter((s) => s.items.length === 0 && s.unchanged > 0) ?? [];
  const active = diff?.sections.filter((s) => s.items.length > 0) ?? [];
  const wbId = review.check.manifest?.provenance.rating_plan_id;
  const versionTo = review.check.manifest?.provenance.version;

  return (
    <div className="rater-revision-review">
      {diff ? (
        <div className="rater-revision-review__verdict" role="status">
          <span className="rater-revision-review__verdict-line">
            {revisionVerdictLine(diff)}
          </span>
          <span className="rater-revision-review__verdict-chips">
            <span className="rater-revision-review__chip rater-revision-review__chip--added">
              {diff.totals.added} added
            </span>
            <span className="rater-revision-review__chip rater-revision-review__chip--changed">
              {diff.totals.changed} changed
            </span>
            <span className="rater-revision-review__chip rater-revision-review__chip--removed">
              {diff.totals.removed} removed
            </span>
          </span>
        </div>
      ) : null}
      <p className="rater-revision-review__verline">
        {wbId ?? "workbook"}
        {review.base
          ? ` · v${review.base.workbook_version ?? "?"} → v${versionTo ?? "?"} · base built ${review.base.built_at.slice(0, 10)}`
          : null}
        {" · updates "}
        {planLabel}
      </p>

      {review.hand_edited_since_build ? (
        <div className="rater-revision-review__warn" role="alert">
          <TriangleAlert aria-hidden />
          <span>
            This plan was hand-edited after its last build. Applying
            overwrites the workbook-managed sections —{" "}
            <strong>duplicate the plan first</strong> to keep hand edits.
          </span>
        </div>
      ) : null}
      {review.base_missing_reason ? (
        <div className="rater-revision-review__warn" role="alert">
          <TriangleAlert aria-hidden />
          <span>{review.base_missing_reason}</span>
        </div>
      ) : null}

      {active.map((sec) => (
        <section key={sec.section} className="rater-revision-review__section">
          <header className="rater-revision-review__section-head">
            <span className="rater-revision-review__section-name">
              {sec.label}
            </span>
            <span className="rater-revision-review__section-counts">
              {[
                sec.added ? `${sec.added} added` : null,
                sec.changed ? `${sec.changed} changed` : null,
                sec.removed ? `${sec.removed} removed` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </header>
          {sec.items.map((item) => (
            <ItemRow key={`${item.state}:${item.key}`} item={item} />
          ))}
        </section>
      ))}

      {quiet.length > 0 ? (
        <p className="rater-revision-review__quiet">
          {quiet.map((s) => s.label).join(" · ")} — unchanged
        </p>
      ) : null}
      {(diff?.ignored ?? []).map((note) => (
        <p key={note} className="rater-revision-review__quiet">
          {note}
        </p>
      ))}
    </div>
  );
}
