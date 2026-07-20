/**
 * Brief 44 PR 44.7 — `<TerritoryGrouping>`.
 *
 * Drag-bucket UI for grouping geo dim levels into named territories.
 * Lives inside the GeoDimEditor's Territories tab; replaces the
 * PR 44.3 placeholder.
 *
 * Two columns (matches Frame 5 of the mockup):
 *
 *   Left  — UNGROUPED LEVELS (N): chips for every level not yet
 *           in a territory. Drag a chip → drop into a bucket.
 *   Right — TERRITORIES (M): named buckets with rename + delete +
 *           "+ New territory". Each bucket renders member chips.
 *           Drag chips between buckets to move; drag back to the
 *           left column to ungroup.
 *
 * Drag-drop uses the native HTML5 API. jsdom doesn't simulate
 * dragstart/dragover/drop realistically, so the pure state ops
 * (`territoryOps.ts`) carry the testable surface; this component
 * is the thin React wrapper.
 *
 * Per Brief 44 Q2 lock — territory is a grouping layer, not a 4th
 * granularity. The component never mutates `levels` (the dim's
 * canonical list); it only edits `territories`.
 */

import { useCallback, useMemo, useState } from "react";

import type { SeedLevel } from "../GeoDimWizard";
import {
  addLevelToTerritory,
  createTerritory,
  deleteTerritory,
  removeLevelFromTerritory,
  renameTerritory,
  territoryByLevel,
  ungroupedLevelIds,
  type GeoTerritory,
} from "./territoryOps";

import "./TerritoryGrouping.css";

/** V8 — max member chips a territory bucket renders before "+N more". */
const MEMBER_PREVIEW_CAP = 24;

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export interface TerritoryGroupingProps {
  /** All levels of the parent geo dim. Drives the chip pool. */
  readonly levels: readonly SeedLevel[];
  /** Current grouping. Consumer persists via `onChange`. */
  readonly territories: readonly GeoTerritory[];
  /** Called with the next territories array on every edit. */
  readonly onChange: (next: GeoTerritory[]) => void;
  /** Optional `data-testid`. */
  readonly testId?: string;
}

// DataTransfer payload key for drag events.
const DT_KEY = "application/x-rater-level-id";

export function TerritoryGrouping({
  levels,
  territories,
  onChange,
  testId = "rater-territory-grouping",
}: TerritoryGroupingProps): JSX.Element {
  const [hoverBucket, setHoverBucket] = useState<string | null>(null);
  // null = ungrouped column. "" string never used.
  const [draggedLevel, setDraggedLevel] = useState<string | null>(null);

  const levelLabelById = useMemo(
    () => new Map(levels.map((l) => [l.id, l.label])),
    [levels],
  );
  const ungroupedIds = useMemo(
    () =>
      ungroupedLevelIds(
        levels.map((l) => l.id),
        territories,
      ),
    [levels, territories],
  );
  const bucketByLevel = useMemo(
    () => territoryByLevel(territories),
    [territories],
  );

  // ── Handlers ─────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLSpanElement>, levelId: string) => {
      setDraggedLevel(levelId);
      if (e.dataTransfer) {
        e.dataTransfer.setData(DT_KEY, levelId);
        e.dataTransfer.effectAllowed = "move";
      }
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedLevel(null);
    setHoverBucket(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, bucketId: string | null) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setHoverBucket(bucketId);
    },
    [],
  );

  const handleDropOnBucket = useCallback(
    (e: React.DragEvent<HTMLDivElement>, bucketId: string) => {
      e.preventDefault();
      const levelId = e.dataTransfer?.getData(DT_KEY) ?? draggedLevel;
      if (!levelId) return;
      onChange(addLevelToTerritory(territories, levelId, bucketId));
      setDraggedLevel(null);
      setHoverBucket(null);
    },
    [draggedLevel, onChange, territories],
  );

  const handleDropOnUngrouped = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const levelId = e.dataTransfer?.getData(DT_KEY) ?? draggedLevel;
      if (!levelId) return;
      const fromBucket = bucketByLevel.get(levelId);
      if (fromBucket) {
        onChange(removeLevelFromTerritory(territories, levelId, fromBucket));
      }
      setDraggedLevel(null);
      setHoverBucket(null);
    },
    [draggedLevel, bucketByLevel, onChange, territories],
  );

  const handleNew = useCallback(() => {
    const { territories: next } = createTerritory(territories, "");
    onChange(next);
  }, [onChange, territories]);

  const handleRename = useCallback(
    (id: string, label: string) => {
      onChange(renameTerritory(territories, id, label));
    },
    [onChange, territories],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onChange(deleteTerritory(territories, id));
    },
    [onChange, territories],
  );

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      className="rater-terr-grouping"
      data-testid={testId}
      aria-label="Territory grouping editor"
    >
      <div
        className={`rater-terr-grouping__col rater-terr-grouping__col--ungrouped${
          hoverBucket === null && draggedLevel !== null ? " is-hovered" : ""
        }`}
        onDragOver={(e) => handleDragOver(e, null)}
        onDrop={handleDropOnUngrouped}
      >
        <div className="rater-terr-grouping__col-head">
          <span className="rater-terr-grouping__col-title">Ungrouped levels</span>
          <span className="rater-terr-grouping__col-count">{ungroupedIds.length}</span>
          <span className="rater-terr-grouping__col-spacer" />
          <span className="rater-terr-grouping__hint">drag to a territory →</span>
        </div>
        <div className="rater-terr-grouping__chips">
          {ungroupedIds.length === 0 ? (
            <span className="rater-terr-grouping__empty">
              Every level is in a territory.
            </span>
          ) : (
            ungroupedIds.map((id) => (
              <LevelChip
                key={id}
                id={id}
                label={levelLabelById.get(id) ?? id}
                isDragging={draggedLevel === id}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            ))
          )}
        </div>
      </div>

      <div className="rater-terr-grouping__col rater-terr-grouping__col--territories">
        <div className="rater-terr-grouping__col-head">
          <span className="rater-terr-grouping__col-title">Territories</span>
          <span className="rater-terr-grouping__col-count">{territories.length}</span>
          <span className="rater-terr-grouping__col-spacer" />
        </div>
        <div className="rater-terr-grouping__buckets">
          {territories.map((t) => (
            <Bucket
              key={t.id}
              territory={t}
              isHovered={hoverBucket === t.id}
              levelLabelById={levelLabelById}
              draggedLevel={draggedLevel}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, t.id)}
              onDrop={(e) => handleDropOnBucket(e, t.id)}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))}
          <button
            type="button"
            className="rater-terr-grouping__new"
            onClick={handleNew}
          >
            + New territory
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

