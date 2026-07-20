/**
 * @openrater/contracts — public API surface.
 *
 * Pure types + pure functions. No React, no DOM, no I/O, no runtime
 * deps. Consumed by Rate Lab UI, the cascade engine, integrators, and
 * the OSS conformance suite.
 */

// ── Spine — the 14-section structure every Plan organizes into ──
//
// As of sub-brief 24.B (Brief 24 v3 §2) the 14 sections fold into
// user-facing workspaces. 24.F2 added "inputs" as a top-level
// workspace + adopted the tab layout: INPUTS / DIMENSIONS /
// PARAMETRIZE / GATE / ASSEMBLE / VERIFY.
export {
  PLAN_SECTIONS,
  PLAN_SECTION_COUNT,
  PLAN_SECTIONS_BY_ID,
  PLAN_SECTIONS_BY_WORKSPACE,
  WORKSPACE_LABELS,
  WORKSPACE_DESCRIPTIONS,
  WORKSPACE_ORDER,
  AUTHORING_WORKSPACES,
  DEFAULT_WORKSPACE,
  isPlanBuilderWorkspace,
} from "./spine";
export type { Section, SectionScope, PlanBuilderWorkspace } from "./spine";

export { SECTION_FLOW, sectionsFeedingInto } from "./section-flow";

// ── Brief 84 — THE one derived headline status (Draft / Live / Archived) ──
export { derivePlanStatus } from "./plan-status";
export type { DerivedPlanStatus, PlanStatusSource } from "./plan-status";

// ── Plan format v0 — the JSON shape that flows between systems ──
export type {
  PlanNode,
  PlanEdge,
  PlanTestCase,
  PlanCitation,
  Plan,
  CompiledPlan,
  RunResult,
  RunOptions,
  TraceEntry,
  CompileError,
} from "./plan-types";

// ── Structured plan issues + unknown-key policy (ADR-0056, Law 2) ──
// ProjectionIssue = plan-shaped (projection/compile time); RowIssue =
// row-shaped (run time). Distinct from the Brief-9 `PlanIssue`
// (reference integrity) + Brief-13 `Issue` (unified panel), which
// these species FEED via adapters.
export type {
  UnknownKeyPolicyMode,
  OnMissPolicy,
  ProjectionIssue,
  ProjectionIssueCode,
  RowIssue,
  RowIssueCode,
  RowIssueDetail,
  RowIssueSeed,
} from "./plan-issues";
export {
  RowIssueError,
  resolveLookupMiss,
  lookupMissSeed,
} from "./plan-issues";

// ── Line of business (LOB) vocabulary ──
// The closed `LineCode` vocabulary (Brief 17 multi-LOB) was DELETED in the
// ADR-0033 axis cleanup: products → `ProductCode` (below), coverages →
// typed `Coverage` / opaque coverage tags. Multi-product is now Policy
// composition (ADR-0034). No replacement export — consumers carry opaque
// `product` / `coverage_id` strings the engine never branches on (§0).

// ── Product axis — ADR-0033 §1 (replaces the product half of LineCode) ─
export type { ProductCode } from "./product-types";
export {
  PRODUCT_CODES,
  PRODUCT_LABELS,
  PRODUCT_DESCRIPTIONS,
  isProductCode,
} from "./product-types";

// ── Coverage axis — ADR-0033 §2 (typed coverage grant within a product) ─
export type { Coverage } from "./coverage-types";
export {
  isCoverage,
  validateCoverages,
  coveragesForProduct,
} from "./coverage-types";

