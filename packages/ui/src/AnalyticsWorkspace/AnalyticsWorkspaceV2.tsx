/**
 * Brief 64 PR 64.6 — <AnalyticsWorkspaceV2>, reshaped by Brief 93 (93.1).
 *
 * Analytics' LANDING view is the plan report (R1): `reportSlot` (the
 * consumer-composed <PlanReport>) renders for every plan, in every
 * data state. The three-act book workspace this component has always
 * carried moves behind the **Book** view, reachable only when a
 * scored result exists — ADR-0041's gate moves from "the whole
 * surface" to "the Book tab" (§1.3):
 *
 *   Report    — <PlanReport> via reportSlot (the document idiom)
 *   Book · Rate Drivers — RateDriversList → DimensionDetailExhibit
 *   Book · Compare      — DislocationExhibit + ImpactByVariable
 *   Book · Present      — ExecutiveSummary
 *
 * The `view` is controlled by the consumer (the report's Book button
 * and the book's Report tab both flow through `onViewChange`), so
 * deep-link/state ownership stays in the route.
 *
 * Plan-agnostic: the consumer hands `variables: OverviewVariableSpec[]` built
 * from `plan.dimensions` — no variable names here.
 *
 * Pure-ish presentation: it owns act/kpi/selection UI state and runs the pure
 * math (computePlanOverview / computeDislocation / computeImpactByVariable)
 * over the data the consumer supplies; the consumer owns version-picker state
 * + re-rate + publish.
 */

import { useMemo, useState, type JSX, type ReactNode } from "react";
import { Button, EmptyState } from "@openrater/design-system";
import { Layers } from "lucide-react";
import {
  ANALYTICS_KPIS,
  type AnalyticsKpiId,
  type AnalyticsKpiSpec,
  type AnalyticsSnapshotSummary,
} from "./analytics-types";
import {
  kpiValue,
  formatKpiValue,
  premiumSplitByTier,
  type ScoredBatchResult,
} from "./exhibit-math";
import {
  computePlanOverview,
  type OverviewVariableSpec,
} from "./overview-math";
import { computeDislocation } from "./dislocation";
import { computeImpactByVariable, type VariableImpact } from "./impact";
import { RateDriversList } from "../RateDriversList";
import { DimensionDetailExhibit } from "./DimensionDetailExhibit";
import { DislocationExhibit } from "./DislocationExhibit";
import { ImpactByVariable } from "./ImpactByVariable";
import { StalenessBanner } from "./StalenessBanner";
import { ExecutiveSummary, type ExecMover } from "./ExecutiveSummary";
import "./AnalyticsWorkspaceV2.css";

const DRAFT_SENTINEL = "__draft__";
type Act = "overview" | "compare" | "present";
/** KPIs offered in the Overview/Compare KPI picker (rate_change is a Compare
 *  concept surfaced via dislocation, not a per-level ranking). */
const PICKER_KPIS: readonly AnalyticsKpiSpec[] = ANALYTICS_KPIS.filter(
  (k) => k.id !== "rate_change",
);

export interface AnalyticsWorkspaceV2Props {
  // ── Gate (ADR-0041) ────────────────────────────────────────────
  readonly hasScoredResult: boolean;
  readonly hasSnapshots: boolean;
  readonly hasGeographicDim: boolean;
  readonly onFreezeVersion: () => void;

  // ── Data ───────────────────────────────────────────────────────
  /** The live scored book (most recent "Score all"). */
  readonly scoredResult: ScoredBatchResult | null;
  /** Re-rated baseline (picked baseline version); null → use scoredResult. */
  readonly baselineResult?: ScoredBatchResult | null;
  /** Re-rated comparison (picked version); null → "live draft" (scoredResult). */
  readonly comparisonResult?: ScoredBatchResult | null;
  /** Rate-driver variables, built from the plan's dimensions (plan-agnostic). */
  readonly variables: readonly OverviewVariableSpec[];
  readonly premiumColumn: string;
  readonly lossColumn?: string;
  /** Territory member states per geographic variable id (for the map). */
  readonly planLabel: string;

