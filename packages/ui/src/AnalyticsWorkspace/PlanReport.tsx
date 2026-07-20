/**
 * <PlanReport> — Brief 93 (93.1): Analytics' landing view.
 *
 * A generated actuarial memo about the PLAN — one readable column in
 * the actuary's question order (R1/R2): the counted lede → what a
 * policy costs (the reference risk walked through the production
 * engine) → what moves the price (structural drivers) → the rate
 * card → worked examples → the book boundary as a quiet closing line
 * (R4 — never an opening apology).
 *
 * Every number is engine- or substrate-truth (R3): the walk runs
 * compilePlan/runPlan on the SAME projected plan the rate card
 * scores; the lede is a deterministic template over counted facts.
 * Interactivity lives in the exhibits it embeds and in the Book tab
 * (R2) — the report itself carries zero pickers.
 */

import { useMemo, type JSX, type ReactNode } from "react";
import { BarChart3, Printer, Shield } from "lucide-react";
import { Button } from "@openrater/design-system";
import type { DimensionRow } from "../DimensionsTable";
import type {
  FactorTableLike,
  StageLike,
} from "../InputsWorkspace/deriveRequiredInputs";
import { synthesizeRepresentativeRisk } from "../InputsWorkspace/synthesizeRepresentativeRisk";
import type { Plan } from "@openrater/contracts";
import { TierVerdictChip } from "../TierVerdictChip";
import type { ReportGateRow } from "./report-gates";
import type { VerifiedExamples } from "./report-examples";
import { StructuralDrivers } from "./StructuralDrivers";
import { computeStructuralDrivers } from "./probe-math";
import { computeReferenceWalk, type ReferenceWalk } from "./report-walk";
import { VECTOR_DELTA_NOTE } from "../WorkbookBuild/vectorDelta";
import {
  buildProvenanceClause,
  buildReportMetaLine,
  computePlanReportFacts,
} from "./report-facts";
import "./PlanReport.css";

export interface PlanReportProps {
  readonly planLabel: string;
  /** Display-ready meta pieces — the consumer owns label resolution. */
  readonly productLabel?: string | null;
  readonly stateLabel?: string | null;
  /** The status chip (consumer composes <PlanStatusChip>). */
  readonly statusSlot?: ReactNode;

  // ── The substrate the report describes ─────────────────────────
  readonly stages: readonly StageLike[];
  readonly dimensions: readonly DimensionRow[];
  readonly factorTables: readonly FactorTableLike[];
  readonly factorTableCells?: ReadonlyMap<
    string,
    ReadonlyMap<string, string | number>
  >;
  /** The projected runtime plan (the probe recipe). Null → the cost
   *  section degrades to its author-a-step line. */
  readonly plan: Plan | null;
  readonly description?: string | null;
  /** Brief 92 — a persisted build report exists (the receipt), so the
   *  lede states the workbook provenance. */
  readonly workbookBuilt?: boolean;

  // ── Doors ───────────────────────────────────────────────────────
  /** True when a persisted scored run exists — renders the Book tab. */
  readonly hasBook: boolean;
  readonly onOpenBook?: () => void;
  readonly onOpenInputs?: () => void;

  // ── §1.1.6 (93.2) — Where the plan says no ─────────────────────
  /** The eligibility rules as display rows (the consumer builds them
   *  from the appetite read model via buildGateRows). Omit ⇒ the
   *  section states the honest no-rules line. */
  readonly gates?: readonly ReportGateRow[];
  /** The default outcome's label ("Standard") for the closing line. */
  readonly defaultTierLabel?: string | null;

  // ── §1.1.7 / R5 (93.3) — worked examples, the workbook variant ──
  /** The filing's own test cases, verified at build (Brief 92). The
   *  consumer builds this from the persisted build report via
   *  buildVerifiedExamples; non-null REPLACES the probe-book variant. */
  readonly verifiedExamples?: VerifiedExamples | null;

  // ── Embedded exhibits (consumer-composed, same as probe mode) ──
  readonly rateCardSlot?: ReactNode;
  readonly probeBookSlot?: ReactNode;
  /** Input key → display label for the pinned-risk caption. */
  readonly pinLabels?: ReadonlyMap<string, string>;
  /** Input key → value resolver, so the caption speaks level labels
   *  ("Revenue band <$25K"), never raw ids (Brief 94 U7). */
  readonly pinValueLabels?: ReadonlyMap<string, PinValueResolver>;
  readonly testId?: string;
}

const PIN_CAPTION_CAP = 6;

