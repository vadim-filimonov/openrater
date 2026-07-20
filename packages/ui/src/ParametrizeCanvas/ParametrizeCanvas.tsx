/**
 * <ParametrizeCanvas> — the Factor Tables SECTION (Brief 67 §3.1, the
 * inversion; originally Brief 33's canvas-style generator).
 *
 * Two views, route-controlled via `?table=`:
 *
 *   • CATALOG (no param) — the section's resting state. A full-width
 *     reading surface (the shared <FactorTablesTable>): what tables
 *     exist, what keys them (axes in display names), how big they are
 *     (factor counts), what depends on them (used-by). Search filters;
 *     "New table" enters creation; opening a row enters the editor.
 *   • EDITOR (?table=<id> | ?table=new) — the act. The dimensions
 *     palette rail appears exactly while axes are being composed
 *     (no materialized cells); once cells exist the grid takes the
 *     full width. Back-crumb returns to the catalog.
 *
 * The old canvas/saved mode-swap (Brief 33 Q8) is retired — the
 * catalog IS the section; authoring is an act you enter and leave.
 *
 * Carried Brief 33 behaviors: dotted-grid backdrop (Q1) · one axis
 * enables Generate (Q3) · native HTML5 drag-drop on dim chips
 * (`DIM_DRAG_MIME`) · cells default to 1.00 (multiplicative identity)
 * · "Edit axes" clears cells and returns to axis-drop composition.
 *
 * Pure presentation. The route owns:
 *   • Dimension list (passed in via `dimensions` from PlanDetailRoute's
 *     `editedDimensions` state)
 *   • Saved factor tables (passed in via `factorTables`)
 *   • The view (catalog vs editor — ?table= in the route's URL)
 *   • Open / new / save handlers
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { ArrowLeft, Plus, Upload, X } from "lucide-react";
import {
  Button,
  IconButton,
  SearchField,
  Segmented,
} from "@openrater/design-system";
import type { DimensionRow } from "../DimensionsTable";
import { levelsForKeying } from "../keying";
// Re-exported for consumers that key cells (ADR-0028 keying domain).
export { levelsForKeying } from "../keying";
import { CANONICAL_COVERAGE_SLUG } from "../coverageDimension";
import {
  FactorTableNode,
  type FactorTableNodeAxes,
} from "../FactorTableNode";
import { cellKey } from "../FactorTableGrid2D";
import { SavePill } from "../SavePill/SavePill";
import {
  CsvImportPreview2D,
  parseCsv2D,
  type CsvImport2D,
} from "../CsvImportPreview2D";
import { FactorTableCmdK } from "../FactorTableCmdK";
import type { FactorTableGrid2DAxis } from "../FactorTableGrid2D";
// Brief 34 PR 34.4 + follow-up — the chart pane that sits inside
// every materialized FactorTableNode in the canvas. Hosts the
// chart picker + chart primitive + InsightsPanel per Brief 34 §4
// (chart-type catalog) + §6 (auto-insights).
import { FactorTableViz } from "../FactorTableViz";
import type {
  FactorTableVizGeographicAxis,
} from "../FactorTableViz";
import type { VizConfig } from "../FactorTableViz/resolveChartType";
// Brief 67 §3.1 — the catalog IS the section's no-param view. The
// shared FactorTablesTable renders it (axes in display names, factor
// counts, used-by — the reading surface the saved-list never was).
import {
  FactorTablesTable,
  type FactorTableRow as CatalogRow,
} from "../FactorTablesTable";
// Brief 70 §1 — the canonical dimension language: the creation pick
// list + the editor's RATES-BY axis chips render through DimToken.
import {
  DimToken,
  shapeOfCanonical,
  type DimensionShape,
} from "../dimensionMeta";
import { ImpactDeletePrompt } from "../ImpactDeletePrompt";
// Brief 67 §3.1 — CSV-first creation: infer which dim the file's row
// keys (and column headers) belong to by level-label matching, then
// seed the creation draft from the matched cells.
import { inferCsvAxes, type CsvAxesInferenceOk } from "./inferCsvAxes";
import "./ParametrizeCanvas.css";

/**
 * Brief 67 §3.1 — the mode-swap is retired. The CATALOG is the section
 * (no URL param); the editor is a full-width act on a selected table
 * (?table=<id>) or a new draft (?table=new). The old `mode` values map:
 * "saved" → catalog, "canvas" → ?table=new.
 */

/**
 * Saved factor-table summary. Shape matches the existing
 * `FactorTableRow` / `FactorTableRefOption` union used in the
 * legacy 24.D Parametrize section — single source of truth carries.
 */
export interface FactorTableSummary {
  readonly id: string;
  readonly display_name: string;
  readonly slug: string;
  readonly description?: string;
  /** 1-D table key dim slug (single axis). */
  readonly key_dimension?: string;
  /** 2-D+ table key dim slugs (Brief 26). */
  readonly key_dimensions?: readonly string[];
  /**
   * "filed" or "draft" — drives the state pill. When omitted,
   * defaults to "filed" (legacy fixtures).
   */
  readonly state?: "filed" | "draft";
  /** Cell count (e.g., 1424). Shown as a pill in the saved row. */
  readonly cell_count?: number;
  /** Optional "edited 4d ago" text. */
  readonly edited_ago?: string;
  /** Optional "N refs" text shown on the right. */
  readonly ref_count?: number;
  /**
   * Brief 67 §3.1 — Algorithm chains that read this table
   * ("Building chain · Construction factor"). Drives the catalog's
   * "Used by" column; the same scan feeds the armed delete prompt.
   */
  readonly used_by?: readonly string[];
}

/**
 * PR 14 — Draft snapshot the canvas hands to `onSaveTable`. The
 * caller can build a `FactorTableSummary` from this (display_name
 * + key_dimension/s from the axes) and either round-trip a cell
 * payload or drop the cells when the backend doesn't store them
 * yet.
 */
export interface ParametrizeCanvasDraft {
  /** Title (auto-suggested or user-typed). */
  readonly title: string;
  /** Axes: row + column dim slugs. Either may be null. */
  readonly axes: FactorTableNodeAxes;
  /**
   * Materialized cells. `null` when the user hasn't clicked Generate
   * yet — the Save button is disabled in that case.
   */
  readonly cells: ReadonlyMap<string, number> | null;
}

