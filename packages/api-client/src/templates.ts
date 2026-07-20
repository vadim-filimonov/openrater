/**
 * Plan templates client (D6.4 / ADR-0027).
 *
 * Three functions:
 *
 *   - listTemplates()                    GET   /api/v1/plan-templates
 *   - getTemplate(templateId)            GET   /api/v1/plan-templates/{id}
 *   - createPlanFromTemplate(body)       POST  /api/v1/plans/from-template
 *
 * The gallery UI on /plans/new uses `listTemplates` for card data and
 * `createPlanFromTemplate` for the submit. `getTemplate` is reserved
 * for preview drawers + tests; the materializer reads the recipe
 * server-side so the gallery never needs the full blob.
 */

import { request } from "./fetcher";
import {
  type FromTemplateRequest,
  type FromTemplateResponse,
  fromTemplateResponseSchema,
  type ListTemplatesResponse,
  listTemplatesResponseSchema,
  type PlanTemplate,
  planTemplateSchema,
} from "./schemas/templates";

export async function listTemplates(
  opts: { signal?: AbortSignal } = {},
): Promise<ListTemplatesResponse> {
  return request({
    method: "GET",
    path: "/api/v1/plan-templates",
    schema: listTemplatesResponseSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

export async function getTemplate(
  templateId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PlanTemplate> {
  return request({
    method: "GET",
    path: `/api/v1/plan-templates/${encodeURIComponent(templateId)}`,
    schema: planTemplateSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/**
 * Create a new plan + materialize every substrate from a template.
 * Returns the new plan id (navigate to it) + a counts envelope
 * (drive a toast).
 */
export async function createPlanFromTemplate(
  body: FromTemplateRequest,
): Promise<FromTemplateResponse> {
  return request({
    method: "POST",
    path: "/api/v1/plans/from-template",
    body,
    schema: fromTemplateResponseSchema,
  });
}