  // ── Version pickers (controlled) ───────────────────────────────
  readonly snapshots: readonly AnalyticsSnapshotSummary[];
  readonly baselineSnapshotId?: string;
  readonly onBaselineSnapshotIdChange?: (id: string) => void;
  readonly comparisonValue?: string;
  readonly onComparisonValueChange?: (value: string) => void;

  // ── Staleness + publish + export ───────────────────────────────
  readonly isStale?: boolean;
  readonly onReScore?: () => void;
  readonly onExport: () => void;

  readonly defaultKpiId?: AnalyticsKpiId;
  /** Brief 73 — the Portfolio "re-rate the stored book" what-if surface,
   *  rendered atop the Compare act. The consumer composes it (it fetches
   *  the book + runs the policy-grain re-rate); omit ⇒ nothing renders. */
  readonly compareBookSlot?: ReactNode;
  /**
   * Brief 93 (R1/R2) — the plan report, Analytics' landing view for
   * every plan in every data state (the consumer composes
   * <PlanReport>). Renders alone whenever `view` is "report" — and
   * always when no scored result exists, since the Book view gates
   * on one (ADR-0041, moved to the tab).
   */
  readonly reportSlot: ReactNode;
  /** Brief 93 §1.3 — which surface is showing. Controlled by the
   *  consumer (the report's Book button / the book's Report tab both
   *  flow through `onViewChange`). */
  readonly view: "report" | "book";
  readonly onViewChange: (view: "report" | "book") => void;
  readonly testId?: string;
}