export interface ParametrizeCanvasProps {
  /** All dims in the plan, surfaced as draggable chips in the left rail. */
  readonly dimensions: readonly DimensionRow[];
  /** Saved factor tables in the plan — the catalog's rows. */
  readonly factorTables: readonly FactorTableSummary[];
  /**
   * Brief 67 §3.1 — true when the user is authoring a NEW table
   * (?table=new). With `editingExisting`/`initialDraft` unset and
   * `creating` false, the component renders the CATALOG.
   */
  readonly creating?: boolean;
  /**
   * Fires from the editor's back crumb — the route drops ?table=
   * and the catalog returns.
   */
  readonly onBackToCatalog?: () => void;
  /**
   * Fires when the user opens a catalog row. The route navigates to
   * ?table=<id> and remounts the canvas in editing mode.
   */
  readonly onOpenFactorTable?: (tableId: string) => void;
  /**
   * Cold-test N19 — fires when the user clicks the trash on a saved
   * factor-table row. When omitted, no delete affordance renders.
   */
  readonly onDeleteFactorTable?: (tableId: string) => void;
  /**
   * Fires when the user clicks "New table" — the route navigates to
   * ?table=new (the creation question).
   */
  readonly onNewFactorTable?: () => void;
  /**
   * Brief 70 §1 — CREATE-ON-PICK. Fires when the user picks a
   * dimension in the creation question. The route mints the table
   * (identity 1.00 cells over the dim's keying levels), persists it,
   * and navigates to ?table=<id>. No draft state ever exists.
   */
  readonly onCreateFromDimension?: (dimSlug: string) => void;
  /**
   * Brief 70 §1 — CSV-first creation commits directly (the Brief-58
   * draft-store handoff died with drafts themselves). The route mints
   * + persists + navigates.
   */
  readonly onCreateFromCsv?: (payload: {
    readonly title: string;
    readonly axes: FactorTableNodeAxes;
    readonly cells: ReadonlyMap<string, number>;
  }) => void;
  /**
   * Brief 70 §1 / lock D7 — fires after an axis change commits, with
   * the table's NEW key-dimension slugs. The route re-binds
   * referencing chains (rebindChainsForTableAxes → stage PATCH) so
   * the table never silently rates ×1.0.
   */
  readonly onAxesChanged?: (newKeyDims: readonly string[]) => void;
  /**
   * Fires when the user clicks the "+ Add dimension" footer button
   * in the left rail. Navigates to Brief 30's dim editor in create mode.
   */
  readonly onAddDimension?: () => void;
  /**
   * PR 14 — Fires when the user clicks the "Save table" button in
   * the canvas chrome. Caller persists the draft into the plan's
   * factor-table catalog (so it shows up in Saved tables, Assemble
   * inventory, and the Inputs deriver). Returns a promise so the
   * button can show a pending state; the canvas clears its draft
   * automatically on resolve.
   *
   * The draft payload mirrors the canvas's internal state — axes
   * are slugs (or null for a still-incomplete axis), cells are the
   * `cellKey(row, col)` → value map, and `title` is the (possibly
   * auto-suggested) display name.
   */
  readonly onSaveTable?: (draft: ParametrizeCanvasDraft) => Promise<void>;
  /**
   * Brief 67 §3.2 — true when the canvas is editing an EXISTING saved
   * table (?table=<id>). Edits write through via onDraftChange (the
   * route autosaves them); the explicit Save stays as a commit comfort
   * but no longer wipes the canvas (the wipe read as deletion), and
   * the head renders the honest save pill below.
   */
  readonly editingExisting?: boolean;
  /** The REAL bulk-sync state driving the save pill (the dims grammar). */
  readonly saveState?: "saving" | "saved" | "error";
  /** Brief 67 §3.4 — non-draft plans render the canvas read-only (the
   *  dims pattern: the mount also withholds every write handler). */
  readonly readOnly?: boolean;
  /**
   * True while an `onSaveTable` call is in flight. The Save button
   * shows a loading state; the canvas blocks edits until it resolves.
   */
  readonly isSavingTable?: boolean;
  /**
   * Brief 53 — when provided, the active draft's empty column slot shows
   * a one-click "+ Coverage split". Firing it (a) asks the parent to
   * ensure the canonical Building / BPP coverage dimension exists in the
   * plan (idempotent), then (b) assigns it to the draft's column axis —
   * so a 2-D property table is buildable without hand-authoring a dim.
   * Omit to hide the affordance.
   */
  readonly onEnsureCoverageDimension?: () => void;
  /**
   * Brief 58 Pillar B — durable draft autosave. Fires the in-progress
   * draft snapshot (debounced ~400ms while editing) AND synchronously on
   * unmount (flush-on-navigate), so an in-flight "Untitled factor table"
   * survives a tab switch instead of being silently lost before "Save
   * table". Fires `null` when the draft is saved or emptied (the clear
   * signal). The parent route persists/restores it via localStorage —
   * the canvas stays a controlled primitive and owns no storage.
   */
  readonly onDraftChange?: (draft: ParametrizeCanvasDraft | null) => void;
  /**
   * Optional initial state for the active draft. Used by the parent
   * route to "load an existing factor table inline" — the parent
   * remounts the canvas (via `key=`) when the user clicks a saved
   * table, and the canvas reads the initial axes/cells/title from
   * this prop instead of the default empty state. Consumed once at
   * mount time; updates to this prop do NOT re-seed state mid-life
   * (use `key=` for that). Brief 58: the parent also seeds this from a
   * persisted autosaved draft when re-opening a new (unsaved) draft.
   */
  readonly initialDraft?: {
    readonly axes?: FactorTableNodeAxes;
    readonly cells?: ReadonlyMap<string, number>;
    readonly title?: string;
  };
  readonly testId?: string;
}

