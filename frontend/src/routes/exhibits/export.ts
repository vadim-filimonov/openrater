/**
 * Exhibits — table rows + CSV export (current Exhibits design,
 * P4 polish).
 *
 * The expanded tile shows the exact numbers the drawing summarizes —
 * one row per level (or per 2-D cell), with the B side and its Δ% in
 * compare mode — and exports the same rows as CSV, byte-for-byte what
 * the table shows. Pure functions; the route renders and downloads.
 */

import type { PlanFactorTable } from "@openrater/api-client";
import type { ExhibitTile, LevelValue } from "./anatomy";
import { orderedLevelValues } from "./anatomy";
import { parseGridKey } from "./gridKey";

export interface TileRow {
  readonly id: string;
  readonly label: string;
  readonly a: number;
  readonly b: number | null;
  /** (b/a − 1) · 100; null when unchanged, absent, or a = 0. */
  readonly deltaPct: number | null;
}

function toRow(
  id: string,
  label: string,
  a: number,
  b: number | undefined,
  compare: boolean,
): TileRow {
  if (!compare || b === undefined) {
    return { id, label, a, b: compare ? null : null, deltaPct: null };
  }
  const changed = Math.abs(b - a) > 1e-9;
  return {
    id,
    label,
    a,
    b,
    deltaPct: changed && a !== 0 ? (b / a - 1) * 100 : null,
  };
}

/**
 * The expanded tile's rows, in the SAME order the drawing uses
 * (value-desc for strips, filed order otherwise) so the eye maps
 * bar → row without translating.
 */
export function tileRows(
  tile: ExhibitTile,
  drawnValues: readonly LevelValue[],
  bTable: PlanFactorTable | null,
): readonly TileRow[] {
  const compare = bTable !== null;
  if (tile.kind === "grid" || tile.kind === "flat" || tile.dim === null) {
    // 2-D / flat tables: one row per cell key, filed (insertion) order.
    return Object.entries(tile.table.cells).map(([key, a]) => {
      const pair = parseGridKey(key);
      const label = pair === null ? key : `${pair[0]} × ${pair[1]}`;
      return toRow(key, label, a, bTable?.cells[key], compare);
    });
  }
  const bValues =
    bTable === null || tile.dim === null
      ? null
      : new Map(
          orderedLevelValues(bTable, tile.dim).map(
            (v) => [v.id, v.value] as const,
          ),
        );
  return drawnValues.map((v) =>
    toRow(v.id, v.label, v.value, bValues?.get(v.id), compare),
  );
}

/** One RFC-4180-enough field: quote when it carries , " or newline. */
function csvField(raw: string): string {
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvLine(fields: readonly (string | number | null)[]): string {
  return fields
    .map((f) => (f === null ? "" : csvField(String(f))))
    .join(",");
}

/** The expanded tile's rows as CSV — exactly what the table shows. */
export function tileCsv(
  tableSlug: string,
  rows: readonly TileRow[],
  compare: boolean,
): string {
  const head = compare
    ? ["table", "level_id", "label", "factor_a", "factor_b", "delta_pct"]
    : ["table", "level_id", "label", "factor"];
  const lines = rows.map((r) =>
    compare
      ? csvLine([
          tableSlug,
          r.id,
          r.label,
          r.a,
          r.b,
          r.deltaPct === null ? null : r.deltaPct.toFixed(2),
        ])
      : csvLine([tableSlug, r.id, r.label, r.a]),
  );
  return [csvLine(head), ...lines].join("\n") + "\n";
}

/** Every table on the wall, one CSV — the footer's "download all". */
export function wallCsv(
  entries: readonly {
    readonly slug: string;
    readonly rows: readonly TileRow[];
  }[],
  compare: boolean,
): string {
  const head = compare
    ? ["table", "level_id", "label", "factor_a", "factor_b", "delta_pct"]
    : ["table", "level_id", "label", "factor"];
  const lines = entries.flatMap((e) =>
    e.rows.map((r) =>
      compare
        ? csvLine([
            e.slug,
            r.id,
            r.label,
            r.a,
            r.b,
            r.deltaPct === null ? null : r.deltaPct.toFixed(2),
          ])
        : csvLine([e.slug, r.id, r.label, r.a]),
    ),
  );
  return [csvLine(head), ...lines].join("\n") + "\n";
}

/** Trigger a client-side download (a Blob + a transient anchor). */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