// ── Policy composition — ADR-0034 (the layer above a Plan) ─────
// Data shapes (§1/§2) + the pure, product-blind composePolicy algorithm
// (gate 7). composePolicy runs N product Plans and sums them; it never
// branches on a product (Genericity invariant, ADR-0033 §0).
export type {
  PlanRef,
  PolicyLine,
  Policy,
  PolicyLineResult,
  PolicyResult,
} from "./policy-types";
export { isPolicy, effectivePolicyTail } from "./policy-types";
// Policy-level adjustments — the ordered post-aggregation tail (Brief 62 /
// ADR-0042). Source-blind: the composer reads a `literal` or asks the
// injected resolver; it never branches on `source.from` or a product.
export type {
  GuardExpr,
  IrpmSourceSpec,
  AdjustmentKind,
  EndorsementEffect,
  PolicyAdjustment,
  AdjustmentProvenance,
  AdjustmentStep,
} from "./policy-adjustments";
export {
  isGuardExpr,
  isIrpmSourceSpec,
  isPolicyAdjustment,
} from "./policy-adjustments";
// The shared per-row IRPM/adjustment-source resolver (Brief 62.2). Pure;
// the cap binds in composePolicy, not here. `IrpmSourceSpec` itself is
// exported above (via the policy-adjustments re-export).
export type {
  IrpmResolveCtx,
  ConnectorEvaluation,
  ConnectorEvaluator,
} from "./irpm-source";
export {
  resolveIrpmSource,
  makeIrpmAdjustmentResolver,
  MODEL_SOURCE_RETIRED_MESSAGE,
} from "./irpm-source";
export type {
  ResolvedPolicyLine,
  ResolvedAdjustmentValue,
  AdjustmentResolver,
  ComposePolicyOptions,
  PolicyTailResult,
} from "./policy-compose";
export { composePolicy, evaluatePolicyTail } from "./policy-compose";

// ── Multi-location → policy roll-up — E08 (foundational primitive) ──
// Group rated location rows by `policy_id`, reduce declared fields (default
// `sum` for premium + TIV). Runs BEFORE the policy-level appetite gate (E03)
// so the gate sees the policy total. Pure + deterministic.
export type {
  RollupReducer,
  RollupField,
  BookRow,
  LocationValue,
  PolicyRollup,
  KeyedRiskRow,
} from "./policy-rollup";
export {
  ROLLUP_REDUCERS,
  reduceRollup,
  rollUpBook,
  rateAndRollUp,
} from "./policy-rollup";

// ── Exposure base vocabulary — Brief 16 class-conditional exposure ─
export type {
  ExposureBaseCode,
  ExposureBaseDeclaration,
} from "./exposure-types";
export {
  EXPOSURE_BASE_CODES,
  EXPOSURE_BASE_LABELS,
  EXPOSURE_BASE_DEFAULT_UNIT,
  EXPOSURE_BASE_DESCRIPTIONS,
  EXPOSURE_INPUT_KEYS,
  slugifyCustomLabel,
  exposureInputKey,
  isExposureBaseCode,
  pickExposureDeclaration,
  validateExposureDeclarations,
} from "./exposure-types";

// ── Class library — runtime handle for input.class_exposure (Brief 16) ─
export type { ClassLibrary, ClassLibraryEntry } from "./class-library-types";
export { makeClassLibrary } from "./class-library-types";

// ── Class record — UI-facing class-library aggregate (M4.1) ─────
export type { ClassRecord, ListClassesFilter } from "./class-record-types";
export { classRecordToLibraryEntry } from "./class-record-types";

// ── Eligibility tier vocabulary — Brief 10 ─────────────────────
export type { EligibilityTier, EligibilityOp } from "./tier-types";
export {
  ELIGIBILITY_TIERS,
  ELIGIBILITY_TIER_LABELS,
  ELIGIBILITY_TIER_DESCRIPTIONS,
  ELIGIBILITY_OPS,
  isEligibilityTier,
  evaluateEligibilityComparator,
} from "./tier-types";

