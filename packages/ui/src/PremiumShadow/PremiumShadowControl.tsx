/**
 * <PremiumShadowControl> — plan-level shadow re-rate (Brief 62.5 PR5b;
 * consumer brief §−1 backend #7 / P-ML4).
 *
 * When a policy's Final-adjustments tail carries a MODEL-sourced IRPM step,
 * the actuary can override that step's model VERSION and see the
 * filed-premium impact: Filed $X → $Y (Δ). The recompute happens in the
 * consumer (a second `composePolicy` pass with the version swapped) — the
 * engine stays source-blind; this primitive is presentational + controlled.
 *
 * Renders nothing when there are no shadowable steps (no model-sourced tail
 * step, or the model has only one version).
 */

import { Num, Button } from "@openrater/design-system";
import { GitCompare, X } from "lucide-react";
import "./PremiumShadowControl.css";

/** A model-sourced tail step that can be shadow-re-rated. */
export interface ShadowableStep {
  readonly adjustmentId: string;
  readonly name: string;
  readonly modelId: string;
  readonly pinnedVersion: string;
}

export interface PremiumShadowControlProps {
  readonly steps: readonly ShadowableStep[];
  /** Available versions per model id (≥2 for a step to be shadowable). */
  readonly versionsByModel: Readonly<Record<string, readonly string[]>>;
  /** The active override, or null. */
  readonly active: { readonly adjustmentId: string; readonly version: string } | null;
  readonly onChange: (next: { readonly adjustmentId: string; readonly version: string } | null) => void;
  /** The pinned (base) filed premium + the shadow filed premium. */
  readonly baseFiled: number | null;
  readonly shadowFiled: number | null;
  readonly isScoring?: boolean;
}

/** A signed whole-dollar currency string ("+$50" / "-$50" / "$0"). */
function signedCurrency(n: number): string {
  const s = Math.abs(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  if (n > 0) return `+${s}`;
  if (n < 0) return `-${s}`;
  return s;
}

export function PremiumShadowControl({
  steps,
  versionsByModel,
  active,
  onChange,
  baseFiled,
  shadowFiled,
  isScoring,
}: PremiumShadowControlProps) {
  // Only steps whose model has ≥2 registered versions are shadowable.
  const shadowable = steps.filter((s) => (versionsByModel[s.modelId]?.length ?? 0) >= 2);
  if (shadowable.length === 0) return null;

  const activeStep = active ? shadowable.find((s) => s.adjustmentId === active.adjustmentId) : undefined;
  const delta =
    baseFiled !== null && shadowFiled !== null ? shadowFiled - baseFiled : null;
  const deltaTone = delta === null || Math.abs(delta) < 0.005 ? "flat" : delta > 0 ? "up" : "down";

  return (
    <section className="rater-premium-shadow" aria-label="Shadow re-rate">
      <header className="rater-premium-shadow__head">
        <GitCompare size={14} className="rater-premium-shadow__icon" aria-hidden />
        <span className="rater-premium-shadow__title">Shadow re-rate</span>
        <span className="rater-premium-shadow__hint">
          Swap a model version → see the filed-premium impact
        </span>
      </header>

      <div className="rater-premium-shadow__controls">
        {/* Which model step to shadow (when more than one). */}
        {shadowable.length > 1 ? (
          <label className="rater-premium-shadow__field">
            <span className="rater-premium-shadow__label">Step</span>
            <select
              className="rater-premium-shadow__select"
              value={active?.adjustmentId ?? ""}
              onChange={(e) => {
                const step = shadowable.find((s) => s.adjustmentId === e.target.value);
                if (!step) return onChange(null);
                const alt =
                  (versionsByModel[step.modelId] ?? []).find((v) => v !== step.pinnedVersion) ??
                  step.pinnedVersion;
                onChange({ adjustmentId: step.adjustmentId, version: alt });
              }}
            >
              <option value="">Pick a step…</option>
              {shadowable.map((s) => (
                <option key={s.adjustmentId} value={s.adjustmentId}>
                  {s.name} · {s.modelId}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* The shadow version for the active (or sole) step. */}
        <label className="rater-premium-shadow__field">
          <span className="rater-premium-shadow__label">
            Shadow version{shadowable.length === 1 ? ` · ${shadowable[0]!.modelId}` : ""}
          </span>
          <select
            className="rater-premium-shadow__select rater-premium-shadow__select--mono"
            value={active?.version ?? ""}
            disabled={shadowable.length > 1 && !active}
            onChange={(e) => {
              const step = activeStep ?? shadowable[0]!;
              if (!e.target.value) return onChange(null);
              onChange({ adjustmentId: step.adjustmentId, version: e.target.value });
            }}
          >
            <option value="">
              {(activeStep ?? shadowable[0])
                ? `pinned · ${(activeStep ?? shadowable[0])!.pinnedVersion}`
                : "—"}
            </option>
            {(versionsByModel[(activeStep ?? shadowable[0])!.modelId] ?? [])
              .filter((v) => v !== (activeStep ?? shadowable[0])!.pinnedVersion)
              .map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
          </select>
        </label>

        {active ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={13} />}
            onClick={() => onChange(null)}
            aria-label="Clear shadow"
          >
            Clear
          </Button>
        ) : null}
      </div>

      {/* The premium impact — only meaningful when a shadow is active. */}
      {active && baseFiled === null && shadowFiled === null && !isScoring ? (
        <p className="rater-premium-shadow__hint-empty">
          Add a product line that scores to see the premium impact.
        </p>
      ) : null}
      {active && !(baseFiled === null && shadowFiled === null && !isScoring) ? (
        <div className="rater-premium-shadow__impact" aria-live="polite">
          <div className="rater-premium-shadow__cell">
            <span className="rater-premium-shadow__cell-label">Filed (pinned)</span>
            {baseFiled !== null ? (
              <Num
                className="rater-premium-shadow__amount"
                value={baseFiled}
                format="currency"
                maximumFractionDigits={0}
                minimumFractionDigits={0}
              />
            ) : (
              <span className="rater-premium-shadow__amount rater-premium-shadow__amount--muted">—</span>
            )}
          </div>
          <span className="rater-premium-shadow__arrow" aria-hidden>
            →
          </span>
          <div className="rater-premium-shadow__cell">
            <span className="rater-premium-shadow__cell-label">Filed (shadow)</span>
            {isScoring || shadowFiled === null ? (
              <span className="rater-premium-shadow__amount rater-premium-shadow__amount--muted">
                {isScoring ? "…" : "—"}
              </span>
            ) : (
              <Num
                className="rater-premium-shadow__amount"
                value={shadowFiled}
                format="currency"
                maximumFractionDigits={0}
                minimumFractionDigits={0}
              />
            )}
          </div>
          <div className="rater-premium-shadow__cell rater-premium-shadow__cell--delta">
            <span className="rater-premium-shadow__cell-label">Δ premium</span>
            <span
              className={`rater-premium-shadow__amount rater-premium-shadow__delta--${deltaTone}`}
            >
              {isScoring || delta === null ? "—" : signedCurrency(delta)}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
