/**
 * @openrater/api-client — typed SDK for api-lab/backend.
 *
 * One function per endpoint; handles error normalization + Zod-
 * validated responses. Apps consume these through @openrater/hooks
 * (TanStack Query wrappers), never call fetch() directly.
 */

export { getApiBase, setApiBase } from "./config";
export { RaterApiError } from "./error";
export type { RaterApiErrorDetail } from "./error";

// Fixture mode (M4.0) — bridges the M4 section editors while
// API Lab slices 3-15 land. See `fixtures.ts` for the contract.
export {
  clearFixtures,
  disableFixtureMode,
  enableFixtureMode,
  isFixtureModeEnabled,
  setFixture,
  setFixturePattern,
} from "./fixtures";
export type { FixtureValue } from "./fixtures";

// Plans (slice-2 endpoint group)
export {
  listPlans,
  getPlan,
  createPlan,
  duplicatePlan,
  addStage,
  patchStageConfig,
  removeStage,
  discardPlan,
  deletePlan,
} from "./plans";
export type { DuplicatePlanResponse } from "./plans";

// Dimensions (D6.2 / ADR-0027 — plan-scoped dimensions registry)
export {
  listDimensions,
  upsertDimension,
  deleteDimension,
  bulkUpsertDimensions,
} from "./dimensions";
export {
  planDimensionSchema,
  upsertDimensionRequestSchema,
  listDimensionsResponseSchema,
  bulkUpsertDimensionsRequestSchema,
  dimDataTypeSchema,
  dimShapeSchema,
  dimensionTypeSchema,
  derivedFromSchema,
} from "./schemas/dimensions";
export type {
  PlanDimension,
  UpsertDimensionRequest,
  ListDimensionsResponse,
  BulkUpsertDimensionsRequest,
  DimDataType,
  DimShape,
  DimensionType,
  DerivedFrom,
} from "./schemas/dimensions";

// Plan templates (D6.4 / ADR-0027 — gallery + /from-template)
export {
  listTemplates,
  getTemplate,
  createPlanFromTemplate,
} from "./templates";
export {
  planTemplateSummarySchema,
  planTemplateSchema,
  listTemplatesResponseSchema,
  fromTemplateRequestSchema,
  fromTemplateResponseSchema,
  materializedCountsSchema,
} from "./schemas/templates";
export type {
  PlanTemplateSummary,
  PlanTemplate,
  ListTemplatesResponse,
  FromTemplateRequest,
  FromTemplateResponse,
  MaterializedCounts,
} from "./schemas/templates";

// Plan snapshots (Brief 43 / PR 43.1 — Analytics workspace versioning;
// Brief 64 §4 — publishSnapshot promotes a version to Current;
// Brief 84 D-B — goLive is the ONE deploy verb: freeze + publish)
export {
  freezeSnapshot,
  listSnapshots,
  getSnapshot,
  publishSnapshot,
  getPublishStatus,
  goLive,
} from "./snapshots";
export type { PublishStatus, GoLiveRequest, GoLiveResponse } from "./snapshots";

// The Ship zone's API path (Brief 76 / v4 P4): un-persisted quotes +
// the optional per-plan API-key gate.
export { quotePlan } from "./quotes";
export type { QuoteRequestBody, QuoteResponse } from "./quotes";
export { listApiKeys, mintApiKey, revokeApiKey } from "./api-keys";
export type { ApiKeyCreated, ApiKeySummary } from "./api-keys";
export {
  planSnapshotSummarySchema,
  planSnapshotSchema,
  freezeSnapshotRequestSchema,
  listSnapshotsResponseSchema,
} from "./schemas/snapshots";
export type {
  PlanSnapshotSummary,
  PlanSnapshot,
  FreezeSnapshotRequest,
  ListSnapshotsResponse,
} from "./schemas/snapshots";

// Inputs mapping (D6.1 / ADR-0027 — plan-scoped singleton)
export {
  getInputMapping,
  upsertInputMapping,
  deleteInputMapping,
} from "./inputs-mapping";
export {
  inputMappingEnvelopeSchema,
  upsertInputMappingRequestSchema,
} from "./schemas/inputs-mapping";
export type {
  InputMappingEnvelope,
  UpsertInputMappingRequest,
} from "./schemas/inputs-mapping";