// ── Policy-level + computed-field appetite — E03 (foundational) ──
// (a) computed gate field (arithmetic over inputs), (b) a policy-level gate
// evaluated against the E08 roll-up totals, (c) most-restrictive-wins tier
// precedence across per-row + policy verdicts. Pure + deterministic.
export type {
  ComputedExpr,
  ComputedField,
  AppetiteVerdict,
  ScopedVerdict,
  PolicyAppetiteDecision,
} from "./policy-appetite";
export {
  evaluateComputedExpr,
  evaluateComputedFields,
  validateComputedExpr,
  formatComputedExpr,
  evaluateAppetiteRules,
  mostRestrictiveTier,
  decidePolicyAppetite,
} from "./policy-appetite";
// The multi-location policy pipeline orchestrator (E08 + E03; brief §3):
// derive → rate → roll-up → policy gates → precedence. Pure.
export type {
  PolicyGateSpec,
  PolicyBookConfig,
  PolicyBookResult,
} from "./policy-book";
export { evaluatePolicyBook } from "./policy-book";

// ── Schedule rating shapes — Brief 15 ──────────────────────────
export type {
  Schedule,
  ScheduleCategory,
  ScheduleApplication,
  ScheduleApplicationEntry,
  ScheduleApplicationSource,
  AppliedScheduleCategory,
} from "./schedule-types";
export { SCHEDULE_APPLICATION_SOURCES } from "./schedule-types";

// ── UW Report shapes — Brief 7 ─────────────────────────────────
export type {
  UwReport,
  UwAdjustment,
  UwReportSource,
  AppliedReportAdjustment,
} from "./report-types";
export { isUwReport } from "./report-types";

// ── Unified error surface — Brief 13 ────────────────────────────
export type {
  IssueSeverity,
  IssueSource,
  IssueLocation,
  IssueFixHint,
  Issue,
  IssueSeverityCounts,
  FilingReadiness,
  CollectIssuesInput,
  ConformanceVectorResult,
} from "./issues";
export {
  ISSUE_SEVERITIES,
  ISSUE_SOURCES,
  deriveIssueId,
  rankIssues,
  countSeverities,
  filingReadiness,
  defaultFilingBlocking,
  collectIssues,
} from "./issues";

// ── Diff library — Brief 12 (Comparison primitive) ─────────────
export {
  diffPlans,
  diffRuns,
  diffTraces,
  diffValue,
  canonicalNodes,
  canonicalEdges,
  edgeKey,
  canonicalObjectKeys,
  unionKeys,
  unionIds,
  nodesById,
  PLAN_TOP_KEYS,
} from "./diff";
export type {
  DiffState,
  DiffNode,
  DiffSummary,
  DiffSide,
  DiffDeeplink,
  RateImpact,
  PlanDiff,
  TraceDiff,
  RunDiff,
} from "./diff";

// ── Block contract — pure half (runtime types, no React) ────────
export {
  isPrimitiveType,
  primitiveOf,
  isCompatible,
} from "./block-types";
export type {
  PrimitiveType,
  TypeRef,
  PortSpec,
  BlockCategory,
  BlockState,
  BlockSize,
  ValidationIssue,
  ValidationResult,
  Jacobian,
  BlockKind,
  ExecuteContext,
} from "./block-types";

// ── Block kind registry ─────────────────────────────────────────
export {
  KindRegistry,
  globalRegistry,
  registerBlockKind,
  getBlockKind,
  listBlockKinds,
  listBlockKindsByCategory,
  findKindsAcceptingType,
  _clearRegistryForTests,
} from "./registry";

// ── Runtime — compile + run + batch ─────────────────────────────
export {
  compilePlan,
  runPlan,
  executePlan,
  runPlanBatch,
  executePlanBatch,
  resolveEligibilityTier,
  PlanCompileError,
  // Phase F (2026-07-17) — the one seam that types a wire record onto
  // the plan's declared input ports (gates + tail guards read it too).
  coercePlanExternalInputs,
  // Brief 95 C4 — the reserved execution-guard port (election skips).
  GUARD_PORT,
} from "./runtime";

