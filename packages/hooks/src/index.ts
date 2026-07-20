/**
 * @openrater/hooks — React composition layer.
 *
 * Exports:
 *   - `RaterQueryProvider`: wraps the app in a TanStack QueryClient
 *     pre-configured with sensible defaults (no aggressive refetching,
 *     5min stale time, retry-once on error, no refetch-on-window-focus
 *     because the Rate Lab actuary works in long deep-focus sessions).
 *   - `queryClient`: the shared QueryClient instance (exported for
 *     manual invalidation outside of components, e.g. from a route
 *     loader).
 *   - Per-entity hooks (`usePlansList`, `usePlanDetail`, `useCreatePlan`,
 *     etc.) compose TanStack Query around `@openrater/api-client` calls.
 *     Each hook owns its query key + cache invalidation policy.
 */

export { RaterQueryProvider, queryClient } from "./query-provider";

// Brief 58 Pillar A — global save-failure surfacing helpers. The
// `MutationCache.onError` floor lives in query-provider; these are the
// pure, reusable pieces (actuary-language mapping + the reporter the
// QueryClient calls).
export { describeApiError } from "./describeApiError";
export type { ApiErrorDescription } from "./describeApiError";
export { reportMutationError, reportMutationSuccess } from "./mutationErrorReporter";
export type { ReportMutationErrorOptions } from "./mutationErrorReporter";

// Plans hooks
export {
  usePlansList,
  usePlanDetail,
  useCreatePlan,
  useAddStage,
  usePatchStageConfig,
  useRemoveStage,
  useDiscardPlan,
  useDeletePlan,
  plansQueryKeys,
} from "./plans";
export type { UseCreatePlanResult } from "./plans";

// Dimensions hooks (D6.2 / ADR-0027 — plan-scoped dimensions registry)
export {
  useDimensionsList,
  useUpsertDimension,
  useDeleteDimension,
  useBulkUpsertDimensions,
  dimensionsQueryKeys,
} from "./dimensions";

// Inputs mapping hooks (D6.1 / ADR-0027 — plan-scoped singleton)
export {
  useInputMapping,
  useUpsertInputMapping,
  useDeleteInputMapping,
  inputMappingQueryKeys,
} from "./inputs-mapping";

// Policy tail hooks (ADR-0055 Option A — plan-scoped singleton)
export {
  usePolicyTailEnvelope,
  useUpsertPolicyTail,
  useDeletePolicyTail,
  policyTailQueryKeys,
} from "./policy-tail";

// Plan templates hooks (D6.4 / ADR-0027 — gallery + /from-template)
export {
  useTemplatesList,
  useTemplateDetail,
  useCreatePlanFromTemplate,
  templatesQueryKeys,
} from "./templates";

// Plan snapshots hooks (Brief 43 / PR 43.1 — Analytics workspace
// versioning + freeze-version dialog on the plan header)
export {
  useSnapshotsList,
  useSnapshotDetail,
  useFreezeSnapshot,
  snapshotsQueryKeys,
} from "./snapshots";

// Factor tables hooks (D6.3 / ADR-0027 — plan-scoped FTs + cells)
export {
  useFactorTablesList,
  useUpsertFactorTable,
  useUpsertFactorTableCells,
  useDeleteFactorTable,
  useBulkUpsertFactorTables,
  factorTablesQueryKeys,
} from "./factor-tables";

// Class-codes hooks (M4.1)
export { useClassCodes, classCodesQueryKeys } from "./class-codes";
// Brief 51 — per-plan writable registry hooks.
export {
  usePlanClassCodes,
  useUpsertClassCode,
  useDeleteClassCode,
  useBulkImportClassCodes,
  planClassCodesQueryKeys,
} from "./class-codes";




export const PACKAGE_NAME = "@openrater/hooks" as const;


// Brief 92 — the workbook build report (null for hand-authored plans).
export {
  useBuildReport,
  buildReportQueryKeys,
  useBuildReports,
  buildReportsQueryKeys,
} from "./ingest";
