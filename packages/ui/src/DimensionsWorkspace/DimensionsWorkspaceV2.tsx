/**
 * <DimensionsWorkspaceV2> — the Dimensions authoring surface.
 *
 * A two-column layout keeps the searchable dimension list and Add menu
 * on the left, with the selected dimension opening inline on the right.
 *
 * The route owns dimension state, selection, persistence, and references.
 * This component renders editable categorical and banded levels plus the
 * shape-specific geographic, classification, and composite views.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Layers,
  MoreHorizontal,
  Plus,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import {
  Button,
  EmptyState,
  IconButton,
  InlineEdit,
  Menu,
  SearchField,
  Segmented,
} from "@openrater/design-system";
import {
  GeneratePanel,
  LevelRowsTable,
  UsedInPanel,
  defaultBandId,
  parseBandPaste,
  parseLevelPaste,
  patchBandedBoundary,
  slugifyLabel,
  useBandedInlineWarnings,
} from "../DimensionEditor";
import {
  GeoDimEditor,
  dimensionRowToGeoDim,
  type GeoDimEditorTab,
} from "../GeoDimEditor";
import type {
  DimensionReference,
  LevelInlineWarning,
  LevelRow,
} from "../DimensionEditor";
// LevelRowsTable and UsedInPanel import their own stylesheets, so this
// surface has no dependency on the legacy DimensionEditor stylesheet.
import type { DimensionRow } from "../DimensionsTable";
import {
  SHAPE_META,
  countLabel,
  shapeOf,
  type DimensionShape,
} from "../dimensionMeta";
import "./dims-v2.css";

// ── Workspace contract ──

/**
 * The shape choice fired from the tool pane's Add buttons.
 *
 * Mirrors `DimensionShape` from @openrater/contracts, with the
 * addition of "classification" for
 * convenience (since classification is a categorical dim with
 * library mapping — surfaced separately in the UI even though
 * it's not its own substrate shape).
 */
export type DimensionShapeChoice =
  | "categorical"
  | "banded"
  | "geographic"
  | "classification"
  | "composite";

/**
 * The subtype filter applied to the workspace's row list.
 *
 * - "all"            — no filter (default)
 * - "standard"       — only legacy Standard-subtype dims (data
 *                      lacks shape OR shape="categorical" without
 *                      `dimension_type === "classification"`)
 * - "banded"         — shape === "banded"
 * - "geographic"     — dimension_type === "geographic"
 * - "classification" — dimension_type === "classification"
 * - "composite"      — shape === "composite"
 *
 * The "standard" filter keeps its 24.A2 name for backward
 * compatibility; the v2 mockup labels the same chip "Categorical."
 */
export type DimensionSubtypeFilter =
  | "all"
  | "standard"
  | "banded"
  | "geographic"
  | "classification"
  | "composite";