// ── Validation — authoring-time error surfacing ─────────────────
export {
  validatePlanReferences,
  EMPTY_PLAN_SNAPSHOT,
} from "./validation";
export type {
  PlanIssue,
  PlanValidationReport,
  ChainSnapshot,
  FactorTableSnapshot,
  DimensionSnapshot,
  SourceSnapshot,
  PlanEntitiesSnapshot,
} from "./validation";

// ── Brief 19 Curves REMOVED in Brief 34 PR 34.7. ────────────────
//
// curve-interp, curve-forms, curve-presets, curve-fit, curve-
// validation are all gone. Brief 34's <FactorTableViz> supersedes
// the curve concept: a 1-D banded factor table renders via
// <LineChart> (PR 34.1) and that IS the curve visualization.

// ── Territory shapes (Brief 20 §6 — Territory map) ─────────────
//
// Authoring-time types for territory schemas. State-scoped (V1).
// Boundary modes: zip_set / fips_set / polygon. Pure types + format
// validators + small boundary-enumeration helpers. No MapLibre — the
// @openrater/ui consumer handles rendering.
export {
  enumerateFipsFromBoundary,
  enumerateZipsFromBoundary,
  isBoundaryNonEmpty,
  isValidFipsFormat,
  isValidZipFormat,
  normalizeStateCode,
} from "./territory-types";
export type {
  GeoJsonFeature,
  Territory,
  TerritoryBoundary,
  TerritoryHistoryEvent,
  TerritoryMetadata,
  TerritorySchema,
  TerritorySchemaMetadata,
  TerritoryStats,
} from "./territory-types";

// ── Territory coverage diagnostics (Brief 20 P-TM3) ────────────
//
// Pure functions to compute gaps / overlaps / per-territory stats
// from a schema + a GeoCatalog. The catalog is supplied by the
// caller (route) so this package doesn't ship megabyte-scale geo
// data.
export {
  computeCoverage,
  emptyGeoCatalog,
} from "./territory-coverage";
export type {
  CoverageReport,
  GeoCatalog,
  OverlapEntry,
} from "./territory-coverage";

// ── Territory validation (Brief 20 §6) ─────────────────────────
//
// Pure validator returning Brief 13 Issue[] for territory_code,
// factor, state, boundary format + emptiness, citation. Coverage-
// level rules (gaps / overlaps) live in territory-coverage.ts.
export { validateTerritorySchema } from "./territory-validation";

// ── Input dictionary (Brief 52) ────────────────────────────────
//
// Pure pre-flight validation of externalInputs against a plan's
// declared inputs (the set of input.source / input_node configs).
// Drives the scoring preview + the Gate's honest readiness status.
export { validateExternalInputs } from "./input-dictionary";
export type {
  InputIssue,
  InputIssueCode,
  InputDictionaryEntry,
} from "./input-dictionary";

// ── Territory CSV schema (Brief 20 P-TM6 + ADR-0017) ───────────
//
// ZIP-to-territory CSV (one row per ZIP). The import path uses
// groupByTerritoryCode to fold flat rows into Territory[] shape +
// surfaces factor conflicts before commit (no silent imports).
export {
  TERRITORY_CSV_SCHEMA,
  groupByTerritoryCode,
} from "./territory-csv";
export type {
  FactorConflict,
  GroupedResult,
  GroupedTerritory,
  TerritoryCsvRow,
} from "./territory-csv";

// ── Class vocabulary library (Brief 21 §6) ─────────────────────
//
// Cross-vocabulary class translation. Ships the Meridian BOP
// reference table (fictional) + the public NAICS-2022 / SIC-1987
// vocabularies + a proprietary slot for runtime registration. translateClass returns ALL matches with explicit
// confidence (high/medium/low) + crosswalk citation. Pure +
// deterministic; per Brief 21 P-CT2 no inference / no ML.
export {
  getClassEntry,
  getVocabulary,
  listVocabularies,
  registerProprietaryVocabulary,
  translateClass,
  translateClassBatch,
  unregisterProprietaryVocabulary,
  vocabIdEquals,
  vocabIdKey,
} from "./class-vocab";
export type {
  BulkTranslationResult,
  ClassEntry,
  ClassEntryRef,
  ClassMatch,
  MatchConfidence,
  ProprietaryCrosswalkEdge,
  VocabId,
  Vocabulary,
} from "./class-vocab";