function fmtMoney(v: number, decimals: 0 | 2): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Per-input resolver: a raw pinned value → its level's label
 *  ("<$25K" for revenue 0, "Alaska" for "ak") — null when no level
 *  matches (the raw value renders). Brief 94 (U7). */
export type PinValueResolver = (value: string | number) => string | null;

/** "Frame · TIV $850,000 · Territory 3" — the reproducibility caption.
 *  Keys resolve through `labels`; values through `valueLabels` (Brief
 *  94 U7 — the caption speaks level labels, never raw ids, matching
 *  the rate card beside it). */
export function buildPinsCaption(
  pins: Record<string, unknown>,
  labels?: ReadonlyMap<string, string>,
  valueLabels?: ReadonlyMap<string, PinValueResolver>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(pins)) {
    if (value == null) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const label = labels?.get(key) ?? key;
    const resolved = valueLabels?.get(key)?.(value) ?? null;
    parts.push(
      `${label} ${
        resolved ??
        (typeof value === "number" ? value.toLocaleString("en-US") : value)
      }`,
    );
  }
  const shown = parts.slice(0, PIN_CAPTION_CAP);
  const more = parts.length - shown.length;
  return more > 0 ? `${shown.join(" · ")} · +${more} more` : shown.join(" · ");
}

export function PlanReport(props: PlanReportProps): JSX.Element {
  const {
    planLabel,
    productLabel,
    stateLabel,
    statusSlot,
    stages,
    dimensions,
    factorTables,
    factorTableCells,
    plan,
    description,
    workbookBuilt,
    hasBook,
    onOpenBook,
    onOpenInputs,
    gates,
    defaultTierLabel,
    verifiedExamples,
    rateCardSlot,
    probeBookSlot,
    pinLabels,
    pinValueLabels,
    testId = "rater-plan-report",
  } = props;

  const facts = useMemo(
    () => computePlanReportFacts(stages, factorTables),
    [stages, factorTables],
  );
  const provenance = buildProvenanceClause({
    workbookBuilt: workbookBuilt ?? false,
  });

  const pins = useMemo(() => {
    try {
      return synthesizeRepresentativeRisk(
        stages,
        dimensions as unknown as Parameters<
          typeof synthesizeRepresentativeRisk
        >[1],
      );
    } catch {
      return {};
    }
  }, [stages, dimensions]);

  // 93.4 — `stages` are the premium-classification authority: a
  // total-less multi-coverage filing declares no total, so its ledger
  // walks EVERY tower and the headline is the dec-page sum. Anchoring
  // on one output headlined the LAST tower ($72 for a $267 risk).
  const walk = useMemo<ReferenceWalk | null>(
    () => (plan ? computeReferenceWalk({ plan, pins, stages }) : null),
    [plan, pins, stages],
  );

  const drivers = useMemo(
    () => computeStructuralDrivers(dimensions, factorTables, factorTableCells),
    [dimensions, factorTables, factorTableCells],
  );
  const topDriver = drivers.find(
    (d) => !d.flat && d.spreadMin !== null && d.spreadMax !== null,
  );

  const pinsCaption = useMemo(
    () => buildPinsCaption(pins, pinLabels, pinValueLabels),
    [pins, pinLabels, pinValueLabels],
  );

  const meta = buildReportMetaLine(facts);
  const gateSentence =
    facts.gateCount > 0
      ? ` ${facts.gateCount} eligibility ${
          facts.gateCount === 1 ? "rule" : "rules"
        } can decline a risk.`
      : "";
  const scope =
    productLabel && stateLabel
      ? `rates ${productLabel} ${
          stateLabel === "All states" ? "across all states" : `in ${stateLabel}`
        }`
      : "is a rating plan";

  return (
    <div className="rater-report" data-testid={testId}>
      <div className="rater-report__head">
        <h1 className="rater-report__title">Plan report</h1>
        <span className="rater-report__spacer" />
        {hasBook && onOpenBook ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<BarChart3 aria-hidden />}
            onClick={onOpenBook}
            data-testid={`${testId}-open-book`}
          >
            Book
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon={<Printer aria-hidden />}
          onClick={() => window.print()}
          data-testid={`${testId}-print`}
        >
          Print
        </Button>
      </div>
      <div className="rater-report__meta">
        {productLabel ? <span>{productLabel}</span> : null}
        {stateLabel ? <span>{stateLabel}</span> : null}
        {statusSlot ? (
          <span className="rater-report__meta-chip">{statusSlot}</span>
        ) : null}
        <span>{meta}</span>
      </div>

      {/* §1.1.2 — the lede: a deterministic template over counts. */}
      <p className="rater-report__lede" data-testid={`${testId}-lede`}>
        <b>{planLabel}</b> {scope}. A policy's premium is built in{" "}
        <b>
          {facts.stepCount} {facts.stepCount === 1 ? "step" : "steps"}
        </b>
        {facts.chainCount > 0 ? (
          <>
            {" "}
            across{" "}
            <b>
              {facts.chainCount} {facts.chainCount === 1 ? "chain" : "chains"}
            </b>
          </>
        ) : null}{" "}
        from{" "}
        <b>
          {facts.inputCount} application{" "}
          {facts.inputCount === 1 ? "input" : "inputs"}
        </b>
        {facts.tableCount > 0 ? (
          <>
            ; {facts.tableCount} factor{" "}
            {facts.tableCount === 1 ? "table carries" : "tables carry"} the
            rates
            {facts.curveCount > 0
              ? ` alongside ${facts.curveCount} ${
                  facts.curveCount === 1 ? "curve" : "curves"
                }`
              : ""}
          </>
        ) : null}
        .{gateSentence}
        {provenance || description ? (
          <span className="rater-report__prov">
            {" "}
            {provenance}
            {provenance && description ? " " : ""}
            {description}
          </span>
        ) : null}
      </p>

      {/* §1.1.3 — what a policy costs: the reference risk, walked. */}
      <section
        className="rater-report__sec"
        aria-label="What a policy costs"
        data-testid={`${testId}-cost`}
      >
        <div className="rater-report__sec-head">
          <h2 className="rater-report__sec-title">What a policy costs</h2>
          <span className="rater-report__sec-src">
            {/* A coverage-sum headline is not a field the filing
                declares — it says so, once, where it applies (P-N4). */}
            {walk?.coverageSum
              ? `the reference risk, through the engine — the sum of its ${
                  walk.rows.filter((r) => r.kind === "subtotal").length
                } coverage premiums (the filing declares no total)`
              : "the reference risk, through the engine"}
          </span>
        </div>
        {walk === null ? (
          <p className="rater-report__none">
            The plan needs a rating step before it can cost a policy — add one
            in Build.
          </p>
        ) : walk.refusal !== null ? (
          <p className="rater-report__refusal" data-testid={`${testId}-refusal`}>
            The reference risk can't be rated: {walk.refusal}
          </p>
        ) : (
          <div className="rater-report__cost">
            <div className="rater-report__big">
              {walk.premium !== null ? (
                fmtMoney(walk.premium, Number.isInteger(walk.premium) ? 0 : 2)
              ) : (
                <span className="rater-report__withheld">withheld</span>
              )}
              {pinsCaption ? (
                <small className="rater-report__pins">{pinsCaption}</small>
              ) : null}
            </div>
            {walk.rows.length > 0 ? (
              <div className="rater-report__walk" data-testid={`${testId}-walk`}>
                {walk.rows.map((row) => (
                  <div
                    key={row.id}
                    className={`rater-report__walk-row is-${row.kind}`}
                  >
                    <span className="rater-report__walk-n">{row.label}</span>
                    <span className="rater-report__walk-f">{row.op}</span>
                    <span className="rater-report__walk-r">
                      {row.running !== null ? fmtMoney(row.running, 2) : "—"}
                    </span>
                  </div>
                ))}
                {walk.premium !== null ? (
                  <div className="rater-report__walk-row is-total">
                    <span className="rater-report__walk-n">Premium</span>
                    <span className="rater-report__walk-f" />
                    <span className="rater-report__walk-r">
                      {fmtMoney(
                        walk.premium,
                        Number.isInteger(walk.premium) ? 0 : 2,
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* §1.1.4 — what moves the price (structural, R10 voice once). */}
      <section
        className="rater-report__sec"
        aria-label="What moves the price"
        data-testid={`${testId}-drivers`}
      >
        <div className="rater-report__sec-head">
          <h2 className="rater-report__sec-title">What moves the price</h2>
          <span className="rater-report__sec-src">
            from the plan's tables — unweighted by any book
          </span>
        </div>
        <StructuralDrivers
          drivers={drivers}
          testId={`${testId}-drivers-list`}
        />
        {topDriver ? (
          <p className="rater-report__drv-sentence">
            <b>
              {topDriver.label} alone swings premium{" "}
              {topDriver.spreadMin!.toFixed(2)}×–
              {topDriver.spreadMax!.toFixed(2)}×
            </b>{" "}
            — the widest lever in the plan.
          </p>
        ) : null}
      </section>

      {/* §1.1.5 — the rate card (the existing exhibit, in its place). */}
      {rateCardSlot ? (
        <section
          className="rater-report__sec"
          aria-label="The rate card"
          data-testid={`${testId}-rate-card`}
        >
          <div className="rater-report__sec-head">
            <h2 className="rater-report__sec-title">The rate card</h2>
            <span className="rater-report__sec-src">
              every other input pinned to the reference risk
            </span>
          </div>
          {rateCardSlot}
        </section>
      ) : null}

      {/* §1.1.6 (93.2) — where the plan says no: the rules, stated. */}
      <section
        className="rater-report__sec"
        aria-label="Where the plan says no"
        data-testid={`${testId}-gates`}
      >
        <div className="rater-report__sec-head">
          <h2 className="rater-report__sec-title">Where the plan says no</h2>
          <span className="rater-report__sec-src">
            eligibility rules, as authored
          </span>
        </div>
        {gates && gates.length > 0 ? (
          <>
            <ul className="rater-report__gates">
              {gates.map((g) => (
                <li key={g.id} className="rater-report__gate">
                  <span className="rater-report__gate-rule">when {g.text}</span>
                  <span className="rater-report__gate-out">
                    <TierVerdictChip tier={g.tier} />
                  </span>
                </li>
              ))}
            </ul>
            {defaultTierLabel ? (
              <p className="rater-report__gates-default">
                Everything else rates <b>{defaultTierLabel}</b>. Rules are
                checked top to bottom — the first match decides.
              </p>
            ) : null}
          </>
        ) : (
          <p className="rater-report__none" data-testid={`${testId}-no-gates`}>
            No eligibility rules — every risk rates. Add rules in Eligibility if
            the program has appetite boundaries.
          </p>
        )}
      </section>

      {/* §1.1.7 / R5 — worked examples. Workbook-built plans surface
          the filing's own verified test cases (Brief 92, 93.3); every
          other plan keeps the probe-book sweep. */}
      {verifiedExamples ? (
        <section
          className="rater-report__sec"
          aria-label="Worked examples"
          data-testid={`${testId}-examples`}
        >
          <div className="rater-report__sec-head">
            <h2 className="rater-report__sec-title">Worked examples</h2>
            <span className="rater-report__sec-src">
              the filing's own test cases, scored at build
            </span>
          </div>
          <p
            className={`rater-report__verdict is-${verifiedExamples.tone}`}
            data-testid={`${testId}-verdict`}
          >
            {verifiedExamples.verdict}
          </p>
          <table className="rater-report__ex" data-testid={`${testId}-ex-table`}>
            <thead>
              <tr>
                <th>Example</th>
                <th>Filing says</th>
                <th>Engine computed</th>
                <th title={VECTOR_DELTA_NOTE}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {verifiedExamples.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{r.expected}</td>
                  <td>{r.actual}</td>
                  <td className={`is-${r.status}`}>{r.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rater-report__ex-cap">
            {verifiedExamples.moreCount > 0
              ? `+${verifiedExamples.moreCount} more — the build report on Overview keeps every check. `
              : "The build report on Overview keeps the cell-addressed detail. "}
            {verifiedExamples.builtAt
              ? `Verified at build, ${verifiedExamples.builtAt.slice(0, 10)}.`
              : null}
          </p>
        </section>
      ) : probeBookSlot ? (
        <section
          className="rater-report__sec"
          aria-label="Worked examples"
          data-testid={`${testId}-examples`}
        >
          <div className="rater-report__sec-head">
            <h2 className="rater-report__sec-title">Worked examples</h2>
            <span className="rater-report__sec-src">
              the plan swept through the engine
            </span>
          </div>
          {probeBookSlot}
        </section>
      ) : null}

      {/* §1.1.8 / R4 — the boundary closes the page, quietly. */}
      <p className="rater-report__boundary" data-testid={`${testId}-boundary`}>
        <Shield aria-hidden />
        {hasBook ? (
          <span>
            This report describes the plan. Your scored book — mix, dislocation,
            comparisons — lives under{" "}
            {onOpenBook ? (
              <button
                type="button"
                className="rater-report__boundary-link"
                onClick={onOpenBook}
              >
                Book
              </button>
            ) : (
              "Book"
            )}
            .
          </span>
        ) : (
          <span>
            Mix, loss ratio, dislocation, and geographic concentration need your
            real book —{" "}
            {onOpenInputs ? (
              <button
                type="button"
                className="rater-report__boundary-link"
                onClick={onOpenInputs}
              >
                connect one in Inputs
              </button>
            ) : (
              "connect one in Inputs"
            )}
            . Everything above comes from the plan itself.
          </span>
        )}
      </p>
    </div>
  );
}
