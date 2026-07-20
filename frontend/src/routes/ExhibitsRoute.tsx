/**
 * /exhibits — the one adaptive exhibit (current Exhibits design).
 *
 * A rating plan, drawn: a template lede from counted facts, then the
 * wall — every factor table as one tile, sorted by how much it can
 * move price (the sort order IS the tornado). Read-only; every tile
 * doors into the owning Rate Lab workspace. No risks required.
 *
 * Modes land by phase. P1 (portrait): one plan. P2 (this file's
 * second mood): `?b=` adds a comparison side — another plan, or this
 * plan at a frozen version (`plan@snapshot`). The wall becomes the
 * diff: changed tables render with the B side overlaid through the
 * charts' filed-ghost affordance (restyled violet), tables only one
 * side has flank it, unchanged tables collapse to one quiet line,
 * and a geo pairing gets the shared-member territory verdict. The
 * book (P3) arrives next, never as a disabled stub.
 *
 * Surfaces handled: loading · error · empty (no plans) · portrait ·
 * comparison.
 */

import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { Button, Menu } from "@openrater/design-system";
import {
  useBuildReport,
  useDimensionsList,
  useFactorTablesList,
  usePlanDetail,
  usePlansList,
  useSnapshotsList,
} from "@openrater/hooks";
import {
  getInputMapping,
  getPolicyTail,
  getSnapshot,
  RaterApiError,
  type PlanDimension,
  type PlanFactorTable,
  type PlanSummary,
  type StageSummary,
} from "@openrater/api-client";
import { derivePlanStatus } from "@openrater/contracts";
import {
  DislocationExhibit,
  PlanStatusChip,
  policyBookDislocation,
} from "@openrater/ui";
import {
  rateBookSide,
  type RerateSnapshotBody,
  type SideRun,
} from "../integrations/runBookRerate";
import {
  drawnValuesFor,
  exhibitTiles,
  formatSpan,
  ledeFacts,
  orderedLevelValues,
  resolveKeyDimension,
  tableSpan,
  type ExhibitTile,
} from "./exhibits/anatomy";
import { Stage } from "./exhibits/Stage";
import {
  Overview,
  type LedgerGroup,
  type LedgerRow,
  type LedgerStatus,
} from "./exhibits/Overview";
import {
  cellDelta,
  compareFacts,
  formatSideRef,
  pairTables,
  parseSideRef,
  parseSnapshotSubstrate,
  territoryVerdict,
  type SideRef,
} from "./exhibits/compare";
import {
  dimFieldBindings,
  fmtMoney,
  impactStats,
  moverDriver,
  parseBook,
  portraitStats,
  toSubmissions,
  type DriverPair,
  type ParsedBook,
} from "./exhibits/book";
import { parseGridKey } from "./exhibits/gridKey";
import { underwritingLedger } from "./exhibits/underwriting";
import {
  downloadCsv,
  tileCsv,
  tileRows,
  wallCsv,
} from "./exhibits/export";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import "./ExhibitsRoute.css";

