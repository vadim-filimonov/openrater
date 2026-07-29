/**
 * Class-codes entity client.
 *
 * Wraps the (future) `GET /api/v1/class-codes` endpoint with a typed
 * function + Zod-validated response. Per the M3.4 scoping doc
 * (`docs/API_LAB_SCOPING_M3_4.md`), the backend endpoint lands in
 * slice 3 of the API Lab port. Pre-slice-3, callers use fixture mode
 * (`setFixture("GET", "/api/v1/class-codes", […])`) to satisfy this
 * function.
 *
 * The function exists today so M4.1 (Classification section) can be
 * built against the real api-client surface — no special test code
 * paths. When slice 3 lands, the only change is "drop the fixture";
 * the calling code is unchanged.
 */

import { z } from "zod";
import { request } from "./fetcher";
import {
  type BulkImportClassCodesRequest,
  type BulkImportClassCodesResponse,
  type ClassRecord,
  type ListClassCodesResponse,
  type ListClassesFilter,
  type PlanClassCode,
  type UpsertClassCodeRequest,
  bulkImportClassCodesResponseSchema,
  classRecordSchema,
  listClassCodesResponseSchema,
  planClassCodeSchema,
} from "./schemas/class-codes";

/**
 * Fetch the class library, optionally filtered.
 *
 * Slice 3 will respect the filter on the backend; pre-slice-3, the
 * fixture honors what it wants to honor. Typically the section editor
 * passes `eligible_for: plan.line` to scope to the current LOB.
 */
export async function listClassCodes(
  filter: ListClassesFilter = {},
  opts: { signal?: AbortSignal } = {},
): Promise<ClassRecord[]> {
  return request({
    method: "GET",
    path: "/api/v1/class-codes",
    query: {
      q: filter.q,
      family: filter.family,
      eligible_for: filter.eligible_for,
      limit: filter.limit,
      offset: filter.offset,
    },
    schema: z.array(classRecordSchema),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Brief 51 — the per-plan writable registry. These hit the real backend
// (api-lab plan_class_codes_route.py); NO fixture. The legacy global
// `listClassCodes` above is retired once ClassificationRoute is rewired
// (Brief 51 PR5).
// ---------------------------------------------------------------------------

function planClassCodesBase(ratingPlanId: string): string {
  return `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/class-codes`;
}

/** List every class scoped to the plan, ordered by class_code. */
export async function listPlanClassCodes(
  ratingPlanId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ListClassCodesResponse> {
  return request({
    method: "GET",
    path: planClassCodesBase(ratingPlanId),
    schema: listClassCodesResponseSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/** Create or replace one class. Idempotent on `class_code` (PUT). */
export async function upsertPlanClassCode(
  ratingPlanId: string,
  body: UpsertClassCodeRequest,
): Promise<PlanClassCode> {
  return request({
    method: "PUT",
    path: `${planClassCodesBase(ratingPlanId)}/${encodeURIComponent(body.class_code)}`,
    body,
    schema: planClassCodeSchema,
  });
}

/** Remove one class. 204 on success. */
export async function deletePlanClassCode(
  ratingPlanId: string,
  classCode: string,
): Promise<void> {
  await request({
    method: "DELETE",
    path: `${planClassCodesBase(ratingPlanId)}/${encodeURIComponent(classCode)}`,
    schema: z.void(),
  });
}

/** Import a class table (merge | replace). The acceptance path for
 *  loading a real filing's class_table. */
export async function bulkImportPlanClassCodes(
  ratingPlanId: string,
  body: BulkImportClassCodesRequest,
): Promise<BulkImportClassCodesResponse> {
  return request({
    method: "POST",
    path: `${planClassCodesBase(ratingPlanId)}/bulk`,
    body,
    schema: bulkImportClassCodesResponseSchema,
  });
}
