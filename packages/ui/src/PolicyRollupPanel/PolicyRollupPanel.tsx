/**
 * <PolicyRollupPanel> — the grouped multi-location scoring result (E08/E03
 * brief D6). Renders the output of `evaluatePolicyBook`: one row per POLICY
 * (its appetite verdict + rolled-up fields), expandable to the per-location
 * contributions that summed into the policy total.
 *
 * This is the surface that finally shows the stress-test acceptance oracle
 * live: a 2-location policy whose TIV rolls up to $1.06M lands IN appetite
 * (neither location declined); a single-location $260k policy declines.
 *
 * Pure presentation — the math is `evaluatePolicyBook` (@openrater/contracts). The
 * appetite verdict reuses <TierVerdictChip> so the policy row shares the gate's
 * 4-tier color language. BEM block `.rater-prp`; tokens; no inline styles.
 */

import { useState, type JSX } from "react";
import { ChevronRight } from "lucide-react";
import type { PolicyBookResult, PolicyResult } from "@openrater/contracts";
import { TierVerdictChip } from "../TierVerdictChip";
import { PremiumBuildUp } from "../PremiumBuildUp";
import "./PolicyRollupPanel.css";

export interface PolicyRollupPanelProps {
  readonly results: readonly PolicyBookResult[];
  /** Rolled field keys to show, in order. Defaults to the union across
   *  results (first-seen order). */
  readonly fields?: readonly string[];
  /** Format a rolled value for display. Default: `value.toLocaleString()`. */
  readonly formatValue?: (field: string, value: number) => string;
  /** Format the IRPM-composed final premium. Default: USD whole-dollar. */
  readonly formatPremium?: (value: number) => string;
  /** Optional `step.id → label` map forwarded to the IRPM build-up. */
  readonly stepLabels?: Readonly<Record<string, string>>;
  readonly testId?: string;
}

const defaultFormat = (_field: string, value: number): string =>
  value.toLocaleString("en-US");

const defaultFormatPremium = (value: number): string =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** Adapt a policy's `composed` roll-up tail into the minimal `PolicyResult`
 *  shape <PremiumBuildUp> reads (subtotal + adjustments + total). The book path
 *  has no policy "lines" — the contributors are LOCATIONS — so the subtotal-row
 *  tag is overridden via `subtotalTag` at the call site. */
function composedToPolicyResult(
  policyId: string,
  composed: NonNullable<PolicyBookResult["composed"]>,
): PolicyResult {
  return {
    policy_id: policyId,
    lines: [],
    subtotal: composed.subtotal,
    package_credit: 1,
    after_credit: composed.subtotal,
    minimum_premium: 0,
    minimum_applied: false,
    total: composed.final,
    adjustments: composed.adjustments,
  };
}

function fieldKeys(
  results: readonly PolicyBookResult[],
  override?: readonly string[],
): string[] {
  if (override) return [...override];
  const seen: string[] = [];
  for (const r of results) {
    for (const k of Object.keys(r.rollup.rolled)) {
      if (!seen.includes(k)) seen.push(k);
    }
  }
  return seen;
}

export function PolicyRollupPanel(props: PolicyRollupPanelProps): JSX.Element {
  const {
    results,
    fields,
    formatValue = defaultFormat,
    formatPremium = defaultFormatPremium,
    stepLabels,
    testId = "rater-prp",
  } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const keys = fieldKeys(results, fields);

  const toggle = (policyId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(policyId)) next.delete(policyId);
      else next.add(policyId);
      return next;
    });
  };

  if (results.length === 0) {
    return (
      <section className="rater-prp" data-testid={testId}>
        <p className="rater-prp__empty">No policies yet — group rows on the Inputs tab.</p>
      </section>
    );
  }

  return (
    <section className="rater-prp" data-testid={testId}>
      <header className="rater-prp__head">
        <span className="rater-prp__head-title">Policies</span>
        <span className="rater-prp__head-count">{results.length}</span>
      </header>

      <div className="rater-prp__list">
        {results.map((r) => {
          const isOpen = expanded.has(r.policy_id);
          return (
            <div className="rater-prp__group" key={r.policy_id}>
              <button
                type="button"
                className={`rater-prp__row rater-prp__row--policy${isOpen ? " is-open" : ""}`}
                onClick={() => toggle(r.policy_id)}
                aria-expanded={isOpen}
                data-testid={`${testId}-policy-${r.policy_id}`}
              >
                <ChevronRight
                  size={13}
                  strokeWidth={2}
                  className="rater-prp__caret"
                  aria-hidden
                />
                <TierVerdictChip tier={r.appetite.tier} />
                <span className="rater-prp__id">{r.policy_id}</span>
                <span className="rater-prp__locs">
                  {r.rollup.location_count}{" "}
                  {r.rollup.location_count === 1 ? "location" : "locations"}
                </span>
                <span className="rater-prp__vals">
                  {keys.map((k) => (
                    <span className="rater-prp__val" key={k}>
                      <span className="rater-prp__val-label">{k}</span>
                      <span
                        className="rater-prp__val-num"
                        data-testid={`${testId}-${r.policy_id}-${k}`}
                      >
                        {formatValue(k, r.rollup.rolled[k] ?? 0)}
                      </span>
                    </span>
                  ))}
                </span>
                {r.composed ? (
                  <span className="rater-prp__final">
                    <span className="rater-prp__final-label">Final</span>
                    <span
                      className="rater-prp__final-num"
                      data-testid={`${testId}-${r.policy_id}-final`}
                    >
                      {formatPremium(r.composed.final)}
                    </span>
                  </span>
                ) : null}
              </button>

              {isOpen ? (
                <>
                <div className="rater-prp__locations" role="group">
                  {r.rollup.location_ids.map((locId, i) => (
                    <div className="rater-prp__row rater-prp__row--location" key={`${locId}-${i}`}>
                      <span className="rater-prp__loc-id">{locId}</span>
                      <span className="rater-prp__vals">
                        {keys.map((k) => {
                          const cell = r.rollup.breakdown[k]?.[i];
                          const v = cell?.value;
                          return (
                            <span className="rater-prp__val" key={k}>
                              <span className="rater-prp__val-label">{k}</span>
                              <span className="rater-prp__val-num">
                                {v == null ? "—" : formatValue(k, v)}
                              </span>
                            </span>
                          );
                        })}
                      </span>
                    </div>
                  ))}
                </div>
                {r.composed ? (
                  <div className="rater-prp__buildup">
                    <PremiumBuildUp
                      result={composedToPolicyResult(r.policy_id, r.composed)}
                      subtotalTag={`${r.rollup.location_count} ${
                        r.rollup.location_count === 1 ? "location" : "locations"
                      }`}
                      {...(stepLabels ? { labels: stepLabels } : {})}
                    />
                  </div>
                ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