/** +8.93 → "+8.9%" — verdict altitude keeps one decimal. */
function fmtSwing(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** A 2-D table as a compact mono grid. Portrait: cells tint azure by
 *  value (one hue, intensity = the factor's place in the span).
 *  Compare: the grid becomes the DELTA — unchanged cells go quiet,
 *  changed cells tint violet by the size of their move and print the
 *  signed % (from→to rides the tooltip and the CSV), so a big grid
 *  reads at a glance instead of drowning in from→to pairs. */
function GridTile({
  tile,
  bCells,
}: {
  readonly tile: ExhibitTile;
  readonly bCells: Readonly<Record<string, number>> | null;
}): JSX.Element {
  const parsed = useMemo(() => {
    const rows: string[] = [];
    const cols: string[] = [];
    const byCell = new Map<string, number>();
    for (const [key, value] of Object.entries(tile.table.cells)) {
      const pair = parseGridKey(key);
      if (pair === null) continue;
      const [r, c] = pair;
      if (!rows.includes(r)) rows.push(r);
      if (!cols.includes(c)) cols.push(c);
      byCell.set(`${r}::${c}`, value);
    }
    const values = [...byCell.values()];
    const lo = values.length > 0 ? Math.min(...values) : 0;
    const hi = values.length > 0 ? Math.max(...values) : 0;
    return { rows, cols, byCell, lo, hi };
  }, [tile.table.cells]);

  // Compare: per-cell relative moves, scaled to the grid's own worst.
  const deltas = useMemo(() => {
    if (bCells === null) return null;
    const byCell = new Map<string, { readonly b: number; readonly rel: number }>();
    let worst = 0;
    for (const [key, v] of parsed.byCell) {
      const [r, c] = key.split("::") as [string, string];
      const b = bCells[`${r}::${c}`] ?? bCells[`${r}|${c}`] ?? bCells[key];
      if (b === undefined || Math.abs(b - v) <= 1e-9) continue;
      const rel = v !== 0 ? Math.abs(b / v - 1) : Math.abs(b - v);
      byCell.set(key, { b, rel });
      if (rel > worst) worst = rel;
    }
    return { byCell, worst };
  }, [parsed, bCells]);

  if (parsed.rows.length === 0) {
    return (
      <p className="rater-exh__tile-fallback">
        {Object.keys(tile.table.cells).length} cells — open the table for the
        full grid.
      </p>
    );
  }
  return (
    <div
      className="rater-exh__grid"
      style={{ gridTemplateColumns: `minmax(48px, auto) repeat(${parsed.cols.length}, 1fr)` }}
      role="table"
      aria-label={`${tile.table.display_name} cells`}
    >
      <span aria-hidden="true" />
      {parsed.cols.map((c) => (
        <span key={c} className="rater-exh__grid-head">
          {c}
        </span>
      ))}
      {parsed.rows.map((r) => (
        <Fragment key={r}>
          <span className="rater-exh__grid-head">{r}</span>
          {parsed.cols.map((c) => {
            const key = `${r}::${c}`;
            const v = parsed.byCell.get(key);
            if (v === undefined) {
              return (
                <span key={`${r}-${c}`} className="rater-exh__grid-cell">
                  —
                </span>
              );
            }
            if (deltas !== null) {
              const delta = deltas.byCell.get(key);
              if (delta === undefined) {
                return (
                  <span
                    key={`${r}-${c}`}
                    className="rater-exh__grid-cell rater-exh__grid-cell--quiet"
                  >
                    {v.toFixed(2)}
                  </span>
                );
              }
              const tint = Math.round(
                12 + (deltas.worst > 0 ? (delta.rel / deltas.worst) * 26 : 0),
              );
              const pct = v !== 0 ? ((delta.b / v - 1) * 100).toFixed(1) : null;
              return (
                <span
                  key={`${r}-${c}`}
                  className="rater-exh__grid-cell rater-exh__grid-cell--chg"
                  style={{
                    background: `color-mix(in oklab, var(--rater-cat-transform) ${tint}%, var(--rater-surface-2))`,
                  }}
                  title={`${v.toFixed(3)} → ${delta.b.toFixed(3)}`}
                >
                  {pct === null
                    ? `${v.toFixed(2)}→${delta.b.toFixed(2)}`
                    : `${delta.b >= v ? "+" : ""}${pct}%`}
                </span>
              );
            }
            // One-hue heat: the cell's place in the table's own span
            // sets the azure intensity — shape without a second color.
            const t =
              parsed.hi - parsed.lo < 1e-9
                ? 0
                : (v - parsed.lo) / (parsed.hi - parsed.lo);
            const tint = Math.round(6 + t * 30);
            return (
              <span
                key={`${r}-${c}`}
                className="rater-exh__grid-cell"
                style={{
                  background: `color-mix(in oklab, var(--rater-cat-input) ${tint}%, var(--rater-surface-2))`,
                }}
              >
                {v.toFixed(2)}
              </span>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

/** The rail's grouping — structural, never invented: geography, then
 *  the drawing kind. Plain names an actuary recognizes. */
function railGroupOf(tile: ExhibitTile): string {
  if (
    tile.dim !== null &&
    (tile.dim.dimension_type === "geographic" || tile.dim.shape === "geographic")
  )
    return "Territory";
  if (tile.kind === "curve") return "Curves";
  if (tile.kind === "strip") return "Classes";
  return "Factors";
}
const RAIL_ORDER = ["Classes", "Factors", "Curves", "Territory"] as const;

/** The comparison's opening selection — the whole diff, not one table. */
const OVERVIEW_ID = "overview";

/** 404 → null: a plan without a mapping/tail is normal, not an error. */
async function fetchOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RaterApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * A body-SHAPED record for a LIVE side — the same keys a frozen
 * snapshot's body carries ({stages, dimensions, factor_tables,
 * input_mapping, policy_tail}), composed from the live endpoints, so
 * the book rates every side through ONE projection (`rateBookSide`).
 * Null until the pieces load. Fetches only once a book is present.
 */
function useLiveBody(
  planId: string | undefined,
  dims: readonly PlanDimension[],
  tables: readonly PlanFactorTable[],
  enabled: boolean,
): RerateSnapshotBody | null {
  const on = enabled && planId !== undefined;
  const detailQuery = usePlanDetail(on ? planId : undefined);
  const mappingQuery = useQuery({
    queryKey: ["exhibits", "mapping", planId],
    enabled: on,
    queryFn: () => fetchOrNull(() => getInputMapping(planId ?? "")),
  });
  const tailQuery = useQuery({
    queryKey: ["exhibits", "tail", planId],
    enabled: on,
    queryFn: () => fetchOrNull(() => getPolicyTail(planId ?? "")),
  });
  return useMemo(() => {
    if (!on || detailQuery.data === undefined) return null;
    if (mappingQuery.data === undefined || tailQuery.data === undefined)
      return null;
    return {
      stages: detailQuery.data.stages,
      dimensions: dims,
      factor_tables: tables,
      input_mapping: mappingQuery.data,
      policy_tail: tailQuery.data,
    } as RerateSnapshotBody;
  }, [on, detailQuery.data, mappingQuery.data, tailQuery.data, dims, tables]);
}

/** One side's substrate: the live plan, or a frozen snapshot's body
 *  parsed through the same api-client schemas the live endpoints use.
 *  `bookLoaded` additionally composes the side's rateable body. */
function useSideSubstrate(ref: SideRef | null, bookLoaded: boolean) {
  const livePlanId =
    ref !== null && ref.snapshotId === null ? ref.planId : undefined;
  const dimsQuery = useDimensionsList(livePlanId);
  const tablesQuery = useFactorTablesList(livePlanId);
  // The UNDERWRITING ledger reads stage rows; a live side
  // fetches the plan detail (cached), a snapshot's body carries them.
  const liveDetailQuery = usePlanDetail(livePlanId);
  const snapshotQuery = useQuery({
    queryKey: ["exhibits", "snapshot", ref?.planId, ref?.snapshotId],
    enabled: ref !== null && ref.snapshotId !== null,
    queryFn: async () => {
      const snapshot = await getSnapshot(
        ref?.planId ?? "",
        ref?.snapshotId ?? "",
      );
      return {
        substrate: parseSnapshotSubstrate(snapshot.body),
        label: snapshot.display_name,
        body: snapshot.body as RerateSnapshotBody,
      };
    },
    staleTime: Infinity, // frozen versions are immutable
  });
  const liveDims = dimsQuery.data?.dimensions ?? [];
  const liveTables = tablesQuery.data?.factor_tables ?? [];
  const liveBody = useLiveBody(
    livePlanId,
    liveDims,
    liveTables,
    bookLoaded && livePlanId !== undefined,
  );

  if (ref === null) {
    return {
      dims: [],
      tables: [],
      stages: [],
      loading: false,
      snapshotLabel: null,
      body: null,
    } as const;
  }
  if (ref.snapshotId !== null) {
    return {
      dims: snapshotQuery.data?.substrate.dims ?? [],
      tables: snapshotQuery.data?.substrate.tables ?? [],
      stages: snapshotQuery.data?.substrate.stages ?? [],
      loading: snapshotQuery.isLoading,
      snapshotLabel: snapshotQuery.data?.label ?? ref.snapshotId,
      body: snapshotQuery.data?.body ?? null,
    } as const;
  }
  return {
    dims: liveDims,
    tables: liveTables,
    stages: liveDetailQuery.data?.stages ?? [],
    loading: dimsQuery.isLoading || tablesQuery.isLoading,
    snapshotLabel: null,
    body: liveBody,
  } as const;
}

/** A side run's failure, phrased for the band. */
function sideFailure(run: SideRun, label: string): string {
  if (run.ok) return "";
  if (run.failure === "no_chain")
    return `${label} has no runnable rating chain yet.`;
  return `${label} prices as a coverage sum (${run.coverageCount} money outputs) with a policy tail — the batch API handles that shape.`;
}

export function ExhibitsRoute(): JSX.Element {
  useDocumentTitle("Exhibits");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const plansQuery = usePlansList({ status: "all" });
  const plans = plansQuery.data ?? [];

  // ?a= carries the exhibited plan; default to the first listed plan so
  // the seeded install lands on Meridian with zero clicks. ?b= arms the
  // comparison — a plan id, or plan@snapshot for a frozen version.
  const requested = params.get("a");
  const plan: PlanSummary | undefined =
    plans.find((p) => p.rating_plan_id === requested) ?? plans[0];
  const bRef = parseSideRef(params.get("b"));

  const setParam = (key: "a" | "b" | "t", value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: false });
  };

  // ── Empty / loading / error states ─────────────────────────────────
  if (plansQuery.isLoading) {
    return (
      <div className="rater-exh">
        <p className="rater-exh__quiet">Loading plans…</p>
      </div>
    );
  }
  if (plansQuery.isError) {
    return (
      <div className="rater-exh">
        <p className="rater-exh__quiet">
          Couldn’t reach the server — is the API running? (
          {(plansQuery.error as Error).message})
        </p>
      </div>
    );
  }
  if (plan === undefined) {
    return (
      <div className="rater-exh">
        <div className="rater-exh__empty">
          <h1 className="rater-exh__empty-title">
            Exhibits draws what your plans mean.
          </h1>
          <p className="rater-exh__empty-sub">
            Build one in Rate Lab — or ask Claude — and it appears here.
          </p>
          <Button variant="primary" onClick={() => navigate("/rate-lab/new")}>
            New plan
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PlanExhibit
      plan={plan}
      plans={plans}
      bRef={bRef}
      selectedTableId={params.get("t")}
      onSelectTable={(id) => setParam("t", id)}
      onSelectPlan={(id) => setParam("a", id)}
      onSelectB={(ref) => setParam("b", ref === null ? null : formatSideRef(ref))}
      onSwap={
        bRef !== null && bRef.snapshotId === null
          ? () => {
              const next = new URLSearchParams(params);
              next.set("a", bRef.planId);
              next.set("b", plan.rating_plan_id);
              setParams(next, { replace: false });
            }
          : null // a frozen B can't take the A seat (A is always a live plan)
      }
    />
  );
}

/** The exhibit for one resolved plan — substrate hooks live here so
 *  they never fire with an undefined plan id. */
function PlanExhibit({
  plan,
  plans,
  bRef,
  selectedTableId,
  onSelectTable,
  onSelectPlan,
  onSelectB,
  onSwap,
}: {
  readonly plan: PlanSummary;
  readonly plans: readonly PlanSummary[];
  readonly bRef: SideRef | null;
  readonly selectedTableId: string | null;
  readonly onSelectTable: (id: string) => void;
  readonly onSelectPlan: (id: string) => void;
  readonly onSelectB: (ref: SideRef | null) => void;
  readonly onSwap: (() => void) | null;
}): JSX.Element {
  const planId = plan.rating_plan_id;
  const dimsQuery = useDimensionsList(planId);
  const tablesQuery = useFactorTablesList(planId);
  const reportQuery = useBuildReport(planId);
  const snapshotsQuery = useSnapshotsList(planId);

  // ── The book (P3) — a CSV of risks, alive only inside this page ──
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onBookFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ""; // re-selecting the same file re-fires
    if (file === undefined) return;
    void file.text().then((text) => {
      const parsed = parseBook(file.name, text);
      if (parsed.ok) {
        setBook(parsed.book);
        setBookError(null);
      } else {
        setBook(null);
        setBookError(parsed.error);
      }
    });
  };

  const b = useSideSubstrate(bRef, book !== null);
  const bPlan = plans.find((p) => p.rating_plan_id === bRef?.planId);
  // Pair underwriting rows across the two sides: gate rules,
  // modifiers, endorsements, and loadings.
  const aDetailQuery = usePlanDetail(bRef !== null ? planId : undefined);
  const uw = useMemo(
    () =>
      bRef === null || b.loading
        ? null
        : underwritingLedger(aDetailQuery.data?.stages ?? [], b.stages),
    [bRef, b.loading, b.stages, aDetailQuery.data],
  );

  const dims = useMemo(
    () => dimsQuery.data?.dimensions ?? [],
    [dimsQuery.data],
  );
  const tables = useMemo(
    () => tablesQuery.data?.factor_tables ?? [],
    [tablesQuery.data],
  );
  const tiles = useMemo(() => exhibitTiles(dims, tables), [dims, tables]);
  const facts = useMemo(() => ledeFacts(dims, tiles), [dims, tiles]);
  const aBody = useLiveBody(planId, dims, tables, book !== null);

  // ── The book, rated — one projection per side, joined on row key ──
  const bookRun = useMemo(() => {
    if (book === null || aBody === null) return null;
    // Inputs project through the plan's declared dictionary + dtypes —
    // the same seam the Run path and the Meridian oracle test use.
    const submissions = toSubmissions(
      book,
      (aBody.stages ?? []) as readonly StageSummary[],
    );
    const aRun = rateBookSide(aBody, submissions, undefined, undefined);
    if (!aRun.ok) return { failed: sideFailure(aRun, "This plan") };
    const portrait = portraitStats(aRun.results, aRun.premiumField);
    if (bRef === null) return { portrait };
    if (b.body === null) return null; // B still loading
    const bRun = rateBookSide(b.body, submissions, undefined, undefined);
    if (!bRun.ok) return { failed: sideFailure(bRun, "The B side") };
    // Drivers: the changed 1-D pairings, resolved per row with the
    // engine's own level resolvers (moverDriver).
    const driverPairs: DriverPair[] = [];
    for (const pair of pairTables(tables, b.tables).pairs) {
      if (cellDelta(pair.a.cells, pair.b.cells).changed === 0) continue;
      const dim = resolveKeyDimension(pair.a, dims);
      if (dim !== null) driverPairs.push({ a: pair.a, b: pair.b, dim });
    }
    const rowByKey = new Map(
      submissions.map((s, i) => [s.submission_id, book.rows[i]] as const),
    );
    const bindings = dimFieldBindings(
      (aBody.stages ?? []) as readonly StageSummary[],
    );
    const driverFor = (key: string): string | null => {
      const row = rowByKey.get(key);
      return row === undefined ? null : moverDriver(row, driverPairs, bindings);
    };
    return {
      portrait,
      impact: impactStats(
        aRun.results,
        bRun.results,
        aRun.premiumField,
        bRun.premiumField,
        driverFor,
      ),
      dislocation: policyBookDislocation(aRun.results, bRun.results, {
        baselinePremiumField: aRun.premiumField,
        candidatePremiumField: bRun.premiumField,
      }).dislocation,
    };
  }, [book, aBody, bRef, b.body, b.tables, tables, dims]);

  // ── The comparison model (null in the portrait) ────────────────────
  const comparison = useMemo(() => {
    if (bRef === null || b.loading || b.tables.length === 0) return null;
    const paired = pairTables(tables, b.tables);
    const bBySlug = new Map(
      b.tables.map((t) => [t.slug || t.table_id, t] as const),
    );
    const changedSlugs = new Set<string>();
    const unchangedNames: string[] = [];
    for (const pair of paired.pairs) {
      if (cellDelta(pair.a.cells, pair.b.cells).changed > 0)
        changedSlugs.add(pair.a.slug || pair.a.table_id);
      else unchangedNames.push(pair.a.display_name);
    }
    const facts2 = compareFacts(dims, tables, b.dims, b.tables);
    // Tables only in B, drawn from the B substrate through the same
    // anatomy (they get their own rail entries, marked "new").
    const onlyBTiles = exhibitTiles(b.dims, paired.onlyB);
    return {
      paired,
      changedSlugs,
      unchangedNames,
      facts: facts2,
      onlyBTiles,
      bBySlug,
    };
  }, [bRef, b.loading, b.tables, b.dims, tables, dims]);

  const report = reportQuery.data ?? null;
  const counts = report?.manifest.counts ?? null;
  const loadingSubstrate = dimsQuery.isLoading || tablesQuery.isLoading;
  const snapshots = snapshotsQuery.data?.snapshots ?? [];
  const otherPlans = plans.filter((p) => p.rating_plan_id !== planId);
  const bLabel =
    bRef === null
      ? null
      : bRef.planId === planId
        ? `this plan · ${b.snapshotLabel ?? "version"}`
        : `${bPlan?.display_name ?? bRef.planId}${b.snapshotLabel !== null ? ` · ${b.snapshotLabel}` : ""}`;

  /** Compare dressing for one A-side tile. */
  const compareFor = (tile: ExhibitTile) => {
    if (comparison === null) return null;
    const slug = tile.table.slug || tile.table.table_id;
    const bTable = comparison.bBySlug.get(slug);
    if (bTable === undefined) {
      return {
        bValues: null,
        bCells: null,
        bTable: null,
        bMax: null,
        note: "only in A",
        onlyInB: false,
      };
    }
    const bDim = b.dims.find((d) => d.slug === tile.dim?.slug) ?? tile.dim;
    const bValues =
      bDim !== null
        ? new Map(
            orderedLevelValues(bTable, bDim).map((v) => [v.id, v.value] as const),
          )
        : null;
    const bVals = Object.values(bTable.cells).filter(Number.isFinite);
    const removed = comparison.facts.removedLevels.find(
      (r) => r.dim === (tile.dim?.display_name ?? ""),
    );
    return {
      bValues,
      bCells: bTable.cells,
      bTable,
      bMax: bVals.length > 0 ? Math.max(...bVals) : null,
      note:
        removed !== undefined
          ? `${removed.ids.slice(0, 3).join(", ")}${removed.ids.length > 3 ? "…" : ""} leaves the filed table`
          : null,
      onlyInB: false,
    };
  };

  // ── The rail model: every A tile + the B-only tiles, grouped ──
  const railEntries = useMemo(() => {
    const entries = tiles.map((tile) => {
      const slug = tile.table.slug || tile.table.table_id;
      return {
        id: tile.table.table_id,
        tile,
        onlyInB: false,
        // Changed cells OR gone from B entirely — retirement is a diff.
        changed:
          comparison !== null &&
          (comparison.changedSlugs.has(slug) ||
            !comparison.bBySlug.has(slug)),
      };
    });
    for (const tile of comparison?.onlyBTiles ?? []) {
      entries.push({
        id: `b-${tile.table.table_id}`,
        tile,
        onlyInB: true,
        changed: true,
      });
    }
    return entries;
  }, [tiles, comparison]);
  const railGroups = useMemo(() => {
    const groups = new Map<string, typeof railEntries>();
    for (const entry of railEntries) {
      const group = railGroupOf(entry.tile);
      groups.set(group, [...(groups.get(group) ?? []), entry]);
    }
    return RAIL_ORDER.filter((g) => groups.has(g)).map((g) => ({
      name: g,
      entries: groups.get(g) ?? [],
    }));
  }, [railEntries]);
  // The rail's common lever scale — every mini bar shares one domain,
  // so the rail reads as the tornado.
  const railScale = useMemo(() => {
    const spans = railEntries
      .map((e) => e.tile.span)
      .filter((s): s is NonNullable<typeof s> => s !== null);
    if (spans.length === 0) return { lo: 0, hi: 1 };
    return {
      lo: Math.min(...spans.map((s) => s.min)),
      hi: Math.max(...spans.map((s) => s.max)),
    };
  }, [railEntries]);
  // The ×1.00 tick, one vertical rhythm down every track — rendered
  // only when the common scale actually straddles par.
  const railTick =
    railScale.lo < 1 && railScale.hi > 1
      ? ((1 - railScale.lo) / (railScale.hi - railScale.lo)) * 100
      : null;

  // Selection: ?t= wins; otherwise the comparison opens on the whole
  // diff (the Overview) and the portrait opens on the widest lever.
  const entryFor = railEntries.find((e) => e.id === selectedTableId);
  const showOverview = comparison !== null && entryFor === undefined;
  const selected =
    entryFor ?? (comparison === null ? railEntries[0] : undefined);
  const selectedCompare =
    selected === undefined || selected.onlyInB
      ? null
      : compareFor(selected.tile);
  // The selected geo pairing's shared-member verdict, as one line.
  const selectedVerdict = useMemo(() => {
    if (
      selected === undefined ||
      selected.onlyInB ||
      comparison === null ||
      selected.tile.dim === null ||
      selected.tile.dim.dimension_type !== "geographic"
    )
      return null;
    const slug = selected.tile.table.slug || selected.tile.table.table_id;
    const bTable = comparison.bBySlug.get(slug);
    const bDim = b.dims.find((d) => d.slug === selected.tile.dim?.slug);
    if (bTable === undefined || bDim === undefined) return null;
    const v = territoryVerdict(selected.tile.dim, selected.tile.table, bDim, bTable);
    if (v === null) return null;
    const largest =
      v.largest === null
        ? ""
        : ` · largest swing ${fmtSwing(v.largest.pct)} (${v.largest.member}, ${v.largest.from.toFixed(2)}→${v.largest.to.toFixed(2)})`;
    return `${v.shared} shared members: ${v.identical} rate identically · ${v.cheaperInB} cheaper in B · ${v.costlierInB} costlier${largest}`;
  }, [selected, comparison, b.dims]);

  // The strip speaks plan language, never slugs: the biggest move's
  // raw cell key resolves to its level label ("row × col" for grids).
  const biggestLabel = useMemo(() => {
    const big = comparison?.facts.biggest ?? null;
    if (big === null) return null;
    const entry = railEntries.find(
      (e) => e.tile.table.display_name === big.table,
    );
    const level = entry?.tile.values.find((v) => v.id === big.key);
    if (level !== undefined) return level.label;
    const pair = parseGridKey(big.key);
    return pair === null ? big.key : `${pair[0]} × ${pair[1]}`;
  }, [comparison, railEntries]);

  // ── The Overview's ledger: every variable across both plans, one
  // row each — counts and the biggest move, never enumerations. ──
  const ledger = useMemo((): readonly LedgerGroup[] => {
    if (comparison === null) return [];
    return railGroups.map((group) => ({
      name: group.name,
      rows: group.entries.map((entry): LedgerRow => {
        const slug = entry.tile.table.slug || entry.tile.table.table_id;
        const bTable = entry.onlyInB
          ? undefined
          : comparison.bBySlug.get(slug);
        const status: LedgerStatus = entry.onlyInB
          ? "new"
          : bTable === undefined
            ? "retired"
            : comparison.changedSlugs.has(slug)
              ? "changed"
              : "same";
        const delta =
          status === "changed" && bTable !== undefined
            ? cellDelta(entry.tile.table.cells, bTable.cells)
            : null;
        // The biggest move, in plan language: level label for 1-D
        // keys, "row × col" for grid keys, the raw key as last resort.
        const labelFor = (key: string): string => {
          const level = entry.tile.values.find((v) => v.id === key);
          if (level !== undefined) return level.label;
          const pair = parseGridKey(key);
          return pair === null ? key : `${pair[0]} × ${pair[1]}`;
        };
        const spanA = entry.tile.span;
        const spanB =
          status === "changed" && bTable !== undefined
            ? tableSpan(bTable.cells)
            : null;
        const spanMoved =
          spanA !== null &&
          spanB !== null &&
          (Math.abs(spanA.min - spanB.min) > 1e-9 ||
            Math.abs(spanA.max - spanB.max) > 1e-9);
        return {
          id: entry.id,
          name: entry.tile.table.display_name,
          status,
          moved:
            delta === null
              ? null
              : { changed: delta.changed, total: delta.total },
          biggest:
            delta !== null && delta.largest !== null
              ? {
                  label: labelFor(delta.largest.key),
                  from: delta.largest.from,
                  to: delta.largest.to,
                }
              : null,
          spanPair:
            spanMoved && spanA !== null && spanB !== null
              ? `${formatSpan(spanA)} → ${formatSpan(spanB)}`
              : null,
        };
      }),
    }));
  }, [comparison, railGroups]);

  return (
    <div className="rater-exh">
      {/* ── The header — the only chrome on the page ── */}
      <div className="rater-exh__bar">
        <Menu>
          <Menu.Trigger>
            <button type="button" className="rater-exh__chip" title="Choose a plan">
              <span className="rater-exh__chip-dot" aria-hidden="true" />
              <b>{plan.display_name}</b>
              <PlanStatusChip status={derivePlanStatus(plan)} />
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </Menu.Trigger>
          <Menu.Items aria-label="Choose a plan">
            {plans.map((p) => (
              <Menu.Item
                key={p.rating_plan_id}
                onSelect={() => onSelectPlan(p.rating_plan_id)}
              >
                {p.display_name}
              </Menu.Item>
            ))}
          </Menu.Items>
        </Menu>

        {bRef === null ? (
          otherPlans.length > 0 || snapshots.length > 0 ? (
            <Menu>
              <Menu.Trigger>
                <button
                  type="button"
                  className="rater-exh__ghost"
                  title="Compare with another plan or a frozen version"
                >
                  ＋ Compare…
                </button>
              </Menu.Trigger>
              <Menu.Items aria-label="Compare with">
                {snapshots.map((s) => (
                  <Menu.Item
                    key={s.snapshot_id}
                    onSelect={() =>
                      onSelectB({ planId, snapshotId: s.snapshot_id })
                    }
                  >
                    This plan · {s.display_name}
                  </Menu.Item>
                ))}
                {otherPlans.map((p) => (
                  <Menu.Item
                    key={p.rating_plan_id}
                    onSelect={() =>
                      onSelectB({ planId: p.rating_plan_id, snapshotId: null })
                    }
                  >
                    {p.display_name}
                  </Menu.Item>
                ))}
              </Menu.Items>
            </Menu>
          ) : null
        ) : (
          <>
            {onSwap !== null ? (
              <button
                type="button"
                className="rater-exh__swap"
                title="Swap sides"
                aria-label="Swap sides"
                onClick={onSwap}
              >
                ⇄
              </button>
            ) : null}
            <span className="rater-exh__chip rater-exh__chip--b">
              <span className="rater-exh__chip-dot rater-exh__chip-dot--b" aria-hidden="true" />
              <b>{bLabel}</b>
              <button
                type="button"
                className="rater-exh__chip-x"
                aria-label="Stop comparing"
                onClick={() => onSelectB(null)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          </>
        )}

        {/* ── The book — the one place risks enter (P3) ── */}
        <span className="rater-exh__bar-right">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="rater-exh__file"
            aria-label="Bring your book (CSV)"
            onChange={onBookFile}
          />
          {book === null ? (
            <button
              type="button"
              className="rater-exh__ghost"
              onClick={() => fileInputRef.current?.click()}
              title="One row per risk, columns named after the plan's inputs"
            >
              Bring your book (CSV)
            </button>
          ) : (
            <span className="rater-exh__chip rater-exh__chip--book">
              <span
                className="rater-exh__chip-dot rater-exh__chip-dot--book"
                aria-hidden="true"
              />
              <b>{book.filename}</b>
              <span className="rater-exh__chip-count">
                · {book.rows.length} risk{book.rows.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="rater-exh__chip-x"
                aria-label="Remove the book"
                onClick={() => {
                  setBook(null);
                  setBookError(null);
                }}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          )}
        </span>
      </div>
      {bookError !== null ? (
        <p className="rater-exh__book-error">{bookError}</p>
      ) : null}

      {/* ── The strip — the plan's counted facts, one quiet line ── */}
      <p className="rater-exh__strip">
        {comparison === null ? (
          <>
            {/*  — this strip counts DIMENSIONS; "inputs" is the
                dictionary's word (Overview's "9 inputs"), not this one. */}
            <span className="rater-exh__num">{facts.answers}</span> variables ·{" "}
            <span className="rater-exh__num">{tables.length}</span> tables
            {facts.territory !== null ? (
              <>
                {" · "}
                <span className="rater-exh__num">{facts.territory.count}</span>{" "}
                territories
              </>
            ) : null}
            {counts !== null ? (
              <>
                {" · "}
                <span className="rater-exh__num">
                  {counts.factor_cells_cited}/{counts.factor_cells}
                </span>{" "}
                factors cited
                {report !== null && report.vectors.status === "ran" ? (
                  <>
                    {" · "}
                    <span className="rater-exh__num">
                      {report.vectors.matched}/{report.vectors.checks.length}
                    </span>{" "}
                    filed checks reproduce
                  </>
                ) : null}
                {" · "}
                <span className="rater-exh__num">
                  {report?.gaps.length ?? 0}
                </span>{" "}
                assumptions
              </>
            ) : (
              <> · built by hand — no build report</>
            )}
          </>
        ) : (
          <>
            Against <span className="rater-exh__b">{bLabel}</span>:{" "}
            <span className="rater-exh__num">
              {comparison.facts.changedTables} of{" "}
              {comparison.facts.sharedTables}
            </span>{" "}
            shared tables change
            {comparison.facts.biggest !== null ? (
              <>
                {" · "}biggest move{" "}
                <span className="rater-exh__num">
                  {biggestLabel ?? comparison.facts.biggest.key}
                </span>{" "}
                <span className="rater-exh__num">
                  {comparison.facts.biggest.from.toFixed(2)}→
                  {comparison.facts.biggest.to.toFixed(2)}
                </span>{" "}
                ({comparison.facts.biggest.table})
              </>
            ) : null}
            {comparison.facts.newDims.length > 0 ? (
              <>
                {" · "}new question
                {comparison.facts.newDims.length === 1 ? "" : "s"}:{" "}
                <span className="rater-exh__b">
                  {comparison.facts.newDims.join(", ")}
                </span>
              </>
            ) : null}
            {comparison.facts.removedLevels.map((r) => (
              <Fragment key={r.dim}>
                {" · "}
                <span className="rater-exh__num">{r.ids.length}</span> level
                {r.ids.length === 1 ? "" : "s"} leave {r.dim}
              </Fragment>
            ))}
          </>
        )}
      </p>

      {/* ── The money band — appears only when a book is present ── */}
      {book !== null && bookRun === null ? (
        <p className="rater-exh__quiet">
          Rating {book.rows.length} risk{book.rows.length === 1 ? "" : "s"}…
        </p>
      ) : null}
      {bookRun !== null && "failed" in bookRun ? (
        <p className="rater-exh__book-error">{bookRun.failed}</p>
      ) : null}
      {bookRun !== null && "portrait" in bookRun ? (
        <section className="rater-exh__money" aria-label="The book, rated">
          {"impact" in bookRun && bookRun.impact !== undefined ? (
            <>
              <div className="rater-exh__money-row">
                <span className="rater-exh__money-cell">
                  <span className="rater-exh__money-label">A total</span>
                  <span className="rater-exh__money-value rater-exh__money-value--a">
                    {fmtMoney(bookRun.impact.aTotal)}
                  </span>
                </span>
                <span className="rater-exh__money-cell">
                  <span className="rater-exh__money-label">B total</span>
                  <span className="rater-exh__money-value rater-exh__money-value--b">
                    {fmtMoney(bookRun.impact.bTotal)}
                  </span>
                </span>
                <span className="rater-exh__money-cell">
                  <span className="rater-exh__money-label">Book delta</span>
                  <span className="rater-exh__money-value">
                    {bookRun.impact.deltaPct === null
                      ? "—"
                      : `${bookRun.impact.deltaPct >= 0 ? "+" : ""}${bookRun.impact.deltaPct.toFixed(1)}%`}
                  </span>
                  <span className="rater-exh__money-sub">
                    {bookRun.impact.matched} of {book?.rows.length} matched
                  </span>
                </span>
              </div>
              <div className="rater-exh__money-hist">
                <DislocationExhibit
                  dislocation={bookRun.dislocation}
                  baselineLabel="A"
                  comparisonLabel="B"
                />
              </div>
              {bookRun.impact.up.length > 0 || bookRun.impact.down.length > 0 ? (
                <div className="rater-exh__movers">
                  <span className="rater-exh__money-label">
                    Biggest moves — driver named from the run
                  </span>
                  {[...bookRun.impact.up, ...bookRun.impact.down].map((m) => (
                    <p key={m.key} className="rater-exh__mover">
                      <span className="rater-exh__num">{m.key}</span>{" "}
                      <span
                        className={
                          m.pct >= 0
                            ? "rater-exh__num rater-exh__mover-up"
                            : "rater-exh__num rater-exh__mover-down"
                        }
                      >
                        {m.pct >= 0 ? "+" : ""}
                        {m.pct.toFixed(1)}%
                      </span>{" "}
                      <span className="rater-exh__num">
                        {fmtMoney(m.from)}→{fmtMoney(m.to)}
                      </span>
                      {m.driver !== null ? (
                        <span className="rater-exh__mover-driver">
                          {" "}
                          · {m.driver}
                        </span>
                      ) : null}
                    </p>
                  ))}
                </div>
              ) : null}
              {bookRun.impact.refusedInB.map((r) => (
                <p key={`rb-${r.key}`} className="rater-exh__refusal">
                  <span className="rater-exh__num">{r.key}</span> — rated by A
                  ({fmtMoney(r.premium)}),{" "}
                  <span className="rater-exh__refusal-why">
                    refused by B: {r.reason}
                  </span>
                  . Never a $0.
                </p>
              ))}
              {bookRun.impact.refusedInA.map((r) => (
                <p key={`ra-${r.key}`} className="rater-exh__refusal">
                  <span className="rater-exh__num">{r.key}</span> — rated by B
                  ({fmtMoney(r.premium)}),{" "}
                  <span className="rater-exh__refusal-why">
                    refused by A: {r.reason}
                  </span>
                  . Never a $0.
                </p>
              ))}
            </>
          ) : (
            <>
              <div className="rater-exh__money-row">
                <span className="rater-exh__money-cell">
                  <span className="rater-exh__money-label">Book total</span>
                  <span className="rater-exh__money-value">
                    {fmtMoney(bookRun.portrait.total)}
                  </span>
                  <span className="rater-exh__money-sub">
                    avg {fmtMoney(bookRun.portrait.average)} / risk
                  </span>
                </span>
                <span className="rater-exh__money-cell">
                  <span className="rater-exh__money-label">Spread</span>
                  <span className="rater-exh__money-value">
                    {bookRun.portrait.min !== null &&
                    bookRun.portrait.max !== null
                      ? `${fmtMoney(bookRun.portrait.min)} – ${fmtMoney(bookRun.portrait.max)}`
                      : "—"}
                  </span>
                  <span className="rater-exh__money-sub">
                    {bookRun.portrait.rated} of {bookRun.portrait.count} rated
                  </span>
                </span>
                {bookRun.portrait.tiers.length > 0 ? (
                  <span className="rater-exh__money-cell">
                    <span className="rater-exh__money-label">Tiers</span>
                    <span className="rater-exh__money-tiers">
                      {bookRun.portrait.tiers
                        .map(([tier, n]) => `${n} ${tier}`)
                        .join(" · ")}
                    </span>
                    <span className="rater-exh__money-sub">
                      every tier named from the eligibility gates
                    </span>
                  </span>
                ) : null}
              </div>
              {bookRun.portrait.refused.map((r) => (
                <p key={r.key} className="rater-exh__refusal">
                  <span className="rater-exh__num">{r.key}</span> —{" "}
                  <span className="rater-exh__refusal-why">{r.reason}</span>.
                  Never a $0.
                </p>
              ))}
            </>
          )}
        </section>
      ) : null}

      {/* ── The workbench: the rail of variables + the stage ── */}
      {loadingSubstrate || (bRef !== null && b.loading) ? (
        <p className="rater-exh__quiet">Drawing the plan…</p>
      ) : tiles.length === 0 ? (
        <p className="rater-exh__quiet">
          No factor tables yet — this plan has nothing to draw.{" "}
          <Link to={`/rate-lab/${planId}`}>Open it in Rate Lab</Link> to keep
          building.
        </p>
      ) : (
        <div className="rater-exh__bench">
          <nav className="rater-exh__rail" aria-label="Variables">
            {comparison !== null ? (
              <button
                type="button"
                className={
                  showOverview
                    ? "rater-exh__rail-item rater-exh__rail-over rater-exh__rail-item--on"
                    : "rater-exh__rail-item rater-exh__rail-over"
                }
                aria-current={showOverview}
                onClick={() => onSelectTable(OVERVIEW_ID)}
              >
                <span className="rater-exh__rail-name">
                  <span className="rater-exh__rail-dot" aria-hidden="true" />
                  What changed
                </span>
                <span className="rater-exh__rail-count">
                  {railEntries.filter((e) => e.changed).length +
                    (uw?.changedCount ?? 0)}
                </span>
              </button>
            ) : null}
            {railGroups.map((group) => (
              <div className="rater-exh__rail-group" key={group.name}>
                <p className="rater-exh__rail-label">{group.name}</p>
                {group.entries.map((entry) => {
                  const span = entry.tile.span;
                  const width =
                    span === null || railScale.hi - railScale.lo < 1e-9
                      ? 0
                      : ((span.max - span.min) /
                          (railScale.hi - railScale.lo)) *
                        100;
                  const left =
                    span === null || railScale.hi - railScale.lo < 1e-9
                      ? 0
                      : ((span.min - railScale.lo) /
                          (railScale.hi - railScale.lo)) *
                        100;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={
                        selected?.id === entry.id
                          ? "rater-exh__rail-item rater-exh__rail-item--on"
                          : "rater-exh__rail-item"
                      }
                      aria-current={selected?.id === entry.id}
                      onClick={() => onSelectTable(entry.id)}
                    >
                      <span className="rater-exh__rail-name">
                        {entry.changed && comparison !== null ? (
                          <span
                            className="rater-exh__rail-dot"
                            title={entry.onlyInB ? "new in B" : "changed"}
                          />
                        ) : null}
                        {entry.tile.table.display_name}
                        {entry.onlyInB ? (
                          <span className="rater-exh__rail-new"> new</span>
                        ) : null}
                      </span>
                      <span className="rater-exh__rail-track">
                        {railTick !== null ? (
                          <span
                            className="rater-exh__rail-tick"
                            style={{ left: `${railTick}%` }}
                          />
                        ) : null}
                        <span
                          className="rater-exh__rail-span"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 2)}%`,
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {showOverview && comparison !== null ? (
            <Overview
              aLabel={plan.display_name}
              bLabel={bLabel ?? ""}
              aMeta={{ inputs: dims.length, tables: tables.length }}
              bMeta={{ inputs: b.dims.length, tables: b.tables.length }}
              facts={comparison.facts}
              groups={ledger}
              underwriting={uw?.rows ?? []}
              onSelect={onSelectTable}
            />
          ) : selected !== undefined ? (
            <Stage
              tile={selected.tile}
              bValues={selectedCompare?.bValues ?? null}
              bCells={selectedCompare?.bCells ?? null}
              gridSlot={
                <GridTile
                  tile={selected.tile}
                  bCells={selectedCompare?.bCells ?? null}
                />
              }
              extraLine={selectedVerdict}
              badge={
                selected.tile.span !== null ? (
                  <>
                    {formatSpan(selected.tile.span)}
                    {selectedCompare !== null &&
                    selectedCompare.bMax !== null &&
                    Math.abs(selectedCompare.bMax - selected.tile.span.max) >
                      1e-9 ? (
                      <span className="rater-exh__tile-badge-b">
                        {" "}
                        → {selectedCompare.bMax.toFixed(2)}
                      </span>
                    ) : null}
                    {selected.onlyInB ? (
                      <span className="rater-exh__tile-badge-b"> · new in B</span>
                    ) : null}
                  </>
                ) : null
              }
              foot={
                <>
                  <span className="rater-exh__tile-cite">
                    {typeof selected.tile.table.source_page === "number"
                      ? `cited p. ${selected.tile.table.source_page} · `
                      : ""}
                    {selected.tile.kind === "grid"
                      ? `${Object.keys(selected.tile.table.cells).length} cells`
                      : `${selected.tile.values.length} levels`}
                    {selectedCompare?.note
                      ? ` · ${selectedCompare.note}`
                      : ""}
                  </span>
                  <span className="rater-exh__tile-foot-spacer" />
                  <Link
                    className="rater-exh__door"
                    to={`/rate-lab/${selected.onlyInB ? (bRef?.planId ?? planId) : planId}/workspace/assemble?table=${encodeURIComponent(selected.tile.table.table_id)}`}
                  >
                    Open in Rate Lab →
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      downloadCsv(
                        `${planId}-${selected.tile.table.slug || selected.tile.table.table_id}.csv`,
                        tileCsv(
                          selected.tile.table.slug ||
                            selected.tile.table.table_id,
                          tileRows(
                            selected.tile,
                            drawnValuesFor(selected.tile),
                            selectedCompare?.bTable ?? null,
                          ),
                          selectedCompare !== null,
                        ),
                      )
                    }
                  >
                    Download CSV
                  </Button>
                </>
              }
            />
          ) : null}
        </div>
      )}


      {/* ── The footer — doors only; the receipts live in the rail ── */}
      <p className="rater-exh__foot">
        <Link to={`/rate-lab/${planId}`}>open in Rate Lab →</Link>
        {" · "}
        <Link to={`/rate-lab/${planId}/workspace/analytics`}>
          full plan report →
        </Link>
        {tiles.length > 0 ? (
          <>
            {" · "}
            <button
              type="button"
              className="rater-exh__foot-action"
              onClick={() => {
                const entries = [
                  ...tiles,
                  ...(comparison?.onlyBTiles ?? []),
                ].map((tile) => ({
                  slug: tile.table.slug || tile.table.table_id,
                  rows: tileRows(
                    tile,
                    drawnValuesFor(tile),
                    comparison?.bBySlug.get(
                      tile.table.slug || tile.table.table_id,
                    ) ?? null,
                  ),
                }));
                downloadCsv(
                  `${planId}-factor-tables.csv`,
                  wallCsv(entries, comparison !== null),
                );
              }}
            >
              download all tables (CSV) ↓
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
