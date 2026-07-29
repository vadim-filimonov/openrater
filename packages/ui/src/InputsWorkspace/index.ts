/**
 * @openrater/ui/InputsWorkspace — public exports for Brief 38.
 *
 * This directory hosts the Inputs workspace surface introduced in
 * Brief 38: pure modules (auto-recognition algorithms, mismatch
 * detection, mapping coordination) plus React primitives (mapping
 * table, mismatch banner, webhook drawer, scoring preview).
 *
 *   - PR 38.2 — autoMatchColumns + pure types
 *   - PR 38.3 — ColumnMappingTable primitive + applyAutoMatch helper
 *   - PR 38.4 — MismatchBanner + detectMismatches + alias write-back
 *   - PR 38.5+ — webhook drawer, scoring preview, orchestrator
 */

// ── PR 38.2 — Auto-recognition algorithm ────────────────────────
export {
  autoMatchColumns,
  bucketConfidence,
  scoreCandidate,
  // Helpers exported for testing / advanced consumers
  levenshtein,
  nameSimilarity,
  tokenize,
} from "./autoMatch";

export type {
  AutoMatchOptions,
  MatchCandidate,
  MatchDtype,
  RequiredInput,
  SourceColumn,
} from "./autoMatch";

// ── ColumnMappingTable types — the v1 primitive was deleted in the
//    v2 cutover (2026-06-09); these types are reused by the deriver
//    + InputsPanelV2. ─────────────────────────────────────────────
export type {
  RequiredInputCategory,
  RequiredInputEntry,
  MappingFilter,
} from "./ColumnMappingTable";

export {
  applyAutoMatchToMapping,
  deriveMappingStatus,
} from "./applyAutoMatch";
export type {
  ApplyAutoMatchOptions,
  ApplyAutoMatchResult,
  MappingStatus,
} from "./applyAutoMatch";

// ── detectMismatches — the v1 <MismatchBanner> primitive was deleted
//    in the v2 cutover; InputsPanelV2 renders mismatches inline. ───
export {
  detectMismatches,
  hasHardMismatch,
  mismatchedInputIds,
  applyAliasOverride,
  removeAliasOverride,
  appendDimAlias,
} from "./detectMismatches";
export {
  detectDtypeMismatch,
  type DtypeMismatch,
} from "./detectDtypeMismatch";
export type {
  AliasOverrides,
  DetectMismatchesOptions,
  Mismatch,
  MismatchedValue,
  MismatchSuggestion,
} from "./detectMismatches";

// ── Cold-test L22 — out-of-range banded-value detection ─────────
// Scans run-result traces for `derive.band` nodes that flagged a
// value outside every band. The projector clamps these onto the
// nearest band (no more silent factor 1.0); this surfaces the count
// per dim so the ScoringPreviewPane can warn loudly.
export { detectOutOfRange, hasOutOfRange } from "./detectOutOfRange";
export type { OutOfRangeBand } from "./detectOutOfRange";

// ── DataSourcePicker types — the v1 picker/dropzone/summary
//    primitives were deleted in the v2 cutover; SampleDataset +
//    SourceKind are reused (the route + the mapping hooks). ───────
export type {
  SampleDataset,
  SourceKind,
} from "./DataSourcePicker";

export { parseCsv, parseCsvForInputs } from "./parseCsv";
export type {
  CsvParseError,
  CsvParseFailure,
  CsvParseResult,
  CsvParseSuccess,
  CsvParseWarning,
  CsvSourceSnapshot,
  ParseCsvForInputsOptions,
  ParseCsvOptions,
} from "./parseCsv";

// ── Brief 45 K11 — off-main-thread CSV parsing ─────────────────
// Web Worker wrapper around `parseCsvForInputs` so loading a large
// CSV (2k-row cold-test) keeps the main thread responsive. Falls back
// to the synchronous parser when workers are unavailable (SSR/tests).
export { parseCsvForInputsAsync } from "./parseCsvAsync";

// ── projectRows — the v1 <ScoringPreviewPane> was deleted in the v2
//    cutover; InputsPanelV2 scores inline via these projectors. ───
export {
  projectRow,
  projectRows,
  projectRowsToExternalInputs,
} from "./projectRowsForBatch";
export type {
  InputDimMap,
  InputDtypeMap,
  ProjectRowOptions,
  ProjectRowError,
  ProjectedRow,
} from "./projectRowsForBatch";

// ── Brief 45 K8 — derived-ratio (@ratio:num/den) sentinel ──────
export {
  RATIO_PREFIX,
  isRatioMapping,
  parseRatio,
  formatRatio,
  computeRatioForRow,
} from "./ratioMapping";
export type { ParsedRatio } from "./ratioMapping";

// ── FCA #23 — scaled-column (@times:column*multiplier) sentinel ──
// Payroll-in-thousands and its kin: a unit transform expressed
// inside the existing column_map string shape.
export {
  TIMES_PREFIX,
  isTimesMapping,
  parseTimes,
  formatTimes,
  computeTimesForRow,
} from "./timesMapping";
export type { ParsedTimes } from "./timesMapping";

