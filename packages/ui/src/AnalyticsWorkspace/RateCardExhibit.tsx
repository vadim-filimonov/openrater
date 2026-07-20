/**
 * <RateCardExhibit> — Brief 89 §3.2 B1 (89.3): the flagship creation
 * artifact of analytics-before-data. The classic manual page, generated:
 * pick 1–2 axes, every other input pinned to the representative risk,
 * cells scored through the SAME client engine the Inputs preview runs
 * (executePlanBatch — ADR-0045's one-engine law; refusals are real,
 * ADR-0056). Gate-declined cells name themselves; withheld cells never
 * fabricate a number.
 *
 * Plan-truth, not book-truth: the card stays available after a real
 * book connects (R11) — it describes the PLAN.
 *
 * Scoring inside an @openrater/ui component follows the InputsPanelV2
 * precedent (the premium preview); everything else is pure probe-math.
 */

import { useMemo, useState, type JSX } from "react";
import { Download } from "lucide-react";
import { Button } from "@openrater/design-system";
import {
  executePlanBatch,
  resolveEligibilityTier,
  ELIGIBILITY_TIER_LABELS,
  type Plan,
  type RunResult,
} from "@openrater/contracts";
import type { DimensionRow } from "../DimensionsTable";
import { formatTableCitation } from "../Citation/formatTableCitation";
import type {
  FactorTableLike,
  StageLike,
} from "../InputsWorkspace/deriveRequiredInputs";
import { synthesizeRepresentativeRisk } from "../InputsWorkspace/synthesizeRepresentativeRisk";
import { resolvePremiumColumn } from "./analytics-bridge";
import {
  COVERAGE_SUM_COLUMN,
  COVERAGE_SUM_COLUMN_LABEL,
  isTotalLessMultiCoverage,
  resolvePlanPremiumContext,
  sumMoneyFields,
} from "./premium-resolution";
import { deriveRequiredInputs } from "../InputsWorkspace/deriveRequiredInputs";
import {
  buildAxis,
  buildRateCardCsv,
  buildRateCardGrid,
  computeStructuralDrivers,
  dimInputKeys,
  probeAxisCandidates,
  type RateCardCellResult,
} from "./probe-math";
import "./AnalyticsProbe.css";

/** Bounded card: rows × cols stays a readable manual page. */
const ROW_LEVEL_CAP = 20;
const COL_LEVEL_CAP = 10;