// ── V1 block kinds — pure execute() implementations ─────────────
export {
  ConstantKind,
  MathOpKind,
  executeMath,
  InputKind,
  InputSourceKind,
  OutputKind,
  DirectLookupKind,
  RangeLookupKind,
  ClassificationLookupKind,
  MultiLookupKind,
  TerritoryLookupKind,
  ChainMultKind,
  ChainAddKind,
  PredicateKind,
  evaluatePredicate,
  RangeCheckKind,
  BranchKind,
  GlmModelKind,
  RatingModelKind,
  SubplanKind,
  UnknownKind,
  // M1.2 Phase B additions
  InputClassExposureKind,
  ChainLobSumKind,
  // Brief 35 PR 35.1 — Assemble
  ChainDimSumKind,
  DEFAULT_DIM_SUM_OUTPUT_FIELD,
  // M1.3 Phase B additions
  EligibilityGateKind,
  // Brief 81 (finding E8) — THE rule matcher + the conditions view.
  eligibilityRuleMatches,
  ruleConditions,
  ModifierScheduleKind,
  // M1.4 Phase B additions
  UwReportKind,
  ChainFromReportKind,
  registerBuiltinKinds,
} from "./kinds";
export type {
  ConstantParams,
  ConstantInputs,
  ConstantOutputs,
  MathOp,
  MathOpParams,
  MathOpInputs,
  MathOpOutputs,
  InputParams,
  InputInputs,
  InputOutputs,
  InputSourceParams,
  InputSourceInputs,
  InputSourceOutputs,
  InputSourceSourceType,
  OutputParams,
  OutputInputs,
  OutputOutputs,
  DirectLookupParams,
  DirectLookupInputs,
  DirectLookupOutputs,
  RangeBucket,
  RangeLookupParams,
  RangeLookupInputs,
  RangeLookupOutputs,
  ClassificationLookupParams,
  ClassificationLookupInputs,
  ClassificationLookupOutputs,
  MultiLookupRow,
  MultiLookupParams,
  MultiLookupInputs,
  MultiLookupOutputs,
  TerritoryRates,
  SnapshottedTerritory,
  TerritoryLookupParams,
  TerritoryLookupInputs,
  TerritoryLookupOutputs,
  ChainMultParams,
  ChainMultInputs,
  ChainMultOutputs,
  ChainAddParams,
  ChainAddInputs,
  ChainAddOutputs,
  PredicateOp,
  PredicateParams,
  PredicateInputs,
  PredicateOutputs,
  RangeCheckParams,
  RangeCheckInputs,
  RangeCheckOutputs,
  BranchParams,
  BranchInputs,
  BranchOutputs,
  GlmModelParams,
  GlmModelInputs,
  GlmModelOutputs,
  RatingModelParams,
  RatingModelInputs,
  RatingModelOutputs,
  SubplanParams,
  SubplanInputs,
  SubplanOutputs,
  UnknownParams,
  UnknownInputs,
  UnknownOutputs,
  // M1.2 Phase B additions
  InputClassExposureParams,
  InputClassExposureInputs,
  InputClassExposureOutputs,
  ChainLobSumParams,
  ChainLobSumInputs,
  ChainLobSumOutputs,
  // Brief 35 PR 35.1 — Assemble
  ChainDimSumParams,
  ChainDimSumInputs,
  ChainDimSumOutputs,
  // M1.3 Phase B additions
  EligibilityGateParams,
  EligibilityGateInputs,
  EligibilityGateOutputs,
  EligibilityRule,
  // Brief 81 (finding E8) — the compound rule shapes.
  EligibilityCondition,
  SingleConditionEligibilityRule,
  CompoundEligibilityRule,
  ModifierScheduleParams,
  ModifierScheduleInputs,
  ModifierScheduleOutputs,
  // M1.4 Phase B additions
  UwReportParams,
  UwReportInputs,
  UwReportOutputs,
  ChainFromReportParams,
  ChainFromReportInputs,
  ChainFromReportOutputs,
} from "./kinds";