export interface DimensionsWorkspaceProps {
  /** All dimensions registered for this plan (any subtype). */
  readonly dimensions: readonly DimensionRow[];
  /**
   * Pre-applied subtype filter. When set, the matching chip is
   * selected on mount and the row list is scoped accordingly. Use
   * to deep-link from the Risk Inputs / Territories / Classification
   * rail shortcuts.
   */
  readonly initialFilter?: DimensionSubtypeFilter;
  /**
   * Click handler — fires when the user activates a non-categorical row
   * (banded / geographic / classification / composite). The route
   * decides whether to open a drawer or navigate elsewhere. For
   * **categorical** rows the workspace handles selection internally
   * by entering inline-edit mode.
   */
  readonly onSelect?: (id: string) => void;
  /**
   * Fired when the user clicks one of the shape buttons in the tool pane.
   * When the user clicks "+ Categorical", the route
   * should (a) create a new categorical `DimensionRow` with a unique
   * id, (b) append it to `dimensions`, and (c) call
   * `onEditingDimensionIdChange(newDim.id)` so the workspace enters
   * inline-edit mode for the new dimension.
   */
  readonly onAdd?: (shape: DimensionShapeChoice) => void;
  /**
   * Controlled id of the dimension currently being
   * edited inline. When set + the dim exists in `dimensions`, the
   * workspace's center pane swaps from the browse list to
   * `<DimensionEditor>`. `null` or undefined renders the browse list.
   */
  readonly editingDimensionId?: string | null;
  /**
   * Fires when the workspace would change the editing id — e.g., user
   * clicks a categorical row (`onEditingDimensionIdChange(rowId)`) or
   * the editor's back-crumb (`onEditingDimensionIdChange(null)`).
   * Required if the consumer wants the inline editor to work.
   */
  readonly onEditingDimensionIdChange?: (id: string | null) => void;
  /**
   * Fires when the inline editor commits a field
   * patch (autosave on blur). The route applies the patch to its
   * `editedDimensions` array.
   */
  readonly onCommitDimension?: (dim: DimensionRow) => void;
  /**
   * Real persistence status forwarded to the inline editor's autosave
   * pill (the route's debounced dimension write). Defaults to "saved".
   */
  readonly saveState?: "saving" | "saved" | "error";
  /** Explicit jump to the plan's class registry (the
   *  classification dim's management surface). The v2 detail renders it
   *  as a CTA; the old row-click hijack (which also lost the query
   *  string) is gone. */
  readonly onOpenClassRegistry?: ((dimId: string) => void) | undefined;
  /** The dimensions request failed: edits stay local-only
   *  until the service answers. The v2 surface renders an honest banner
   *  (the pill used to read "Saved" over a dead sync). */
  readonly syncBlocked?: boolean;
  /** Retry the failed dimensions fetch. */
  readonly onRetrySync?: (() => void) | undefined;
  /**
   * Fires when the user clicks the editor's Delete button. The route
   * owns confirmation and impact preview behavior.
   */
  readonly onDeleteDimension?: (dimId: string) => void;
  /**
   * Looks up downstream references to a dimension. When undefined,
   * the editor's "Used in" panel renders the empty CTA.
   */
  readonly resolveReferences?: (dimId: string) => readonly DimensionReference[];
  /**
   * Fires when the user clicks an empty-state action
   * button or a Used-in row. The route owns the navigation.
   */
  readonly onJumpToReference?: (ref: DimensionReference) => void;
  /**
   * Empty-state actions. When omitted, the buttons
   * are hidden.
   */
  readonly onReferenceInChain?: (dimId: string) => void;
  readonly onUseAsFactorTableKey?: (dimId: string) => void;
  /**
   * Composite axis-change side channel. Fires
   * separately from `onCommitDimension` so the route can toast on
   * `"reorder"` (lock #10: factor tables keyed on this dim will
   * re-key their columns).
   */
  readonly onCompositeAxisChange?: (
    dimId: string,
    next: readonly string[],
    kind: "add" | "remove" | "reorder",
  ) => void;
  /**
   * Optional back-crumb for edit-in-place. When set
   * and the inline editor is open, an extra crumb appears above
   * "All dimensions" — `← back to <label>`. Clicking fires `onClick`,
   * which the route uses to navigate back to the consumer surface
   * (e.g., the factor table the user came from).
   */
  readonly returnTo?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  // ── Geographic inline editor ─────────────────
  //
  // When the user clicks an existing geographic dim in the list, the
  // workspace's center pane swaps to `<GeoDimEditor>` (instead of the
  // categorical/banded `<DimensionEditor>`). The geographic editor
  // needs four extra controlled bits the consumer owns:
  //
  //   · `geographicActiveTab` — which of the Levels / Map /
  //     Territories tabs is open. Persisted across renders so
  //     navigating away + back returns to the same tab.
  //   · `onGeographicActiveTabChange` — fires when the user clicks
  //     a tab.
  //   · No separate display-name / levels / territories callbacks —
  //     those reuse `onCommitDimension` (the editor commits a fresh
  //     `DimensionRow` with the patched fields).
  //
  // When these props are omitted, the center pane falls back to
  // `<DimensionEditor>` for geographic dims (legacy path; categorical
  // body shows but won't render the map/territories tabs).
  /**
   * Controlled tab id for the GeoDimEditor. Default: "levels".
   */
  readonly geographicActiveTab?: GeoDimEditorTab;
  /**
   * Fires when the user picks a different tab inside the geographic
   * editor (Levels / Map / Territories).
   */
  readonly onGeographicActiveTabChange?: (tab: GeoDimEditorTab) => void;
  readonly testId?: string;
}



type Shape = DimensionShape;

// shapeOf, SHAPE_META, and countLabel live in the shared
// shared dimensionMeta module (the canonical dimension language;
// <DimToken> renders it everywhere else). dims2 re-consumes the module
// so it stays the reference implementation.

/**
 * The two shapes whose levels the inline grid edits directly (P2). The other
 * three author their levels elsewhere — geographic via the map/territories
 * tabs, classification via the class registry, composite via axis reorder —
 * so they stay read-only here until P3.
 */
function editableLevelShape(shape: Shape): "categorical" | "banded" | null {
  if (shape === "categorical") return "categorical";
  if (shape === "banded") return "banded";
  return null;
}

// Composite is omitted from the Add menu: coverage_value
// slicing + the structural coverage dim cover the 2-D case, and the
// composite create path was a dead end (a stale toast). Existing
// composite dims remain readable in the detail pane.
const ADD_SHAPES: ReadonlyArray<{ shape: DimensionShapeChoice; hint: string }> =
  [
    { shape: "categorical", hint: "Named levels" },
    { shape: "banded", hint: "Numeric ranges" },
    { shape: "geographic", hint: "State · ZIP · territory" },
    { shape: "classification", hint: "Class library" },
  ];

const FILTERS: ReadonlyArray<{
  value: DimensionSubtypeFilter;
  label: string;
  match: (s: Shape) => boolean;
}> = [
  { value: "all", label: "All", match: () => true },
  { value: "standard", label: "Categorical", match: (s) => s === "categorical" },
  { value: "banded", label: "Banded", match: (s) => s === "banded" },
  { value: "geographic", label: "Geo", match: (s) => s === "geographic" },
];