export interface RateCardExhibitProps {
  /** The projected runtime plan (stagesToRuntimePlan output). */
  readonly plan: Plan | null;
  readonly stages: readonly StageLike[];
  readonly dimensions: readonly DimensionRow[];
  readonly factorTables: readonly FactorTableLike[];
  readonly factorTableCells?: ReadonlyMap<
    string,
    ReadonlyMap<string, string | number>
  >;
  /** Receives (filename, csv) — the consumer owns the download. */
  readonly onExportCsv?: (filename: string, csv: string) => void;
  readonly testId?: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** First refusal note off the row's trace (plan words, never a stack). */
function refusalNote(result: RunResult): string | null {
  for (const entry of Object.values(result.trace)) {
    const first = entry.issues?.[0];
    if (first && typeof first.message === "string") return first.message;
    if (entry.error) return entry.error.message;
  }
  return null;
}

export function RateCardExhibit(props: RateCardExhibitProps): JSX.Element {
  const {
    plan,
    stages,
    dimensions,
    factorTables,
    factorTableCells,
    onExportCsv,
    testId = "rater-rate-card",
  } = props;

  const candidates = useMemo(
    () => probeAxisCandidates(dimensions),
    [dimensions],
  );
  const inputKeys = useMemo(
    () => dimInputKeys(stages, dimensions, factorTables),
    [stages, dimensions, factorTables],
  );
  // Default axes = the two highest AUTHORED-swing candidates.
  const rankedCandidates = useMemo(() => {
    const drivers = computeStructuralDrivers(
      candidates,
      factorTables,
      factorTableCells,
    );
    const order = new Map(drivers.map((d, i) => [d.id, i] as const));
    return [...candidates].sort(
      (a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99),
    );
  }, [candidates, factorTables, factorTableCells]);

  const [rowSlugPref, setRowSlugPref] = useState<string | null>(null);
  const [colSlugPref, setColSlugPref] = useState<string | null>(null);
  const rowSlug = rowSlugPref ?? rankedCandidates[0]?.slug ?? null;
  const colSlug =
    colSlugPref !== null
      ? colSlugPref === "" // explicit "—"
        ? null
        : colSlugPref
      : (rankedCandidates.find((d) => d.slug !== rowSlug)?.slug ?? null);

  // Pins: the representative risk, minus the axes, plus user edits.
  const repRisk = useMemo(
    () =>
      synthesizeRepresentativeRisk(
        stages,
        // Same cast every consumer uses: DimensionRow carries the
        // slug/levels/shape fields the synthesizer reads.
        dimensions as unknown as Parameters<
          typeof synthesizeRepresentativeRisk
        >[1],
      ),
    [stages, dimensions],
  );
  const [pinEdits, setPinEdits] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [editingPin, setEditingPin] = useState<string | null>(null);
  // Every TRUE input the structure reads becomes a pin seat — the
  // synthesizer covers dim-bound lookups, but an exposure-style input
  // has no authored levels to draw from: it renders as an EMPTY pin
  // the user fills (an unfilled seat is omitted from the row, so the
  // engine's refusal stays real, never a fabricated 0).
  const pinSeats = useMemo(() => {
    const seats = new Set<string>(Object.keys(repRisk));
    try {
      for (const r of deriveRequiredInputs(
        stages,
        dimensions as unknown as Parameters<typeof deriveRequiredInputs>[1],
        { factorTables },
      )) {
        if (r.constantSlot !== true) seats.add(r.id);
      }
    } catch {
      // Substrate hiccups never break the card; rep keys remain.
    }
    return seats;
  }, [repRisk, stages, dimensions, factorTables]);
  const pins = useMemo(() => {
    const merged: Record<string, unknown> = { ...repRisk };
    for (const [k, v] of Object.entries(pinEdits)) {
      const n = Number(v);
      if (v.trim() === "") {
        delete merged[k];
        continue;
      }
      merged[k] = Number.isFinite(n) ? n : v;
    }
    return merged;
  }, [repRisk, pinEdits]);

  const rowDim = candidates.find((d) => d.slug === rowSlug) ?? null;
  const colDim =
    colSlug === null
      ? null
      : (candidates.find((d) => d.slug === colSlug) ?? null);

  const rowAxis = useMemo(
    () =>
      rowDim
        ? buildAxis(rowDim, inputKeys.get(rowDim.slug) ?? rowDim.slug, ROW_LEVEL_CAP)
        : null,
    [rowDim, inputKeys],
  );
  const colAxis = useMemo(
    () =>
      colDim
        ? buildAxis(colDim, inputKeys.get(colDim.slug) ?? colDim.slug, COL_LEVEL_CAP)
        : null,
    [colDim, inputKeys],
  );

  // 93.4 — what the PLAN calls its premium, classified from the
  // authored STAGES. A total-less multi-coverage filing declares no
  // total, so every cell is the dec-page SUM of its towers; reading one
  // output would print the LAST tower as the risk's price.
  const planPremium = useMemo(
    () => (plan ? resolvePlanPremiumContext(plan, stages) : null),
    [plan, stages],
  );
  const coverageSum = planPremium !== null && isTotalLessMultiCoverage(planPremium);
  const premiumField = useMemo(
    () =>
      plan === null
        ? null
        : coverageSum
          ? COVERAGE_SUM_COLUMN
          : resolvePremiumColumn(plan),
    [plan, coverageSum],
  );
  const hasChain = useMemo(
    () => plan?.nodes?.some((n) => n.kind === "chain.mult") ?? false,
    [plan],
  );

  const cells = useMemo<readonly RateCardCellResult[] | null>(() => {
    if (!plan || !hasChain || !premiumField || !rowAxis) return null;
    const grid = buildRateCardGrid(pins, rowAxis, colAxis);
    let results: readonly RunResult[] = [];
    try {
      results = executePlanBatch(
        plan,
        grid.map((g) => g.inputs),
      );
    } catch {
      return null;
    }
    return grid.map((g, i) => {
      const r = results[i];
      if (!r) {
        return {
          rowLevelId: g.rowLevelId,
          colLevelId: g.colLevelId,
          premium: null,
          tier: null,
          note: null,
        };
      }
      // A total-less plan's cell is the sum of its coverage towers —
      // the SAME dec-page semantic /score derives (`views.premium`,
      // basis "coverage_sum"). Law 2 / G8: a refused cell sums nothing
      // (its surviving towers stay in `outputs` for the note, but a sum
      // of partials is the wrong number the refusal withheld).
      const premium =
        coverageSum && planPremium !== null
          ? r.row_status === "error"
            ? null
            : sumMoneyFields(r.outputs, planPremium.moneyFields)
          : ((): number | null => {
              const raw = r.outputs[premiumField];
              return typeof raw === "number" && Number.isFinite(raw)
                ? raw
                : null;
            })();
      const tier = resolveEligibilityTier(r.trace);
      return {
        rowLevelId: g.rowLevelId,
        colLevelId: g.colLevelId,
        premium,
        tier,
        note: premium === null ? refusalNote(r) : null,
      };
    });
  }, [plan, hasChain, premiumField, rowAxis, colAxis, pins, coverageSum, planPremium]);

  const cellByKey = useMemo(() => {
    const m = new Map<string, RateCardCellResult>();
    for (const c of cells ?? []) {
      m.set(`${c.rowLevelId} ${c.colLevelId ?? ""}`, c);
    }
    return m;
  }, [cells]);

  // Pins rail: every seat the card holds constant (axes excluded) —
  // filled seats show their value; unfilled ones show "—" and invite
  // the fill (the exposure case).
  const pinEntries = useMemo(() => {
    const axisKeys = new Set(
      [rowAxis?.inputKey, colAxis?.inputKey].filter(Boolean) as string[],
    );
    return [...pinSeats]
      .filter((k) => !axisKeys.has(k))
      .sort()
      .map((k) => [k, pins[k]] as const);
  }, [pinSeats, pins, rowAxis, colAxis]);

  //  — the row variable's driving table, cited ("cited p. 6 —
  // Rule C.5"); rides every premium cell's tooltip. Declared with the
  // other hooks (before the honest-degrade early returns) so the hook
  // order never changes across renders (rules-of-hooks).
  const rowCitation = useMemo(() => {
    if (!rowDim) return null;
    const table = factorTables.find((ft) =>
      (ft.key_dimensions ?? (ft.key_dimension ? [ft.key_dimension] : []))
        .includes(rowDim.slug),
    );
    return table
      ? formatTableCitation(
          table as {
            readonly source_page?: number | null;
            readonly source_pdf_url?: string | null;
          },
        )
      : null;
  }, [factorTables, rowDim]);

  const handleExport = (): void => {
    if (!onExportCsv || !rowAxis || !cells) return;
    onExportCsv(
      `rate-card-${rowAxis.dimSlug}${colAxis ? `-x-${colAxis.dimSlug}` : ""}.csv`,
      buildRateCardCsv(rowAxis, colAxis, cells),
    );
  };

  // ── Honest degrades ────────────────────────────────────────────
  if (!hasChain || !plan || premiumField === null) {
    return (
      <p className="rater-probe__degrade" data-testid={`${testId}-no-chain`}>
        Author a rating step first — the plan can't rate anything yet.
      </p>
    );
  }
  if (candidates.length === 0 || rowAxis === null) {
    return (
      <p className="rater-probe__degrade" data-testid={`${testId}-no-axes`}>
        The card needs a dimension with levels to rate by — author one in
        Dimensions, or key a factor table from the Rating picker.
      </p>
    );
  }

  const cellContent = (
    rowId: string,
    colId: string | null,
  ): JSX.Element => {
    const c = cellByKey.get(`${rowId} ${colId ?? ""}`);
    if (!c) return <span className="rater-probe__cell-na">—</span>;
    // A declined row still carries an INDICATIVE premium (G11) — the
    // verdict outranks the number here: an over-tight gate must be
    // VISIBLE in the card (Brief 89 B1), not hidden behind dollars.
    if (c.tier === "decline") {
      return (
        <span
          className="rater-probe__cell-refuse"
          {...(c.note ? { title: c.note } : {})}
        >
          ✕ {ELIGIBILITY_TIER_LABELS["decline"] ?? "Declined"}
        </span>
      );
    }
    if (c.premium !== null) {
      //  — the cell answers "where did this number come from":
      // the row variable's driving table, cited from the filing.
      return (
        <span {...(rowCitation ? { title: rowCitation } : {})}>
          {fmtMoney(c.premium)}
        </span>
      );
    }
    return (
      <span
        className="rater-probe__cell-na"
        {...(c.note ? { title: c.note } : {})}
      >
        —
      </span>
    );
  };

  return (
    <div className="rater-probe__card" data-testid={testId}>
      <div className="rater-probe__card-toolbar">
        <label className="rater-probe__axis">
          rows:
          <select
            value={rowSlug ?? ""}
            onChange={(e) => setRowSlugPref(e.target.value)}
            aria-label="Rate card rows axis"
            data-testid={`${testId}-rows-axis`}
          >
            {rankedCandidates.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.display_name || d.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="rater-probe__axis">
          columns:
          <select
            value={colSlug ?? ""}
            onChange={(e) => setColSlugPref(e.target.value)}
            aria-label="Rate card columns axis"
            data-testid={`${testId}-cols-axis`}
          >
            <option value="">—</option>
            {rankedCandidates
              .filter((d) => d.slug !== rowSlug)
              .map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.display_name || d.slug}
                </option>
              ))}
          </select>
        </label>
        {onExportCsv ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Download />}
            onClick={handleExport}
            data-testid={`${testId}-export`}
          >
            Export CSV
          </Button>
        ) : null}
      </div>

      {pinEntries.length > 0 ? (
        <div className="rater-probe__pins" data-testid={`${testId}-pins`}>
          {pinEntries.map(([k, v]) => (
            <span key={k} className="rater-probe__pin">
              {editingPin === k ? (
                <input
                  className="rater-probe__pin-input"
                  defaultValue={String(v ?? "")}
                  autoFocus
                  aria-label={`Pinned value for ${k}`}
                  onBlur={(e) => {
                    setPinEdits((prev) => ({ ...prev, [k]: e.target.value }));
                    setEditingPin(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setPinEdits((prev) => ({
                        ...prev,
                        [k]: (e.target as HTMLInputElement).value,
                      }));
                      setEditingPin(null);
                    } else if (e.key === "Escape") {
                      setEditingPin(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="rater-probe__pin-btn"
                  onClick={() => setEditingPin(k)}
                  title="Edit the pinned value"
                >
                  {k} <b>{String(v ?? "—")}</b>
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rater-probe__tablewrap">
        <table className="rater-probe__table">
          <caption className="rater-probe__sr">
            {coverageSum && planPremium !== null
              ? `Rate card — probe values from the plan; each cell is the sum of the plan's ${planPremium.moneyFields.length} coverage premiums (the filing declares no total)`
              : "Rate card — probe values from the plan"}
          </caption>
          <thead>
            <tr>
              <th scope="col">{rowAxis.label}</th>
              {colAxis ? (
                colAxis.levels.map((c) => (
                  <th key={c.id} scope="col">
                    {c.label}
                  </th>
                ))
              ) : (
                <th scope="col">
                  {coverageSum ? COVERAGE_SUM_COLUMN_LABEL : "Premium"}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rowAxis.levels.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                {colAxis ? (
                  colAxis.levels.map((c) => (
                    <td key={c.id}>{cellContent(r.id, c.id)}</td>
                  ))
                ) : (
                  <td>{cellContent(r.id, null)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rowAxis.truncated > 0 || (colAxis?.truncated ?? 0) > 0) && (
        <p className="rater-probe__truncated" role="status">
          {rowAxis.truncated > 0
            ? `${rowAxis.truncated} more ${rowAxis.label} level${rowAxis.truncated === 1 ? "" : "s"} not shown. `
            : ""}
          {(colAxis?.truncated ?? 0) > 0
            ? `${colAxis!.truncated} more ${colAxis!.label} level${colAxis!.truncated === 1 ? "" : "s"} not shown.`
            : ""}
        </p>
      )}
      <p className="rater-probe__cardfoot">
        Every other input pinned above. Cells scored by the engine —
        refusals are real.
      </p>
    </div>
  );
}