// ── CSV roundtrip library — ADR-0017 ──
//
// Shared by Briefs 6, 18, 19, 20, 21, 22. RFC-4180 strict +
// deterministic byte-stable output + 5-state ImportDiff<T>.
export {
  encodeCsv,
  decodeCsv,
  quoteIfNeeded,
  formatNumber,
  computeDiff,
  emptyDiff,
  summarizeDiff,
  parseRequiredString,
  parseOptionalString,
  parseRequiredNumber,
  parseOptionalNumber,
  parsePositiveNumber,
  parseNonNegativeNumber,
  parseInteger,
  parseEnum,
  // Shared name matching and header preflight.
  normalizeIdent,
  tokenize,
  levenshtein,
  nameSimilarity,
  preflightBook,
  preflightHeader,
  composePreflightSentence,
  sniffDelimiter,
  headerLineOf,
} from "./csv";
export type {
  BookPreflight,
  PreflightInput,
  PreflightMatch,
  PreflightSuggestion,
  ImportDiffState,
  ImportMode,
  ImportDiff,
  ImportDiffChange,
  ImportDiffFieldChange,
  ImportDiffIgnored,
  ParseResult,
  ParseError,
  ParseWarning,
  ColumnSpec,
  CsvSchema,
  ComputeDiffOptions,
  DiffSummary as CsvDiffSummary,
} from "./csv";

// ── Factor-table validation (M5.1.8 / Brief 18 P-FT2 + §6) ─────
export {
  validateFactorTableRows,
  FACTOR_TABLE_DEFAULT_KEY,
} from "./factor-table-validation";
export type {
  FactorTableValidationRow,
  ValidateFactorTableInput,
} from "./factor-table-validation";

// ── Chain config wire shapes (M4.3.8a) ──
//
// Mirrors the Pydantic models in server/src/openrater/rates/plans/configs.py.
// These are substrate-level invariants
// (config_json shape) that the runtime enforces — not endpoint
// request/response shapes (which stay in @openrater/api-client).
export {
  dimensionBindingSchema,
  factorPredicateSchema,
  factorLookupMethodSchema,
  factorLookupSchema,
  lcmApplicationSchema,
  chainSpecSchema,
  multiplicativeChainConfigSchema,
  flatFactorConfigSchema,
  formulaConfigSchema,
} from "./chain-configs";
export type {
  DimensionBinding,
  FactorPredicate,
  FactorLookupMethod,
  FactorLookup,
  LcmApplication,
  ChainSpec,
  MultiplicativeChainConfig,
  FlatFactorConfig,
  FormulaConfig,
} from "./chain-configs";

// ── Pure GLM math (Plan Format Spec v1 §4.5) ────────────────────────
//
// The deterministic core the `model.glm` kind evaluates inline
// coefficients through. The Model Lab artifact seam (registry, format
// adapters, evaluators, score-bands, gate model sources, factor-table
// export) is retired; external scores enter plans as typed inputs.
export type {
  ModelPrediction,
  GlmLink,
  GlmCoeffSpec,
  GlmTransform,
  GlmBucket,
} from "./glm-math";
export {
  applyGlmLink,
  applyGlmTransform,
  applyCategoricalTransform,
  evaluateGlm,
} from "./glm-math";

