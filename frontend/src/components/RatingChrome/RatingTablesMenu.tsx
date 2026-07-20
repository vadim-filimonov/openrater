/**
 * <RatingTablesMenu> — Brief 82 D-C (the catalog is a MENU, not a pane).
 *
 * One toolbar button ("Tables · N") summons this popover: search, the
 * in-sheet tables with shape + used-by facts, a separated "Not in the
 * sheet" group (the F9 fix — unused tables stop impersonating the
 * catalog's head), and "New table" running the Brief 67 creation
 * question via the consumer callback. Replaces the deleted
 * `RatingRail` pane (rule 8).
 *
 * O-2 — every string here is plan data (table names) or generic
 * catalog grammar; no line-of-business words.
 */

import { useMemo, useState } from "react";
import type { JSX } from "react";
import { Plus, X } from "lucide-react";
import { IconButton, SearchField } from "@openrater/design-system";
import "./RatingTablesMenu.css";

export interface RatingMenuTable {
  readonly id: string;
  readonly name: string;
  /** "18 values · 0.65–1" (authored shape — the table's identity). */
  readonly shapeLabel: string;
  readonly usedByCount: number;
}

export interface RatingTablesMenuProps {
  readonly tables: readonly RatingMenuTable[];
  readonly onSelectTable: (tableId: string) => void;
  /** Omitted on read-only plans — the create affordance hides. */
  readonly onNewTable?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly testId?: string;
}

export function RatingTablesMenu(props: RatingTablesMenuProps): JSX.Element {
  const {
    tables,
    onSelectTable,
    onNewTable,
    onClose,
    testId = "rater-rating-tables-menu",
  } = props;
  const [query, setQuery] = useState("");

  const { used, unused } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (t: RatingMenuTable) =>
      q === "" || t.name.toLowerCase().includes(q);
    return {
      used: tables.filter((t) => t.usedByCount > 0 && match(t)),
      unused: tables.filter((t) => t.usedByCount === 0 && match(t)),
    };
  }, [tables, query]);

  const renderRows = (rows: readonly RatingMenuTable[]) =>
    rows.map((t) => (
      <button
        key={t.id}
        type="button"
        className="rater-rtmenu__row"
        onClick={() => onSelectTable(t.id)}
        data-testid={`${testId}-table-${t.id}`}
      >
        <span className="rater-rtmenu__name">{t.name}</span>
        <span className="rater-rtmenu__meta">
          {t.shapeLabel}
          {t.usedByCount > 0
            ? ` · used by ${t.usedByCount}`
            : " · unused"}
        </span>
      </button>
    ));

  return (
    <div
      className="rater-rtmenu"
      role="dialog"
      aria-label="Factor tables"
      data-testid={testId}
    >
      <header className="rater-rtmenu__head">
        <span className="rater-rtmenu__title">Factor tables</span>
        <span className="rater-rtmenu__count">{tables.length}</span>
        <IconButton
          aria-label="Close factor tables"
          size="xs"
          variant="ghost"
          onClick={onClose}
          icon={<X size={14} strokeWidth={1.8} />}
          data-testid={`${testId}-close`}
        />
      </header>
      <div className="rater-rtmenu__search">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Find a table…"
          size="sm"
          aria-label="Find a factor table"
          autoFocus
        />
      </div>
      <div className="rater-rtmenu__list">
        {used.length > 0 ? (
          <>
            <div className="rater-rtmenu__group">
              In the sheet · {used.length}
            </div>
            {renderRows(used)}
          </>
        ) : null}
        {unused.length > 0 ? (
          <>
            <div className="rater-rtmenu__group">
              Not in the sheet · {unused.length}
            </div>
            {renderRows(unused)}
          </>
        ) : null}
        {used.length + unused.length === 0 ? (
          <p className="rater-rtmenu__empty">
            {query.trim() === ""
              ? "No factor tables yet — create the first one."
              : `Nothing matches “${query}”.`}
          </p>
        ) : null}
      </div>
      {onNewTable !== undefined ? (
        <button
          type="button"
          className="rater-rtmenu__new"
          onClick={onNewTable}
          data-testid={`${testId}-new`}
        >
          <Plus size={13} strokeWidth={1.8} aria-hidden /> New table
        </button>
      ) : null}
    </div>
  );
}
