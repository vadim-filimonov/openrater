/**
 * <LevelRowsTable> — the spreadsheet-style level table.
 *
 * Brief 30 §4 / §5.1 / §5.2. The hero of the dimension editor —
 * "levels are the form" (Principle P1).
 *
 * Categorical layout (PR 30.1):
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ ≡  L1  frame              Frame              aliases ✕    │
 *   │ ≡  L2  joisted_masonry    Joisted masonry    aliases ✕    │
 *   │ + Add another level                                       │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Banded layout (PR 30.2):
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ ≡  L1  band_0_5      New          lo   hi     ✕           │
 *   │ ≡  L2  band_5_15     Modern       lo   hi     ✕           │
 *   │ + Add another level                                       │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Cells (common to both shapes):
 *   • drag handle (≡) — native HTML5 drag/drop reorder (matches
 *     CalculationTower's pattern). On drop, fires onReorderLevels
 *     with the new ordered id vector.
 *   • level id — auto-derived from label (categorical) or from
 *     [lo, hi) (banded). Click to edit manually; commits on blur.
 *   • label — display name. Edits commit on blur. Empty labels show
 *     a placeholder.
 *   • remove — single-click delete with no confirm at this layer
 *     (consumer can wrap with confirmation if it wants).
 *
 * Shape-specific cells:
 *   • categorical: alias chip-cloud via the existing <ChipInput>.
 *   • banded: numeric lo + hi inputs. When the user blurs out of
 *     a boundary, the consumer's onUpdateLevel patches the level
 *     AND propagates to the adjacent band so the breakpoint chain
 *     stays contiguous (see `patchBandedBoundary` in banded-utils).
 *
 * Pure presentation. The consumer owns the level vector; this
 * primitive emits patches via callbacks.
 *
 * Composes with:
 *   • <ChipInput> (Brief 26 PR 6) — for the alias chip-cloud
 *   • <DimensionEditor> (this PR's orchestrator)
 *
 * Out of scope:
 *   • Banded scrubber visual — that's <BandedScrubberStrip>, a
 *     sibling primitive that wraps PR #175's <BreakpointScrubber>
 *     and drives this table via the same onUpdateLevel callback
 *   • Composite product preview — PR 30.6
 *   • Geographic / Classification placeholders — PR 30.6/30.7
 */

