/**
 * Factor tables sync layer — D6.3 / ADR-0027.
 *
 * Bridges the API-backed `PlanFactorTable` (metadata + inlined cells)
 * with the legacy two-store UI state in `PlanDetailRoute`:
 *   · `editedFactorTables`        — list of `FactorTableRow` metadata
 *   · `editedFactorTableCells`    — `Map<ftId, Map<cellKey, number>>`
 *
 * The split exists in the UI because Brief 33's Parametrize canvas
 * mutates cells without touching metadata + vice versa. The API
 * exposes a unified `PlanFactorTable` per FT; the adapters here
 * split it back into the two UI shapes on read and recombine on
 * write.
 *
 * See `dimensionsSync.ts` for the sister module + the rationale for
 * keeping the adapter outside `PlanDetailRoute.tsx`.
 */

import type {
  PlanFactorTable,
  UpsertFactorTableRequest,
} from "@openrater/api-client";
import type { FactorTableRow } from "@openrater/ui";

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * API `PlanFactorTable` → UI `FactorTableRow` metadata. Drops the
 * inlined cells (those flow into the cell-map state separately) and
 * the lifecycle columns.
 */
export function planFactorTableToRow(pf: PlanFactorTable): FactorTableRow {
  const row: Record<string, unknown> = {
    id: pf.table_id,
    display_name: pf.display_name,
    slug: pf.slug,
  };
  if (pf.description !== undefined && pf.description !== null) {
    row.description = pf.description;
  }
  // The legacy UI shape supports both `key_dimension` (1-D) and
  // `key_dimensions[]` (2-D+). We always populate the array; 1-D
  // consumers that read `key_dimension` get the first slug as a
  // convenience.
  if (pf.key_dimensions.length > 0) {
    row.key_dimensions = [...pf.key_dimensions];
    if (pf.key_dimensions.length === 1) {
      row.key_dimension = pf.key_dimensions[0];
    }
  }
  if (pf.draft_status !== undefined && pf.draft_status !== null) {
    row.draft_status = pf.draft_status;
  }
  if (pf.source_pdf_url !== undefined && pf.source_pdf_url !== null) {
    row.source_pdf_url = pf.source_pdf_url;
  }
  if (pf.source_page !== undefined && pf.source_page !== null) {
    row.source_page = pf.source_page;
  }
  // ADR-0063 — carry the linear-interpolation flag through so the
  // projector (`stagesToRuntimePlan`) can emit `lookup.multi.interpolateOn`.
  if (pf.interpolation !== undefined && pf.interpolation !== null) {
    row.interpolation = pf.interpolation;
  }
  return row as unknown as FactorTableRow;
}

/**
 * Project the cells of every API FT into the
 * `Map<ftId, Map<cellKey, number>>` shape the UI consumes.
 */
export function planFactorTablesToCellMap(
  tables: readonly PlanFactorTable[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const t of tables) {
    const inner = new Map<string, number>();
    for (const [key, value] of Object.entries(t.cells)) {
      inner.set(key, value);
    }
    out.set(t.table_id, inner);
  }
  return out;
}

/**
 * UI `FactorTableRow` (+ optional cells from the sidecar map) →
 * API `UpsertFactorTableRequest`. Cells are passed through verbatim
 * when supplied; pass `undefined` to leave existing cells alone
 * server-side (use that on metadata-only edits).
 */
export function factorTableRowToUpsertRequest(
  row: FactorTableRow,
  cells: Map<string, number> | undefined,
): UpsertFactorTableRequest {
  // The UI accepts either `key_dimension` (1-D legacy) or
  // `key_dimensions` (multi-D); normalize both into the
  // server's `key_dimensions: string[]`.
  const legacyKey = (row as { readonly key_dimension?: string })
    .key_dimension;
  const keyDimensions: string[] =
    row.key_dimensions !== undefined
      ? [...row.key_dimensions]
      : legacyKey
        ? [legacyKey]
        : [];

  const req: Record<string, unknown> = {
    table_id: row.id,
    display_name: row.display_name || row.id,
    slug: row.slug || row.id,
    key_dimensions: keyDimensions,
  };
  if (row.description !== undefined) req.description = row.description;
  if (row.draft_status !== undefined) req.draft_status = row.draft_status;
  if (row.source_pdf_url !== undefined) req.source_pdf_url = row.source_pdf_url;
  if (row.source_page !== undefined) req.source_page = row.source_page;
  if (cells !== undefined) {
    req.cells = Object.fromEntries(cells.entries());
  }
  // ADR-0063 — persist the interpolation flag on write-back. Absent =
  // leave the stored flag untouched (matches the cells convention).
  if (row.interpolation !== undefined) req.interpolation = row.interpolation;
  return req as UpsertFactorTableRequest;
}

/**
 * Bulk converter — for the localStorage → API one-shot migration
 * (ADR-0027 §3) and the steady-state debounced write.
 *
 * Pairs each FT metadata row with its cells (if present) and emits
 * the bulk request shape the server consumes.
 */
export function factorTablesToBulkRequest(
  tables: readonly FactorTableRow[],
  cellsByFt: ReadonlyMap<string, ReadonlyMap<string, number>>,
): { factor_tables: UpsertFactorTableRequest[] } {
  return {
    factor_tables: tables.map((row) => {
      const cells = cellsByFt.get(row.id);
      return factorTableRowToUpsertRequest(
        row,
        cells ? new Map(cells) : new Map(),
      );
    }),
  };
}