// ── Dimension contract (sub-brief 24.A + 24.A2 — canonical Dimension + subtypes) ─
//
// The single source of truth for what a Dimension is. Used by the
// DIMENSIONS workspace (sub-brief 24.C), the PARAMETRIZE workspace
// (24.D), and every UI consumer that touches dimensions.
//
// Two discriminators:
//   • `role` — rating-input | structural | both. Bindable from
//     policy data, or used as a static axis in multi-dim tables.
//   • `dimension_type` (24.A2) — standard | geographic | classification.
//     Drives which editor pane the DIMENSIONS workspace opens.
//
// Both fields are UI hints. The engine ignores them (chained
// lookups operate the same regardless).
export type {
  Dimension,
  DimensionRole,
  DimensionDataType,
  DimensionType,
  ClassMappingRule,
  // 26.P0 — v2 shape + level types.
  DimensionShape,
  DimensionLevel,
  CategoricalLevel,
  BandedLevel,
  GeographicLevel,
  // ADR-0038 — canonical geographic lookup-domain structural param.
  GeoLookupDimLike,
} from "./dimension-types";
export {
  isRatingInput,
  isStructural,
  isStandardDimension,
  isGeographicDimension,
  isClassificationDimension,
  normalizeDimension,
  resolveClassMapping,
  DEFAULT_DIMENSION_ROLE,
  DEFAULT_DIMENSION_TYPE,
  CLASS_MAPPING_DEFAULT_PATTERN,
  // 26.P0 — v2 helpers.
  DEFAULT_DIMENSION_SHAPE,
  inferDimensionShape,
  isBandedDimension,
  isCategoricalDimension,
  validateBandedLevels,
  deriveBandsFromBreakpoints,
  // Finding E5 — JSON-safe open band ends (null ⇄ ±Infinity).
  bandLo,
  bandHi,
  // Brief 30 PR 30.3 — richer banded validator: returns ALL issues
  // (gap / overlap / sort / invalid-bound / empty / mixed-kind)
  // with structured `kind` discriminators for UI tinting.
  // (Lives in dimension-validation.ts but re-exported here as a
  // companion to the existing dimension-types helpers.)
  resolveBandedLevel,
  resolveCategoricalLevel,
  // ADR-0025 (Brief 27) — composite shape helpers.
  isCompositeDimension,
  resolveCompositeLevel,
  validateCompositeDimension,
  compositeLevelCount,
  COMPOSITE_LEVEL_SEPARATOR,
  // ADR-0038 — canonical geographic lookup domain (one source of truth for
  // the factor grid, the input validator, and the engine projector).
  isGeographicLookupDim,
  activeGeoTerritories,
  geoLookupKeys,
  resolveGeographicValue,
  geoAcceptanceSet,
  geoValueToKeyMap,
} from "./dimension-types";

// Brief 30 PR 30.3 — Richer banded validator (returns all issues
// in one pass, each with a structured `kind` discriminator).
export {
  validateBandedDimension,
  bandedGapsAndOverlaps,
  describeBandedIssue,
} from "./dimension-validation";
export type { BandedDimensionIssue } from "./dimension-validation";

// Brief 30 PR 30.4 — Dimension reference resolver. Walks plan
// stages + factor tables + modifiers and emits the
// `DimensionReferenceLite[]` the @openrater/ui UsedInPanel consumes.
// Brief 34 PR 34.7 removed the Curves walk; curves no longer exist.
export { findDimensionReferences } from "./dimension-references";
export type {
  DimensionReferenceLite,
  ChainStageSummary,
  FactorTableReference,
  ModifierScheduleReference,
  FindDimensionReferencesInput,
} from "./dimension-references";

// ── Model contract (sub-brief 24.A — FactorTableExport shape) ────────
//
// The shape every Model node in the Parametrize workspace (24.E)
// reads from. Source-agnostic: Model Lab + external (PMML / ONNX /
// JSON) all use this contract. Engine doesn't see "model" — model
// output flows into factor tables the engine reads normally.
export type {
  ModelExport,
  ModelInput,
  ModelOutput,
  ModelSource,
  ModelDataType,
} from "./model-types";
export {
  requiredInputNames,
  findModelInput,
  findModelOutput,
} from "./model-types";

export const PACKAGE_NAME = "@openrater/contracts" as const;
