/**
 * <DiffSummaryChip> — top-level diff summary.
 *
 * Brief 12 — header chip showing the aggregate counts from a
 * DiffSummary + optional total impact:
 *
 *     2 changed · 1 added · 0 removed · +$190 (+3.7%)
 *
 * When the diff is empty (everything unchanged), renders:
 *
 *     ✓ Identical
 *
 * BEM:
 *   .rater-diff-summary-chip
 *   .rater-diff-summary-chip--identical
 *   .rater-diff-summary-chip__counts
 *   .rater-diff-summary-chip__count
 *   .rater-diff-summary-chip__count-value
 *   .rater-diff-summary-chip__count-label
 */

import type { DiffSummary, RateImpact } from "@openrater/contracts";
import { CheckCircle } from "lucide-react";
import { RateImpactBadge } from "../RateImpactBadge/RateImpactBadge";
import "./DiffSummaryChip.css";

export interface DiffSummaryChipProps {
  readonly summary: DiffSummary;
  /** When present, an additional RateImpactBadge is appended for the
   *  total premium delta. Typically supplied for run-vs-run +
   *  proposed-vs-filed modes. */
  readonly totalImpact?: RateImpact | null;
}

export function DiffSummaryChip({
  summary,
  totalImpact,
}: DiffSummaryChipProps) {
  const totalChanges = summary.changed + summary.added + summary.removed;
  if (totalChanges === 0) {
    return (
      <span
        className="rater-diff-summary-chip rater-diff-summary-chip--identical"
        aria-label="Identical — no differences found"
      >
        <CheckCircle size={14} aria-hidden />
        <span>Identical</span>
      </span>
    );
  }
  return (
    <span
      className="rater-diff-summary-chip"
      aria-label={`${summary.changed} changed, ${summary.added} added, ${summary.removed} removed`}
    >
      <span className="rater-diff-summary-chip__counts">
        <CountSlot label="changed" value={summary.changed} tone="changed" />
        <CountSlot label="added" value={summary.added} tone="added" />
        <CountSlot label="removed" value={summary.removed} tone="removed" />
      </span>
      {totalImpact ? (
        <>
          <span className="rater-diff-summary-chip__separator" aria-hidden>·</span>
          <RateImpactBadge impact={totalImpact} />
        </>
      ) : null}
    </span>
  );
}

function CountSlot({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: "changed" | "added" | "removed";
}) {
  return (
    <span
      className={`rater-diff-summary-chip__count rater-diff-summary-chip__count--${tone}`}
    >
      <span className="rater-diff-summary-chip__count-value">{value}</span>
      <span className="rater-diff-summary-chip__count-label">{label}</span>
    </span>
  );
}
