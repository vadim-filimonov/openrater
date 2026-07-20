/**
 * Brief 64 PR 64.4 — <DislocationExhibit>.
 *
 * The Compare act's headline: a histogram of per-policy rate change
 * (baseline → comparison) with a summary chip row. Decreases tint
 * emerald, increases tint orange, magnitude deepens the fill — the
 * actuary reads "how much of the book moved, and which way" at a glance.
 *
 * Pure presentation over a precomputed `Dislocation` (`computeDislocation`).
 * Beyond-range counts surface as an explicit note — never silently dropped.
 */

import { type JSX } from "react";
import { EmptyState } from "@openrater/design-system";
import { Activity } from "lucide-react";
import { formatDeltaPct } from "./exhibit-math";
import type { Dislocation } from "./dislocation";
import "./DislocationExhibit.css";

export interface DislocationExhibitProps {
  readonly dislocation: Dislocation;
  readonly baselineLabel: string;
  readonly comparisonLabel: string;
  readonly testId?: string;
}

const VIEW_W = 480;
const VIEW_H = 168;
const PAD = { l: 8, r: 8, t: 10, b: 22 };

export function DislocationExhibit(
  props: DislocationExhibitProps,
): JSX.Element {
  const {
    dislocation,
    baselineLabel,
    comparisonLabel,
    testId = "rater-dislocation",
  } = props;
  const { bins, summary, beyondLow, beyondHigh, displayRange } = dislocation;
  const [rangeLo, rangeHi] = displayRange;

  if (summary.total === 0) {
    return (
      <section className="rater-dislocation" data-testid={testId}>
        <Header baselineLabel={baselineLabel} comparisonLabel={comparisonLabel} />
        <div className="rater-dislocation__empty" data-testid={`${testId}-empty`}>
          <EmptyState
            icon={<Activity size={24} />}
            title="No comparison to chart"
            description="Pick a baseline version and a comparison (live draft or another version) to see the portfolio rate-change distribution."
          />
        </div>
      </section>
    );
  }

  const plotW = VIEW_W - PAD.l - PAD.r;
  const plotH = VIEW_H - PAD.t - PAD.b;
  let maxCount = 1;
  for (const b of bins) if (b.count > maxCount) maxCount = b.count;

  const binW = bins.length > 0 ? plotW / bins.length : 0;
  const zeroX =
    PAD.l + ((0 - rangeLo) / (rangeHi - rangeLo || 1)) * plotW;

  return (
    <section className="rater-dislocation" data-testid={testId}>
      <Header baselineLabel={baselineLabel} comparisonLabel={comparisonLabel} />

      <svg
        className="rater-dislocation__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        data-testid={`${testId}-svg`}
        role="img"
        aria-label="Per-policy rate-change distribution"
      >
        {/* baseline (0%) marker */}
        <line
          className="rater-dislocation__zero"
          x1={zeroX}
          x2={zeroX}
          y1={PAD.t - 4}
          y2={PAD.t + plotH}
        />
        <text
          className="rater-dislocation__zero-label"
          x={zeroX + 3}
          y={PAD.t + 4}
        >
          0%
        </text>
        {/* x-axis */}
        <line
          className="rater-dislocation__axis"
          x1={PAD.l}
          x2={VIEW_W - PAD.r}
          y1={PAD.t + plotH}
          y2={PAD.t + plotH}
        />
        {/* bars */}
        {bins.map((b, i) => {
          const mid = (b.lo + b.hi) / 2;
          const dir = mid < -1e-9 ? "down" : mid > 1e-9 ? "up" : "flat";
          const h = (b.count / maxCount) * plotH;
          const x = PAD.l + i * binW;
          const y = PAD.t + plotH - h;
          // Deepen the fill with magnitude (|mid| up to 30%).
          const intensity = Math.min(1, Math.abs(mid) / 0.3);
          const opacity = b.count === 0 ? 0 : 0.45 + 0.55 * intensity;
          return (
            <rect
              key={i}
              className={`rater-dislocation__bar is-${dir}`}
              x={x + 0.5}
              width={Math.max(0.5, binW - 1)}
              y={y}
              height={Math.max(0, h)}
              opacity={opacity}
              data-testid={`${testId}-bar-${i}`}
            >
              <title>
                {formatDeltaPct(b.lo)} to {formatDeltaPct(b.hi)} · {b.count}{" "}
                {b.count === 1 ? "policy" : "policies"}
              </title>
            </rect>
          );
        })}
        {/* edge labels */}
        <text className="rater-dislocation__x-label" x={PAD.l} y={VIEW_H - 6}>
          {formatDeltaPct(rangeLo)}
        </text>
        <text
          className="rater-dislocation__x-label"
          x={VIEW_W - PAD.r}
          y={VIEW_H - 6}
          textAnchor="end"
        >
          {formatDeltaPct(rangeHi)}+
        </text>
      </svg>

      <div className="rater-dislocation__summary" data-testid={`${testId}-summary`}>
        <Chip tone="up" label="increase" value={pct(summary.pctUp)} />
        <Chip tone="down" label="decrease" value={pct(summary.pctDown)} />
        <Chip tone="neutral" label="within ±10%" value={pct(summary.pctWithin10)} />
        <Chip
          tone={toneOf(summary.weightedAvg)}
          label="weighted avg"
          value={formatDeltaPct(summary.weightedAvg)}
        />
      </div>

      {(beyondLow > 0 || beyondHigh > 0 || summary.naCount > 0) && (
        <p className="rater-dislocation__note" data-testid={`${testId}-note`}>
          {beyondLow > 0 && `${beyondLow} below ${formatDeltaPct(rangeLo)}. `}
          {beyondHigh > 0 && `${beyondHigh} above ${formatDeltaPct(rangeHi)}. `}
          {summary.naCount > 0 &&
            `${summary.naCount} new business (no prior premium).`}
        </p>
      )}
    </section>
  );
}

function Header(props: {
  readonly baselineLabel: string;
  readonly comparisonLabel: string;
}): JSX.Element {
  return (
    <header className="rater-dislocation__head">
      <div className="rater-dislocation__title-block">
        <span className="rater-dislocation__title-icon" aria-hidden>
          <Activity size={14} />
        </span>
        <h3 className="rater-dislocation__title">Book dislocation</h3>
      </div>
      <span className="rater-dislocation__sub">
        per-policy rate change · {props.baselineLabel} → {props.comparisonLabel}
      </span>
    </header>
  );
}

function Chip(props: {
  readonly tone: "up" | "down" | "neutral";
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <span className={`rater-dislocation__chip is-${props.tone}`}>
      <span className="rater-dislocation__chip-val">{props.value}</span>
      <span className="rater-dislocation__chip-label">{props.label}</span>
    </span>
  );
}

function pct(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

function toneOf(frac: number | null): "up" | "down" | "neutral" {
  if (frac === null || Math.abs(frac) < 1e-9) return "neutral";
  return frac > 0 ? "up" : "down";
}