export function DimensionsWorkspaceV2(
  props: DimensionsWorkspaceProps,
): JSX.Element {
  const {
    dimensions,
    initialFilter,
    onAdd,
    onSelect,
    editingDimensionId,
    onEditingDimensionIdChange,
    onCommitDimension,
    onDeleteDimension,
    onJumpToReference,
    onReferenceInChain,
    onUseAsFactorTableKey,
    resolveReferences,
    saveState,
    syncBlocked,
    onRetrySync,
    onOpenClassRegistry,
    geographicActiveTab,
    onGeographicActiveTabChange,
  } = props;

  const editable = typeof onAdd === "function";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DimensionSubtypeFilter>(
    initialFilter ?? "all",
  );
  // The selected dim drives the right pane. Controlled by the route's
  // editingDimensionId when present (so edit-mode wiring is a drop-in),
  // with a local fallback for the read-only browse case.
  const [localSel, setLocalSel] = useState<string | null>(
    editingDimensionId ?? null,
  );
  const selectedId = editingDimensionId ?? localSel;

  const matchFilter = useMemo(
    () => FILTERS.find((f) => f.value === filter)?.match ?? (() => true),
    [filter],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dimensions.filter((d) => {
      if (!matchFilter(shapeOf(d))) return false;
      if (!q) return true;
      return (
        d.display_name.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q)
      );
    });
  }, [dimensions, matchFilter, search]);

  const selected = useMemo(
    () => dimensions.find((d) => d.id === selectedId) ?? null,
    [dimensions, selectedId],
  );

  const select = (id: string) => {
    setLocalSel(id);
    onEditingDimensionIdChange?.(id);
    onSelect?.(id);
  };

  // Wave 3 — the empty pane is an edge case, not the default: with
  // nothing selected, the first visible dimension opens. Sets the
  // editing id only (never onSelect — that's the user's gesture). The
  // route-controlled editingDimensionId always wins.
  // B4 — fire when `selected` is null, not just when `selectedId` is null:
  // after DELETING the selected dim, selectedId still points at the gone id, so
  // `selected` is null but the detail pane fell back to the global "No
  // dimensions yet" empty state while the rail still listed dims. (A dim merely
  // FILTERED out still resolves in the unfiltered `dimensions`, so `selected`
  // stays non-null — the deliberate "filtering doesn't clear" behavior holds.)
  useEffect(() => {
    if (selected == null && rows.length > 0) {
      const first = rows[0]!;
      setLocalSel(first.id);
      onEditingDimensionIdChange?.(first.id);
    }
  }, [selected, rows, onEditingDimensionIdChange]);

  return (
    <div className="rater-dims2">
      {/* Make sync failure visible: a failed
          dimensions GET used to silently disable ALL persistence while
          the pill read "Saved". */}
      {syncBlocked ? (
        <div className="rater-dims2__syncbanner" role="alert">
          <AlertTriangle size={14} aria-hidden />
          <span className="rater-dims2__syncbanner-msg">
            Changes aren't being saved — the dimensions service didn't
            respond. Edits stay in this browser until it does.
          </span>
          {onRetrySync ? (
            <Button variant="ghost" size="xs" onClick={onRetrySync}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* ── LIST (left) ─────────────────────────────────────────── */}
      <aside className="rater-dims2__list" aria-label="Dimensions">
        <div className="rater-dims2__list-head">
          <SearchField
            className="rater-dims2__search"
            value={search}
            onChange={setSearch}
            placeholder="Search dimensions…"
            aria-label="Search dimensions"
          />
          {editable ? (
            <Menu>
              <Menu.Trigger>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus />}
                  iconAfter={<ChevronDown />}
                >
                  Add
                </Button>
              </Menu.Trigger>
              <Menu.Items aria-label="Add a dimension by shape">
                {ADD_SHAPES.map(({ shape, hint }) => {
                  const m = SHAPE_META[shape as Shape];
                  return (
                    <Menu.Item key={shape} onSelect={() => onAdd?.(shape)}>
                      <span
                        className={`rater-dims2__add-ic rater-dims2__shape--${shape}`}
                        aria-hidden
                      >
                        {m.icon}
                      </span>
                      <span className="rater-dims2__add-body">
                        <span className="rater-dims2__add-title">{m.label}</span>
                        <span className="rater-dims2__add-hint">{hint}</span>
                      </span>
                    </Menu.Item>
                  );
                })}
              </Menu.Items>
            </Menu>
          ) : null}
        </div>

        <div className="rater-dims2__filter">
          <Segmented<DimensionSubtypeFilter>
            value={FILTERS.some((f) => f.value === filter) ? filter : "all"}
            onChange={setFilter}
            items={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
            ariaLabel="Filter dimensions by shape"
          />
        </div>

        <div className="rater-dims2__rows">
          {rows.length === 0 ? (
            <div className="rater-dims2__empty-list">
              <p>
                {dimensions.length === 0
                  ? "No dimensions yet."
                  : "No dimensions match."}
              </p>
              {dimensions.length > 0 ? (
                <Button
                  variant="plain"
                  size="xs"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear search & filters
                </Button>
              ) : null}
            </div>
          ) : (
            rows.map((dim) => {
              const shape = shapeOf(dim);
              const m = SHAPE_META[shape];
              return (
                <button
                  key={dim.id}
                  type="button"
                  className={`rater-dims2__row${
                    dim.id === selectedId ? " is-selected" : ""
                  }`}
                  onClick={() => select(dim.id)}
                  aria-current={dim.id === selectedId ? "true" : undefined}
                >
                  <span
                    className={`rater-dims2__shape rater-dims2__shape--${shape}`}
                    aria-hidden
                  >
                    {m.icon}
                  </span>
                  <span className="rater-dims2__row-body">
                    <span className="rater-dims2__row-name">
                      {dim.display_name}
                    </span>
                    <span className="rater-dims2__row-slug">{dim.slug}</span>
                  </span>
                  <span className="rater-dims2__row-count">
                    {countLabel(dim, shape)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── DETAIL (right) ──────────────────────────────────────── */}
      <section className="rater-dims2__detail" aria-label="Dimension detail">
        {selected ? (
          <DimensionDetail
            key={selected.id}
            dim={selected}
            shape={shapeOf(selected)}
            siblingDims={dimensions}
            references={resolveReferences?.(selected.id) ?? []}
            {...(saveState ? { saveState } : {})}
            {...(onCommitDimension ? { onCommit: onCommitDimension } : {})}
            {...(onDeleteDimension
              ? { onDelete: () => onDeleteDimension(selected.id) }
              : {})}
            {...(onJumpToReference ? { onJumpToReference } : {})}
            {...(onReferenceInChain ? { onReferenceInChain } : {})}
            {...(onUseAsFactorTableKey ? { onUseAsFactorTableKey } : {})}
            {...(onOpenClassRegistry ? { onOpenClassRegistry } : {})}
            {...(geographicActiveTab ? { geographicActiveTab } : {})}
            {...(onGeographicActiveTabChange
              ? { onGeographicActiveTabChange }
              : {})}
          />
        ) : (
          <div className="rater-dims2__detail-empty">
            {/* Wave 3 — auto-select makes this the true ZERO-dimensions
                case (with any dims, the first one opens), so the empty
                state carries the next action instead of instructions. */}
            <EmptyState
              icon={
                <span className="rater-dims2__empty-ic">
                  <Layers size={24} />
                </span>
              }
              title="No dimensions yet"
              description={
                editable
                  ? "Dimensions are the risk attributes your factors key on."
                  : "This plan hasn't declared any dimensions."
              }
            >
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus />}
                  onClick={() => onAdd?.("categorical")}
                >
                  Add a categorical dimension
                </Button>
              ) : null}
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The right-pane detail. Editable (name/id + levels autosave) for categorical +
 * banded dims when `onCommit` is wired; read-only otherwise. Reuses the v1
 * level-CRUD + meta-commit logic verbatim so behaviour is preserved.
 */
function DimensionDetail({
  dim,
  shape,
  siblingDims,
  references,
  saveState,
  onCommit,
  onDelete,
  onJumpToReference,
  onReferenceInChain,
  onUseAsFactorTableKey,
  onOpenClassRegistry,
  geographicActiveTab,
  onGeographicActiveTabChange,
}: {
  readonly dim: DimensionRow;
  readonly shape: Shape;
  readonly siblingDims: readonly DimensionRow[];
  readonly references: readonly DimensionReference[];
  readonly saveState?: "saving" | "saved" | "error" | undefined;
  readonly onCommit?: ((dim: DimensionRow) => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onJumpToReference?: ((ref: DimensionReference) => void) | undefined;
  readonly onReferenceInChain?: ((dimId: string) => void) | undefined;
  readonly onUseAsFactorTableKey?: ((dimId: string) => void) | undefined;
  readonly onOpenClassRegistry?: ((dimId: string) => void) | undefined;
  readonly geographicActiveTab?: GeoDimEditorTab | undefined;
  readonly onGeographicActiveTabChange?:
    | ((tab: GeoDimEditorTab) => void)
    | undefined;
}): JSX.Element {
  const m = SHAPE_META[shape];
  const editLevelShape = editableLevelShape(shape);
  const canEdit = typeof onCommit === "function";
  const canEditLevels = canEdit && editLevelShape !== null;
  const unitPlural = m.units;
  // The geographic shape body lives in this pane:
  // the GeoDimEditor (Levels / Map / Territories tabs) renders headless
  // below the identity header. Controlled tab state when the route
  // provides it; local fallback otherwise.
  const isGeoEditable = shape === "geographic" && canEdit;
  const [localGeoTab, setLocalGeoTab] = useState<GeoDimEditorTab>("levels");
  const geoTab = geographicActiveTab ?? localGeoTab;
  const handleGeoTab = (tab: GeoDimEditorTab): void => {
    setLocalGeoTab(tab);
    onGeographicActiveTabChange?.(tab);
  };
  // The structure count follows the canonical domain:
  // territories when grouped, else levels labeled by granularity.
  const geoGrouped = (dim.geo_territories?.length ?? 0) > 0;
  const structureUnits =
    shape === "geographic"
      ? geoGrouped
        ? "territories"
        : dim.geo_granularity === "zip"
          ? "ZIPs"
          : dim.geo_granularity === "county"
            ? "counties"
            : "states"
      : unitPlural;
  const structureCount =
    shape === "composite"
      ? (dim.axes?.length ?? 0)
      : shape === "geographic" && geoGrouped
        ? (dim.geo_territories?.length ?? 0)
        : (dim.levels?.length ?? 0);

  // ── Meta drafts — autosave on blur (re-seed when the dim swaps or its
  //    committed name/id changes upstream). Mirrors the v1 editor. ──
  const [nameDraft, setNameDraft] = useState(dim.display_name);
  const [slugDraft, setSlugDraft] = useState(dim.slug);
  const [slugOverridden, setSlugOverridden] = useState(false);
  const [focusLevelId, setFocusLevelId] = useState<string | undefined>(
    undefined,
  );
  useEffect(() => {
    setNameDraft(dim.display_name);
    setSlugDraft(dim.slug);
    setSlugOverridden(false);
    setFocusLevelId(undefined);
  }, [dim.id, dim.display_name, dim.slug]);

  // Map the row's levels into the grid's LevelRow shape (kind fallback +
  // conditional optionals under exactOptionalPropertyTypes). Verbatim from v1.
  const levels: readonly LevelRow[] = useMemo(() => {
    if (!dim.levels || editLevelShape === null) return [];
    return dim.levels.map((l): LevelRow => {
      const kind = (l.kind ?? editLevelShape) as "categorical" | "banded";
      const lr: { -readonly [K in keyof LevelRow]: LevelRow[K] } = {
        kind,
        id: l.id,
        label: l.label,
      };
      if (kind === "categorical" && l.aliases !== undefined) {
        lr.aliases = l.aliases;
      }
      if (typeof l.lo === "number") lr.lo = l.lo;
      if (typeof l.hi === "number") lr.hi = l.hi;
      return lr as LevelRow;
    });
  }, [dim.levels, editLevelShape]);

  // Commit a patch — flush any pending (typed-but-unblurred) name/id drafts
  // INTO the patch so a level add/edit never drops the meta the user typed.
  // The explicit patch fields win (spread last). Mirrors v1 `fireCommit`.
  const fireCommit = useCallback(
    (patch: Partial<DimensionRow>) => {
      if (!onCommit) return;
      const tName = nameDraft.trim();
      const tSlug = slugDraft.trim();
      onCommit({
        ...dim,
        ...(tName !== "" && tName !== dim.display_name
          ? { display_name: tName }
          : {}),
        ...(tSlug !== "" && tSlug !== dim.slug ? { slug: tSlug } : {}),
        ...patch,
      });
    },
    [onCommit, nameDraft, slugDraft, dim],
  );

  // ── Meta handlers (label-drives-id until overridden) ──
  // The name renders as an <InlineEdit> (Wave 1) which owns the draft +
  // commit/revert UX; these two handlers keep the COUPLED state in sync:
  // the parent mirrors the draft (so fireCommit's flush guard still sees
  // it) and live-mirrors the slug while it hasn't been hand-overridden.
  const handleNameDraft = (draft: string) => {
    setNameDraft(draft);
    if (draft === dim.display_name) {
      // reverted (Esc / empty / unchanged) — restore the slug mirror too
      if (!slugOverridden) setSlugDraft(dim.slug);
    } else if (!slugOverridden) {
      setSlugDraft(slugifyLabel(draft));
    }
  };
  const handleNameCommit = (next: string) => {
    const candidateSlug = slugOverridden ? null : slugifyLabel(next);
    const shouldUpdateSlug =
      candidateSlug !== null && candidateSlug !== "" && candidateSlug !== dim.slug;
    if (shouldUpdateSlug) setSlugDraft(candidateSlug);
    fireCommit(
      shouldUpdateSlug
        ? { display_name: next, slug: candidateSlug }
        : { display_name: next },
    );
  };
  const handleSlugBlur = () => {
    const trimmed = slugDraft.trim();
    if (trimmed === "" || trimmed === dim.slug) {
      setSlugDraft(dim.slug);
      return;
    }
    fireCommit({ slug: trimmed });
  };

  // ── Level CRUD — verbatim from v1 DimensionEditor ──
  const handleAddLevel = () => {
    const existingIds = new Set(levels.map((l) => l.id));
    if (editLevelShape === "categorical") {
      let counter = levels.length + 1;
      let candidate = `level_${counter}`;
      while (existingIds.has(candidate)) {
        counter += 1;
        candidate = `level_${counter}`;
      }
      fireCommit({
        levels: [
          ...levels,
          { kind: "categorical", id: candidate, label: "", aliases: [] },
        ],
      });
      setFocusLevelId(candidate);
      return;
    }
    // An open tail band splits instead of appending
    // past Infinity: [lo, ∞) becomes [lo, lo+width) + [lo+width, ∞).
    const openTail = [...levels]
      .reverse()
      .find((l) => l.kind === "banded" && l.hi === Number.POSITIVE_INFINITY);
    if (openTail && typeof openTail.lo === "number") {
      const prevFinite = [...levels]
        .reverse()
        .find((l) => l.kind === "banded" && Number.isFinite(l.hi));
      const width =
        prevFinite &&
        typeof prevFinite.lo === "number" &&
        typeof prevFinite.hi === "number"
          ? Math.max(1, prevFinite.hi - prevFinite.lo)
          : 100;
      const splitAt = openTail.lo + width;
      let counter = levels.length + 1;
      let candidate = `band_${splitAt}_up`;
      while (existingIds.has(candidate)) {
        counter += 1;
        candidate = `band_${splitAt}_up_${counter}`;
      }
      fireCommit({
        levels: levels.map((l) =>
          l === openTail
            ? { ...l, hi: splitAt }
            : l,
        ).concat([
          {
            kind: "banded",
            id: candidate,
            label: "",
            lo: splitAt,
            hi: Number.POSITIVE_INFINITY,
          },
        ]),
      });
      setFocusLevelId(candidate);
      return;
    }
    const lastBanded = [...levels]
      .reverse()
      .find(
        (l) =>
          l.kind === "banded" &&
          typeof l.hi === "number" &&
          Number.isFinite(l.hi),
      );
    let lo: number;
    let hi: number;
    if (
      lastBanded &&
      typeof lastBanded.hi === "number" &&
      Number.isFinite(lastBanded.hi)
    ) {
      const lastLo = typeof lastBanded.lo === "number" ? lastBanded.lo : 0;
      const lastHi = lastBanded.hi;
      const width = Math.max(1, lastHi - lastLo);
      lo = lastHi;
      hi = lastHi + width;
    } else {
      lo = 0;
      hi = 100;
    }
    let candidate = defaultBandId(lo, hi);
    let suffix = 1;
    while (existingIds.has(candidate)) {
      suffix += 1;
      candidate = `${defaultBandId(lo, hi)}_${suffix}`;
    }
    fireCommit({
      levels: [...levels, { kind: "banded", id: candidate, label: "", lo, hi }],
    });
    setFocusLevelId(candidate);
  };
  const handleRemoveLevel = (levelId: string) => {
    // Remove the first match only: with a duplicated id
    // the filter-by-id form deleted BOTH rows from one click.
    const idx = levels.findIndex((l) => l.id === levelId);
    if (idx < 0) return;
    fireCommit({
      levels: [...levels.slice(0, idx), ...levels.slice(idx + 1)],
    });
  };
  const handleUpdateLevel = (levelId: string, patch: Partial<LevelRow>) => {
    if (editLevelShape === "banded") {
      const index = levels.findIndex((l) => l.id === levelId);
      if (
        index >= 0 &&
        ((typeof patch.lo === "number" && patch.lo !== levels[index]!.lo) ||
          (typeof patch.hi === "number" && patch.hi !== levels[index]!.hi))
      ) {
        const edge: "lo" | "hi" = typeof patch.lo === "number" ? "lo" : "hi";
        const value: number = (
          typeof patch.lo === "number" ? patch.lo : patch.hi
        ) as number;
        let newLevels = patchBandedBoundary(levels, index, edge, value);
        const { lo: _lo, hi: _hi, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          newLevels = newLevels.map((l) =>
            l.id === levelId ? { ...l, ...rest } : l,
          );
        }
        fireCommit({ levels: newLevels });
        return;
      }
    }
    fireCommit({
      levels: levels.map((l) => (l.id === levelId ? { ...l, ...patch } : l)),
    });
  };
  const handleReorderLevels = (orderedIds: readonly string[]) => {
    const byId = new Map(levels.map((l) => [l.id, l]));
    fireCommit({
      levels: orderedIds
        .map((id) => byId.get(id))
        .filter((l): l is LevelRow => l !== undefined),
    });
  };

  // Banded integrity uses the same gap/overlap validation
  // the legacy editor ran, with the one-click add-band-into-the-gap fix.
  // A banded vocabulary with holes must never look healthy.
  const handleInsertLevels = useCallback(
    (next: readonly LevelRow[]) => fireCommit({ levels: next }),
    [fireCommit],
  );
  const bandedWarnings = useBandedInlineWarnings(
    editLevelShape ?? shape,
    levels,
    canEdit ? handleInsertLevels : undefined,
  );
  // Duplicate level ids are visible the moment they
  // exist (they used to commit silently; edits + deletes then hit
  // multiple rows). Rendered through the same inline-warning rows the
  // banded gap detection uses.
  const duplicateIdWarnings = useMemo<readonly LevelInlineWarning[]>(() => {
    const firstIndexById = new Map<string, number>();
    levels.forEach((l, i) => {
      if (!firstIndexById.has(l.id)) firstIndexById.set(l.id, i);
    });
    const out: LevelInlineWarning[] = [];
    levels.forEach((l, i) => {
      const first = firstIndexById.get(l.id);
      if (first !== undefined && first !== i) {
        out.push({
          afterIndex: i,
          id: `dup-id-${i}`,
          title: "Duplicate id",
          detail: `"${l.id}" already names level ${first + 1} — give this row its own id so edits land on one row.`,
        });
      }
    });
    return out;
  }, [levels]);
  const inlineWarnings = useMemo(
    () =>
      [...bandedWarnings, ...duplicateIdWarnings].sort(
        (a, b) => a.afterIndex - b.afterIndex,
      ),
    [bandedWarnings, duplicateIdWarnings],
  );

  // ── Bulk authoring paths for large class sets.
  //    Paste levels (categorical), Paste bands + Generate (banded) —
  //    the legacy editor's capabilities, rebuilt dims2-native. ──
  const [bulkMode, setBulkMode] = useState<
    null | "paste-levels" | "paste-bands" | "generate"
  >(null);
  const [pasteText, setPasteText] = useState("");
  const [bandReplace, setBandReplace] = useState(true);
  const levelPastePreview = useMemo(() => {
    if (bulkMode !== "paste-levels") return null;
    return parseLevelPaste(pasteText, {
      existingIds: levels.map((l) => l.id),
    });
  }, [bulkMode, pasteText, levels]);
  const bandPastePreview = useMemo(() => {
    if (bulkMode !== "paste-bands") return null;
    return parseBandPaste(pasteText, {
      existingIds: bandReplace ? [] : levels.map((l) => l.id),
    });
  }, [bulkMode, pasteText, levels, bandReplace]);
  const closeBulk = (): void => {
    setBulkMode(null);
    setPasteText("");
  };
  const applyLevelPaste = (): void => {
    if (!levelPastePreview || levelPastePreview.added.length === 0) return;
    fireCommit({
      levels: [
        ...levels,
        ...levelPastePreview.added.map((l) => ({
          kind: "categorical" as const,
          id: l.id,
          label: l.label,
          aliases: [],
        })),
      ],
    });
    closeBulk();
  };
  const applyBandPaste = (): void => {
    if (!bandPastePreview || bandPastePreview.added.length === 0) return;
    const pasted = bandPastePreview.added.map((b) => ({
      kind: "banded" as const,
      id: b.id,
      label: b.label ?? "",
      lo: b.lo,
      hi: b.hi,
    }));
    fireCommit({
      levels: bandReplace ? pasted : [...levels, ...pasted],
    });
    closeBulk();
  };

  // ── Honest autosave pill + id-collision warning ──
  const hasUnsavedDraft =
    nameDraft.trim() !== dim.display_name ||
    (slugDraft.trim() !== "" && slugDraft.trim() !== dim.slug);
  // Wave 3 — the honest pill: a typed-but-unblurred draft reads
  // "Editing" (nothing is being persisted yet — the old pill said
  // "Saving…" indefinitely, a lie in both directions); the route's real
  // write status drives Saving/Saved/error; and a settled "Saved"
  // confirms for ~2s then fades, leaving steady state silent. The slot
  // stays mounted so the ⋯ button never moves.
  const pill: "editing" | "saving" | "saved" | "error" | null = canEdit
    ? hasUnsavedDraft
      ? "editing"
      : (saveState ?? null)
    : null;
  const [savedVisible, setSavedVisible] = useState(true);
  useEffect(() => {
    if (pill !== "saved") {
      setSavedVisible(true);
      return undefined;
    }
    const t = setTimeout(() => setSavedVisible(false), 2000);
    return () => clearTimeout(t);
  }, [pill]);
  const slugCollision = useMemo(() => {
    const s = slugDraft.trim();
    if (s === "" || s === dim.slug) return false;
    return siblingDims.some((o) => o.id !== dim.id && o.slug === s);
  }, [slugDraft, dim.slug, dim.id, siblingDims]);

  return (
    <div className="rater-dims2__d">
      {/* Wave 3 — the back-crumb row is gone (a master-detail whose list
          never leaves the screen has no "back"; auto-select made
          deselection obsolete). The save pill + ⋯ actions live on the
          name row instead, reclaiming a full row of rhythm. */}
      <header className="rater-dims2__d-head">
        <span
          className={`rater-dims2__d-shape rater-dims2__shape--${shape}`}
          aria-hidden
        >
          {m.icon}
        </span>
        <div className="rater-dims2__d-headcopy">
          <div className="rater-dims2__d-namerow">
            {canEdit ? (
              <InlineEdit
                variant="title"
                value={dim.display_name}
                onDraftChange={handleNameDraft}
                onCommit={handleNameCommit}
                placeholder="Dimension name"
                aria-label="Dimension display name"
              />
            ) : (
              <h3 className="rater-dims2__d-name">{dim.display_name}</h3>
            )}
            <span
              className={[
                "rater-dims2__save",
                pill ? `rater-dims2__save--${pill}` : null,
                pill === null || (pill === "saved" && !savedVisible)
                  ? "rater-dims2__save--hidden"
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-live="polite"
            >
              {pill === "saved" ? <Check size={11} aria-hidden /> : null}
              {pill === "editing"
                ? "Editing"
                : pill === "saving"
                  ? "Saving…"
                  : pill === "error"
                    ? "Save failed"
                    : "Saved"}
            </span>
            {onDelete ? (
              <Menu>
                <Menu.Trigger>
                  <IconButton
                    variant="plain"
                    size="sm"
                    aria-label="Dimension actions"
                    icon={<MoreHorizontal />}
                  />
                </Menu.Trigger>
                <Menu.Items aria-label="Dimension actions">
                  <Menu.Item danger onSelect={onDelete}>
                    <Trash2 size={14} aria-hidden /> Delete dimension
                  </Menu.Item>
                </Menu.Items>
              </Menu>
            ) : null}
          </div>
          <div className="rater-dims2__d-meta">
            <span>{m.label}</span>
            <span className="rater-dims2__d-dot" aria-hidden />
            <span className="rater-dims2__d-idline">
              id{" "}
              {canEdit ? (
                <input
                  className="rater-dims2__slug-input rater-dims2__mono"
                  value={slugDraft}
                  size={Math.max(6, slugDraft.length + 1)}
                  onChange={(e) => {
                    setSlugDraft(e.target.value);
                    setSlugOverridden(true);
                  }}
                  onBlur={handleSlugBlur}
                  aria-label="Dimension id"
                  spellCheck={false}
                />
              ) : (
                <code className="rater-dims2__mono">{dim.slug}</code>
              )}
            </span>
          </div>
          {slugCollision ? (
            <p className="rater-dims2__d-warn">
              <AlertTriangle size={12} aria-hidden /> Another dimension already
              uses this id.
            </p>
          ) : null}
        </div>
      </header>

      <div className="rater-dims2__d-divider" />

      {dim.role === "structural" || dim.role === "both" ? (
        /* The structural coverage axis announces itself:
           renaming its level ids silently breaks every 2-D table. */
        <p className="rater-dims2__d-structural">
          Structural — the algorithm's 2-D tables key on this axis.
        </p>
      ) : null}

      {isGeoEditable ? (
        /* All geographic edits flow
           through the same onCommit channel the other shapes use. */
        <GeoDimEditor
          headless
          dimension={dimensionRowToGeoDim(dim)}
          activeTab={geoTab}
          onTabChange={handleGeoTab}
          onDisplayNameChange={(name) =>
            onCommit?.({ ...dim, display_name: name })
          }
          onLevelsChange={(seedLevels) =>
            onCommit?.({
              ...dim,
              levels: seedLevels.map((l) => ({
                kind: "categorical" as const,
                id: l.id,
                label: l.label,
              })),
            })
          }
          onTerritoriesChange={(territories) =>
            onCommit?.({
              ...dim,
              geo_territories: territories.map((t) => ({
                id: t.id,
                label: t.label,
                members: [...t.members],
              })),
            })
          }
          onImportLevelsAndTerritories={(seedLevels, territories) =>
            /* One commit keeps levels and territories from racing. */
            onCommit?.({
              ...dim,
              levels: seedLevels.map((l) => ({
                kind: "categorical" as const,
                id: l.id,
                label: l.label,
              })),
              geo_territories: territories.map((t) => ({
                id: t.id,
                label: t.label,
                members: [...t.members],
              })),
            })
          }
        />
      ) : (
        <div className="rater-dims2__d-secrow">
          <span className="rater-dims2__eyebrow">{structureUnits}</span>
          <span className="rater-dims2__d-count">{structureCount}</span>
          {canEditLevels && bulkMode === null ? (
            <span className="rater-dims2__d-bulk">
              {editLevelShape === "categorical" ? (
                <Button
                  variant="plain"
                  size="xs"
                  onClick={() => setBulkMode("paste-levels")}
                >
                  Paste levels…
                </Button>
              ) : (
                <>
                  <Button
                    variant="plain"
                    size="xs"
                    onClick={() => setBulkMode("generate")}
                  >
                    Generate…
                  </Button>
                  <Button
                    variant="plain"
                    size="xs"
                    onClick={() => setBulkMode("paste-bands")}
                  >
                    Paste bands…
                  </Button>
                </>
              )}
            </span>
          ) : null}
        </div>
      )}

      {bulkMode === "generate" ? (
        <GeneratePanel
          currentLevels={levels}
          onApply={(_recipe, newLevels) => {
            fireCommit({ levels: newLevels });
            closeBulk();
          }}
          onCancel={closeBulk}
        />
      ) : null}

      {bulkMode === "paste-levels" || bulkMode === "paste-bands" ? (
        <div className="rater-dims2__paste">
          <textarea
            className="rater-dims2__paste-text"
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={
              bulkMode === "paste-levels"
                ? "One level per line — label, or id,label"
                : "One band per line — low,high[,label]"
            }
            aria-label={
              bulkMode === "paste-levels" ? "Paste levels" : "Paste bands"
            }
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <div className="rater-dims2__paste-foot">
            <span className="rater-dims2__paste-preview">
              {bulkMode === "paste-levels"
                ? levelPastePreview
                  ? `${levelPastePreview.added.length} new · ${levelPastePreview.skipped.length} skipped`
                  : ""
                : bandPastePreview
                  ? `${bandPastePreview.added.length} band${bandPastePreview.added.length === 1 ? "" : "s"} · ${bandPastePreview.skipped.length} skipped`
                  : ""}
            </span>
            {bulkMode === "paste-bands" ? (
              <label className="rater-dims2__paste-replace">
                <input
                  type="checkbox"
                  checked={bandReplace}
                  onChange={(e) => setBandReplace(e.target.checked)}
                />
                Replace existing bands
              </label>
            ) : null}
            <Button variant="ghost" size="xs" onClick={closeBulk}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={
                bulkMode === "paste-levels"
                  ? !levelPastePreview || levelPastePreview.added.length === 0
                  : !bandPastePreview || bandPastePreview.added.length === 0
              }
              onClick={
                bulkMode === "paste-levels" ? applyLevelPaste : applyBandPaste
              }
            >
              {bulkMode === "paste-levels" ? "Add levels" : "Apply bands"}
            </Button>
          </div>
        </div>
      ) : null}

      {isGeoEditable || bulkMode !== null ? null : canEditLevels ? (
        <LevelRowsTable
          shape={editLevelShape}
          levels={levels}
          onAddLevel={handleAddLevel}
          onRemoveLevel={handleRemoveLevel}
          onUpdateLevel={handleUpdateLevel}
          onReorderLevels={handleReorderLevels}
          inlineWarnings={inlineWarnings}
          {...(focusLevelId ? { focusLevelId } : {})}
        />
      ) : (dim.levels?.length ?? 0) > 0 ? (
        <div className="rater-dims2__lv">
          <div className="rater-dims2__lv-row rater-dims2__lv-row--head">
            <span>Display name</span>
            <span>{shape === "composite" ? "Axis id" : "Level id"}</span>
          </div>
          {(dim.levels ?? []).slice(0, 40).map((lvl, i) => (
            <div key={i} className="rater-dims2__lv-row">
              <span className="rater-dims2__lv-name">
                {lvl.label || lvl.id || `Level ${i + 1}`}
              </span>
              <span className="rater-dims2__lv-id rater-dims2__mono">{lvl.id}</span>
            </div>
          ))}
          {(dim.levels?.length ?? 0) > 40 ? (
            // Wave 3 — never truncate silently: the meta says "200
            // territories", so the table must own up to showing 40.
            <div className="rater-dims2__lv-row rater-dims2__lv-row--more">
              + {(dim.levels?.length ?? 0) - 40} more {unitPlural}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rater-dims2__d-note">No {structureUnits} defined yet.</p>
      )}

      {shape === "classification" ? (
        /* Classification manages its classes in the
           registry; the jump is an EXPLICIT action (the old row-click
           hijacked navigation and lost the query string). */
        <div className="rater-dims2__d-registry">
          <span className="rater-dims2__d-registry-meta">
            {dim.class_library_id
              ? `Bound to the ${dim.class_library_id} registry`
              : "Classes live in the plan's class registry"}
          </span>
          {onOpenClassRegistry ? (
            <Button
              variant="ghost"
              size="xs"
              iconAfter={<ArrowUpRight size={12} />}
              onClick={() => onOpenClassRegistry(dim.id)}
            >
              Manage class registry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="rater-dims2__d-secrow rater-dims2__d-secrow--gap">
        <span className="rater-dims2__eyebrow">Used in</span>
        <span className="rater-dims2__d-count">{references.length}</span>
      </div>
      <div className="rater-dims2__d-usedin">
        <UsedInPanel
          references={references}
          {...(onJumpToReference ? { onJumpToReference } : {})}
          {...(onReferenceInChain
            ? { onReferenceInChain: () => onReferenceInChain(dim.id) }
            : {})}
          {...(onUseAsFactorTableKey
            ? { onUseAsFactorTableKey: () => onUseAsFactorTableKey(dim.id) }
            : {})}
        />
      </div>
    </div>
  );
}
