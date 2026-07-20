/**
 * Plan templates hooks — TanStack Query wrappers around
 * @openrater/api-client/templates. (D6.4 / ADR-0027.)
 *
 * The gallery UI on `/rate-lab/new` uses `useTemplatesList` + the
 * `useCreatePlanFromTemplate` mutation. Invalidates the plans-list
 * cache on success so the new plan appears wherever a list is
 * mounted (same pattern as `useCreatePlan`).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPlanFromTemplate,
  getTemplate,
  listTemplates,
  type FromTemplateRequest,
  type FromTemplateResponse,
  type ListTemplatesResponse,
  type PlanTemplate,
} from "@openrater/api-client";

import { plansQueryKeys } from "./plans";

export const templatesQueryKeys = {
  all: ["plan-templates"] as const,
  list: () => [...templatesQueryKeys.all, "list"] as const,
  detail: (templateId: string) =>
    [...templatesQueryKeys.all, templateId] as const,
};

/**
 * Fetch the gallery list (cards) — metadata + counts, no recipe blob.
 */
export function useTemplatesList() {
  return useQuery<ListTemplatesResponse>({
    queryKey: templatesQueryKeys.list(),
    queryFn: ({ signal }) => listTemplates({ signal }),
  });
}

/**
 * Fetch a single template with the full recipe — for preview drawers
 * + tests. The gallery doesn't need this; the materializer reads the
 * recipe server-side.
 */
export function useTemplateDetail(templateId: string | undefined) {
  return useQuery<PlanTemplate>({
    queryKey: templateId
      ? templatesQueryKeys.detail(templateId)
      : templatesQueryKeys.detail("__missing__"),
    queryFn: ({ signal }) => {
      if (!templateId) {
        throw new Error("useTemplateDetail: templateId is required");
      }
      return getTemplate(templateId, { signal });
    },
    enabled: Boolean(templateId),
  });
}

/**
 * Create a new plan + materialize all substrates from a template.
 * Invalidates the plans-list cache so the new plan appears in any
 * mounted PlansList without a manual refetch.
 */
export function useCreatePlanFromTemplate() {
  const queryClient = useQueryClient();
  return useMutation<FromTemplateResponse, Error, FromTemplateRequest>({
    mutationFn: (body) => createPlanFromTemplate(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: plansQueryKeys.lists() });
    },
  });
}
