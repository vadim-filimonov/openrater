/**
 * <PremiumBuildUp> — the premium build-up trace (Brief 62.4, R1).
 *
 * Renders a `PolicyResult`'s ordered post-aggregation tail (62.1's
 * `AdjustmentStep[]`) as an explainable waterfall — the cold-test
 * centerpiece (every premium explainable, W4 §4.0):
 *
 *     Subtotal                                    $3,205
 *       Schedule rating  −7.0% (Σ6 · cap ±25%)  column  3,205 → 2,981
 *       Package          × 0.90                  filed   2,981 → 2,683
 *       New-business     not applied (skipped)           2,683 → 2,683
 *       Terrorism        + $18                    filed   2,683 → 2,701
 *       Minimum premium  floor $500 · not binding         2,701 → 2,701
 *     Filed premium                               $2,701
 *
 * Each step shows: a kind-colored chip + label, the engine's `detail`
 * string (the authoritative effect text), a provenance pill (literal /
 * column / model / filed), and before→after. Guard-skipped steps render
 * muted (P-N9). Back-compat: a LEGACY policy's `PolicyResult` carries the
 * synthesized 2-step tail (62.1 §3), so the old `× credit → floor` view is
 * a SPECIAL CASE of this renderer — no separate code path.
 *
 * Renamed from `<PolicyBuildUp>` (Brief 46); both consumers (the plan's
 * cohort drill-in and the /policies composer) now mount `<PremiumBuildUp>`
 * directly, so the back-compat alias was removed (durable-pref #8).
 *
 * Pure + presentational. No data fetching, no product branch, no premium
 * math (all arithmetic is the shipped `composePolicy`).
 */

import { Num, EmptyState } from "@openrater/design-system";
import { Calculator, FileSearch, AlertTriangle } from "lucide-react";
import type { AdjustmentStep, PolicyResult } from "@openrater/contracts";
import "./PremiumBuildUp.css";

export interface PremiumBuildUpProps {
  /** The composed result, or `null` before a risk is scored. */
  readonly result: PolicyResult | null;
  /**
   * Optional `step.id → display label` map (from the authored tail, e.g.
   * `pioneer → "Pioneer credit"`). Falls back to a kind-derived label, so
   * the component renders correctly from a `PolicyResult` alone.
   */
  readonly labels?: Readonly<Record<string, string>>;
  /**
   * Brief 62.6 — open the FROZEN replay snapshot behind a connector-sourced
   * step (the filing record; re-scores read this, never the live API). When
   * provided, a step carrying `provenance.snapshot_id` shows a view affordance.
   */
  readonly onViewSnapshot?: (snapshotId: string) => void;
  /**
   * Override the subtotal-row tag (default `"{n} lines"`). The multi-location
   * roll-up reuses this build-up over a rolled subtotal whose contributors are
   * LOCATIONS, not policy lines — it passes e.g. `"2 locations"` so the tag
   * reads correctly. Omit and the line-count default is used (unchanged).
   */
  readonly subtotalTag?: string;
}

const KIND_LABEL: Record<AdjustmentStep["kind"], string> = {
  schedule_rating: "Schedule rating",
  package_factor: "Package",
  endorsement: "Endorsement",
  minimum_premium: "Minimum premium",
};

const KIND_MOD: Record<AdjustmentStep["kind"], string> = {
  schedule_rating: "sched",
  package_factor: "pkg",
  endorsement: "endo",
  minimum_premium: "min",
};

/** Credit (green) when the step lowered the running total, debit (orange)
 *  when it raised it, neutral when unchanged (a no-op / non-binding floor). */
function toneFor(step: AdjustmentStep): "credit" | "debit" | "neutral" {
  if (step.after < step.before) return "credit";
  if (step.after > step.before) return "debit";
  return "neutral";
}

function provenanceLabel(step: AdjustmentStep): string {
  const p = step.provenance;
  if (!p) return "filed";
  // connector carries a version (62.6) — surface it in the pill.
  if (p.source === "connector" && p.version) return `connector · ${p.version}`;
  return p.source;
}

export function PremiumBuildUp({
  result,
  labels,
  onViewSnapshot,
  subtotalTag,
}: PremiumBuildUpProps) {
  if (!result) {
    return (
      <div className="rater-premium-buildup rater-premium-buildup--empty">
        <EmptyState
          icon={<Calculator />}
          title="No premium yet"
          description="Score a risk to see the build-up."
        />
      </div>
    );
  }

  const lineWord = result.lines.length === 1 ? "line" : "lines";

  return (
    <div className="rater-premium-buildup">
      <div className="rater-premium-buildup__row rater-premium-buildup__row--subtotal">
        <span className="rater-premium-buildup__label">
          Subtotal
          <span className="rater-premium-buildup__tag">
            {subtotalTag ?? `${result.lines.length} ${lineWord}`}
          </span>
        </span>
        <Num
          className="rater-premium-buildup__amount"
          value={result.subtotal}
          format="currency"
          maximumFractionDigits={0}
          minimumFractionDigits={0}
        />
      </div>

      {result.adjustments.map((step) => {
        const tone = toneFor(step);
        const label = labels?.[step.id] ?? KIND_LABEL[step.kind];
        return (
          <div
            key={step.id}
            className={
              "rater-premium-buildup__row rater-premium-buildup__row--step" +
              (step.applied ? "" : " rater-premium-buildup__row--skipped")
            }
          >
            <span
              className={`rater-premium-buildup__chip rater-premium-buildup__chip--${KIND_MOD[step.kind]}`}
            >
              {label}
            </span>
            <span
              className={`rater-premium-buildup__detail rater-premium-buildup__detail--${tone}`}
            >
              {step.detail}
            </span>
            <span className="rater-premium-buildup__prov">
              {provenanceLabel(step)}
              {step.provenance?.fallback_reason ? (
                <span
                  className="rater-premium-buildup__fallback"
                  title={`Fallback: ${step.provenance.fallback_reason}`}
                >
                  <AlertTriangle size={10} /> fallback
                </span>
              ) : null}
              {step.provenance?.snapshot_id && onViewSnapshot ? (
                <button
                  type="button"
                  className="rater-premium-buildup__snapshot"
                  onClick={() => onViewSnapshot(step.provenance!.snapshot_id!)}
                  title={`View the frozen response (snapshot ${step.provenance.snapshot_id}) — re-scores read this, never the live API`}
                >
                  <FileSearch size={11} /> snapshot
                </button>
              ) : null}
            </span>
            <span className="rater-premium-buildup__arrow">
              <Num value={step.before} format="integer" />
              <span className="rater-premium-buildup__arrow-glyph" aria-hidden="true">
                {" → "}
              </span>
              <Num value={step.after} format="integer" />
            </span>
          </div>
        );
      })}

      <div className="rater-premium-buildup__divider" />

      <div className="rater-premium-buildup__total">
        <span className="rater-premium-buildup__total-label">Filed premium</span>
        <Num
          className="rater-premium-buildup__total-amount"
          value={result.total}
          format="currency"
          maximumFractionDigits={0}
          minimumFractionDigits={0}
        />
      </div>
    </div>
  );
}
