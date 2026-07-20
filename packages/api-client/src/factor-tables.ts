/**
 * Plan-scoped factor tables client (D6.3 / ADR-0027).
 *
 * Five functions, one per endpoint under
 * `/api/v1/plans/{rating_plan_id}/factor-tables`:
 *
 *   - listFactorTables(planId)                 GET    /
 *   - upsertFactorTable(planId, body)          POST  /  | PUT /{table_id}
 *   - upsertFactorTableCells(planId, tid, c)   PUT   /{table_id}/cells
 *   - deleteFactorTable(planId, tableId)       DELETE /{table_id}
 *   - bulkUpsertFactorTables(planId, body)     POST  /bulk
 *
 * `upsertFactorTable` defaults to PUT (idempotent on `table_id`). Cells
 * are inlined on the parent FT object — `cells: undefined` on a PUT
 * leaves them alone; `cells: {}` clears them; `cells: {...}` replaces
 * them. Use `upsertFactorTableCells` for cell-only edits without
 * touching metadata (the Parametrize canvas's "Save table" button).
 */

import { z } from "zod";
import { request } from "./fetcher";
import {
  type BulkUpsertFactorTablesRequest,
  type ListFactorTablesResponse,
  listFactorTablesResponseSchema,
  type PlanFactorTable,
  planFactorTableSchema,
  type UpsertFactorTableCellsRequest,
  type UpsertFactorTableRequest,
} from "./schemas/factor-tables";

function plansBase(ratingPlanId: string): string {
  return `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/factor-tables`;
}

export async function listFactorTables(
  ratingPlanId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ListFactorTablesResponse> {
  return request({
    method: "GET",
    path: plansBase(ratingPlanId),
    schema: listFactorTablesResponseSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/**
 * Upsert a single factor table (metadata + optional cells). Uses PUT
 * under the hood — idempotent on `table_id`. Pass `cells: undefined`
 * to leave existing cells alone; `cells: {}` to clear them.
 */
export async function upsertFactorTable(
  ratingPlanId: string,
  body: UpsertFactorTableRequest,
): Promise<PlanFactorTable> {
  return request({
    method: "PUT",
    path: `${plansBase(ratingPlanId)}/${encodeURIComponent(body.table_id)}`,
    body,
    schema: planFactorTableSchema,
  });
}

/**
 * Replace-all the cell map for one FT, atomically. Metadata is
 * untouched. The wire shape is `{ cells: { [cellKey]: number } }`.
 */
export async function upsertFactorTableCells(
  ratingPlanId: string,
  tableId: string,
  body: UpsertFactorTableCellsRequest,
): Promise<PlanFactorTable> {
  return request({
    method: "PUT",
    path: `${plansBase(ratingPlanId)}/${encodeURIComponent(tableId)}/cells`,
    body,
    schema: planFactorTableSchema,
  });
}

export async function deleteFactorTable(
  ratingPlanId: string,
  tableId: string,
): Promise<void> {
  await request({
    method: "DELETE",
    path: `${plansBase(ratingPlanId)}/${encodeURIComponent(tableId)}`,
    schema: z.void(),
  });
}

/**
 * Replace ALL FTs (and their cells) for the plan with the supplied
 * set, atomically. Used by the localStorage → API one-shot migration
 * on first plan open (ADR-0027 §3) and the future `/from-template`
 * endpoint (D6.4).
 */
export async function bulkUpsertFactorTables(
  ratingPlanId: string,
  body: BulkUpsertFactorTablesRequest,
  opts: { ifMatch?: string } = {},
): Promise<ListFactorTablesResponse> {
  return request({
    method: "POST",
    path: `${plansBase(ratingPlanId)}/bulk`,
    body,
    schema: listFactorTablesResponseSchema,
    // v4 G14 — precondition the replace-all on the last-seen
    // collection_hash.
    ...(opts.ifMatch !== undefined
      ? { headers: { "If-Match": opts.ifMatch } }
      : {}),
  });
}