// ── webhook helpers + payload-schema inference — the v1
//    <WebhookConfigDrawer> primitive was deleted in the v2 cutover;
//    WebhookSource (v2) composes these. ──────────────────────────
export {
  emptyWebhookConfig,
  applyAuthToHeaders,
  testWebhookRequest,
} from "./WebhookConfigDrawer";
export type {
  AuthSpec,
  PayloadSchema,
  WebhookConfig,
  WebhookTestResult,
} from "./WebhookConfigDrawer";

export { inferPayloadSchema } from "./inferPayloadSchema";
export type {
  InferPayloadSchemaOptions,
  InferPayloadSchemaResult,
  InferPayloadSchemaWarning,
  PayloadSchemaField,
} from "./inferPayloadSchema";

// ── InputsWorkspace types + helpers — the v1 orchestrator COMPONENT
//    was deleted in the v2 cutover (InputsPanelV2 replaces it); these
//    types + pure helpers are the shared substrate. ───────────────
export {
  deriveBasicRequiredInputs,
  emptyPlanInputMapping,
  autoDetectGrouping,
  suggestRollupFields,
} from "./InputsWorkspace";
export type {
  PlanInputMapping,
  PolicyGroupingConfig,
  RollupFieldSpec,
  ProductModeSpec,
} from "./InputsWorkspace";

// ── PR 11h — Required-inputs derivation (Brief 38 §4.2) ────────
// `RequiredInputCategory` is already exported via ColumnMappingTable
// (PR 38.3); deriveRequiredInputs re-imports + reuses the same union
// so the rail + the deriver speak one type.
export {
  deriveRequiredInputs,
  normalizePath as normalizeRequiredInputPath,
} from "./deriveRequiredInputs";
export type {
  DerivedRequiredInput,
  StageLike as DeriveRequiredInputsStage,
} from "./deriveRequiredInputs";

// ── PR D2a — Stages → runtime Plan projector (real scoring) ────
//
// Compiles authored multiplicative_chain stages + client-side factor
// tables into a runtime Plan that actually computes premiums. Closes
// the gap where Score-all ran only an echo plan (PR 11a) and never
// executed the real chain. The consumer wires this into the Inputs
// workspace so the user sees real premium columns in the trace + CSV.
export {
  stagesToRuntimePlan,
  PROJECTOR_EXECUTED_STAGE_KINDS,
} from "./stagesToRuntimePlan";
export type {
  FactorTableCellsMap,
  ProjectionResult,
  StagesToRuntimePlanOptions,
} from "./stagesToRuntimePlan";
// Brief 48 §3.4 / phase 3 — deterministic representative risk (dim first-levels)
// for scored Verify mode when the plan carries no stored/CSV risk.
export { synthesizeRepresentativeRisk } from "./synthesizeRepresentativeRisk";

// ── G-5 — Chunked batch scoring with progress + yield ───────────
//
// executePlanBatch is synchronous; for 2k+ row batches it blocks
// the main thread for several hundred ms. This wrapper yields
// between chunks of N rows (default 200) so the browser can paint
// progress + respond to input. AbortSignal honored.
export {
  executePlanBatchChunked,
  shouldUseChunkedScoring,
  DEFAULT_CHUNK_SIZE,
} from "./executePlanBatchChunked";
export type {
  BatchProgress,
  ExecutePlanBatchChunkedOptions,
} from "./executePlanBatchChunked";

// ── Brief 49 — Create inputs from CSV columns ───────────────────
//
// Pure transform: a loaded CSV's columns + sample rows → DimensionRow[]
// + the slug→column map. Backs the one-click "Create inputs from these
// columns" CTA in the empty state (QA #1 + #7).
export { buildInputsFromCsvColumns } from "./buildInputsFromCsvColumns";
export type {
  BuildInputsOptions,
  BuildInputsResult,
} from "./buildInputsFromCsvColumns";

// ── Brief 50 — Route match confidence ───────────────────────────
// Pure scoring for the external-lookup review gate (echo_of outputs).
export {
  matchConfidence,
  MATCH_STRONG_THRESHOLD,
  MATCH_PARTIAL_THRESHOLD,
} from "./matchConfidence";
export type {
  MatchConfidence,
  MatchConfidenceLevel,
} from "./matchConfidence";

// (Brief 61's <InputTable> was deleted in the v2 cutover — InputsPanelV2's
//  DictionaryTable is the unified schema+binding surface now.)

// Brief 62.3 — apply the plan's Final-adjustments tail to a scored cohort
// (the per-row filed premium + build-up trace). The live mount + render
// are 62.4; this is the pure path.
export { applyCohortPolicyTail } from "./cohortPolicyTail";
export type { CohortRowTail, ApplyCohortPolicyTailArgs } from "./cohortPolicyTail";

// P2 G4 (ADR-0056) — policy-book config extraction, lifted from
// rate-lab so the scoring service composes the filed premium through
// the SAME code path the browser uses.
export {
  policyBookConfigFromPlan,
  policyAggregateFields,
  keyedRowsFromBook,
  planMinimumPremium,
  appendPlanFloor,
  PLAN_MIN_PREMIUM_STEP_ID,
  POLICY_LOCATION_COUNT,
  // Brief 80 (finding E7) — the one plan-total resolver + the named
  // composition issues.
  planTotalOutputField,
  collectCompositionIssues,
} from "./policyBookConfig";
export type {
  AuthoredRollupField,
  AuthoredGrouping,
} from "./policyBookConfig";