export function AnalyticsWorkspaceV2(
  props: AnalyticsWorkspaceV2Props,
): JSX.Element {
  const {
    hasScoredResult,
    hasSnapshots,
    hasGeographicDim,
    onFreezeVersion,
    scoredResult,
    baselineResult = null,
    comparisonResult = null,
    variables,
    premiumColumn,
    lossColumn,
    planLabel,
    snapshots,
    baselineSnapshotId,
    onBaselineSnapshotIdChange,
    comparisonValue = DRAFT_SENTINEL,
    onComparisonValueChange,
    isStale = false,
    onReScore,
    onExport,
    defaultKpiId = "avg",
    compareBookSlot,
    reportSlot,
    view,
    onViewChange,
    testId = "rater-analytics",
  } = props;

  const [act, setAct] = useState<Act>("overview");
  const [kpiId, setKpiId] = useState<AnalyticsKpiId>(
    defaultKpiId === "rate_change" ? "avg" : defaultKpiId,
  );
  const [selectedVar, setSelectedVar] = useState<string | null>(null);
  const kpi: AnalyticsKpiSpec =
    PICKER_KPIS.find((k) => k.id === kpiId) ?? PICKER_KPIS[2]!; // "avg"

  // Datasets: Overview shows the live book; Compare diffs baseline →
  // comparison. Computed (and the memos below called) BEFORE the gate:
  // `hasScoredResult` flips false→true within one mount now that the
  // feed is the async persisted run (Brief 75 phase 4) — an early
  // return between hooks would change the hook order and crash.
  const overviewRows = scoredResult?.rows ?? [];
  const baseRows = (baselineResult ?? scoredResult)?.rows ?? [];
  const compRows = (comparisonResult ?? scoredResult)?.rows ?? [];
  const hasComparison = baselineResult !== null || comparisonResult !== null;

  const bookTotal = kpiValue(overviewRows, "total", premiumColumn) ?? 0;
  const bookAvg = kpiValue(overviewRows, "avg", premiumColumn) ?? 0;
  const policyCount = overviewRows.length;
  // G11 — the headline premium is WRITTEN premium: declined rows carry an
  // indicative figure that renders as its own stat, never blended in. A
  // book with no verdicts (gate-less plan / legacy persisted run) keeps
  // the honest undifferentiated "Total premium".
  const bookSplit = premiumSplitByTier(overviewRows, premiumColumn);

  const overview = useMemo(
    () =>
      computePlanOverview({
        rows: overviewRows,
        variables,
        premiumColumn,
        kpi: kpiId,
        ...(lossColumn !== undefined ? { lossColumn } : {}),
      }),
    [overviewRows, variables, premiumColumn, kpiId, lossColumn],
  );

  const dislocation = useMemo(
    () =>
      computeDislocation({
        baselineRows: baseRows,
        comparisonRows: compRows,
        premiumColumn,
      }),
    [baseRows, compRows, premiumColumn],
  );

  const impact = useMemo(
    () =>
      computeImpactByVariable({
        baselineRows: baseRows,
        comparisonRows: compRows,
        variables,
        premiumColumn,
        kpi,
        ...(lossColumn !== undefined ? { lossColumn } : {}),
      }),
    [baseRows, compRows, variables, premiumColumn, kpi, lossColumn],
  );

  const selectedSpec = variables.find((v) => v.id === selectedVar) ?? null;

  // ── Brief 93 (R1): the report is the landing view — rendered alone
  // whenever the consumer's view says so, and ALWAYS when no scored
  // result exists (the Book view gates on one; ADR-0041 moved from
  // "the whole surface" to the tab). Placed AFTER every hook (rules
  // of hooks — `hasScoredResult` flips within one mount). ──
  if (view !== "book" || !hasScoredResult || scoredResult === null) {
    return (
      <section
        className="rater-analytics"
        data-testid={testId}
        data-view="report"
        data-ready={hasScoredResult ? "true" : "false"}
      >
        <div
          className="rater-analytics__report"
          data-testid={`${testId}-report`}
        >
          {reportSlot}
        </div>
      </section>
    );
  }

  const baselineLabel = labelFor(baselineSnapshotId, snapshots, "baseline");
  const comparisonLabel =
    comparisonValue === DRAFT_SENTINEL
      ? "live draft"
      : labelFor(comparisonValue, snapshots, "comparison");

  return (
    <section
      className="rater-analytics"
      data-testid={testId}
      data-view="book"
      data-ready="true"
    >
      <Header planLabel={planLabel} />

      {/* Executive band */}
      <div className="rater-analytics__band" data-testid={`${testId}-band`}>
        <div className="rater-analytics__band-kpis">
          <BandStat
            label={bookSplit.hasVerdicts ? "Written premium" : "Total premium"}
            value={formatKpiValue(
              bookSplit.hasVerdicts ? bookSplit.written : bookTotal,
              "total",
            )}
          />
          {bookSplit.declinedCount > 0 && (
            <BandStat
              label="Declined (indicative)"
              value={formatKpiValue(bookSplit.declined, "total")}
            />
          )}
          <BandStat
            label="Policies"
            value={policyCount.toLocaleString("en-US")}
          />
          <BandStat
            label="Avg premium"
            value={formatKpiValue(bookAvg, "avg")}
          />
          {hasComparison && (
            <BandStat
              label={`vs ${baselineLabel}`}
              value={formatPct(dislocation.summary.weightedAvg)}
              tone={toneOf(dislocation.summary.weightedAvg)}
            />
          )}
        </div>
      </div>

      {/* Act switch + pickers */}
      <div className="rater-analytics__toolbar">
        <div
          className="rater-analytics__acts"
          role="tablist"
          aria-label="Analytics view"
        >
          {/* Brief 93 §1.3 — the way back to the landing view. */}
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="rater-analytics__act"
            onClick={() => onViewChange("report")}
            data-testid={`${testId}-act-report`}
          >
            Report
          </button>
          {(["overview", "compare", "present"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={act === a}
              className={`rater-analytics__act${act === a ? " is-active" : ""}`}
              onClick={() => setAct(a)}
              data-testid={`${testId}-act-${a}`}
            >
              {a === "overview"
                ? "Rate Drivers"
                : a === "compare"
                  ? "Compare"
                  : "Present"}
            </button>
          ))}
        </div>
        <div className="rater-analytics__pickers">
          {hasSnapshots && (
            <Picker
              label="Baseline"
              value={baselineSnapshotId ?? snapshots[0]?.snapshot_id ?? ""}
              onChange={(v) => onBaselineSnapshotIdChange?.(v)}
              options={snapshots.map((s) => ({
                value: s.snapshot_id,
                label: s.display_name,
              }))}
              testId={`${testId}-baseline`}
            />
          )}
          {hasSnapshots && (
            <Picker
              label="Comparison"
              value={comparisonValue}
              onChange={(v) => onComparisonValueChange?.(v)}
              options={[
                { value: DRAFT_SENTINEL, label: "Live draft" },
                ...snapshots.map((s) => ({
                  value: s.snapshot_id,
                  label: s.display_name,
                })),
              ]}
              testId={`${testId}-comparison`}
            />
          )}
          <Picker
            label="KPI"
            value={kpiId}
            onChange={(v) => setKpiId(v as AnalyticsKpiId)}
            options={PICKER_KPIS.map((k) => ({ value: k.id, label: k.label }))}
            testId={`${testId}-kpi`}
          />
          <button
            type="button"
            className="rater-analytics__export"
            onClick={onExport}
            data-testid={`${testId}-export`}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Act bodies */}
      {act === "overview" && (
        <div
          className="rater-analytics__body"
          data-testid={`${testId}-overview`}
        >
          <RateDriversList
            variables={overview.variables}
            bookAvg={bookAvg}
            kpiLabel={kpi.label}
            formatValue={(v) => formatKpiValue(v, kpiId)}
            selectedId={selectedVar}
            onSelect={(id) => setSelectedVar(id === selectedVar ? null : id)}
            testId={`${testId}-drivers`}
          />
          {selectedSpec && (
            <DimensionDetailExhibit
              variable={selectedSpec}
              rows={overviewRows}
              kpi={kpi}
              premiumColumn={premiumColumn}
              {...(lossColumn !== undefined ? { lossColumn } : {})}
              bookAvg={bookAvg}
              testId={`${testId}-detail`}
            />
          )}
          {/* Brief 93 — the rate card lives on the report now (§1.1.5);
              the Book view stays observed-data only. */}
        </div>
      )}

      {act === "compare" && (
        <div className="rater-analytics__body" data-testid={`${testId}-compare`}>
          {compareBookSlot ? (
            <section
              className="rater-analytics__book-rerate"
              aria-label="Re-rate the stored book"
            >
              <h3 className="rater-analytics__section-title">
                Re-rate the stored book
              </h3>
              {compareBookSlot}
            </section>
          ) : null}
          {isStale && scoredResult.scoredAt && (
            <StalenessBanner
              scoredAt={scoredResult.scoredAt}
              stale
              {...(onReScore ? { onReScore } : {})}
              testId={`${testId}-staleness`}
            />
          )}
          {hasComparison ? (
            <>
              <DislocationExhibit
                dislocation={dislocation}
                baselineLabel={baselineLabel}
                comparisonLabel={comparisonLabel}
                testId={`${testId}-dislocation`}
              />
              <ImpactByVariable
                variables={impact.variables}
                baselineLabel={baselineLabel}
                comparisonLabel={comparisonLabel}
                selectedId={selectedVar}
                onSelect={(id) =>
                  setSelectedVar(id === selectedVar ? null : id)
                }
                testId={`${testId}-impact`}
              />
              {selectedSpec && (
                <DimensionDetailExhibit
                  variable={selectedSpec}
                  rows={baseRows}
                  comparisonRows={compRows}
                  kpi={kpi}
                  premiumColumn={premiumColumn}
                  {...(lossColumn !== undefined ? { lossColumn } : {})}
                  bookAvg={bookAvg}
                  baselineLabel={baselineLabel}
                  comparisonLabel={comparisonLabel}
                  testId={`${testId}-compare-detail`}
                />
              )}
            </>
          ) : (
            <div
              className="rater-analytics__hint"
              data-testid={`${testId}-compare-hint`}
            >
              <EmptyState
                icon={<Layers size={24} />}
                title="Pick two versions to compare"
                description={
                  hasSnapshots
                    ? "Set a Baseline version above; Comparison defaults to your live draft. Freeze → edit → compare to see the portfolio dislocation."
                    : "Freeze a version first, then edit and return here to compare old vs new."
                }
              />
              {!hasSnapshots && (
                <Button
                  variant="primary"
                  size="md"
                  onClick={onFreezeVersion}
                  data-testid={`${testId}-freeze`}
                >
                  Save a version
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {act === "present" && (
        <div className="rater-analytics__body" data-testid={`${testId}-present`}>
          <ExecutiveSummary
            planLabel={planLabel}
            totalPremium={bookTotal}
            policyCount={policyCount}
            avgPremium={bookAvg}
            {...(scoredResult.scoredAt
              ? { scoredAt: scoredResult.scoredAt }
              : {})}
            {...(hasComparison
              ? {
                  comparison: {
                    baselineLabel,
                    comparisonLabel,
                    weightedAvg: dislocation.summary.weightedAvg,
                    pctWithin10: dislocation.summary.pctWithin10,
                    maxUp: dislocation.summary.maxUp,
                  },
                  topIncreases: topMovers(impact.variables, "up"),
                  topDecreases: topMovers(impact.variables, "down"),
                }
              : {})}
            testId={`${testId}-exec`}
          />
        </div>
      )}

      {!hasGeographicDim && act === "overview" && (
        <p
          className="rater-analytics__map-hint"
          data-testid={`${testId}-map-hint`}
        >
          Map a state / territory dim on Inputs to unlock the geographic map.
        </p>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sub-components + helpers
// ──────────────────────────────────────────────────────────────────

function Header(props: { readonly planLabel: string }): JSX.Element {
  return (
    <header className="rater-analytics__header">
      <h1 className="rater-analytics__title">Analytics</h1>
      <p className="rater-analytics__subtitle">{props.planLabel}</p>
    </header>
  );
}

function BandStat(props: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "up" | "down" | "neutral";
}): JSX.Element {
  return (
    <div className="rater-analytics__band-stat">
      <span className="rater-analytics__band-label">{props.label}</span>
      <span
        className={`rater-analytics__band-val${props.tone ? ` is-${props.tone}` : ""}`}
      >
        {props.value}
      </span>
    </div>
  );
}

function Picker(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly testId: string;
}): JSX.Element {
  return (
    <label className="rater-analytics__picker">
      <span className="rater-analytics__picker-label">{props.label}</span>
      <select
        className="rater-analytics__picker-select"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        data-testid={props.testId}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function labelFor(
  id: string | undefined,
  snapshots: readonly AnalyticsSnapshotSummary[],
  fallback: string,
): string {
  if (!id) return fallback;
  return snapshots.find((s) => s.snapshot_id === id)?.display_name ?? fallback;
}

function formatPct(frac: number | null): string {
  if (frac === null || !Number.isFinite(frac)) return "—";
  const pct = frac * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function toneOf(frac: number | null): "up" | "down" | "neutral" {
  if (frac === null || Math.abs(frac) < 1e-9) return "neutral";
  return frac > 0 ? "up" : "down";
}

function topMovers(
  variables: readonly VariableImpact[],
  dir: "up" | "down",
): ExecMover[] {
  const movers: ExecMover[] = [];
  for (const v of variables) {
    const delta = dir === "up" ? v.maxLevelDelta : v.minLevelDelta;
    if (delta === null) continue;
    if (dir === "up" && delta > 1e-9) movers.push({ label: v.label, delta });
    if (dir === "down" && delta < -1e-9) movers.push({ label: v.label, delta });
  }
  movers.sort((a, b) => (dir === "up" ? b.delta - a.delta : a.delta - b.delta));
  return movers.slice(0, 3);
}