// Policy tail (ADR-0055 Option A — plan-scoped singleton)
export {
  getPolicyTail,
  upsertPolicyTail,
  deletePolicyTail,
} from "./policy-tail";
export {
  policyTailEnvelopeSchema,
  upsertPolicyTailRequestSchema,
} from "./schemas/policy-tail";
export type {
  PolicyTailEnvelope,
  UpsertPolicyTailRequest,
} from "./schemas/policy-tail";

// Factor tables (D6.3 / ADR-0027 — plan-scoped FTs + cells registry)
export {
  listFactorTables,
  upsertFactorTable,
  upsertFactorTableCells,
  deleteFactorTable,
  bulkUpsertFactorTables,
} from "./factor-tables";
export {
  planFactorTableSchema,
  upsertFactorTableRequestSchema,
  upsertFactorTableCellsRequestSchema,
  listFactorTablesResponseSchema,
  bulkUpsertFactorTablesRequestSchema,
  draftStatusSchema,
} from "./schemas/factor-tables";
export type {
  PlanFactorTable,
  UpsertFactorTableRequest,
  UpsertFactorTableCellsRequest,
  ListFactorTablesResponse,
  BulkUpsertFactorTablesRequest,
  DraftStatus,
} from "./schemas/factor-tables";

// Class codes.
export { listClassCodes } from "./class-codes";
// Brief 51 — per-plan writable registry client.
export {
  listPlanClassCodes,
  upsertPlanClassCode,
  deletePlanClassCode,
  bulkImportPlanClassCodes,
} from "./class-codes";
export {
  classRecordSchema,
  listClassesFilterSchema,
  planClassCodeSchema,
  upsertClassCodeRequestSchema,
  listClassCodesResponseSchema,
  bulkImportClassCodesRequestSchema,
  bulkImportClassCodesResponseSchema,
} from "./schemas/class-codes";
export type {
  ClassRecord,
  ListClassesFilter,
  PlanClassCode,
  UpsertClassCodeRequest,
  ListClassCodesResponse,
  BulkImportClassCodesRequest,
  BulkImportClassCodesResponse,
} from "./schemas/class-codes";



// Schemas + types
export {
  lineOfBusinessSchema,
  planStatusSchema,
  planSummarySchema,
  stageSummarySchema,
  planDetailSchema,
  createPlanRequestSchema,
  createPlanResponseSchema,
  listPlansFilterSchema,
  addStageRequestSchema,
  addStageResponseSchema,
  stageInputSpecSchema,
  stageOutputSpecSchema,
  stageConfigPatchSchema,
  patchDraftRequestSchema,
  patchDraftResponseSchema,
  removeStageResponseSchema,
  discardPlanResponseSchema,
  deletePlanResponseSchema,
} from "./schemas/plans";

export type {
  LineOfBusiness,
  PlanStatus,
  PlanSummary,
  StageSummary,
  PlanDetail,
  CreatePlanRequest,
  CreatePlanResponse,
  ListPlansFilter,
  AddStageRequest,
  AddStageResponse,
  StageInputSpec,
  StageOutputSpec,
  StageConfigPatch,
  PatchDraftRequest,
  PatchDraftResponse,
  RemoveStageResponse,
  DiscardPlanResponse,
  DeletePlanResponse,
} from "./schemas/plans";



export const PACKAGE_NAME = "@openrater/api-client" as const;

// Plan runs (Brief 75 / v4 P3 — the Run zone's persisted history).
export {
  createPlanRun,
  getPlanRun,
  getPlanRunCompare,
  getPlanRunRows,
  listPlanRuns,
} from "./runs";
export type {
  CreatePlanRunRequest,
  PlanRun,
  PlanRunList,
  PlanRunRow,
  PlanRunRowsPage,
  PlanRunSummary,
  RunCompare,
} from "./runs";


// Brief 92 (ADR-0065) — deterministic workbook ingestion: the check,
// the build, and the persisted build report. Brief 94 §2 adds the
// starter-kit asset URLs.
export {
  bookTemplateUrl,
  buildWorkbookPlan,
  checkWorkbook,
  getBuildReport,
  getEditsSinceBuild,
  ingestAssetUrl,
  listBuildReports,
  reingestApply,
  reingestCheck,
} from "./ingest";
export type {
  BuildReport,
  EditsSinceBuild,
  DriftSummary,
  IngestAssetKind,
  ReingestCheckResult,
  RevisionCandidate,
  BuildWorkbookResponse,
  CheckIssue,
  ManifestCounts,
  VectorCase,
  VectorResult,
  VectorsSummary,
  WorkbookBytes,
  WorkbookCheckResult,
  WorkbookManifest,
} from "./ingest";