export function ParametrizeCanvas(
  props: ParametrizeCanvasProps,
): JSX.Element {
  const {
    dimensions,
    factorTables,
    creating = false,
    onBackToCatalog,
    onOpenFactorTable,
    onDeleteFactorTable,
    onNewFactorTable,
    onCreateFromDimension,
    onCreateFromCsv,
    onAxesChanged,
    onAddDimension,
    editingExisting = false,
    saveState,
    readOnly = false,
    onEnsureCoverageDimension,
    onDraftChange,
    initialDraft,
    testId = "rater-parametrize-canvas",
  } = props;

  // Brief 70 §1 — the creation question's pick list state.
  const [pickQuery, setPickQuery] = useState("");
  const [pickShape, setPickShape] = useState<"all" | DimensionShape>("all");
  // Brief 67 §3.5 — the rail search FILTERS (it was explicitly inert:
  // "not wired to filtering yet", the audit's fastest trust killer).
  // Brief 70 §1 — the creation question's pickable dims: composite is
  // excluded (ADR-0051 — coverage slicing covers 2-D); zero-level dims
  // render disabled (a table needs rows). Search + shape filter.
  const pickableDims = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return dimensions
      .filter((d) => shapeOfCanonical(d) !== "composite")
      .filter((d) => pickShape === "all" || shapeOfCanonical(d) === pickShape)
      .filter(
        (d) =>
          !q ||
          (d.display_name || "").toLowerCase().includes(q) ||
          d.slug.toLowerCase().includes(q),
      );
  }, [dimensions, pickQuery, pickShape]);
  // Brief 70 §1 — three views: the CATALOG (resting state), the
  // CREATION QUESTION ("What does this table rate by?" — create-on-
  // pick, no drag/Generate), and the EDITOR (always a saved table
  // with materialized cells; full width, grid + profile).
  const view: "catalog" | "creating" | "editor" = creating
    ? "creating"
    : editingExisting || initialDraft !== undefined
      ? "editor"
      : "catalog";
  const [catalogQuery, setCatalogQuery] = useState("");
  // Map dim slugs → display names so the catalog's Axes column reads
  // with the actuary's vocabulary, not raw slugs.
  const dimDisplayBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const dim of dimensions) {
      map.set(dim.slug, dim.display_name || dim.slug);
    }
    return map;
  }, [dimensions]);
  const catalogRows = useMemo<readonly CatalogRow[]>(
    () =>
      factorTables.map((t) => {
        const dims =
          t.key_dimensions ?? (t.key_dimension ? [t.key_dimension] : []);
        return {
          ...t,
          ...(dims.length > 0
            ? {
                axes_label: dims
                  .map((d) => dimDisplayBySlug.get(d) ?? d)
                  .join(" × "),
              }
            : {}),
        };
      }),
    [factorTables, dimDisplayBySlug],
  );
  const filteredCatalogRows = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return catalogRows;
    return catalogRows.filter(
      (t) =>
        t.display_name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.axes_label ?? "").toLowerCase().includes(q),
    );
  }, [catalogRows, catalogQuery]);
  // Brief 67 §3.1 — CSV-first creation. The file picker parses +
  // infers; the result renders as a confirm panel (the user validates
  // the inferred dim BEFORE the table exists — preview-before-apply),
  // then Create seeds the creation draft via onDraftChange and enters
  // ?table=new through onNewFactorTable.
  const [csvCreate, setCsvCreate] = useState<
    | { kind: "preview"; fileName: string; inference: CsvAxesInferenceOk }
    | { kind: "error"; message: string }
    | null
  >(null);
  const csvCreateInputRef = useRef<HTMLInputElement | null>(null);
  const handleCsvCreatePick = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = parseCsv2D(text, { fileName: file.name });
        const inference = inferCsvAxes(parsed, dimensions);
        if (!inference.ok) {
          setCsvCreate({ kind: "error", message: inference.reason });
          return;
        }
        setCsvCreate({
          kind: "preview",
          fileName: file.name,
          inference,
        });
      } catch (err) {
        setCsvCreate({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [dimensions],
  );
  const handleCsvCreateConfirm = useCallback(() => {
    if (csvCreate?.kind !== "preview") return;
    const { inference } = csvCreate;
    // Brief 70 §1 — CSV-first creation COMMITS directly (drafts are
    // gone): the route mints + persists + navigates to ?table=<id>.
    setCsvCreate(null);
    onCreateFromCsv?.({
      title: `${inference.rowDimName}${
        inference.colDimName ? ` × ${inference.colDimName}` : ""
      } factors`,
      axes: {
        rowDimSlug: inference.axes.rowDimSlug,
        colDimSlug: inference.axes.colDimSlug,
      },
      cells: new Map(inference.cells),
    });
  }, [csvCreate, onCreateFromCsv]);

  // PR 33.2 — Local active-draft state. One draft at a time. Cleared
  // when the user successfully generates (which fires `onNewFactorTable`).
  //
  // The `initialDraft` prop is consumed once at mount via the state
  // initializer — the parent route remounts the canvas (`key=`) when
  // it wants to switch which table is loaded.
  const [draftAxes, setDraftAxes] = useState<FactorTableNodeAxes>(
    () => initialDraft?.axes ?? { rowDimSlug: null, colDimSlug: null },
  );
  const [draftTitle, setDraftTitle] = useState<string>(
    () => initialDraft?.title ?? "",
  );

  // Auto-suggest a title once the user fills an axis (and they haven't typed
  // their own). ADR-0038 — name the table from the dims' DISPLAY NAMES
  // (slug-cased), not their stable slugs, so a geographic dim whose slug froze
  // to its granularity ("zip") but is named "Territory" yields
  // `territory_factor`, not the leaky `zip_factor`. 1-D → `{name}_factor`.
  // Manual edits short-circuit this.
  // Brief 67 §3.2 — a seeded title (opening a saved table / restoring a
  // draft) is the user's name: auto-suggestion must NOT clobber it (it
  // used to, and re-save then minted a DUPLICATE table via the by-name
  // match — the catalog forked silently).
  const [titleAutoSuggested, setTitleAutoSuggested] = useState(
    () => (initialDraft?.title ?? "") === "",
  );
  // Brief 67 §3.5 — suggest a HUMAN name ("Protection class factor"),
  // not a slug ("protection_class_factor"). The route derives the slug
  // id FROM the title on save, so the id stays machine-shaped while
  // the catalog reads in the actuary's words.
  const suggestedTitle = useMemo(() => {
    const slugs = [draftAxes.rowDimSlug, draftAxes.colDimSlug].filter(
      (slug): slug is string => slug !== null,
    );
    if (slugs.length === 0) return "";
    const names = slugs.map((slug) => {
      const dim = dimensions.find((d) => d.slug === slug);
      return (dim?.display_name?.trim() || slug).replace(/\s+/g, " ");
    });
    return `${names.join(" × ")} factor`;
  }, [draftAxes, dimensions]);
  const effectiveTitle = titleAutoSuggested ? suggestedTitle : draftTitle;

  // Brief 53 / Brief 70 — one-click coverage split, now via the
  // + Second axis popover's pinned suggestion. Ensures the canonical
  // Building / BPP coverage dim exists (idempotent), then commits the
  // axis change through the SAME carry-forward path as any other.
  const handleAddCoverageSplit = useCallback(() => {
    onEnsureCoverageDimension?.();
    requestAxes({ ...draftAxes, colDimSlug: CANONICAL_COVERAGE_SLUG });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnsureCoverageDimension, draftAxes]);
  const handleTitleChange = (next: string) => {
    setDraftTitle(next);
    setTitleAutoSuggested(false);
  };

  // PR 33.3 / Brief 70 — Materialized cells. Create-on-pick means a
  // table ALWAYS has cells from birth; null only ever occurs for the
  // empty-levels edge (a dim whose levels were deleted later).
  const [draftCells, setDraftCells] = useState<ReadonlyMap<string, number> | null>(
    () => initialDraft?.cells ?? null,
  );

  // Helper — build the default-cell Map for GIVEN axes. All cells
  // start at 1.00 (no change to the premium).
  const materializeCellsFor = useCallback(
    (axes: FactorTableNodeAxes): ReadonlyMap<string, number> => {
      const next = new Map<string, number>();
      const rowDim = dimensions.find((d) => d.slug === axes.rowDimSlug);
      const colDim = dimensions.find((d) => d.slug === axes.colDimSlug);
      // ADR-0028 — geo dims with a territory grouping key on territory ids.
      const rowLevels = rowDim ? levelsForKeying(rowDim) : [];
      const colLevels = colDim ? levelsForKeying(colDim) : [];
      if (rowLevels.length === 0 && colLevels.length === 0) return next;
      if (rowLevels.length > 0 && colLevels.length > 0) {
        for (const r of rowLevels) {
          for (const c of colLevels) {
            if (r.id && c.id) next.set(cellKey(r.id, c.id), 1);
          }
        }
      } else if (rowLevels.length > 0) {
        for (const r of rowLevels) {
          if (r.id) next.set(cellKey(r.id, null), 1);
        }
      } else {
        // 1-D col only — pivot the col into the row slot at the grid level.
        for (const c of colLevels) {
          if (c.id) next.set(cellKey(c.id, null), 1);
        }
      }
      return next;
    },
    [dimensions],
  );

  // Brief 70 §1 — IN-PLACE axis change with carry-forward. No
  // Generate, no frame round-trip: re-key immediately; exact keys keep
  // their values; a 1-D table whose dim becomes the ROW of a 2-D grid
  // copies each row value into every new column; only genuinely new
  // coordinates start at 1.00. The change reports itself (the footer's
  // transient carry report) and fires onAxesChanged so the route
  // re-binds referencing chains (lock D7).
  const [axisChangeReport, setAxisChangeReport] = useState<string | null>(
    null,
  );
  const applyAxes = useCallback(
    (next: FactorTableNodeAxes) => {
      const fresh = materializeCellsFor(next);
      setDraftCells((prev) => {
        if (!prev || prev.size === 0) return fresh;
        const merged = new Map(fresh);
        let carried = 0;
        for (const key of merged.keys()) {
          const exact = prev.get(key);
          if (exact !== undefined) {
            merged.set(key, exact);
            if (exact !== 1) carried += 1;
            continue;
          }
          const sep = key.indexOf("::");
          if (sep > 0) {
            const rowOnly = prev.get(key.slice(0, sep));
            if (rowOnly !== undefined) {
              merged.set(key, rowOnly);
              if (rowOnly !== 1) carried += 1;
            }
          }
        }
        const fresh1 = merged.size - carried;
        setAxisChangeReport(
          `${carried} value${carried === 1 ? "" : "s"} carried · ${fresh1} at 1.00`,
        );
        return merged;
      });
      setDraftAxes(next);
      const keyDims = [next.rowDimSlug, next.colDimSlug].filter(
        (s): s is string => s !== null,
      );
      onAxesChanged?.(keyDims);
    },
    [materializeCellsFor, onAxesChanged],
  );
  // The armed path: count the AUTHORED (≠ 1.00) values that would NOT
  // survive the change; > 0 arms the impact prompt first.
  const countDroppedAuthored = useCallback(
    (next: FactorTableNodeAxes): number => {
      if (!draftCells) return 0;
      const fresh = materializeCellsFor(next);
      let dropped = 0;
      for (const [key, value] of draftCells) {
        if (value === 1) continue;
        if (fresh.has(key)) continue;
        // the 1-D→2-D copy rescues bare row keys
        if (
          !key.includes("::") &&
          [...fresh.keys()].some((k) => k.startsWith(`${key}::`))
        ) {
          continue;
        }
        dropped += 1;
      }
      return dropped;
    },
    [draftCells, materializeCellsFor],
  );
  const [pendingAxes, setPendingAxes] = useState<{
    readonly next: FactorTableNodeAxes;
    readonly dropped: number;
  } | null>(null);
  const [axisPopoverOpen, setAxisPopoverOpen] = useState<"row" | "col" | null>(
    null,
  );
  const requestAxes = useCallback(
    (next: FactorTableNodeAxes) => {
      const dropped = countDroppedAuthored(next);
      if (dropped > 0) {
        setPendingAxes({ next, dropped });
      } else {
        applyAxes(next);
      }
    },
    [countDroppedAuthored, applyAxes],
  );

  // ── Brief 58 Pillar B — durable draft autosave ──────────────────
  //
  // The in-progress draft lives only in the useState above; navigating
  // away (a tab switch unmounts the canvas) used to lose it before the
  // actuary reached "Save table". We now hand the snapshot to the parent
  // (which persists it to localStorage) debounced while editing, and
  // flush it synchronously on unmount so a fast navigation still captures
  // the latest. `null` means "no draft worth keeping" (empty / saved).
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const latestDraftRef = useRef<ParametrizeCanvasDraft | null>(null);

  const draftSnapshot = useMemo<ParametrizeCanvasDraft | null>(() => {
    const hasContent =
      draftCells !== null ||
      draftAxes.rowDimSlug !== null ||
      draftAxes.colDimSlug !== null ||
      effectiveTitle.trim().length > 0;
    if (!hasContent) return null;
    return { title: effectiveTitle, axes: draftAxes, cells: draftCells };
  }, [effectiveTitle, draftAxes, draftCells]);

  // Keep the latest snapshot in a ref for the unmount flush, and debounce
  // the persist call so a burst of cell edits writes once.
  // Brief 67 walkthrough fix — these effects mount in the EDITOR only.
  // The catalog's local draft state is always empty, so its debounce
  // used to fire onDraftChange(null) 400ms after landing and the route
  // CLEARED the stored draft — composing a table, backing out to the
  // catalog, and returning restored nothing (the Brief 58 durability
  // defeated on the most common in-section path). `view` is constant
  // per mount (the route remounts via key), so the gates are stable.
  useEffect(() => {
    latestDraftRef.current = draftSnapshot;
    if (!onDraftChange || view !== "editor") return;
    const handle = window.setTimeout(() => {
      onDraftChangeRef.current?.(draftSnapshot);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [draftSnapshot, onDraftChange, view]);

  // Flush-on-navigate: cleanup-only effect firing the latest snapshot
  // immediately (the debounce above is cancelled by its own cleanup
  // first, so this is the last word). Editor only — a catalog unmount
  // must never write (or clear) the stored draft.
  useEffect(() => {
    if (view !== "editor") return undefined;
    return () => {
      onDraftChangeRef.current?.(latestDraftRef.current);
    };
  }, [view]);

  // ── Brief 34 PR 34.4 + follow-up — chart pane construction ──────
  //
  // When cells are materialized, build the <FactorTableViz> for the
  // 60/40 split view. The viz renders the chart picker + auto-pick
  // chart per shape + InsightsPanel underneath. Mirrors the col-only
  // fallback that `materializeCells()` uses — a 1-D table with only
  // the col slot filled pivots `colDim` into the row axis at the
  // grid + viz level.
  const vizRowAxis = useMemo<FactorTableGrid2DAxis | null>(() => {
    const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
    const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);
    const axisDim = rowDim ?? colDim;
    if (!axisDim) return null;
    return {
      dimSlug: axisDim.slug,
      // ADR-0028 — territory-grouped geo dims key on territory ids.
      values: levelsForKeying(axisDim).map((l) => ({
        id: l.id,
        label: l.label,
      })),
    };
  }, [dimensions, draftAxes]);
  const vizColAxis = useMemo<FactorTableGrid2DAxis | null>(() => {
    const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
    const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);
    if (!rowDim || !colDim) return null;
    return {
      dimSlug: colDim.slug,
      // ADR-0028 — territory-grouped geo dims key on territory ids.
      values: levelsForKeying(colDim).map((l) => ({
        id: l.id,
        label: l.label,
      })),
    };
  }, [dimensions, draftAxes]);
  // isBanded shape for the chart auto-pick + monotonicity insight.
  // 1-D col-only: rowDim is the COL; mirror its shape into row.
  const vizIsBanded = useMemo<{
    readonly row: boolean;
    readonly col: boolean;
  }>(() => {
    const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
    const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);
    const effectiveRowDim = rowDim ?? colDim;
    return {
      row: effectiveRowDim?.shape === "banded",
      col: rowDim !== undefined && colDim !== undefined
        ? colDim.shape === "banded"
        : false,
    };
  }, [dimensions, draftAxes]);
  // Optional monotonicity direction from the row dim's
  // `monotonicity_expected` (Brief 30 follow-up). Inferred when
  // unset on a banded dim.
  const vizMonotonicityExpected = useMemo<
    "increasing" | "decreasing" | boolean | undefined
  >(() => {
    const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
    const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);
    const axisDim = rowDim ?? colDim;
    if (!axisDim) return undefined;
    const m = axisDim.monotonicity_expected;
    if (m === "increasing" || m === "decreasing") return m;
    if (m === true) return true;
    if (m === null || m === false) return false;
    return undefined; // let FactorTableViz default from shape
  }, [dimensions, draftAxes]);
  // Brief 44 PR 44.5 — Derive the geographicAxis when the row dim
  // is a `dimension_type === "geographic"` row. Unlocks the "Map"
  // chart-type pill in <FactorTableViz>. We mirror the 1-D
  // fallback semantics of `vizRowAxis` above: if the row slot is
  // empty but the col slot holds the geo dim, the col is pivoted
  // into the row axis at viz time, so it counts as the geographic
  // axis too.
  const vizGeographicAxis = useMemo<
    FactorTableVizGeographicAxis | undefined
  >(() => {
    const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
    const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);
    const axisDim = rowDim ?? colDim;
    if (!axisDim) return undefined;
    if (axisDim.dimension_type !== "geographic") return undefined;
    if (!axisDim.geo_granularity) return undefined;
    const scope = axisDim.geo_scope ?? { kind: "national" as const };
    return {
      granularity: axisDim.geo_granularity,
      scope,
    };
  }, [dimensions, draftAxes]);

  // Brief 34 follow-up — vizConfig (chart-type override). MUST be
  // declared BEFORE the `chartPane` useMemo below (which closes
  // over `vizConfig`).
  //
  // The chart-picker pills inside <FactorTableViz> are CONTROLLED:
  // clicking a pill fires `onVizConfigChange` with the new chartType,
  // and the parent (us) must persist it for the next render to pick
  // up. Without this state the pills are no-ops.
  //
  // Default: `{ chartType: "auto" }` so the canvas auto-picks the
  // best chart for the table's shape on first render. The user can
  // override via the pills; we reset back to "auto" whenever cells
  // drop so the next materialization starts fresh.
  const [vizConfig, setVizConfig] = useState<VizConfig>({
    chartType: "auto",
  });

  // The chart pane element passed into <FactorTableNode>'s slot.
  // Null when not materialized OR no row axis (defensive — the
  // FactorTableNode already empty-states when rowAxisGrid is null
  // or has no levels, but we don't want to mount Viz with bad
  // props either).
  const chartPane = useMemo<React.ReactNode>(() => {
    if (draftCells === null || vizRowAxis === null) return null;
    if (vizRowAxis.values.length === 0) return null;
    return (
      <FactorTableViz
        rowAxis={vizRowAxis}
        cells={draftCells}
        isBanded={vizIsBanded}
        // Brief 34 follow-up — InsightsPanel removed per user
        // direction. The auto-insights felt like a gimmick layered
        // on the chart; we keep the chart-type catalog + auto-pick
        // (the moat) but drop the panel below it.
        hideInsights
        // Controlled chart-type pills. Without these the pill
        // clicks are silent no-ops because <FactorTableViz>'s
        // handlePillChange routes through onVizConfigChange.
        vizConfig={vizConfig}
        onVizConfigChange={setVizConfig}
        testId="rater-pc-viz"
        {...(vizColAxis !== null ? { colAxis: vizColAxis } : {})}
        {...(vizMonotonicityExpected !== undefined
          ? { monotonicityExpected: vizMonotonicityExpected }
          : {})}
        {...(vizGeographicAxis !== undefined
          ? { geographicAxis: vizGeographicAxis }
          : {})}
      />
    );
  }, [
    draftCells,
    vizRowAxis,
    vizColAxis,
    vizIsBanded,
    vizMonotonicityExpected,
    vizGeographicAxis,
    vizConfig,
  ]);

  // Brief 34 follow-up — Local view state for the segmented toggle.
  // Brief 67 §3.2 — co-render: the chart rides beside the grid;
  // open by default (collapsing is the exception, not a mode).
  const [chartOpen, setChartOpen] = useState(true);

  // Reset vizConfig to auto whenever cells drop (Edit axes path)
  // so the next materialization starts with the auto-picked chart.
  useEffect(() => {
    if (draftCells === null) setVizConfig({ chartType: "auto" });
  }, [draftCells]);

  // Cell-edit handler — fold the (row, col, value) update into the
  // existing Map. For 1-D tables the colId is null; the grid uses
  // cellKey(rowId, null) as the Map key.
  const handleCellEdit = useCallback(
    (rowId: string, colId: string | null, value: number) => {
      setDraftCells((prev) => {
        if (prev === null) return prev;
        const next = new Map(prev);
        next.set(cellKey(rowId, colId), value);
        return next;
      });
    },
    [],
  );

  // PR 33.4 — Selection state for the embedded grid. Stored as a
  // Set of cellKey strings; mirrors the FactorTableGrid2D contract.
  // Cleared whenever cells drop (Edit axes path) — see effect below.
  const [draftSelection, setDraftSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleSelectionChange = useCallback((next: Set<string>) => {
    setDraftSelection(next);
  }, []);

  // Power-tools handlers — apply bulk ops to every selected cell.
  // "Set to" replaces each selected cell's value with the constant;
  // "Apply +/-X%" multiplies each selected cell by (1 + percent/100).
  // Both no-op when selection is empty or cells aren't materialized.
  const handleSetSelectionValue = useCallback(
    (value: number) => {
      setDraftCells((prev) => {
        if (prev === null || draftSelection.size === 0) return prev;
        const next = new Map(prev);
        for (const key of draftSelection) next.set(key, value);
        return next;
      });
    },
    [draftSelection],
  );

  const handleApplySelectionPercent = useCallback(
    (percent: number) => {
      const factor = 1 + percent / 100;
      setDraftCells((prev) => {
        if (prev === null || draftSelection.size === 0) return prev;
        const next = new Map(prev);
        for (const key of draftSelection) {
          const cur = next.get(key);
          if (cur !== undefined) next.set(key, cur * factor);
        }
        return next;
      });
    },
    [draftSelection],
  );

  // Selection auto-clears whenever cells drop (Edit axes → return to
  // axis-drop frame). Without this the next Generate would inherit
  // stale keys.

  // PR 33.5 — CSV-import drawer state. `csvDrawerOpen` is the show/
  // hide flag; `csvDrawerData` carries the parsed CSV (null while
  // waiting on a file pick). Both reset when the drawer closes.
  const [csvDrawerOpen, setCsvDrawerOpen] = useState(false);
  const [csvDrawerData, setCsvDrawerData] = useState<CsvImport2D | null>(null);
  const [csvDrawerError, setCsvDrawerError] = useState<string | null>(null);

  const handleOpenCsvDrawer = useCallback(() => {
    setCsvDrawerData(null);
    setCsvDrawerError(null);
    setCsvDrawerOpen(true);
  }, []);

  const handleCloseCsvDrawer = useCallback(() => {
    setCsvDrawerOpen(false);
    setCsvDrawerData(null);
    setCsvDrawerError(null);
  }, []);

  // Read + parse the user-picked CSV file in the browser. Errors
  // surface via `csvDrawerError` (rendered as an empty-state subtitle).
  const handlePickCsvFile = useCallback((file: File) => {
    setCsvDrawerError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      try {
        setCsvDrawerData(parseCsv2D(raw, { fileName: file.name }));
      } catch (err) {
        setCsvDrawerError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.onerror = () => {
      setCsvDrawerError("Could not read file.");
    };
    reader.readAsText(file);
  }, []);

  // Brief 67 walkthrough fix — Export CSV (import was one-way; filings
  // and peer review round-trip through Excel). Serializes with the
  // same LABEL vocabulary the importer matches on, so export →
  // reimport is lossless.
  const handleExportCsv = useCallback(() => {
    if (draftCells === null) return;
    const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
    const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);
    const axisDim = rowDim ?? colDim;
    if (!axisDim) return;
    const pivoted1D = rowDim === undefined && colDim !== undefined;
    const rowLevels = levelsForKeying(axisDim);
    const colLevels =
      rowDim && colDim && !pivoted1D ? levelsForKeying(colDim) : null;
    const esc = (s: string) =>
      /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const header = [
      esc(axisDim.display_name || axisDim.slug),
      ...(colLevels ? colLevels.map((l) => esc(l.label)) : ["Factor"]),
    ].join(",");
    const lines = rowLevels.map((row) => {
      const cellsForRow = colLevels
        ? colLevels.map((col) => draftCells.get(cellKey(row.id, col.id)))
        : [draftCells.get(cellKey(row.id, null))];
      return [
        esc(row.label),
        ...cellsForRow.map((v) => (v === undefined ? "" : String(v))),
      ].join(",");
    });
    const blob = new Blob([`${header}\n${lines.join("\n")}\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(effectiveTitle.trim() || "factor-table")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [draftCells, dimensions, draftAxes, effectiveTitle]);

  // Apply CSV-resolved changes: merge into draftCells.
  const handleApplyCsvChanges = useCallback(
    (changes: ReadonlyMap<string, number>) => {
      setDraftCells((prev) => {
        if (prev === null) return prev;
        const next = new Map(prev);
        for (const [key, value] of changes) next.set(key, value);
        return next;
      });
      // Close the drawer and clear staged data.
      handleCloseCsvDrawer();
    },
    [handleCloseCsvDrawer],
  );

  // Resolve the row + col DimensionRow refs the drawer needs.
  const csvRowAxis = useMemo(
    () => dimensions.find((d) => d.slug === draftAxes.rowDimSlug) ?? null,
    [dimensions, draftAxes.rowDimSlug],
  );
  const csvColAxis = useMemo(
    () => dimensions.find((d) => d.slug === draftAxes.colDimSlug) ?? null,
    [dimensions, draftAxes.colDimSlug],
  );

  // PR 33.7 — ⌘K command palette. Open on ⌘K / Ctrl+K when a draft
  // is materialized; the palette consumes the canvas's row + col
  // axes to build its match index.
  const [cmdKOpen, setCmdKOpen] = useState(false);

  useEffect(() => {
    // Bind ⌘K / Ctrl+K globally. Only meaningful when cells are
    // materialized — we still mount the listener unconditionally so
    // the keybinding is discoverable even before Generate (and we
    // gate inside the handler).
    const handler = (event: KeyboardEvent) => {
      const isCmdK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isCmdK) return;
      if (draftCells === null) return; // No grid → no palette.
      event.preventDefault();
      setCmdKOpen((cur) => !cur);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [draftCells]);

  // Build the FactorTableGrid2DAxis shape the palette consumes.
  // Re-using the same `dimToAxis` shape FactorTableNode uses
  // internally would be nicer; for now we inline a minimal version.
  const cmdKRowAxis = useMemo<FactorTableGrid2DAxis | null>(() => {
    if (csvRowAxis === null) return null;
    return {
      dimSlug: csvRowAxis.slug,
      values: (csvRowAxis.levels ?? []).map((l) => ({
        id: l.id,
        label: l.label,
      })),
    };
  }, [csvRowAxis]);
  const cmdKColAxis = useMemo<FactorTableGrid2DAxis | null>(() => {
    if (csvColAxis === null) return null;
    return {
      dimSlug: csvColAxis.slug,
      values: (csvColAxis.levels ?? []).map((l) => ({
        id: l.id,
        label: l.label,
      })),
    };
  }, [csvColAxis]);

  // Jump handler — selects the target cell (so the user lands on it
  // visually) and closes the palette. Future PR can wire scroll-into-
  // view via ref; for now selection + close is enough for the cold-
  // test (the user can locate the cell via its highlight).
  const handleCmdKJump = useCallback(
    (rowId: string, colId: string | null) => {
      setDraftSelection(new Set([cellKey(rowId, colId)]));
    },
    [],
  );

  // ── Brief 67 §3.1 — the CATALOG view (the section's resting state).
  // Full-width reading surface: what tables exist, what keys them, how
  // big they are, what depends on them. Opening a row (or "New table")
  // is the act that enters the editor.
  if (view === "catalog") {
    return (
      <section
        className="rater-pc-catalog"
        aria-label="Factor Tables"
        data-testid={`${testId}-catalog`}
      >
        <header className="rater-pc-catalog-head">
          <div className="rater-pc-catalog-heading">
            <h2 className="rater-pc-catalog-title">Factor Tables</h2>
            <p className="rater-pc-catalog-def">
              Each table maps a dimension&rsquo;s levels to factors — the
              numbers the algorithm multiplies.
            </p>
          </div>
          <span className="rater-pc-grow" />
          {factorTables.length > 0 ? (
            <SearchField
              className="rater-pc-catalog-search"
              size="sm"
              value={catalogQuery}
              onChange={setCatalogQuery}
              placeholder="Search tables"
              aria-label="Search factor tables"
            />
          ) : null}
          {onNewFactorTable && onCreateFromCsv && dimensions.length > 0 ? (
            <>
              <input
                ref={csvCreateInputRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleCsvCreatePick(file);
                }}
                data-testid={`${testId}-catalog-csv-input`}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<Upload size={14} strokeWidth={1.5} aria-hidden />}
                onClick={() => csvCreateInputRef.current?.click()}
                data-testid={`${testId}-catalog-import-csv`}
              >
                Import CSV
              </Button>
            </>
          ) : null}
          {onNewFactorTable ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus size={14} strokeWidth={1.5} aria-hidden />}
              onClick={onNewFactorTable}
              data-testid={`${testId}-catalog-new`}
            >
              New table
            </Button>
          ) : null}
        </header>
        {csvCreate !== null ? (
          <div
            className={`rater-pc-csvnew rater-pc-csvnew--${csvCreate.kind}`}
            role={csvCreate.kind === "error" ? "alert" : "status"}
            data-testid={`${testId}-catalog-csvnew`}
          >
            {csvCreate.kind === "error" ? (
              <>
                <span className="rater-pc-csvnew-text">
                  {csvCreate.message}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCsvCreate(null)}
                >
                  Dismiss
                </Button>
              </>
            ) : (
              <>
                <span className="rater-pc-csvnew-text">
                  <strong>{csvCreate.fileName}</strong> reads as{" "}
                  <strong>
                    {csvCreate.inference.rowDimName}
                    {csvCreate.inference.colDimName
                      ? ` × ${csvCreate.inference.colDimName}`
                      : ""}
                  </strong>{" "}
                  · {csvCreate.inference.matchedRows} row
                  {csvCreate.inference.matchedRows === 1 ? "" : "s"} matched
                  {csvCreate.inference.skippedRows > 0
                    ? ` · ${csvCreate.inference.skippedRows} skipped`
                    : ""}
                  {csvCreate.inference.skippedCols > 0
                    ? ` · ${csvCreate.inference.skippedCols} column${csvCreate.inference.skippedCols === 1 ? "" : "s"} skipped`
                    : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCsvCreate(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCsvCreateConfirm}
                  data-testid={`${testId}-catalog-csvnew-create`}
                >
                  Create table
                </Button>
              </>
            )}
          </div>
        ) : null}
        {catalogRows.length > 0 && filteredCatalogRows.length === 0 ? (
          <p
            className="rater-pc-catalog-nomatch"
            data-testid={`${testId}-catalog-nomatch`}
          >
            No tables match &ldquo;{catalogQuery.trim()}&rdquo;.
          </p>
        ) : (
          <FactorTablesTable
            tables={filteredCatalogRows}
            {...(onOpenFactorTable !== undefined
              ? { onOpen: onOpenFactorTable }
              : {})}
            {...(onDeleteFactorTable !== undefined
              ? { onDelete: onDeleteFactorTable }
              : {})}
            {...(onNewFactorTable !== undefined
              ? {
                  emptyAction: (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={14} strokeWidth={1.5} aria-hidden />}
                      onClick={onNewFactorTable}
                      data-testid={`${testId}-catalog-empty-new`}
                    >
                      New table
                    </Button>
                  ),
                }
              : {})}
            testId={`${testId}-catalog-table`}
          />
        )}
      </section>
    );
  }

  // ── Brief 70 §1 — the CREATION QUESTION. One centered ask; picking
  // a dimension CREATES the table (identity 1.00 cells) and the route
  // lands in the editor. No drag, no slots, no Generate.
  if (view === "creating") {
    return (
      <section
        className="rater-pc-create"
        aria-label="New factor table"
        data-testid={`${testId}-create`}
      >
        <div className="rater-pc-create-crumb">
          {onBackToCatalog ? (
            <Button
              variant="plain"
              size="sm"
              icon={<ArrowLeft size={14} strokeWidth={1.5} aria-hidden />}
              onClick={onBackToCatalog}
              data-testid={`${testId}-back`}
            >
              Factor tables
            </Button>
          ) : null}
        </div>
        <div className="rater-pc-create-col">
          <h2 className="rater-pc-create-q">What does this table rate by?</h2>
          <p className="rater-pc-create-sub">
            Pick the dimension whose levels become the rows. A second
            axis can come later.
          </p>
          <SearchField
            size="md"
            value={pickQuery}
            onChange={setPickQuery}
            placeholder="Search dimensions…"
            aria-label="Search dimensions"
            autoFocus
          />
          <div className="rater-pc-create-filters">
            <Segmented<"all" | DimensionShape>
              value={pickShape}
              onChange={setPickShape}
              ariaLabel="Filter by shape"
              items={[
                { value: "all", label: "All" },
                { value: "categorical", label: "Categorical" },
                { value: "banded", label: "Banded" },
                { value: "geographic", label: "Geo" },
                { value: "classification", label: "Classes" },
              ]}
              testId={`${testId}-create-shapes`}
            />
          </div>
          {dimensions.length === 0 ? (
            <div
              className="rater-pc-create-empty"
              data-testid={`${testId}-create-empty`}
            >
              No dimensions yet — a factor table needs a dimension whose
              levels become its rows.
              {onAddDimension ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={14} strokeWidth={1.5} aria-hidden />}
                  onClick={onAddDimension}
                  data-testid={`${testId}-create-add-dimension`}
                >
                  Add a dimension
                </Button>
              ) : null}
            </div>
          ) : (
            <div
              className="rater-pc-create-list"
              data-testid={`${testId}-create-list`}
            >
              {pickableDims.length === 0 ? (
                <div className="rater-pc-create-nomatch">
                  No dimension matches.
                </div>
              ) : (
                pickableDims.map((dim) => {
                  const keyable = levelsForKeying(dim).length > 0;
                  return (
                    <DimToken
                      key={dim.id}
                      dim={dim}
                      density="row"
                      disabled={!keyable || onCreateFromDimension === undefined}
                      onActivate={() => onCreateFromDimension?.(dim.slug)}
                      {...(!keyable
                        ? {
                            trailing: (
                              <span className="rater-pc-create-nolevels">
                                no levels yet
                              </span>
                            ),
                          }
                        : {})}
                      testId={`${testId}-create-dim-${dim.slug}`}
                    />
                  );
                })
              )}
            </div>
          )}
          {onCreateFromCsv && dimensions.length > 0 ? (
            <>
              <input
                ref={csvCreateInputRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleCsvCreatePick(file);
                }}
                data-testid={`${testId}-create-csv-input`}
              />
              <button
                type="button"
                className="rater-pc-create-drop"
                onClick={() => csvCreateInputRef.current?.click()}
                data-testid={`${testId}-create-csv`}
              >
                Or import a CSV — headers are matched against your
                dimensions&rsquo; levels.
              </button>
              {csvCreate !== null ? (
                <div
                  className={`rater-pc-csvnew rater-pc-csvnew--${csvCreate.kind}`}
                  role={csvCreate.kind === "error" ? "alert" : "status"}
                  data-testid={`${testId}-create-csvnew`}
                >
                  {csvCreate.kind === "error" ? (
                    <>
                      <span className="rater-pc-csvnew-text">
                        {csvCreate.message}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCsvCreate(null)}
                      >
                        Dismiss
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="rater-pc-csvnew-text">
                        <strong>{csvCreate.fileName}</strong> reads as{" "}
                        <strong>
                          {csvCreate.inference.rowDimName}
                          {csvCreate.inference.colDimName
                            ? ` × ${csvCreate.inference.colDimName}`
                            : ""}
                        </strong>{" "}
                        · {csvCreate.inference.matchedRows} row
                        {csvCreate.inference.matchedRows === 1 ? "" : "s"}{" "}
                        matched
                        {csvCreate.inference.skippedRows > 0
                          ? ` · ${csvCreate.inference.skippedRows} skipped`
                          : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCsvCreate(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleCsvCreateConfirm}
                        data-testid={`${testId}-create-csvnew-create`}
                      >
                        Create table
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
          <p className="rater-pc-create-foot">
            The table opens with every factor at 1.00 — nothing changes
            until you edit.
          </p>
        </div>
      </section>
    );
  }

  // ── Brief 70 §1 — the EDITOR act: always a saved table, always full
  // width. The head reads as a sentence: name · RATES BY · axis chips
  // (click to change — the same pick list as creation, in a popover).
  const rowDim = dimensions.find((d) => d.slug === draftAxes.rowDimSlug);
  const colDim = dimensions.find((d) => d.slug === draftAxes.colDimSlug);

  const axisPopover = (axis: "row" | "col"): JSX.Element => {
    const current = axis === "row" ? draftAxes.rowDimSlug : draftAxes.colDimSlug;
    const other = axis === "row" ? draftAxes.colDimSlug : draftAxes.rowDimSlug;
    return (
      <div
        className="rater-pc-axispop"
        data-testid={`${testId}-axispop-${axis}`}
      >
        <SearchField
          size="sm"
          value={pickQuery}
          onChange={setPickQuery}
          placeholder={
            axis === "row" ? "Change the row axis…" : "Change the column axis…"
          }
          aria-label="Change axis"
          autoFocus
        />
        <div className="rater-pc-axispop-list">
          {pickableDims.map((dim) => {
            const keyable = levelsForKeying(dim).length > 0;
            const isCurrent = dim.slug === current;
            const isOther = dim.slug === other;
            return (
              <DimToken
                key={dim.id}
                dim={dim}
                density="row"
                selected={isCurrent}
                disabled={!keyable || isOther || readOnly}
                onActivate={() => {
                  setAxisPopoverOpen(null);
                  setPickQuery("");
                  if (isCurrent) return;
                  requestAxes(
                    axis === "row"
                      ? { ...draftAxes, rowDimSlug: dim.slug }
                      : { ...draftAxes, colDimSlug: dim.slug },
                  );
                }}
                {...(isOther
                  ? {
                      trailing: (
                        <span className="rater-pc-create-nolevels">
                          on the other axis
                        </span>
                      ),
                    }
                  : {})}
                testId={`${testId}-axispop-${axis}-${dim.slug}`}
              />
            );
          })}
        </div>
        {axis === "col" && onEnsureCoverageDimension && current === null ? (
          <button
            type="button"
            className="rater-pc-axispop-coverage"
            onClick={() => {
              setAxisPopoverOpen(null);
              handleAddCoverageSplit();
            }}
            data-testid={`${testId}-axispop-coverage`}
          >
            + Coverage split — Building / BPP, one click
          </button>
        ) : null}
      </div>
    );
  };

  const editorHead = (
    <header className="rater-pc-canvas-head">
      {onBackToCatalog ? (
        <Button
          variant="plain"
          size="sm"
          icon={<ArrowLeft size={14} strokeWidth={1.5} aria-hidden />}
          onClick={onBackToCatalog}
          data-testid={`${testId}-back`}
        >
          Factor tables
        </Button>
      ) : null}
      <span className="rater-pc-rates-eyebrow">rates by</span>
      <div className="rater-pc-axisgroup">
        {([
          ["row", rowDim, draftAxes.rowDimSlug] as const,
          ["col", colDim, draftAxes.colDimSlug] as const,
        ]).map(([axis, dim, slug]) =>
          slug !== null && dim ? (
            <span key={axis} className="rater-pc-axischip-wrap">
              <button
                type="button"
                className="rater-pc-axischip"
                disabled={readOnly}
                onClick={() => {
                  setPickQuery("");
                  setAxisPopoverOpen((cur) => (cur === axis ? null : axis));
                }}
                data-testid={`${testId}-axischip-${axis}`}
              >
                <DimToken dim={dim} density="inline" />
                <span className="rater-pc-axischip-count">
                  · {levelsForKeying(dim).length}
                </span>
              </button>
              {axis === "col" && !readOnly ? (
                <IconButton
                  variant="ghost"
                  size="xs"
                  icon={<X size={12} aria-hidden />}
                  aria-label="Remove the second axis"
                  onClick={() =>
                    requestAxes({ ...draftAxes, colDimSlug: null })
                  }
                  data-testid={`${testId}-axischip-col-remove`}
                />
              ) : null}
              {axisPopoverOpen === axis ? axisPopover(axis) : null}
            </span>
          ) : null,
        )}
        {draftAxes.colDimSlug === null && !readOnly ? (
          <span className="rater-pc-axischip-wrap">
            <Button
              variant="plain"
              size="sm"
              onClick={() => {
                setPickQuery("");
                setAxisPopoverOpen((cur) => (cur === "col" ? null : "col"));
              }}
              data-testid={`${testId}-second-axis`}
            >
              + Second axis
            </Button>
            {axisPopoverOpen === "col" ? axisPopover("col") : null}
          </span>
        ) : null}
      </div>
      <span className="rater-pc-grow" />
      {axisChangeReport !== null ? (
        <span
          className="rater-pc-carryreport"
          data-testid={`${testId}-carryreport`}
        >
          {axisChangeReport}
        </span>
      ) : null}
      {editingExisting && saveState && !readOnly ? (
        <SavePill state={saveState} testId={`${testId}-savepill`} />
      ) : null}
    </header>
  );

  return (
    <>
    <section
      className="rater-pc-canvas rater-pc-canvas--full"
      aria-label="Factor Tables"
      data-testid={`${testId}-canvas`}
    >
      {editorHead}
      <CanvasMode
        readOnly={readOnly}
        dimensions={dimensions}
        draftAxes={draftAxes}
        draftTitle={effectiveTitle}
        onTitleChange={handleTitleChange}
        {...(editingExisting ? { nodeStatus: "saved" as const } : {})}
        testId={testId}
        {...(draftCells !== null
          ? {
              draftCells,
              draftSelection,
              onSelectionChange: handleSelectionChange,
              onExportCsv: handleExportCsv,
            }
          : {})}
        {...(draftCells !== null && !readOnly
          ? {
              onCellEdit: handleCellEdit,
              onSetSelectionValue: handleSetSelectionValue,
              onApplySelectionPercent: handleApplySelectionPercent,
              onImportCsv: handleOpenCsvDrawer,
            }
          : {})}
        {...(chartPane !== null ? { chartPane } : {})}
        chartOpen={chartOpen}
        onChartOpenChange={setChartOpen}
      />
    </section>
    {/* Brief 70 §1 — the armed axis change: authored values that would
        drop arm the impact prompt first (the one armed delete). */}
    <ImpactDeletePrompt
      open={pendingAxes !== null}
      artifactName={`${pendingAxes?.dropped ?? 0} authored factor${(pendingAxes?.dropped ?? 0) === 1 ? "" : "s"}`}
      artifactKind="value"
      lossStatement={
        <>
          Changing the axis drops{" "}
          <strong>
            {pendingAxes?.dropped ?? 0} authored factor
            {(pendingAxes?.dropped ?? 0) === 1 ? "" : "s"}
          </strong>{" "}
          that have no place on the new axis. Matching levels carry
          forward.
        </>
      }
      onConfirm={() => {
        if (pendingAxes) applyAxes(pendingAxes.next);
        setPendingAxes(null);
      }}
      onCancel={() => setPendingAxes(null)}
      testId={`${testId}-axes-impact`}
    />
    {csvRowAxis && (
      <CsvImportPreview2D
        open={csvDrawerOpen}
        csv={csvDrawerData}
        rowAxis={csvRowAxis}
        currentCells={draftCells ?? new Map()}
        onApply={handleApplyCsvChanges}
        onCancel={handleCloseCsvDrawer}
        onPickFile={handlePickCsvFile}
        {...(csvDrawerError !== null ? { error: csvDrawerError } : {})}
        testId={`${testId}-csv-drawer`}
        {...(csvColAxis !== null ? { colAxis: csvColAxis } : {})}
      />
    )}
    {/* Parse failures surface inline — the drawer used to swallow
        them silently (a malformed file looked like an empty drawer). */}
    {cmdKRowAxis !== null && draftCells !== null && (
      <FactorTableCmdK
        open={cmdKOpen}
        rowAxis={cmdKRowAxis}
        cells={draftCells}
        onJumpToCell={handleCmdKJump}
        onClose={() => setCmdKOpen(false)}
        testId={`${testId}-cmdk`}
        {...(cmdKColAxis !== null ? { colAxis: cmdKColAxis } : {})}
      />
    )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────
   CanvasMode — the editor body: the FactorTableNode mount (title,
   import/export, status, grid + chart co-render). Brief 70 removed
   the axis-drop frame, Generate, and the onboarding strip — a table
   always exists with cells by the time this renders.
   ────────────────────────────────────────────────────────────────── */

function CanvasMode(props: {
  readonly dimensions: readonly DimensionRow[];
  readonly draftAxes: FactorTableNodeAxes;
  readonly draftTitle: string;
  readonly onTitleChange: (next: string) => void;
  readonly testId: string;
  readonly draftCells?: ReadonlyMap<string, number>;
  readonly onCellEdit?: (
    rowId: string,
    colId: string | null,
    value: number,
  ) => void;
  readonly draftSelection?: ReadonlySet<string>;
  readonly onSelectionChange?: (next: Set<string>) => void;
  readonly onSetSelectionValue?: (value: number) => void;
  readonly onApplySelectionPercent?: (percent: number) => void;
  readonly onImportCsv?: () => void;
  readonly onExportCsv?: () => void;
  readonly nodeStatus?: "empty" | "draft" | "saved";
  readonly chartPane?: React.ReactNode;
  readonly chartOpen?: boolean;
  readonly onChartOpenChange?: (open: boolean) => void;
  readonly readOnly?: boolean;
}): JSX.Element {
  const {
    dimensions,
    draftAxes,
    draftTitle,
    onTitleChange,
    testId,
    draftCells,
    onCellEdit,
    draftSelection,
    onSelectionChange,
    onSetSelectionValue,
    onApplySelectionPercent,
    onImportCsv,
    onExportCsv,
    nodeStatus,
    chartPane,
    chartOpen,
    onChartOpenChange,
  } = props;
  return (
    <div className="rater-pc-canvas-body" data-testid={`${testId}-canvas-body`}>
      <FactorTableNode
        readOnly={props.readOnly ?? false}
        dimensions={dimensions}
        axes={draftAxes}
        title={draftTitle}
        onTitleChange={onTitleChange}
        testId={`${testId}-draft`}
        {...(draftCells !== undefined ? { cells: draftCells } : {})}
        {...(onCellEdit !== undefined ? { onCellEdit } : {})}
        {...(draftSelection !== undefined
          ? { selectedCells: draftSelection }
          : {})}
        {...(onSelectionChange !== undefined ? { onSelectionChange } : {})}
        {...(onSetSelectionValue !== undefined
          ? { onSetSelectionValue }
          : {})}
        {...(onApplySelectionPercent !== undefined
          ? { onApplySelectionPercent }
          : {})}
        {...(onImportCsv !== undefined ? { onImportCsv } : {})}
        {...(onExportCsv !== undefined ? { onExportCsv } : {})}
        {...(nodeStatus !== undefined ? { status: nodeStatus } : {})}
        {...(chartPane !== undefined ? { chartPane } : {})}
        {...(chartOpen !== undefined ? { chartOpen } : {})}
        {...(onChartOpenChange !== undefined ? { onChartOpenChange } : {})}
      />
    </div>
  );
}