interface LevelChipProps {
  readonly id: string;
  readonly label: string;
  readonly isDragging: boolean;
  readonly onDragStart: (
    e: React.DragEvent<HTMLSpanElement>,
    id: string,
  ) => void;
  readonly onDragEnd: () => void;
}

function LevelChip({
  id,
  label,
  isDragging,
  onDragStart,
  onDragEnd,
}: LevelChipProps): JSX.Element {
  return (
    <span
      className={`rater-terr-grouping__chip${isDragging ? " is-dragging" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, id)}
      onDragEnd={onDragEnd}
      data-level-id={id}
      // V8 — disambiguate duplicate city labels (e.g. many ZIPs named
      // "LAWRENCE") by surfacing the underlying level id (the ZIP) on hover.
      title={label && label !== id ? `${id} · ${label}` : id}
    >
      {label}
    </span>
  );
}

interface BucketProps {
  readonly territory: GeoTerritory;
  readonly isHovered: boolean;
  readonly levelLabelById: ReadonlyMap<string, string>;
  readonly draggedLevel: string | null;
  readonly onDragStart: (
    e: React.DragEvent<HTMLSpanElement>,
    id: string,
  ) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  readonly onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  readonly onRename: (id: string, label: string) => void;
  readonly onDelete: (id: string) => void;
}

function Bucket({
  territory,
  isHovered,
  levelLabelById,
  draggedLevel,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRename,
  onDelete,
}: BucketProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`rater-terr-grouping__bucket${isHovered ? " is-hovered" : ""}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="rater-terr-grouping__bucket-head">
        <input
          className="rater-terr-grouping__bucket-name"
          value={territory.label}
          onChange={(e) => onRename(territory.id, e.target.value)}
          aria-label={`Rename territory ${territory.label}`}
        />
        <span className="rater-terr-grouping__bucket-count">
          {territory.members.length}
        </span>
        <button
          type="button"
          className="rater-terr-grouping__bucket-x"
          onClick={() => onDelete(territory.id)}
          title={`Remove ${territory.label}`}
          aria-label={`Delete ${territory.label}`}
        >
          ✕
        </button>
      </div>
      <div className="rater-terr-grouping__bucket-drop">
        {territory.members.length === 0 ? (
          <span className="rater-terr-grouping__bucket-empty">
            Drop levels here
          </span>
        ) : (
          <>
            {(expanded
              ? territory.members
              : territory.members.slice(0, MEMBER_PREVIEW_CAP)
            ).map((id) => (
              <LevelChip
                key={id}
                id={id}
                label={levelLabelById.get(id) ?? id}
                isDragging={draggedLevel === id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
            {/* V8 — a real filing groups hundreds of ZIPs per territory;
                cap the preview and let the user expand on demand instead of
                rendering all 686 chips at once. */}
            {territory.members.length > MEMBER_PREVIEW_CAP && (
              <button
                type="button"
                className="rater-terr-grouping__bucket-more"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                {expanded
                  ? "Show fewer"
                  : `+${territory.members.length - MEMBER_PREVIEW_CAP} more`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