import { AlertTriangle, GripVertical, Plus, X } from "lucide-react";
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  JSX,
} from "react";
import { Fragment, useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@openrater/design-system";
import { ChipInput } from "../ChipInput";
import "./LevelRowsTable.css";

/**
 * MIME type for the drag-and-drop payload. Distinct from
 * CalcInventoryRail's CALC_DRAG_MIME so the two drag sources can
 * coexist without confusion.
 */
const LEVEL_DRAG_MIME = "application/x-rater-dimension-level-id";

/**
 * Brief 66 §3.1 — render-only uid reconciliation. Rows must NOT key on
 * `level.id`: the id is itself an editable field (and label-drives-id
 * rewrites it), so an id commit remounted the row and dumped focus to
 * <body> — the owner-acknowledged focus bug, and the blocker under the
 * keyboard layer. Uids are minted per ROW and survive edits:
 *   · equal length ⇒ field edits / renames (or a reorder this table
 *     initiated, whose uids were permuted at the source) — index-stable.
 *   · length change ⇒ align by id walk; unmatched next-rows mint fresh.
 * The uid is never persisted and never leaves this component.
 */
function reconcileUids(
  prev: readonly LevelRow[],
  next: readonly LevelRow[],
  uids: readonly string[],
  mint: () => string,
): readonly string[] {
  if (next.length === prev.length) {
    // Top up in case the very first render arrives before any uids.
    if (uids.length === next.length) return uids;
    return next.map((_, i) => uids[i] ?? mint());
  }
  const out: string[] = [];
  let p = 0;
  for (const row of next) {
    if (p < prev.length && prev[p]!.id === row.id) {
      out.push(uids[p] ?? mint());
      p += 1;
    } else if (next.length > prev.length) {
      out.push(mint()); // insertion at this position
    } else {
      // deletion(s): skip removed prev rows until ids realign
      while (p < prev.length && prev[p]!.id !== row.id) p += 1;
      if (p < prev.length) {
        out.push(uids[p] ?? mint());
        p += 1;
      } else {
        out.push(mint());
      }
    }
  }
  return out;
}

/**
 * Shape of one level row. Matches the relevant subset of
 * `DimensionLevel` from `@openrater/contracts/dimension-types` — kept
 * structural here so this primitive doesn't pull on the canonical
 * type's discriminated union.
 *
 * `kind` is required (matches the canonical DimensionLevel discriminator)
 * — the editor always knows which shape it's authoring. Categorical
 * levels use `aliases`; banded levels use `lo`/`hi`.
 */
export interface LevelRow {
  readonly kind: "categorical" | "banded" | "geographic";
  readonly id: string;
  readonly label: string;
  /** Optional aliases (categorical levels). When undefined, treated as []. */
  readonly aliases?: readonly string[];
  /** Banded-only fields — surfaced in PR 30.2. Reserved here for typing. */
  readonly lo?: number;
  readonly hi?: number;
}

export interface LevelRowsTableProps {
  /** "categorical" lays out id + label + aliases. "banded" adds lo/hi cells (PR 30.2). */
  readonly shape: "categorical" | "banded";
  /** Current level rows. Order is meaningful — that's what the user reorders. */
  readonly levels: readonly LevelRow[];
  /** Append a new empty level. The consumer picks the new id (typically `level_${N+1}`). */
  readonly onAddLevel: () => void;
  /** Remove the level with the given id. */
  readonly onRemoveLevel: (levelId: string) => void;
  /**
   * Patch a single level (id, label, aliases, or lo/hi). The patch is
   * shallow-merged with the existing level. The consumer is responsible
   * for revalidating the resulting vector (e.g., uniqueness of ids).
   */
  readonly onUpdateLevel: (levelId: string, patch: Partial<LevelRow>) => void;
  /**
   * Fires with the new ordered id vector when the user drops a row at
   * a new position. The consumer reorders the level vector to match.
   */
  readonly onReorderLevels: (orderedIds: readonly string[]) => void;
  /**
   * When true, the table renders read-only (no chip add/remove, no
   * drag handles, no remove buttons). Used by the deferred view
   * mode (not exercised in PR 30.1).
   */
  readonly readOnly?: boolean;
  /**
   * If set, focuses this level's label cell on mount. Used when the
   * consumer just appended a new level — focus moves to it so the
   * user can type without a click.
   */
  readonly focusLevelId?: string;
  /**
   * Brief 30 PR 30.3 — Inline warning rows. Each entry says
   * "insert a warning row between `levels[afterIndex]` and
   * `levels[afterIndex + 1]`" with the given message + optional
   * onFix callback (renders an inline "+ Add band" button when
   * provided). Use to surface gap detection inline at the row
   * level. Sorted by afterIndex; safe to leave empty.
   */
  readonly inlineWarnings?: readonly LevelInlineWarning[];
  readonly testId?: string;
}

/**
 * Inline warning marker — rendered as a row BETWEEN two adjacent
 * level rows. PR 30.3 uses it for banded gap detection (gap warning
 * between band[i] and band[i+1]).
 */
export interface LevelInlineWarning {
  /** Insert after this level index (0-based; -1 = before all). */
  readonly afterIndex: number;
  /** Stable key for React reconciliation. */
  readonly id: string;
  /** Headline message (e.g., "Coverage gap · 15 ≤ x < 30"). */
  readonly title: string;
  /** Subtle one-line explanation. */
  readonly detail: string;
  /**
   * Optional inline "+ Add band" CTA. When set, the warning row
   * renders the action button on the right.
   */
  readonly onFix?: () => void;
  /** Label for the fix CTA (default "+ Add band"). */
  readonly fixLabel?: string;
}

/**
 * Slugify a label into a stable id candidate. Matches the
 * "label drives id, override on click" lock (Brief 30 §−1 Q2).
 *
 * Strips diacritics, lowercases, collapses whitespace+punctuation to
 * underscores. Leading/trailing underscores trimmed.
 */
export function slugifyLabel(label: string): string {
  const ascii = label.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function LevelRowsTable(props: LevelRowsTableProps): JSX.Element {
  const {
    shape,
    levels,
    onAddLevel,
    onRemoveLevel,
    onUpdateLevel,
    onReorderLevels,
    readOnly = false,
    focusLevelId,
    inlineWarnings = [],
    testId = "rater-level-rows-table",
  } = props;

  // Bucket inline warnings by afterIndex for O(1) lookup while
  // rendering. The same afterIndex can hold multiple warnings.
  const warningsByAfter = new Map<number, readonly LevelInlineWarning[]>();
  for (const w of inlineWarnings) {
    const existing = warningsByAfter.get(w.afterIndex) ?? [];
    warningsByAfter.set(w.afterIndex, [...existing, w]);
  }

  // ── Drag state — local; commits via onReorderLevels on drop ───
  //
  // We track the index of the row currently being dragged + the
  // index where it would drop. Native HTML5 drag events drive both;
  // the drop indicator renders between rows.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, index: number) => {
      if (readOnly) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(LEVEL_DRAG_MIME, levels[index]!.id);
      setDragIndex(index);
    },
    [levels, readOnly],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, index: number) => {
      if (readOnly || dragIndex === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      // Determine if cursor is in the top or bottom half of the row
      // to decide whether the drop slot is before or after the row.
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      const insertBefore = offsetY < rect.height / 2;
      setDropIndex(insertBefore ? index : index + 1);
    },
    [dragIndex, readOnly],
  );

  // Brief 66 §3.1 — stable row uids (see reconcileUids above).
  const uidCounterRef = useRef(0);
  const prevLevelsRef = useRef<readonly LevelRow[]>([]);
  const uidsRef = useRef<readonly string[]>([]);
  if (levels !== prevLevelsRef.current) {
    uidsRef.current = reconcileUids(
      prevLevelsRef.current,
      levels,
      uidsRef.current,
      () => `lvl-uid-${(uidCounterRef.current += 1)}`,
    );
    prevLevelsRef.current = levels;
  }

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      // Reorder: remove from dragIndex, insert at dropIndex.
      // If dropIndex > dragIndex, the removal shifts the target down by 1.
      const next = levels.map((l) => l.id);
      const [moved] = next.splice(dragIndex, 1);
      const adjustedDrop =
        dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
      next.splice(adjustedDrop, 0, moved!);
      // Permute the row uids with the same splice so the reordered
      // array (equal length) stays index-aligned on the next render.
      const uids = [...uidsRef.current];
      const [movedUid] = uids.splice(dragIndex, 1);
      uids.splice(adjustedDrop, 0, movedUid!);
      uidsRef.current = uids;
      onReorderLevels(next);
    }
    setDragIndex(null);
    setDropIndex(null);
  }, [dragIndex, dropIndex, levels, onReorderLevels]);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      handleDragEnd();
    },
    [handleDragEnd],
  );

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="rater-dim-levels" data-testid={testId}>
      <div className="rater-dim-levels__rows" onDragEnd={handleDragEnd}>
        {levels.length === 0 ? (
          <PlaceholderRow shape={shape} testId={`${testId}-placeholder`} />
        ) : (
          levels.map((level, index) => (
            <Fragment key={uidsRef.current[index] ?? level.id}>
              <LevelRow
                level={level}
                index={index}
                shape={shape}
                readOnly={readOnly}
                autoFocusLabel={focusLevelId === level.id}
                isDragging={dragIndex === index}
                isDropTarget={dropIndex === index}
                isDropTargetAfter={
                  dropIndex === levels.length && index === levels.length - 1
                }
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onUpdateLevel={onUpdateLevel}
                onRemoveLevel={onRemoveLevel}
                testId={`${testId}-row-${level.id}`}
              />
              {(warningsByAfter.get(index) ?? []).map((w) => (
                <InlineWarningRow
                  key={w.id}
                  warning={w}
                  testId={`${testId}-warning-${w.id}`}
                />
              ))}
            </Fragment>
          ))
        )}
      </div>
      {!readOnly && (
        <Button
          variant="plain"
          size="sm"
          fullWidth
          icon={<Plus />}
          className="rater-dim-levels__add"
          onClick={onAddLevel}
          data-testid={`${testId}-add`}
        >
          Add another level
        </Button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Internal row component
// ──────────────────────────────────────────────────────────────────

interface LevelRowProps {
  readonly level: LevelRow;
  readonly index: number;
  readonly shape: "categorical" | "banded";
  readonly readOnly: boolean;
  readonly autoFocusLabel: boolean;
  readonly isDragging: boolean;
  readonly isDropTarget: boolean;
  readonly isDropTargetAfter: boolean;
  readonly onDragStart: (
    event: ReactDragEvent<HTMLDivElement>,
    index: number,
  ) => void;
  readonly onDragOver: (
    event: ReactDragEvent<HTMLDivElement>,
    index: number,
  ) => void;
  readonly onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  readonly onUpdateLevel: (id: string, patch: Partial<LevelRow>) => void;
  readonly onRemoveLevel: (id: string) => void;
  readonly testId: string;
}

function LevelRow(props: LevelRowProps): JSX.Element {
  const {
    level,
    index,
    shape,
    readOnly,
    autoFocusLabel,
    isDragging,
    isDropTarget,
    isDropTargetAfter,
    onDragStart,
    onDragOver,
    onDrop,
    onUpdateLevel,
    onRemoveLevel,
    testId,
  } = props;

  // Local draft state for the id + label cells. We commit on blur
  // (autosave model — Brief 30 §−1 Q1). Keeping local state lets the
  // user edit without each keystroke roundtripping through the parent.
  //
  // State is seeded once at mount (or whenever the level.id changes —
  // rows key on a STABLE render-only uid (Brief 66 §3.1) — an id commit
  // no longer remounts the row; the draft-sync effects below re-seed
  // from props when the cell isn't focused. In-progress edits keep the
  // user's text; race resolution is "last write wins by user action."
  const [idDraft, setIdDraft] = useState(level.id);
  const [labelDraft, setLabelDraft] = useState(level.label);
  // Brief 66 §3.1 — rows no longer remount on id/label commits (stable
  // uid keys), so drafts re-seed from props — but never mid-edit: a
  // focused cell keeps the user's in-progress text.
  const idInputRef = useRef<HTMLInputElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== idInputRef.current) setIdDraft(level.id);
  }, [level.id]);
  useEffect(() => {
    if (document.activeElement !== labelInputRef.current) {
      setLabelDraft(level.label);
    }
  }, [level.label]);
  // Track whether the id was manually overridden — once the user
  // touches the id cell, label-drives-id stops auto-running.
  const idOverriddenRef = useRef(false);

  const handleLabelChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newLabel = event.target.value;
    setLabelDraft(newLabel);
    // Label-drives-id: if the user hasn't touched the id cell, keep
    // it in sync with the slugified label while they type. The actual
    // commit happens on blur — but we update the draft live so the
    // user sees the relationship.
    if (!idOverriddenRef.current) {
      setIdDraft(slugifyLabel(newLabel) || `level_${level.id}`);
    }
  };

  const handleLabelBlur = () => {
    const trimmed = labelDraft.trim();
    if (trimmed === level.label) return;
    // Commit label + (if the user didn't override) the synced id.
    // Build the patch as a frozen literal — Partial<LevelRow> is
    // readonly so we can't mutate `patch.id` post-construction.
    const includeId = !idOverriddenRef.current && idDraft !== level.id;
    const patch: Partial<LevelRow> = includeId
      ? { label: trimmed, id: idDraft }
      : { label: trimmed };
    onUpdateLevel(level.id, patch);
  };

  const handleIdChange = (event: ChangeEvent<HTMLInputElement>) => {
    idOverriddenRef.current = true;
    setIdDraft(event.target.value);
  };

  const handleIdBlur = () => {
    const trimmed = idDraft.trim();
    if (trimmed === "" || trimmed === level.id) {
      setIdDraft(level.id);
      return;
    }
    onUpdateLevel(level.id, { id: trimmed });
  };

  const handleAliasesChange = (next: readonly string[]) => {
    onUpdateLevel(level.id, { aliases: next });
  };

  const aliases = level.aliases ?? [];

  return (
    <>
      {isDropTarget && <DropIndicator testId={`${testId}-drop-before`} />}
      <div
        className={`rater-dim-levels__row rater-dim-levels__row--${shape}${
          isDragging ? " is-dragging" : ""
        }${autoFocusLabel ? " is-new" : ""}`}
        draggable={!readOnly}
        onDragStart={(e) => onDragStart(e, index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDrop={onDrop}
        data-testid={testId}
      >
        {!readOnly && (
          <span
            className="rater-dim-levels__drag-handle"
            aria-label={`Drag to reorder ${level.label || level.id}`}
            data-testid={`${testId}-drag-handle`}
          >
            <GripVertical size={14} aria-hidden />
          </span>
        )}
        <span className="rater-dim-levels__num">L{index + 1}</span>
        <input
          ref={idInputRef}
          type="text"
          className="rater-dim-levels__id"
          value={idDraft}
          onChange={handleIdChange}
          onBlur={handleIdBlur}
          aria-label={`Level id for ${level.label || idDraft}`}
          spellCheck={false}
          readOnly={readOnly}
          data-testid={`${testId}-id`}
        />
        <input
          ref={labelInputRef}
          type="text"
          className="rater-dim-levels__label"
          value={labelDraft}
          onChange={handleLabelChange}
          onBlur={handleLabelBlur}
          placeholder="Type a label…"
          aria-label={`Level label for ${idDraft}`}
          autoFocus={autoFocusLabel}
          readOnly={readOnly}
          data-testid={`${testId}-label`}
        />
        {shape === "categorical" && (
          <span
            className="rater-dim-levels__aliases"
            data-testid={`${testId}-aliases`}
          >
            <ChipInput
              values={aliases}
              onChange={handleAliasesChange}
              placeholder="+ alias"
              ariaLabel={`Aliases for ${level.label || idDraft}`}
              disabled={readOnly}
              testId={`${testId}-aliases-chip-input`}
            />
          </span>
        )}
        {shape === "banded" && (
          <BandedBoundaryCells
            level={level}
            readOnly={readOnly}
            onChangeLo={(value) =>
              onUpdateLevel(level.id, { lo: value })
            }
            onChangeHi={(value) =>
              onUpdateLevel(level.id, { hi: value })
            }
            testId={testId}
          />
        )}
        {!readOnly && (
          <button
            type="button"
            className="rater-dim-levels__remove"
            onClick={() => onRemoveLevel(level.id)}
            aria-label={`Remove level ${level.label || level.id}`}
            data-testid={`${testId}-remove`}
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
      {isDropTargetAfter && <DropIndicator testId={`${testId}-drop-after`} />}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

function PlaceholderRow(props: {
  readonly shape: "categorical" | "banded";
  readonly testId: string;
}): JSX.Element {
  const { shape, testId } = props;
  return (
    <div
      className={`rater-dim-levels__row rater-dim-levels__row--${shape} rater-dim-levels__row--placeholder`}
      data-testid={testId}
    >
      <span className="rater-dim-levels__drag-handle" aria-hidden>
        <GripVertical size={14} />
      </span>
      <span className="rater-dim-levels__num">L1</span>
      <span className="rater-dim-levels__id">
        {shape === "banded" ? "band_…" : "level_id"}
      </span>
      <span className="rater-dim-levels__label">
        {shape === "banded"
          ? "Click \"+ Add another level\" or \"⌃ Generate…\" to seed bands"
          : 'Click "+ Add another level" to start'}
      </span>
      {shape === "categorical" && (
        <span className="rater-dim-levels__aliases">
          <span className="rater-dim-levels__aliases-placeholder">aliases</span>
        </span>
      )}
      {shape === "banded" && (
        <span className="rater-dim-levels__banded">
          <span className="rater-dim-levels__aliases-placeholder">
            lo ≤ x &lt; hi
          </span>
        </span>
      )}
      <span></span>
    </div>
  );
}

/**
 * Banded boundary cells — two numeric inputs (`lo` + `hi`) + the
 * `≤ x <` glyph between them. Each commits on blur via the
 * corresponding callback; the parent typically routes lo/hi
 * patches through `patchBandedBoundary` so adjacent bands stay
 * contiguous.
 *
 * Empty values are tolerated — the user might delete one digit
 * while typing the next. We only commit when the parsed number
 * differs from the current level value AND is finite.
 */
function BandedBoundaryCells(props: {
  readonly level: LevelRow;
  readonly readOnly: boolean;
  readonly onChangeLo: (value: number) => void;
  readonly onChangeHi: (value: number) => void;
  readonly testId: string;
}): JSX.Element {
  const { level, readOnly, onChangeLo, onChangeHi, testId } = props;

  // Local draft state for each input so the user can type freely
  // (clear the field, retype, paste, etc.) without each keystroke
  // round-tripping through the parent. Commit on blur.
  // Brief 66 §3.5 — open ends render as EMPTY fields (the contract's
  // ±Infinity; '1M and up' is authored by clearing the hi cell). A
  // finite draft shows the number; an open bound shows "".
  const boundToDraft = (v: number | undefined): string =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  const [loDraft, setLoDraft] = useState<string>(boundToDraft(level.lo));
  const [hiDraft, setHiDraft] = useState<string>(boundToDraft(level.hi));

  // Resync drafts when the upstream level changes (e.g., scrubber
  // drag commits while the user isn't focused on this row).
  useEffect(() => {
    setLoDraft(boundToDraft(level.lo));
  }, [level.lo]);
  useEffect(() => {
    setHiDraft(boundToDraft(level.hi));
  }, [level.hi]);

  const handleLoBlur = () => {
    if (loDraft.trim() === "") {
      // An emptied lo = an open lower end ("below X").
      if (level.lo !== Number.NEGATIVE_INFINITY) {
        onChangeLo(Number.NEGATIVE_INFINITY);
      }
      return;
    }
    const parsed = Number(loDraft);
    if (!Number.isFinite(parsed)) {
      // Bad input → revert to last good value.
      setLoDraft(boundToDraft(level.lo));
      return;
    }
    if (parsed === level.lo) return;
    onChangeLo(parsed);
  };

  const handleHiBlur = () => {
    if (hiDraft.trim() === "") {
      // An emptied hi = an open upper end ("X and up").
      if (level.hi !== Number.POSITIVE_INFINITY) {
        onChangeHi(Number.POSITIVE_INFINITY);
      }
      return;
    }
    const parsed = Number(hiDraft);
    if (!Number.isFinite(parsed)) {
      setHiDraft(boundToDraft(level.hi));
      return;
    }
    if (parsed === level.hi) return;
    onChangeHi(parsed);
  };

  return (
    <span
      className="rater-dim-levels__banded"
      data-testid={`${testId}-banded-cells`}
    >
      <input
        type="number"
        inputMode="decimal"
        className="rater-dim-levels__banded-input rater-dim-levels__banded-input--lo"
        value={loDraft}
        placeholder="open"
        onChange={(e) => setLoDraft(e.target.value)}
        onBlur={handleLoBlur}
        aria-label={`Lower bound for ${level.label || level.id}`}
        readOnly={readOnly}
        data-testid={`${testId}-lo`}
      />
      <span className="rater-dim-levels__banded-op" aria-hidden>
        ≤ x &lt;
      </span>
      <input
        type="number"
        inputMode="decimal"
        className="rater-dim-levels__banded-input rater-dim-levels__banded-input--hi"
        value={hiDraft}
        placeholder="no cap"
        onChange={(e) => setHiDraft(e.target.value)}
        onBlur={handleHiBlur}
        aria-label={`Upper bound for ${level.label || level.id}`}
        readOnly={readOnly}
        data-testid={`${testId}-hi`}
      />
    </span>
  );
}

function DropIndicator(props: { readonly testId: string }): JSX.Element {
  const { testId } = props;
  return (
    <div
      className="rater-dim-levels__drop-indicator"
      role="presentation"
      aria-hidden
      data-testid={testId}
    />
  );
}

/**
 * Inline warning row — rendered between two adjacent level rows by
 * the parent table. The fix button is optional; when omitted, the
 * row is purely informational.
 */
function InlineWarningRow(props: {
  readonly warning: LevelInlineWarning;
  readonly testId: string;
}): JSX.Element {
  const { warning, testId } = props;
  return (
    <div
      className="rater-dim-levels__warning-row"
      role="alert"
      data-testid={testId}
    >
      <span className="rater-dim-levels__warning-icon" aria-hidden>
        <AlertTriangle size={14} />
      </span>
      <div className="rater-dim-levels__warning-body">
        <span className="rater-dim-levels__warning-title">{warning.title}</span>
        <span className="rater-dim-levels__warning-detail">
          {warning.detail}
        </span>
      </div>
      {warning.onFix !== undefined && (
        <Button
          variant="ghost"
          size="xs"
          icon={<Plus size={12} />}
          onClick={warning.onFix}
          data-testid={`${testId}-fix`}
        >
          {warning.fixLabel ?? "Add band"}
        </Button>
      )}
    </div>
  );
}

