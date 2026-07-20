/**
 * /rate-lab/:id — Plan detail landing.
 *
 * Header chrome + the workspace tab strip (Overview + the 7 spine
 * workspaces). Every authoring surface reads the LIVE substrate
 * (plan.stages kind counts, the dimensions catalog, the FT catalog)
 * and readiness comes from the ONE selector, `computePlanReadiness`
 * (P2 G13, ADR-0056 D1).
 *
 * Brief 78 P5.2 (v4, G13 remainder) — the stage-bucket accounting is
 * GONE: `STAGE_KIND_TO_SECTION` and the `plan.section_layout` read
 * (a field nothing ever wrote) were deleted with their
 * `bucketStagesBySection` map. Tab dots, the Overview checklist, and
 * the drawer predecessor lookups all derive from the same live
 * sources now — the buckets could only disagree with them (the
 * Algorithm/Rating dot burned amber forever because loadings/outputs
 * buckets were structurally unfillable).
 *
 * Reshaped by the workspace-era navigation changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowRight,
  Clipboard,
  Copy,
  ArrowLeft,
  Database,
  KeyRound,
  ListPlus,
  MoreHorizontal,
  Play,
  Plus,
  Rocket,
  Settings,
  Table2,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Button,
  Chip,
  Drawer,
  EmptyState,
  IconButton,
  Menu,
  Modal,
  useToast,
} from "@openrater/design-system";
import {
  PLAN_SECTIONS,
  PLAN_SECTIONS_BY_ID,
  PLAN_SECTIONS_BY_WORKSPACE,
  // Workspace taxonomy: Inputs is its own peer (5 authoring workspaces
  // plus verify), presented as top tabs rather than a left rail.
  WORKSPACE_LABELS,
  WORKSPACE_ORDER,
  DEFAULT_WORKSPACE,
  isPlanBuilderWorkspace,
  // ADR-0033 — single-product header label prefers the real product
  // (Directors & Officers) over the deprecated line_of_business shim.
  PRODUCT_LABELS,
  isProductCode,
  // Brief 55 — eligibility tier vocabulary for the Analytics tier slice.
  ELIGIBILITY_TIERS,
  ELIGIBILITY_TIER_LABELS,
  // Brief 84 — THE one derived headline status (Draft / Live / Archived).
  derivePlanStatus,
} from "@openrater/contracts";
import type {
  Section,
  PlanBuilderWorkspace,
  EligibilityTier,
} from "@openrater/contracts";
import type {
  ServerRunResultLike,
  TraceDimensionLike,
  TraceStageLike,
} from "@openrater/ui";
import {
  useBulkUpsertDimensions,
  useBulkUpsertFactorTables,
  useDeleteInputMapping,
  useDimensionsList,
  useFactorTablesList,
  // Brief 43 / PR 43.1 — Freeze version dialog wiring.
  useFreezeSnapshot,
  // Brief 43 / PR 43.2 — Analytics workspace prerequisites check.
  useSnapshotsList,
  // Brief 43 / PR 43.6.e — re-rate the picked baseline + comparison
  // snapshot bodies against the live scored rows.
  useSnapshotDetail,
  useBuildReport,
  useBuildReports,
  useInputMapping,
  usePlanDetail,
  useRemoveStage,
  useUpsertInputMapping,
  plansQueryKeys,
} from "@openrater/hooks";
import {
  RaterApiError,
  publishSnapshot,
  // §2.5 / v4 G22 — "Save as copy" is ONE server-side transaction (the
  // create-then-replay loop that half-built on failure is gone).
  duplicatePlan as apiDuplicatePlan,
  type AddStageRequest,
  type PatchDraftRequest,
  type ApiKeyCreated,
  type PlanDetail,
  type PlanRunRow,
  type QuoteResponse,
  type PlanSnapshot,
  type StageSummary,
  // Brief 95 D1 — the plan's fill-in book CSV (Run zone download).
  bookTemplateUrl,
  createPlanRun,
  getApiBase,
  getInputMapping,
  getPlanRun,
  getPlanRunRows,
  getPublishStatus,
  // Brief 84 D-B — the ONE deploy verb (freeze + publish in one call).
  getEditsSinceBuild,
  goLive,
  listApiKeys,
  listPlanRuns,
  // Brief 89 R4 — the genesis duplicate-link target check (empty plans only).
  listPlans,
  mintApiKey,
  quotePlan,
  revokeApiKey,
} from "@openrater/api-client";
import {
  multiplicativeChainConfigSchema,
  type FactorLookup,
  // Brief 30 PR 30.4 — pure resolver for the inline editor's Used-in panel.
  findDimensionReferences,
  // PR 11b — Score-all runs the echo plan against the full row set.
  // E08/E03 PR D — the grouped policy roll-up + appetite run.
  compilePlan,
  evaluatePolicyBook,
  // Brief glm-irpm-lightbox-in-policy-rollup — resolve a model-sourced IRPM in
  // the opt-in policy tail composed on the rolled subtotal.
  makeIrpmAdjustmentResolver,
  type Plan,
  type PolicyBookResult,
} from "@openrater/contracts";
import {
  AppetiteStatement,
  type AppetiteFieldOption,
  // Brief 89.3 follow-up — the value space a gate can actually match
  // for a dimension-backed field (levels per shape; banded = none).
  gateValueLevels,
  // 25.B — Calculation Tower (ASSEMBLE v2). Replaces the 24.H xyflow
  // AssembleWorkspace with a vertical funnel surface: single tower
  // per coverage, lego-block nodes, mode-aware metadata chips,
  // first-class model nodes with input manifest, 6-section inventory
  // Brief 70 §2 — the build-up sheet replaced the canvas; the route
  // keeps only the projection pair (stages ↔ TowerPlan) for the
  // editedPlan + content-dirty autosave machinery.
  stagesToTowerPlan,
  // PR 12.1 — Reverse projector. Wired by `handleSaveAssemble`
  // below; converts the in-memory TowerPlan back into the
  // substrate stage list the backend mutations accept.
  towerPlanToStages,
  // Brief 70 Phase 3 — the Final-adjustments tail editors (the Brief
  // 39 primitives survive the GateCanvas deletion as the tail's
  // editors; drafts + converters live in integrations/tailSync).
  ModifierEditor,
  EndorsementEditor,
  emptyModifierDraft,
  emptyEndorsementDraft,
  // Brief 78 P5.3 (G16) — the add-endorsement guard (create on save).
  isEndorsementDraftValid,
  type ModifierDraft,
  type EndorsementDraft,
  ChainFactorDrawer,
  ClampStageDrawer,
  // 24.C / Brief 27 PR 1 / Brief 30 PR 30.1 — Dimensions workspace
  // + inline editor (categorical) + legacy banded drawer.
  // Brief 30 PR 30.1 deletes <DimensionStandardDrawer> in favor of
  // <DimensionEditor> rendered inline in the workspace center pane.
  // Banded still uses its drawer (PR 30.2 inlines it next).
  // v2 Dimensions redesign (2-column) — §2B view-swap behind ?dims2=1,
  // takes the same DimensionsWorkspaceProps (P1: the shell).
  DimensionsWorkspaceV2,
  // Brief 44 PR 44.11 — Geographic dim wizard. Modal-launched from
  // the workspace's "+ Geographic" tool-pane button; the wizard's
  // onCreate materializes a `DimensionRow` that the route appends
  // to editedDimensions and opens inline in the workspace's center
  // pane (where GeoDimEditor takes over via PR 44.3).
  GeoDimWizard,
  type GeoDimDraft,
  type GeoDimEditorTab,
  // Brief 30 PR 30.5 — delete-with-impact modal.
  DimensionDeletePrompt,
  // 26.P0 — DimensionRow shape for fixture-mode persistence state.
  // Re-exported through @openrater/ui's index; the route holds a typed
  // editedDimensions array that the inline editor's autosave + the
  // banded drawer's save handler both mutate.
  type DimensionRow,
  // Brief 30 PR 30.4 — @openrater/ui's UsedInPanel reference shape.
  type DimensionReference,
  // Brief 27 PR 1 — Shape choice type now exported from the
  // workspace primitive (the modal it used to belong to is gone).
  type DimensionShapeChoice,
  // Brief 30 PR 30.2 — pure utilities for seeding banded dim creates
  // with sensible defaults (5 equal-width bands across [0, 100]).
  FinalAdjustmentsEditor,
  BookCostGuardrail,
  type ConnectorOption,
  FlatFactorStageDrawer,
  // 24.E — legacy Gate workspace (read-only browse list).
  // Brief 39 §1 supersedes with <GateCanvas> below; the legacy
  // primitive is still re-exported from @openrater/ui for backward
  // compat but no longer mounted by this route.
  // GateWorkspace,
  // Brief 39 PR 39.5+ — Gate authoring orchestrator + helpers.
  // Brief 43 / PR 43.1 — Plan snapshot freeze dialog.
  FreezeVersionDialog,
  // Brief 64 — Analytics v2 three-act orchestrator (replaces the Brief 43
  // single-slice shell) + the rate-driver variable spec it consumes.
  AnalyticsWorkspaceV2,
  // Brief 93 (93.1) — the plan report, Analytics' landing view.
  PlanReport,
  // Brief 93 (93.2) — the gates section's row builder.
  buildGateRows,
  // Brief 93 (93.3) — the worked-examples workbook variant.
  buildVerifiedExamples,
  STATE_LABEL_BY_CODE,
  RateCardExhibit,
  // Brief 89 §3.2 B3 (89.4) — the probe book.
  ProbeBookCard,
  type ProbeBookState,
  buildDefaultProbeSweep,
  analyzeProbeRows,
  dimInputKeys,
  resolvePremiumColumn,
  type OverviewVariableSpec,
  // L32 — persisted Analytics view-state (slice / level / kpi / metric)
  // + the KPI id enum, used by the per-plan localStorage helper below.
  type AnalyticsViewState,
  type AnalyticsKpiId,
  // Brief 43 / PR 43.6.a — scored-result persistence bridge.
  loadScoredResult,
  runRowsToScoredBatchResult,
  // Brief 66 (Phase 2) — Save to Portfolio (the book of record).
  // G-4 — Loss-column auto-detect for the LR KPI.
  // Brief 43 §6.1 / ADR-0041 Phase 2 — staleness fingerprint.
  computeScoringFingerprint,
  // Brief 43 / PR 43.6.d — per-snapshot re-rate. The projector
  // turns a frozen substrate snapshot body into the runtime Plan
  // `rerateSnapshotRows` executes.
  rerateSnapshotRows,
  snapshotBodyToRuntimePlan,
  // Brief 43 / PR 43.7 — Export scored CSV.
  buildAnalyticsScoredCsv,
  analyticsScoredCsvFilename,
  // G-5 — Chunked batch scoring (perf fix; yields between chunks).
  // Brief 38 — the Inputs tab's typed substrate. The v1 <InputsWorkspace>
  // orchestrator was deleted on 2026-06-09 (v2 cutover); InputsPanelV2 is
  // the single mount point now. The shared types/helpers below still come
  // from the InputsWorkspace module.
  type PlanInputMapping,
  // J3 — sample-dataset affordance on the CSV dropzone. Routes derive
  // the dataset from plan.template_id and pass it through; the
  // workspace forwards to CsvDropzone.
  type SampleDataset,
  // PR 11b — Score-all wiring. The Inputs workspace's
  // onScoreAll callback runs executePlanBatch against the FULL
  // sample row set and downloads the result as CSV.
  projectRowsToExternalInputs,
  type RequiredInputEntry as IwRequiredInputEntry,
  // PR 11h/11i — derive the required-inputs list from the FULL
  // plan (chain dim refs + factor inputs + flat-factor inputs +
  // explicit input_node stages), not just the Inputs section's
  // input_node stages. Brief 38 §4.2.
  deriveRequiredInputs,
  // PR D2a — Project authored chain stages + client-side factor
  // tables into a runtime Plan that actually computes premiums.
  // Closes the cold-test gap where Score-all ran only the echo plan
  // and never executed real chains. Used by InputsWorkspaceMount.
  stagesToRuntimePlan,
  synthesizeRepresentativeRisk,
  RunSection,
  // Trace-panel brief §14 (audit P4-01) — the evaluated-trace remount:
  // adapt the PERSISTED server run (result_json) into <TracePanel>'s
  // grouped view. The Test result renders it inline; history rows open
  // the same panel in a drawer.
  TracePanel,
  buildServerRunTraceView,
  // W16 — fallback prettifier for Test-form fields that have no declared
  // display name (dictionary + dimensions are consulted first).
  humanizeFieldName,
  // Declare guard — a ':' names a binding namespace (literal:1), never a
  // declarable input field.
  isDeclarableFieldName,
  // P2.1 (v2 Inputs) — webhook data source. `testWebhookRequest` fetches a
  // sample (best-effort from the browser; auth env-vars resolve server-side
  // at API Lab request time), `inferPayloadSchema` turns the parsed body into
  // typed source columns. Composed into the mount's `onInferSchema` for
  // <InputsPanelV2>'s WebhookSource. No secret ever enters the plan.
  testWebhookRequest,
  inferPayloadSchema,
  // Brief 33 PR 33.1 — Parametrize-as-canvas. Since Brief 78 (P5.1)
  // it mounts as the Rating workspace's ?expand=1 TAKEOVER (creation
  // + 2-D editing); the standalone Factor Tables tab is gone. The
  // legacy <ParametrizeWorkspace> was deleted from @openrater/ui 2026-05-24.
  ParametrizeCanvas,
  FactorTableDeletePrompt,
  // Brief 82 R1 — the honest save pill rides the Rating toolbar (the
  // Brief 78 panes — WorkspaceFrame + RatingRail + RatingTableInspector
  // — are deleted; the tab is one column).
  SavePill,
  getPerLevelTowers,
  //  — the one public counting (chains · steps) + the tail-kind
  // set the Final-adjustments ledger renders.
  countPublicAlgorithm,
  SHEET_TAIL_STAGE_KINDS,
  //  — the one absolute date rendering.
  isoDate,
  isoDateTime,
  RatingInlineGrid,
  type PlanReadiness,
  // Cold-test M — territory-keying. Re-opening an existing factor table
  // must materialize its cells off the SAME keys the canvas + runtime
  // use: a geo dim with territories keys on the 5 territory ids, not
  // the 50+DC raw state levels. Shared helper keeps all three sites
  // (materializeCells / viz axes / this initial-cell builder) in lock-
  // step. See ADR-0028.
  levelsForKeying,
  // Brief 89 R5 — the picker-created table's referencing step inserts
  // into the waiting tower with the sheet's own node builder.
  pickerItemToNode,
  insertNodeAtEnd,
  type ParametrizeCanvasProps,
  type ParametrizeCanvasDraft,
  type FactorTableSummary,
  // Brief 78 P5.4 (D-F) — the policy tail projects into sheet rows.
  type SheetAdjustment,
  // Brief 34 PR 34.7 follow-up — cellKey for inline-edit initial cells.
  cellKey,
  RoundStageDrawer,
  // Brief 80 (finding E7) — the total-premium contract + the named
  // composition issues.
  TOTAL_TOWER_OUTPUT_FIELD,
  collectCompositionIssues,
  // 24.F2 — WorkspaceTabs (top tab strip, replaces left rail).
  // (24.F's WorkspaceShell + WorkspaceToolPane are no longer mounted
  // — each workspace orchestrator now provides its own chrome.)
  WorkspaceTabs,
  PlanHeader,
  PlanStatusChip,
  GoLiveDialog,
  OverviewSection,
  BuildReportView,
  InputsPanelV2,
  emptyClampDraft,
  emptyDraftForKind,
  emptyFlatFactorDraft,
  emptyRoundDraft,
  factorDraftToMutation,
  type ClampDraft,
  type DimensionSubtypeFilter,
  type FactorDraft,
  type FlatFactorDraft,
  type RoundDraft,
  // Brief 44 PR 44.11.e — type-only re-export of the
  // GeoTransformerPicker's id enum. Needed to cast the route's
  // string-typed `geoTransformerByInputId` state into the strict
  // shape `projectRowsToExternalInputs` expects.
  type GeoTransformerId,
  // Re-rate projection — options threaded into snapshotBodyToRuntimePlan
  // + the result shape the chart reads.
  type StagesToRuntimePlanOptions,
  type ScoredBatchResult,
  // Brief 52 / 61 — declared-input view-model, rendered by InputsPanelV2's
  // dictionary table (the v1 <InputTable>/<InputsWorkspace> were deleted).
  type InputDictEntry,
  // Brief 53 — canonical Building / BPP coverage structural dimension,
  // seeded by the Parametrize "+ Coverage split" affordance.
  CANONICAL_COVERAGE_DIMENSION,
  // Brief 74 PR 74.0 — the shared plan-readiness selector (lifted from
  // this file so OpenRater Home + this Overview share one "next step").
  computePlanReadiness,
  // 93.4 — the book's premium basis. This route composes policies
  // LOCALLY (`policyRollupResults`), so it needs the same Law-1
  // synthesis the scoring service's two composers apply; reading
  // `rollup_fields` raw is what left this path without a total-less leg.
  COVERAGE_SUM_COLUMN,
  extraPolicyRollupFields,
  isCoverageSumBook,
  resolvePlanPremiumContext,
  sumMoneyFields,
  type AuthoredRollupField,
  type PremiumPlanLike,
} from "@openrater/ui";
import { useAddStage, usePatchStageConfig } from "@openrater/hooks";
// Brief 52 — entry ⇄ input_node stage adapter for the dictionary editor.
import {
  stagesToInputDictEntries,
  entryToAddStageRequest,
  entryToConfigPatch,
} from "../integrations/inputDictStages";
// Brief 62.4 — the plan's Final-adjustments tail (in-memory authoring store).
import { usePolicyTailSynced } from "../integrations/policyTailStore";
// ADR-0064 — fingerprint-first run staleness (content-hash fallback).
import { isRunStale } from "../integrations/runStaleness";
// G15/G24 — debounced replace-all writes whose pending state survives the
// effect cleanup, so Freeze can land them first and route-leave can't
// drop them.
import { createFlushableDebounce } from "../integrations/flushableDebounce";
import { minPremiumTarget } from "../integrations/authoringParity";
import {
  policyBookConfigFromPlan,
  keyedRowsFromBook,
  policyAggregateFields,
  planMinimumPremium,
  appendPlanFloor,
} from "../integrations/policyBookConfig";
// Brief 62.6 PR3 — the connector book: per-row batch evaluator + cost guardrail.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  invokeConnector,
  listConnectors,
  listInputValues,
  listRoutes,
} from "../api/connectors";
// Brief 84 D-D — the Ship Connect card's read (the Hub's own ladder).
import { getPlanConnections } from "../api/integrations";
import { showApiLab } from "../integrations/apiLabFlag";
import { useCohortConnectorEvaluator } from "../integrations/useCohortConnectorEvaluator";
// Brief 58 Pillar C — durable input-dictionary bulk-add (survives navigation).
import {
  useDurableInputDeclarations,
  type InputDeclarationsApi,
} from "../integrations/useDurableInputDeclarations";
import "./inputsWorkspaceMount.css";
// Brief 35 consumer-site integration v1 — orchestrator that
// mounts SpawnZone → TabBar + Tower → TotalTowerCard around the
// Brief 70 §2 Phase 3 — the build-up sheet's rate-lab glue (ambient
// sample scoring + product language + the Final-adjustments rows).
import { AlgorithmMount } from "../components/AlgorithmSheet";
// Brief 82 — the Rating tab's chrome: the summoned table catalog
// (D-C) + the readiness footer (D-D). The in-row grid editor (R2,
// RatingInlineGrid) is an @openrater/ui primitive.
import { RatingTablesMenu, RatingFooter } from "../components/RatingChrome";
import {
  modifierDraftToStageRequest,
  endorsementDraftToStageRequest,
  planStagesToTailEntries,
} from "../integrations/tailSync";
import {
  SAMPLE_DIMENSIONS,
  SAMPLE_FACTOR_TABLES,
  SAMPLE_PLAN_ID,
} from "../fixtures/sample-refs";
// Retired fixture compatibility types. SAMPLE_PLAN_ID is a sentinel that
// never matches a persisted plan, so all runtime state comes from the API.
// D6.2 / ADR-0027 — bridge the API-backed `PlanDimension` shape with
// the legacy `DimensionRow` UI shape used everywhere downstream.
import {
  dimensionRowsToBulkRequest,
  planDimensionToRow,
} from "../integrations/dimensionsSync";
// D6.3 / ADR-0027 — same bridge for factor tables + their cell sidecar.
import {
  factorTablesToBulkRequest,
  planFactorTableToRow,
  planFactorTablesToCellMap,
} from "../integrations/factorTablesSync";
import { rebindChainsForTableAxes } from "../integrations/factorTableChainRebind";
import {
  APPETITE_STAGE_ID,
  appetiteScopeConfig,
  consolidationOrder,
  planStagesToAppetite,
  type AppetiteRule,
} from "../integrations/appetiteSync";
// Brief 46 — shared chain runtime config (lcm + base-rate defaults),
// reused by the Policy scoring hook.
import {
  resolveChainRuntime,
  type ChainRuntimeDefaults,
} from "../integrations/chainRuntime";
import "./PlanDetailRoute.css";
import "./sections/AddStageDrawer.css";
import "./sections/RatingChainsSection.css";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// Brief 75 phase 4 — the exhibits' client-side row ceiling when
// reading a persisted book run (pages of 2000 via the run-rows
// endpoint). Books beyond it stay server-side; rowCount vs the run's
// request row_count names the truncation.
const ANALYTICS_RUN_ROW_CAP = 10_000;

// Brief 55 item 2 — the bundled `nonprofit_990` "Use sample data" dataset was
// removed from the Inputs surface. It was a D&O/GL template leftover that read
// as nonsense on an Meridian BOP plan and is no longer offered by default. The
// <DataSourcePicker> `sampleDataset` prop remains an optional API for any
// consumer that wants to offer a plan-appropriate sample.

// Chain runtime constants (lcm + base-rate input defaults) moved to
// `../integrations/chainRuntime` (Brief 46) so the plan re-rating path +
// the Policy scoring hook resolve the same config. `resolveChainRuntime`
// + `ChainRuntimeDefaults` are imported at the top of this file.

export function PlanDetailRoute() {
  const { id } = useParams<{ id: string }>();
  // Use isPending (v5: pending status = no data yet) instead of isLoading
  // (v5: pending + actively fetching) — we want the skeleton during retry
  // backoff too, not just the first attempt.
  const { data, isPending, error, refetch } = usePlanDetail(id);
  // Brief 88 §3.4 — "{plan} · Rate Lab · OpenRater" once the plan loads.
  useDocumentTitle(data?.display_name, "Rate Lab");

  return (
    <div className="plan-detail-page">
      {/* V2_INTERFACE_SPEC §2.5 — no back-crumb row: the top bar's
          "Rate Lab" link is the way back to the plans list. */}

      {isPending ? (
        <PlanSkeleton />
      ) : error ? (
        isNotFound(error) ? (
          <NotFoundCard id={id ?? ""} />
        ) : (
          <ErrorCard
            message={error instanceof Error ? error.message : String(error)}
            onRetry={() => refetch()}
          />
        )
      ) : data ? (
        <PlanDetailContent plan={data} />
      ) : null}
    </div>
  );
}

// ---- Loaded ----

/**
 * The drawer can be in one of these states.
 *
 * PR 12.3 — dropped `add` + `edit` variants. They were the legacy
 * <InputNodeForm> entry points for hand-authoring input_node stages.
 * Input sources now project automatically from the chain (PR 12.1 /
 * PR 12.2); kind-specific drawers handle every other authoring path
 * (`add-chain-factor`, `add-flat-factor`, `add-round`, etc.).
 * `delete-confirm` is still entered directly from every section's
 * row-level delete affordance.
 */
type EditorState =
  | { kind: "closed" }
  | { kind: "delete-confirm"; section: Section; stage: StageSummary }
  /**
   * M4.3.8b — chain-factor authoring (add). The drawer is rendered
   * by `<ChainFactorDrawer>` (separate from the risk-inputs Drawer
   * mount).
   */
  | {
      kind: "add-chain-factor";
      section: Section;
      chainStageId: string;
      chainName: string;
      chainOutputPath: string;
    }
  /**
   * M4.3.9 — chain-factor edit. Same drawer, mode="edit". Carries
   * the chainIndex + factorIndex so the route can REPLACE the right
   * row in the chain stage's config_json on save.
   */
  | {
      kind: "edit-chain-factor";
      section: Section;
      chainStageId: string;
      chainName: string;
      chainOutputPath: string;
      chainIndex: number;
      factorIndex: number;
    }
  /**
   * M4.3.9 — confirm-then-remove a chain factor. Re-uses the
   * existing Drawer with a confirmation panel (mirrors the
   * top-level delete-confirm flow).
   */
  | {
      kind: "remove-chain-factor-confirm";
      section: Section;
      chainStageId: string;
      chainName: string;
      chainIndex: number;
      factorIndex: number;
      factorLabel: string;
    }
  /**
   * M4.13 — flat-factor stage editor (Loadings + Final Adjustments).
   * Carries the section context so the route can route the save
   * (input_path depends on section).
   */
  | {
      kind: "add-flat-factor";
      section: Section;
    }
  | {
      kind: "edit-flat-factor";
      section: Section;
      stage: StageSummary;
    }
  /**
   * M4.15 — clamp + round stage editors (Final Adjustments).
   * `add-clamp` was removed (v4 G6): the projector never executes
   * `clamp`, so no live affordance may CREATE one. Existing clamp
   * stages stay editable (the drawer carries a "not yet priced"
   * notice); the minimum-premium affordance authors the round
   * stage's floor instead.
   */
  | {
      kind: "edit-clamp";
      section: Section;
      stage: StageSummary;
    }
  | {
      kind: "add-round";
      section: Section;
    }
  | {
      kind: "edit-round";
      section: Section;
      stage: StageSummary;
    }
  /**
   * Brief 70 §2 Phase 3 — the Final-adjustments tail editors
   * (modifier schedule / endorsement), reached from the build-up
   * sheet's tail rows. Drafts live in modifierTailDraft /
   * endorsementTailDraft; saves go through the STAGE API (config
   * patch, or remove+add when an endorsement's effect kind — and so
   * its stage_kind — changes), never the tower diff.
   */
  | {
      kind: "edit-modifier";
      stageId: string;
    }
  // F06 — the IRPM schedule used to eager-POST an empty modifier (one category,
  // name:"") which 422'd, so the editor never opened and the button was a dead
  // click. "add-modifier" opens the drawer FIRST on an in-memory draft; the
  // stage is created (addStage) only when the actuary saves a valid config.
  | {
      kind: "add-modifier";
      stageId: string;
    }
  | {
      kind: "edit-endorsement";
      stageId: string;
    }
  // Brief 78 P5.3 (G16) — endorsements finally have a CREATE path:
  // the sheet's Final-adjustments add menu opens the editor on an
  // in-memory draft (the F06 add-modifier pattern — no eager POST);
  // the stage is created on save via endorsementDraftToStageRequest.
  | {
      kind: "add-endorsement";
      stageId: string;
    };
// Brief 30 PR 30.1 + 30.2 — the legacy "add-dim-standard" /
// "edit-dim-standard" / "add-dim-banded" / "edit-dim-banded"
// editor.kind variants are gone. Both categorical AND banded
// dimension editing happen INLINE in the workspace center pane,
// driven by the `editingDimensionId` controlled prop. Geographic /
// Classification / Composite still flow through the workspace's
// onSelect → existing routes (subsequent PRs inline them).

/**  — run kinds in user language (the wire says `sample`). */
function runKindNoun(kind: string): string {
  return kind === "sample" ? "quote" : kind;
}

function PlanDetailContent({ plan }: { plan: PlanDetail }) {
  const { notify } = useToast();
  // 24.C — the dimensions workspace's onSelect handler routes to
  // /rate-lab/:id/territories or /rate-lab/:id/classification for the
  // non-Standard subtypes, so PlanDetailContent needs `navigate`.
  const navigate = useNavigate();

  // Read-only gate. The API Lab state machine only permits stage edits
  // (add_stage / remove_stage / patch_stage) on a DRAFT plan; proposed,
  // active, and archived are read-only (`LEGAL_STATES_FOR_ACTION` in
  // rates/plans/state_machine.py). The Assemble workspace autosaves the
  // rating chain on edit AND normalizes tower state on mount, so without
  // this gate, opening a non-draft plan's Assemble fires a storm of
  // add_stage mutations that all 409 — and because a failed save never
  // refreshes the server stages, the dirty signal never clears and the
  // autosave retries every ~800ms forever (the "Couldn't save ×N" toast
  // storm). `isWritable` gates every persistence + normalization path so
  // non-draft plans render in a calm read-only state with zero mutations.
  const isWritable = plan.status === "draft";

  const [editor, setEditor] = useState<EditorState>({ kind: "closed" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Brief 43 / PR 43.1 — Freeze version dialog state. The error
  // message holds the human-readable 409 collision string so the
  // user can edit the name + retry without losing the notes draft.
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeErrorMessage, setFreezeErrorMessage] = useState<string | null>(
    null,
  );

  // P5.2 G13 — `stagesById` + `stagesBySection` (bucketStagesBySection
  // over section_layout + STAGE_KIND_TO_SECTION) are DELETED. Every
  // former consumer reads the live substrate directly.

  // P2 G13 — stage-KIND counts straight off the substrate (the
  // section_layout/STAGE_KIND_TO_SECTION buckets under-counted: gates/
  // modifiers/endorsements mapped to NO bucket, so "Set eligibility"
  // could never complete).
  const stageKindCounts = useMemo(() => {
    let inputs = 0;
    let chains = 0;
    let gates = 0;
    for (const s of plan.stages) {
      if (s.stage_kind === "input_node") inputs += 1;
      else if (s.stage_kind === "multiplicative_chain") chains += 1;
      else if (
        s.stage_kind === "eligibility.gate" ||
        s.stage_kind.startsWith("modifier.") ||
        s.stage_kind.startsWith("endorsement.")
      ) {
        gates += 1;
      }
    }
    return { inputs, chains, gates };
  }, [plan.stages]);

  // V2_INTERFACE_SPEC §2.3 — deterministic landing: a bare
  // /rate-lab/:id (no workspace segment, or a bogus one) lands on
  // OVERVIEW. Explicit workspace deep-links always win. The create
  // flow navigates straight to /workspace/inputs so a brand-new plan
  // keeps momentum.
  const { workspace: workspaceParam } = useParams<{ workspace?: string }>();
  const isOverviewActive = !isPlanBuilderWorkspace(workspaceParam ?? "");
  const activeWorkspace: PlanBuilderWorkspace = isPlanBuilderWorkspace(
    workspaceParam ?? "",
  )
    ? (workspaceParam as PlanBuilderWorkspace)
    : DEFAULT_WORKSPACE;

  // Derive the "active section" the SectionDetailPane renders for
  // this workspace. For workspaces that own a unified primitive
  // (DIMENSIONS/PARAMETRIZE/GATE), the workspace handles all sub-
  // sections internally — we just pass the first section in the
  // workspace as a representative anchor. For INPUTS/ASSEMBLE/VERIFY
  // the "active section" is the primary section the user lands on.
  const activeSectionId =
    PLAN_SECTIONS_BY_WORKSPACE[activeWorkspace][0]?.id ?? PLAN_SECTIONS[0]!.id;

  const queryClient = useQueryClient();
  const removeMutation = useRemoveStage(plan.rating_plan_id);
  // M4.3.8b — chain-factor mutations. Both call api-client through
  // @openrater/hooks's TanStack Query wrappers; success invalidates the
  // plan-detail query so the new factor lands in the chain card on
  // the next render.
  const addStageMutation = useAddStage(plan.rating_plan_id);
  const patchStageConfigMutation = usePatchStageConfig(plan.rating_plan_id);
  // Brief 58 Pillar C — durable input-dictionary bulk-add. Lives at this
  // STABLE level (PlanDetailContent does not unmount on tab switch) so the
  // 28 quick-add saves complete in the background even if the actuary
  // navigates away immediately. Threaded to <InputsWorkspaceMount> (which
  // unmounts) so the queue + drain survive it.
  const inputDeclarations = useDurableInputDeclarations(plan.rating_plan_id);
  // Brief 43 / PR 43.1 — Freeze a snapshot of the current draft.
  // The hook invalidates the snapshot-list query on success so any
  // mounted picker re-renders with the new version. (Brief 84: the
  // freeze affordance lives on the Ship tab; the header shows the
  // derived-status chip instead of the deleted stepper.)
  const freezeSnapshotMutation = useFreezeSnapshot(plan.rating_plan_id);
  // §2.4 — the header's Rate sample button requests a Test run; the
  // Test mount listens (a monotonically-increasing nonce, 0 = never).
  const [testRunRequest, setTestRunRequest] = useState(0);

  // §2.5 — "Duplicate plan": create a fresh draft and replay this
  // plan's CURRENT edited substrate (stages in order, dimensions,
  // factor tables WITH cells) through the existing endpoints. How an
  // actuary takes Sample BOP to MO without rebuilding 30 stages.
  const [duplicating, setDuplicating] = useState(false);
  const handleDuplicatePlan = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      // v4 G22 — ONE server-side transaction copies the whole substrate
      // (stages + IO, dimensions with class_library_id re-pointed at the
      // copy, factor tables + cells, class registry, input mapping,
      // policy tail). The client replay this replaces looped add_stage —
      // half-building on any mid-loop failure — and silently dropped the
      // last three substrates.
      const copy = await apiDuplicatePlan(plan.rating_plan_id);
      notify(`Duplicated as "${copy.display_name}".`);
      navigate(`/rate-lab/${copy.new_plan_id}`);
    } catch (err) {
      notify(
        err instanceof Error
          ? `Couldn't duplicate the plan: ${err.message}`
          : "Couldn't duplicate the plan.",
      );
    } finally {
      setDuplicating(false);
    }
  };
  const snapshotsQuery = useSnapshotsList(plan.rating_plan_id);

  // M4.3.8b — chain factor draft state. Owned by the route so
  // <ChainFactorDrawer> stays controlled.
  const [chainFactorDraft, setChainFactorDraft] = useState<FactorDraft>(() =>
    emptyDraftForKind(""),
  );

  // M4.13 — flat-factor stage draft state. Owned by the route so
  // <FlatFactorStageDrawer> stays controlled.
  const [flatFactorDraft, setFlatFactorDraft] = useState<FlatFactorDraft>(() =>
    emptyFlatFactorDraft(),
  );

  // M4.15 — clamp + round drafts. Same pattern as flatFactorDraft.
  const [clampDraft, setClampDraft] = useState<ClampDraft>(() =>
    emptyClampDraft(),
  );
  const [roundDraft, setRoundDraft] = useState<RoundDraft>(() =>
    emptyRoundDraft(),
  );

  // Brief 30 PR 30.1 — Controlled id of the dim currently being
  // edited inline in the workspace center pane. The workspace renders
  // <DimensionEditor> when this points to a categorical dim;
  // otherwise renders the browse list.
  // Brief 44 PR 44.11 — Geographic dim wizard + active tab state.
  // The wizard opens via `handleAddGeographicDimension` and emits a
  // GeoDimDraft on Create. The active tab is controlled by the route
  // so navigating away from + back to the editor returns to the
  // same tab (Levels / Map / Territories).
  const [geographicWizardOpen, setGeographicWizardOpen] = useState(false);
  const [geographicActiveTab, setGeographicActiveTab] =
    useState<GeoDimEditorTab>("levels");
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(
    null,
  );

  // 26.P0 — Fixture-mode persistence for dimension authoring.
  //
  // Pre-26.P0 the save handler showed a toast ("lands with API Lab
  // slice 4...") and dropped the draft on the floor — the user
  // typed a dimension, clicked Save, and nothing happened. This
  // state closes that bug: handleSaveDimStandard appends (add) or
  // replaces (edit) by id. The four SAMPLE_DIMENSIONS
  // call sites all read from editedDimensions now so the new /
  // edited row flows through to every consumer (workspace,
  // ChainFactorDrawer pickers, CalculationTower inventory).
  //
  // When slice 4 ships, swap this for a TanStack Query state.
  // Brief 39 follow-up — only seed the BOP fixture dimensions when
  // the plan IS an Meridian BOP plan. WC / CGL / Auto / Umbrella plans
  // (and any future LOB) start with an empty dimension list, matching
  // the "blank" template the user picked at /rate-lab/new. The fixture
  // can also leak into a BOP-blank plan today; tightening on the
  // backend `template` field lands when the seed module ports.
  // PR A1 — Persist edited dimensions to localStorage. Lazy initializer
  // reads any prior session's state for this plan; falls back to empty.
  //
  // PR D3.7 — Tightened the fallback gate. Pre-D3.7 this used
  // `plan.line_of_business === "bop"` which fired for ANY BOP plan
  // (including the user's blank + nonprofit_990 templates) → 11 ISO
  // BOP dims got seeded + the useEffect on line 508 persisted them
  // to localStorage, overwriting template seed data. Now the
  // fixture only fires for the actual Meridian BOP sample plan.
  const [editedDimensions, setEditedDimensions] = useState<
    readonly DimensionRow[]
  >(() => {
    const stored = loadStoredDimensions(plan.rating_plan_id);
    if (stored !== null) return stored;
    return plan.rating_plan_id === SAMPLE_PLAN_ID
      ? SAMPLE_DIMENSIONS
      : [];
  });
  // Brief 66 §3.7 — the localStorage WRITE-THROUGH is decommissioned:
  // it was the Brief-60 clobber vector (stale local caches re-imposed
  // over API truth). The API is the source of truth; the lazy READ
  // above survives ONLY as the one-shot legacy-migration ramp (plans
  // last touched before D6.2 push their cache to the API on first
  // open, then never read it again) — delete it once fleets migrate.

  // -------------------------------------------------------------------
  // D6.2 / ADR-0027 — API-backed dimensions sync (multi-browser fix).
  //
  // The bug pre-D6.2: dims lived ONLY in localStorage, so a plan
  // authored in browser A was empty in browser B even though the
  // backend plan record was visible (the chain stages referenced
  // dim slugs the second browser couldn't resolve, so the inventory
  // rail + workspaces rendered blank).
  //
  // The fix: API is the source of truth. On mount per planId:
  //   · If API has dims → setEditedDimensions(api) (browser B
  //     hydrates from the same row browser A wrote)
  //   · If API empty AND localStorage has dims → bulk-upload them
  //     (browser A's first open after the API ships migrates its
  //     legacy cache to the server)
  //   · If both empty → no-op (fresh plan)
  //
  // Steady-state writes: every editedDimensions mutation is mirrored
  // to the API via the same bulk endpoint (replace-all atomicity).
  // The write is debounced ~400ms so per-keystroke autosaves coalesce
  // into one round trip.
  // -------------------------------------------------------------------
  const dimensionsApi = useDimensionsList(plan.rating_plan_id);
  const bulkUpsertDimsMutation = useBulkUpsertDimensions(plan.rating_plan_id);
  // Honest save status for the inline dimension editor's autosave pill —
  // the REAL debounced write, not a fake timer (QA finding #5).
  const dimsSaveState: "saving" | "saved" | "error" =
    bulkUpsertDimsMutation.isError
      ? "error"
      : bulkUpsertDimsMutation.isPending
        ? "saving"
        : "saved";
  // ── v4 G14 — precondition every dims replace-all on the last-seen
  // collection hash. A second writer (another tab) lands first → our
  // write 412s (`stale_write`) instead of silently wiping theirs; we
  // stop the sync and say so, once.
  const dimsHashRef = useRef<string | null>(null);
  const dimsConflictRef = useRef(false);
  const onDimsWriteSettled = useCallback(
    (
      res: { collection_hash?: string | null | undefined } | undefined,
      err: unknown,
    ) => {
      if (typeof res?.collection_hash === "string") {
        dimsHashRef.current = res.collection_hash;
      }
      if (
        err instanceof RaterApiError &&
        err.code === "stale_write" &&
        !dimsConflictRef.current
      ) {
        dimsConflictRef.current = true;
        notify(
          "Dimensions changed in another tab — your last edit wasn't " +
            "saved. Reload to continue editing.",
        );
      }
    },
    [notify],
  );
  const dimsIfMatch = () =>
    dimsHashRef.current !== null ? { ifMatch: dimsHashRef.current } : {};
  const dimsInitialSyncRef = useRef(false);
  // Brief 66 §3.2 — edits made while the dimensions GET is failing are
  // local-only. When the service comes back, those edits must WIN the
  // initial sync (the unconditional API-wins hydration would clobber
  // them — the reconnect variant of the Brief 60 class).
  const dimsEditedWhileBlockedRef = useRef(false);
  useEffect(() => {
    if (dimensionsApi.isError) dimsEditedWhileBlockedRef.current = true;
    // Marks only on edits DURING the failure window: this effect keys on
    // editedDimensions, and isError is read at edit time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedDimensions]);
  // Reset the one-shot guard whenever the plan id changes (route param
  // change without a remount — e.g. left-rail navigation).
  useEffect(() => {
    dimsInitialSyncRef.current = false;
    dimsEditedWhileBlockedRef.current = false;
  }, [plan.rating_plan_id]);

  // One-shot sync on first successful API response per plan id.
  useEffect(() => {
    if (dimsInitialSyncRef.current) return;
    if (!dimensionsApi.isSuccess) return;
    // G14 — capture the precondition token HERE, where local state is
    // reconciled with the server (adopt or push-over). A background
    // focus-refetch must never advance the token on its own: state
    // would stay stale while the token freshens, re-arming the exact
    // clobber the token exists to stop (caught live in verification).
    const dimsListHash = dimensionsApi.data.collection_hash;
    if (typeof dimsListHash === "string") {
      dimsHashRef.current = dimsListHash;
    }
    const apiDims = dimensionsApi.data.dimensions;
    if (apiDims.length > 0 && !dimsEditedWhileBlockedRef.current) {
      // API wins — hydrate local state with the server-truth.
      setEditedDimensions(apiDims.map(planDimensionToRow));
    } else if (dimsEditedWhileBlockedRef.current && isWritable) {
      // Brief 66 §3.2 — the user edited while the service was down;
      // their local state is the freshest truth. Push it (G14: still
      // preconditioned on the hash the reconnect GET just delivered).
      dimsEditedWhileBlockedRef.current = false;
      bulkUpsertDimsMutation.mutate(
        { ...dimensionRowsToBulkRequest(editedDimensions), ...dimsIfMatch() },
        {
          onSuccess: (res) => onDimsWriteSettled(res, undefined),
          onError: (err) => onDimsWriteSettled(undefined, err),
        },
      );
    } else if (editedDimensions.length > 0 && isWritable) {
      // API empty + local non-empty → migrate localStorage → API.
      // Fire-and-forget; the next reload reads from API. Gated on
      // writability: never migrate a stale local cache onto a frozen plan.
      bulkUpsertDimsMutation.mutate(
        { ...dimensionRowsToBulkRequest(editedDimensions), ...dimsIfMatch() },
        {
          onSuccess: (res) => onDimsWriteSettled(res, undefined),
          onError: (err) => onDimsWriteSettled(undefined, err),
        },
      );
    }
    dimsInitialSyncRef.current = true;
    // We intentionally only depend on the API success transition
    // (and the plan id, via the reset effect above). Re-running on
    // every editedDimensions change would cause an infinite loop
    // with the steady-state write effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensionsApi.isSuccess, plan.rating_plan_id]);

  // Steady-state debounced write — every local mutation propagates to
  // the API so other browsers + tabs converge on the latest state.
  // Skipped until the initial sync has run so we don't accidentally
  // overwrite the API with the lazy-init fallback.
  //
  // G15/G24 — the debounce is FLUSHABLE: `pending` survives the effect
  // cleanup, so "Freeze version" can land the write before the server
  // composes the snapshot, and a route-leave unmount lands it instead
  // of dropping the last <400ms of edits.
  const dimsDebounce = useRef(createFlushableDebounce(400)).current;
  const dimsWriteNowRef = useRef<() => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  dimsWriteNowRef.current = () =>
    bulkUpsertDimsMutation
      .mutateAsync({
        ...dimensionRowsToBulkRequest(editedDimensions),
        ...dimsIfMatch(),
      })
      .then(
        (res) => {
          onDimsWriteSettled(res, undefined);
          return res;
        },
        (err: unknown) => {
          onDimsWriteSettled(undefined, err);
          throw err;
        },
      );
  useEffect(() => {
    if (!dimsInitialSyncRef.current) return;
    // Read-only plans never write back — gates the debounced overwrite.
    if (!isWritable) return;
    // G14 — after a detected conflict, stop overwriting; the user was
    // told to reload (writing again would clobber the other writer).
    if (dimsConflictRef.current) return;
    dimsDebounce.arm(() => {
      bulkUpsertDimsMutation.mutate(
        {
          ...dimensionRowsToBulkRequest(editedDimensions),
          ...dimsIfMatch(),
        },
        {
          onSuccess: (res) => onDimsWriteSettled(res, undefined),
          onError: (err) => onDimsWriteSettled(undefined, err),
        },
      );
    });
    return () => dimsDebounce.disarm();
    // bulkUpsertDimsMutation is intentionally excluded — TanStack
    // returns a fresh ref each render, which would re-fire the
    // debounce every render. The ref is stable across the lifecycle
    // of one mutation hook instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedDimensions, plan.rating_plan_id]);
  const flushDimsSave = useCallback(
    () => dimsDebounce.flush(() => dimsWriteNowRef.current()),
    [dimsDebounce],
  );
  // G24 (SPA-nav half) — land a pending dims write on route leave.
  useEffect(
    () => () => {
      void flushDimsSave();
    },
    [flushDimsSave],
  );

  // Same gating for factor tables — only Meridian BOP plans see the BOP
  // fixture catalog. Other LOBs start with an empty factor-table
  // catalog so the user isn't authoring against pre-built tables
  // they didn't ask for.
  //
  // PR 14 — Promoted from useMemo → useState so the Parametrize
  // canvas's Save button can append user-authored tables. The
  // initial value still seeds from the BOP fixture for BOP plans
  // (matches the prior useMemo behavior). Backend persistence
  // (API Lab slice 6) lands when the factor-tables endpoint ships;
  // until then this state lives only in memory + dies on full
  // reload, matching the `editedDimensions` pattern.
  // PR A2 — Persist FT catalog (summaries) to localStorage. Same
  // pattern as A1: lazy load → fall back to BOP fixture → empty.
  const [editedFactorTables, setEditedFactorTables] = useState<
    readonly (typeof SAMPLE_FACTOR_TABLES)[number][]
  >(() => {
    const stored = loadStoredFactorTables(plan.rating_plan_id);
    if (stored !== null) return stored;
    // PR D3.7 — same tightening as editedDimensions above.
    return plan.rating_plan_id === SAMPLE_PLAN_ID
      ? SAMPLE_FACTOR_TABLES
      : [];
  });
  useEffect(() => {
    storeFactorTables(plan.rating_plan_id, editedFactorTables);
  }, [plan.rating_plan_id, editedFactorTables]);
  // Keep the old name as an alias so existing read sites don't
  // churn — the array is the same shape, just sourced from state.
  const planFactorTables = editedFactorTables;

  // P2 G13 (ADR-0056, D1) — readiness moved BELOW the projection memo:
  // the one selector now reads stage-KIND counts + the dry compile
  // (see `readiness` next to `chainProjection`). The stage-bucket +
  // factor-table-count rails are gone.

  // PR A2 — Sidecar cell-value map keyed by ft.id. Each FT's cells
  // are a Map<cellKey, number>; together they form the persisted
  // workbook of authored cell values. Without this, every page
  // reload zeros 11+ tables' worth of carefully-typed numbers.
  const [editedFactorTableCells, setEditedFactorTableCells] = useState<
    Map<string, Map<string, number>>
  >(() => loadStoredFactorTableCells(plan.rating_plan_id));

  // P2 G13 (ADR-0056, D1 ruled) — THE readiness signal is the DRY
  // COMPILE: project the substrate and ask (a) did a runnable chain
  // emit, (b) how many severity-error ProjectionIssues fired. Pure
  // data-shaping over ~dozens of stages (sub-ms); the Inputs mount
  // runs its own projection for scoring — the engine's purity makes
  // the two byte-identical.
  const dryProjection = useMemo(() => {
    try {
      const projected = stagesToRuntimePlan(
        plan.stages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editedDimensions as unknown as any,
        planFactorTables,
        editedFactorTableCells,
        { planId: `${plan.rating_plan_id}-readiness` },
      );
      return {
        hasRunnableChain: projected.plan.nodes.some(
          (n) => n.kind === "chain.mult",
        ),
        errorIssueCount: projected.issues.filter((i) => i.severity === "error")
          .length,
      };
    } catch {
      return { hasRunnableChain: false, errorIssueCount: 0 };
    }
  }, [
    plan.stages,
    plan.rating_plan_id,
    editedDimensions,
    planFactorTables,
    editedFactorTableCells,
  ]);

  // Brief 89 R7 — the RATE rail's second leg: fields the structure
  // reads that no input_node declares. compileReady is engine truth,
  // but an undeclared read compiles fine and REFUSES at run time —
  // the pill said "Ready to rate" over a red refusal (F5). Same
  // deriver the Inputs mount runs, so the counts always match the
  // dictionary. Brief 89 R8 splits the count: an undeclared UNSET
  // CONSTANT (column-shaped LCM) is "a step needs a value" (repair in
  // Rating), never a declare nudge.
  const requiredGap = useMemo(() => {
    try {
      const declared = new Set(
        stagesToInputDictEntries(plan.stages).map((e) => e.fieldName),
      );
      const undeclared = deriveRequiredInputs(
        plan.stages,
        // Same cast the Inputs mount uses — the deriver reads only
        // slug + display_name + shape off the dimension rows.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editedDimensions as unknown as any,
        { factorTables: planFactorTables },
      ).filter((r) => !declared.has(r.id));
      return {
        // Optional override columns (ADR-0047's overridable authored
        // LCM) have a fallback value — they never block readiness.
        undeclaredRequiredInputCount: undeclared.filter(
          (r) => r.constantSlot !== true && r.optional !== true,
        ).length,
        unsetValueStepCount: undeclared.filter((r) => r.constantSlot === true)
          .length,
      };
    } catch {
      return { undeclaredRequiredInputCount: 0, unsetValueStepCount: 0 };
    }
  }, [plan.stages, editedDimensions, planFactorTables]);

  const readiness = useMemo(
    () =>
      computePlanReadiness({
        declaredInputCount: stageKindCounts.inputs,
        chainStageCount: stageKindCounts.chains,
        projection: dryProjection,
        undeclaredRequiredInputCount: requiredGap.undeclaredRequiredInputCount,
        unsetValueStepCount: requiredGap.unsetValueStepCount,
      }),
    [stageKindCounts, dryProjection, requiredGap],
  );

  useEffect(() => {
    storeFactorTableCells(plan.rating_plan_id, editedFactorTableCells);
  }, [plan.rating_plan_id, editedFactorTableCells]);

  // -------------------------------------------------------------------
  // D6.3 / ADR-0027 — API-backed factor tables + cells sync.
  //
  // Same pattern as the dimensions sync above (D6.2). The API is the
  // source of truth; localStorage stays as a write-through cache.
  // The split UI state (`editedFactorTables` metadata +
  // `editedFactorTableCells` sidecar) is recombined into the unified
  // `PlanFactorTable` shape on read and write.
  // -------------------------------------------------------------------
  const factorTablesApi = useFactorTablesList(plan.rating_plan_id);
  // Brief 67 §3.2 — the honest FT save pill (the dims grammar): the
  // REAL bulk-sync mutation drives it, not a fake timer or a premature
  // toast.
  const bulkUpsertFtsMutation = useBulkUpsertFactorTables(plan.rating_plan_id);
  // Brief 67 walkthrough fix — the pill is HONEST about this session:
  // idle-never-ran renders nothing (it used to read "Saved" the moment
  // a table opened, before any write).
  const ftSaveState: "saving" | "saved" | "error" | undefined =
    bulkUpsertFtsMutation.isError
      ? "error"
      : bulkUpsertFtsMutation.isPending
        ? "saving"
        : bulkUpsertFtsMutation.isSuccess
          ? "saved"
          : undefined;
  const ftsInitialSyncRef = useRef(false);
  // ── v4 G14 — same precondition machinery as the dims sync above:
  // the last-seen collection hash rides every FT replace-all; a stale
  // write 412s, we stop the sync and say so once.
  const ftsHashRef = useRef<string | null>(null);
  const ftsConflictRef = useRef(false);
  const onFtsWriteSettled = useCallback(
    (
      res: { collection_hash?: string | null | undefined } | undefined,
      err: unknown,
    ) => {
      if (typeof res?.collection_hash === "string") {
        ftsHashRef.current = res.collection_hash;
      }
      if (
        err instanceof RaterApiError &&
        err.code === "stale_write" &&
        !ftsConflictRef.current
      ) {
        ftsConflictRef.current = true;
        notify(
          "Factor tables changed in another tab — your last edit wasn't " +
            "saved. Reload to continue editing.",
        );
      }
    },
    [notify],
  );
  const ftsIfMatch = () =>
    ftsHashRef.current !== null ? { ifMatch: ftsHashRef.current } : {};
  // G14 — the dims reconnect guard, generalized (Brief 66 §3.2): edits
  // made while the FT GET is failing must WIN the initial sync when the
  // service comes back, not be clobbered by the unconditional adopt.
  const ftsEditedWhileBlockedRef = useRef(false);
  useEffect(() => {
    if (factorTablesApi.isError) ftsEditedWhileBlockedRef.current = true;
    // Marks only on edits DURING the failure window (keys on the edited
    // state; isError read at edit time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedFactorTables, editedFactorTableCells]);
  useEffect(() => {
    ftsInitialSyncRef.current = false;
    ftsEditedWhileBlockedRef.current = false;
  }, [plan.rating_plan_id]);

  // One-shot sync on first successful API response per plan id.
  useEffect(() => {
    if (ftsInitialSyncRef.current) return;
    if (!factorTablesApi.isSuccess) return;
    // G14 — token captured at reconcile time only (see the dims note).
    const ftsListHash = factorTablesApi.data.collection_hash;
    if (typeof ftsListHash === "string") ftsHashRef.current = ftsListHash;
    const apiTables = factorTablesApi.data.factor_tables;
    if (apiTables.length > 0 && !ftsEditedWhileBlockedRef.current) {
      // API wins — hydrate both stores from server-truth.
      setEditedFactorTables(
        apiTables.map(
          planFactorTableToRow,
        ) as readonly (typeof SAMPLE_FACTOR_TABLES)[number][],
      );
      setEditedFactorTableCells(planFactorTablesToCellMap(apiTables));
    } else if (ftsEditedWhileBlockedRef.current && isWritable) {
      // G14 (Brief 66 §3.2 grammar) — the user edited while the service
      // was down; their local state is the freshest truth. Push it.
      ftsEditedWhileBlockedRef.current = false;
      bulkUpsertFtsMutation.mutate(
        {
          ...factorTablesToBulkRequest(
            editedFactorTables,
            editedFactorTableCells,
          ),
          ...ftsIfMatch(),
        },
        {
          onSuccess: (res) => onFtsWriteSettled(res, undefined),
          onError: (err) => onFtsWriteSettled(undefined, err),
        },
      );
    } else if (editedFactorTables.length > 0 && isWritable) {
      // API empty + local non-empty → migrate localStorage → API,
      // including the cell sidecar. Gated on writability: never migrate a
      // stale local cache onto a frozen plan.
      bulkUpsertFtsMutation.mutate(
        {
          ...factorTablesToBulkRequest(
            editedFactorTables,
            editedFactorTableCells,
          ),
          ...ftsIfMatch(),
        },
        {
          onSuccess: (res) => onFtsWriteSettled(res, undefined),
          onError: (err) => onFtsWriteSettled(undefined, err),
        },
      );
    }
    ftsInitialSyncRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factorTablesApi.isSuccess, plan.rating_plan_id]);

  // ADR-0064 — the run-staleness fingerprint: the plan-side scoring
  // substrate (stages + dimensions + factor-table cells + policy tail).
  // content_hash (ADR-0015) hashes stages + metadata ONLY, so a
  // cells-only edit changes every premium while the hash stands still;
  // every run captures this fingerprint at request time and the "plan
  // changed since this run" lines compare it first (isRunStale, with a
  // content-hash fallback for older runs). Held null until the dims +
  // factor-table queries hydrate — comparing a half-hydrated substrate
  // would flash a false stale line on a cold load.
  const [stalenessTail] = usePolicyTailSynced(plan.rating_plan_id, {
    writable: false,
  });
  const runScoringFingerprint = useMemo(
    () =>
      dimensionsApi.isSuccess && factorTablesApi.isSuccess
        ? computeScoringFingerprint(
            plan.stages,
            editedDimensions,
            editedFactorTableCells,
            { policyTail: stalenessTail },
          )
        : null,
    [
      dimensionsApi.isSuccess,
      factorTablesApi.isSuccess,
      plan.stages,
      editedDimensions,
      editedFactorTableCells,
      stalenessTail,
    ],
  );

  // Steady-state debounced write — fires whenever the metadata list
  // OR the cell map changes. Debounce coalesces per-keystroke autosave
  // bursts into one round trip.
  //
  // G15/G24 — flushable, same contract as the dims sync above.
  const ftsDebounce = useRef(createFlushableDebounce(400)).current;
  const ftsWriteNowRef = useRef<() => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  ftsWriteNowRef.current = () =>
    bulkUpsertFtsMutation
      .mutateAsync({
        ...factorTablesToBulkRequest(
          editedFactorTables,
          editedFactorTableCells,
        ),
        ...ftsIfMatch(),
      })
      .then(
        (res) => {
          onFtsWriteSettled(res, undefined);
          return res;
        },
        (err: unknown) => {
          onFtsWriteSettled(undefined, err);
          throw err;
        },
      );
  useEffect(() => {
    if (!ftsInitialSyncRef.current) return;
    // Read-only plans never write back — gates the debounced overwrite.
    if (!isWritable) return;
    // G14 — after a detected conflict, stop overwriting (reload to
    // continue); writing again would clobber the other writer.
    if (ftsConflictRef.current) return;
    ftsDebounce.arm(() => {
      bulkUpsertFtsMutation.mutate(
        {
          ...factorTablesToBulkRequest(
            editedFactorTables,
            editedFactorTableCells,
          ),
          ...ftsIfMatch(),
        },
        {
          onSuccess: (res) => onFtsWriteSettled(res, undefined),
          onError: (err) => onFtsWriteSettled(undefined, err),
        },
      );
    });
    return () => ftsDebounce.disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedFactorTables, editedFactorTableCells, plan.rating_plan_id]);
  const flushFtsSave = useCallback(
    () => ftsDebounce.flush(() => ftsWriteNowRef.current()),
    [ftsDebounce],
  );
  // G24 (SPA-nav half) — land a pending factor-table write on route leave.
  useEffect(
    () => () => {
      void flushFtsSave();
    },
    [flushFtsSave],
  );

  // Brief 30 PR 30.7 — Edit-in-place deep-link.
  //
  // When the user clicks "Open dim editor ↗" from <LevelEditPopover>
  // in the factor-table route, that route navigates here with:
  //   • `?dim=<slug>` — auto-opens the inline editor for this dim
  //   • `location.state.returnTo` — the back-crumb payload
  //
  // We project both into the workspace via the existing
  // `editingDimensionId` + the new `returnTo` prop.
  const location = useLocation();
  const dimQueryParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("dim");
  }, [location.search]);

  // Brief 67 §3.1 — Factor Tables view state (URL-controlled).
  // `?table=<id>` opens the editor act on a saved table; `?table=new`
  // enters creation; no param renders the catalog. The old
  // `?mode=canvas|saved` toggle is retired — legacy `?mode` params
  // are ignored (and cleared on the next navigation).
  const editingTableId = useMemo<string | null>(() => {
    const params = new URLSearchParams(location.search);
    return params.get("table");
  }, [location.search]);
  // Brief 67 §3.1 — `?table=new&axis=<slug>` pre-seeds the creation
  // draft's row axis (the Dimensions "Use as factor table key" jump
  // lands with the dim already in place instead of a toast telling
  // the user which chip to grab).
  const creatingAxisSlug = useMemo<string | null>(() => {
    const params = new URLSearchParams(location.search);
    return params.get("axis");
  }, [location.search]);
  const handleOpenFactorTableInline = useCallback(
    (tableId: string) => {
      const params = new URLSearchParams(location.search);
      params.set("table", tableId);
      params.delete("mode");
      params.delete("axis");
      // Brief 78 (P5.1) — opening a table lands in the compact
      // INSPECTOR; the full-width takeover is an explicit "Expand".
      params.delete("expand");
      navigate(`${location.pathname}?${params.toString()}`, { replace: false });
    },
    [location.pathname, location.search, navigate],
  );
  const handleBackToCatalog = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete("table");
    params.delete("mode");
    params.delete("axis");
    params.delete("expand");
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
      replace: false,
    });
  }, [location.pathname, location.search, navigate]);
  // Brief 82 R1 — `?expand=1` is ABSORBED: any `?table=<id>` opens the
  // full-width takeover now (the inspector pane is gone), so the old
  // Brief 78 expand/collapse state + handlers died. Deep links carrying
  // `&expand=1` still land correctly — the param is simply ignored.

  // Resolve `?dim=<slug>` to a real dim row + auto-open the editor.
  useEffect(() => {
    if (dimQueryParam === null) return;
    const target = editedDimensions.find(
      (d) => d.slug === dimQueryParam || d.id === dimQueryParam,
    );
    if (target && editingDimensionId !== target.id) {
      setEditingDimensionId(target.id);
    }
    // Intentionally ignore editingDimensionId in deps so the user can
    // navigate away from the editor without us re-opening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimQueryParam, editedDimensions]);

  // Read the back-crumb payload from location state (set by the
  // factor-table route's "Open dim editor" handler).
  const returnTo = useMemo(() => {
    const state = location.state as {
      returnTo?: { label?: string; href?: string };
    } | null;
    const rt = state?.returnTo;
    if (!rt || !rt.href || !rt.label) return null;
    return { label: rt.label, href: rt.href };
  }, [location.state]);

  const handleReturnToConsumer = useCallback(() => {
    if (returnTo) navigate(returnTo.href);
  }, [returnTo, navigate]);

  // Closed-over wrapper for the workspace prop. `null` when no
  // returnTo state was provided so the back-crumb stays hidden.
  const returnToWithHandler = useMemo(
    () =>
      returnTo
        ? { label: returnTo.label, onClick: handleReturnToConsumer }
        : null,
    [returnTo, handleReturnToConsumer],
  );

  const handleAddStage = (section: Section) => {
    if (section.id === "rating-chains") {
      // The "Add factor" affordance lives inside each <RatingChainCard>
      // (per-card per-chain). The section-level Add button creates a
      // new chain stage entirely — deferred to a follow-up.
      notify("Adding a rating chain here is coming soon.");
      return;
    }
    if (section.id === "loadings" || section.id === "final-adjustments") {
      // M4.13 — Loadings open the FlatFactorStageDrawer in add mode.
      // M4.14 — Final Adjustments do the same. Clamp + round editing
      // lands in a follow-up PR (different config shapes).
      setFlatFactorDraft(emptyFlatFactorDraft());
      setEditor({ kind: "add-flat-factor", section });
      return;
    }
    // Every other section has no add affordance today.
    notify(`The ${section.name} editor is coming soon.`);
  };

  const handleEditStage = (section: Section, stage: StageSummary) => {
    if (
      (section.id === "loadings" || section.id === "final-adjustments") &&
      stage.stage_kind === "flat_factor"
    ) {
      // M4.13 + M4.14 — pre-populate the flat-factor drawer with
      // the stage's existing config_json and open in edit mode.
      setFlatFactorDraft(stageToFlatFactorDraft(stage));
      setEditor({ kind: "edit-flat-factor", section, stage });
      return;
    }
    if (section.id === "final-adjustments" && stage.stage_kind === "clamp") {
      // M4.15 — clamp editor.
      setClampDraft(stageToClampDraft(stage));
      setEditor({ kind: "edit-clamp", section, stage });
      return;
    }
    if (section.id === "final-adjustments" && stage.stage_kind === "round") {
      // M4.15 — round editor.
      setRoundDraft(stageToRoundDraft(stage));
      setEditor({ kind: "edit-round", section, stage });
      return;
    }
    // No row-level editor for the other sections today.
    notify(`The editor for "${stage.display_name}" is coming soon.`);
  };

  // V2_INTERFACE_SPEC §2.5 — handleDeleteStage / handleAdd-Edit-Remove-
  // Factor + confirmRemoveFactor were deleted: they were reachable only
  // through the unreachable per-section arms (the Assemble gate owns
  // those sections). Preserved in git history; the Algorithm pass (P6)
  // re-homes factor editing in the canvas.

  const handleCloseDrawer = () => {
    setEditor({ kind: "closed" });
    removeMutation.reset();
  };

  const handleCancelDelete = () => {
    if (editor.kind === "delete-confirm") {
      setEditor({ kind: "closed" });
      removeMutation.reset();
    }
  };

  const handleConfirmDelete = async () => {
    if (editor.kind !== "delete-confirm") return;
    const { stage } = editor;
    const label = stageLabel(stage);
    try {
      await removeMutation.mutateAsync({ stageId: stage.stage_id });
      setEditor({ kind: "closed" });
      notify(`Removed "${label}"`);
    } catch {
      // error stays on removeMutation.error; the confirmation panel
      // renders the banner. User can click Back to close, or retry.
    }
  };

  const isDeleteConfirmDrawerOpen = editor.kind === "delete-confirm";
  const isChainFactorDrawerOpen =
    editor.kind === "add-chain-factor" || editor.kind === "edit-chain-factor";
  const isFlatFactorDrawerOpen =
    editor.kind === "add-flat-factor" || editor.kind === "edit-flat-factor";
  const isClampDrawerOpen = editor.kind === "edit-clamp";
  const isRoundDrawerOpen =
    editor.kind === "add-round" || editor.kind === "edit-round";

  const handleCloseChainFactorDrawer = () => {
    setEditor({ kind: "closed" });
    setChainFactorDraft(emptyDraftForKind(""));
    addStageMutation.reset();
    patchStageConfigMutation.reset();
  };

  // M4.13 — flat-factor (Loadings + later Final Adj) save handlers.
  const handleCloseFlatFactorDrawer = () => {
    setEditor({ kind: "closed" });
    setFlatFactorDraft(emptyFlatFactorDraft());
    addStageMutation.reset();
    patchStageConfigMutation.reset();
  };

  // M4.15 — clamp + round save handlers.
  const handleCloseClampDrawer = () => {
    setEditor({ kind: "closed" });
    setClampDraft(emptyClampDraft());
    addStageMutation.reset();
    patchStageConfigMutation.reset();
  };

  const handleCloseRoundDrawer = () => {
    setEditor({ kind: "closed" });
    setRoundDraft(emptyRoundDraft());
    addStageMutation.reset();
    patchStageConfigMutation.reset();
  };

  // PR 12.2 — Assemble save handler. `SectionDetailPane` owns the
  // editedPlan + the `towerPlanToStages` projection; this callback
  // takes the resulting desired-stages array, diffs it against the
  // current `plan.stages`, and dispatches add / patch / remove
  // mutations one stage at a time. Toast surfaces the count breakdown
  // so the user sees what landed without opening the network panel.
  //
  // Diff rules:
  //   - In desired + NOT in plan.stages → add
  //   - In both + config_json differs   → patch
  //   - In plan.stages + NOT in desired → remove
  //
  // The converter (PR 12.1) preserves sidecar stages (loadings,
  // modifiers, clamps, etc.) via `preservedStages` so they round-
  // trip untouched; their config_json should not differ. The diff
  // still catches it if it does.
  const [isSavingAssemble, setIsSavingAssemble] = useState(false);
  const handleSaveAssembleStages = useCallback(
    async (
      desired: readonly {
        readonly stage_id: string;
        readonly stage_kind: string;
        readonly display_name: string;
        readonly config_json: Record<string, unknown> | null;
      }[],
    ) => {
      // Read-only choke point: never dispatch stage mutations on a
      // non-draft plan (the backend 409s every add/remove/patch). The
      // autosave effect is gated too, but ALL Assemble persistence flows
      // through here, so this is the load-bearing guard.
      if (!isWritable) return;
      setIsSavingAssemble(true);
      try {
        const currentById = new Map(plan.stages.map((s) => [s.stage_id, s]));
        const desiredIds = new Set(desired.map((s) => s.stage_id));

        const toAdd = desired.filter((s) => !currentById.has(s.stage_id));
        const toRemove = plan.stages.filter((s) => !desiredIds.has(s.stage_id));
        const toPatch = desired.filter((s) => {
          const cur = currentById.get(s.stage_id);
          if (!cur) return false;
          // Cheap deep-equality check via JSON.stringify; chain
          // configs are small (few KB) so the cost is negligible.
          return (
            JSON.stringify(cur.config_json ?? {}) !==
            JSON.stringify(s.config_json ?? {})
          );
        });

        for (const s of toAdd) {
          const request: AddStageRequest = {
            stage_id: s.stage_id,
            stage_kind: s.stage_kind,
            display_name: s.display_name,
            config_json: s.config_json ?? {},
            inputs: [],
            outputs: [],
          };
          await addStageMutation.mutateAsync(request);
        }

        if (toPatch.length > 0) {
          const patch: PatchDraftRequest = {
            stage_patches: toPatch.map((s) => ({
              stage_id: s.stage_id,
              config_json: s.config_json ?? {},
            })),
          };
          await patchStageConfigMutation.mutateAsync(patch);
        }

        for (const s of toRemove) {
          await removeMutation.mutateAsync({ stageId: s.stage_id });
        }

        // E12 — optimistically reconcile the plan-detail cache to the
        // just-saved stages so the Assemble dirty signal clears immediately
        // (Unsaved → Saving… → All changes saved) instead of lingering on
        // "Unsaved changes" until the mutations' invalidate-driven refetch
        // lands. This runs ONLY on the success path (after every mutation
        // resolved) — a failed save throws above, leaving the cache (and the
        // honest "Unsaved" pill) untouched. The mutations already invalidated
        // the detail query, so the authoritative refetch still lands and
        // overwrites these optimistic rows with the backend's canonical shape.
        queryClient.setQueryData(
          plansQueryKeys.detail(plan.rating_plan_id),
          (old: PlanDetail | undefined): PlanDetail | undefined => {
            if (!old) return old;
            const prevById = new Map(
              old.stages.map((s) => [s.stage_id, s] as const),
            );
            const nextStages: StageSummary[] = desired.map((d, i) => {
              const prev = prevById.get(d.stage_id);
              return {
                citation_rule: null,
                citation_page: null,
                source_filing_id: null,
                ...(prev ?? {}),
                stage_id: d.stage_id,
                stage_kind: d.stage_kind,
                display_name: d.display_name,
                config_json: d.config_json ?? {},
                sequence: i,
              };
            });
            return { ...old, stages: nextStages };
          },
        );

        const parts: string[] = [];
        if (toAdd.length > 0) parts.push(`${toAdd.length} added`);
        if (toPatch.length > 0) parts.push(`${toPatch.length} updated`);
        if (toRemove.length > 0) parts.push(`${toRemove.length} removed`);
        // v4 P0.8 — only announce a real change; a clean no-op save (the
        // backoff retry that finally lands with nothing left to write) stays
        // silent so the recovery doesn't itself become a toast.
        if (parts.length > 0) notify(`Saved · ${parts.join(" · ")}`);
      } catch (err) {
        // v4 P0.8 (G23) — RETHROW so the caller (SectionDetailPane's
        // autosave) can track the failure streak, back off, and drive the
        // honest "Save failed" pill. Previously this swallowed the error and
        // toasted per-attempt, which — with the content still dirty — became
        // an unbounded ~1Hz retry + toast storm. The toast now fires once,
        // from the caller, on the first failure of a streak.
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        setIsSavingAssemble(false);
      }
    },
    [
      isWritable,
      plan.stages,
      plan.rating_plan_id,
      queryClient,
      addStageMutation,
      patchStageConfigMutation,
      removeMutation,
      notify,
    ],
  );

  // ── 24.C — DimensionsWorkspace handlers ────────────────────────
  //
  // The workspace emits one `onSelect(dimId)` event per row click; the
  // route picks the subtype-appropriate handoff: Standard / Banded /
  // Geographic editing all happen INLINE in the workspace center pane
  // (categorical+banded via <DimensionEditor>, geographic via
  // <GeoDimEditor> after Brief 44 PR 44.11). Classification still uses
  // a separate route. Composite emits a toast for now.
  const handleSelectDimension = (dimId: string) => {
    const dim = editedDimensions.find((d) => d.id === dimId);
    if (!dim) return;
    // Brief 30 PR 30.1 + 30.2 + Brief 44 PR 44.11 — categorical,
    // banded, AND geographic editing all happen INLINE in the
    // workspace center pane. The workspace already set
    // editingDimensionId on click; this handler only routes the
    // shapes whose editor still lives elsewhere (Classification —
    // Composite emits a toast).
    if (dim.shape === "banded") return; // inline
    const subtype = dim.dimension_type ?? "standard";
    if (subtype === "geographic") {
      // Brief 44 PR 44.11 — geographic opens inline in the workspace
      // center pane via <GeoDimEditor>. Unlike categorical/banded
      // (which jump to the editor on the single row-click), a
      // geographic row click only SELECTS the dim (inspect-first);
      // the inspector's "Edit dimension" button is the editor entry
      // point and routes here. So this handler must set
      // editingDimensionId itself — the workspace has NOT set it (the
      // row-click inline-edit path is gated to standard/banded). The
      // matching DimensionsWorkspace `editingDim` memo now resolves
      // geographic so the GeoDimEditor branch mounts.
      setEditingDimensionId(dimId);
      return;
    }
    // Brief 66 §3.3 — classification no longer hijacks the row click
    // (it ejected the user off the surface AND lost the query string);
    // the detail pane's explicit "Manage class registry" CTA owns the
    // jump via onOpenClassRegistry below.
    // Standard (categorical) is also inline now — no-op.
  };

  // Brief 66 §3.3 — the explicit class-registry jump, carrying the
  // current query string (the old navigate dropped ?dims2 and the
  // back-journey landed on the WRONG dimensions surface).
  const handleOpenClassRegistry = useCallback(
    (_dimId: string) => {
      navigate(
        `/rate-lab/${plan.rating_plan_id}/classification${window.location.search}`,
      );
    },
    [navigate, plan.rating_plan_id],
  );

  /**
   * Brief 30 PR 30.1 — Inline-create flow for categorical dims.
   *
   * Creates an empty categorical DimensionRow with a unique
   * auto-generated id, appends to editedDimensions, and sets the
   * workspace's editingDimensionId so the inline editor opens
   * for the new dim. The user's first field blur autosaves the
   * dim's name/slug/etc. into the same row.
   */
  const handleAddCategoricalDimension = () => {
    // Unique id within the current plan's editedDimensions set.
    let counter = editedDimensions.length + 1;
    let candidate = `dim_${counter}`;
    const existingIds = new Set(editedDimensions.map((d) => d.id));
    while (existingIds.has(candidate)) {
      counter += 1;
      candidate = `dim_${counter}`;
    }
    const newDim: DimensionRow = {
      id: candidate,
      display_name: "",
      slug: candidate,
      // Categorical defaults — Brief 30 locks data_type silent to
      // "string" + Role removed.
      data_type: "string",
      role: "rating-input",
      dimension_type: "standard",
      shape: "categorical",
      levels: [],
    };
    setEditedDimensions((prev) => [...prev, newDim]);
    setEditingDimensionId(newDim.id);
  };

  // Brief 53 — ensure the canonical Building / BPP coverage structural
  // dimension exists (idempotent on slug). Fired by the Parametrize
  // "+ Coverage split" so a 2-D property table is buildable without
  // hand-authoring a coverage dim. Appending triggers the editedDimensions
  // autosave; ParametrizeCanvas assigns it to the draft's column axis.
  const handleEnsureCoverageDimension = () => {
    setEditedDimensions((prev) =>
      prev.some((d) => d.slug === CANONICAL_COVERAGE_DIMENSION.slug)
        ? prev
        : [...prev, CANONICAL_COVERAGE_DIMENSION],
    );
  };

  // Brief 44 PR 44.11 — Geographic dims are authored by the inline
  // <GeoDimWizard> modal. The modal collects granularity + scope +
  // display name; on Create, the route materializes a DimensionRow,
  // appends it to editedDimensions, and opens the row in the
  // workspace's center pane (where <GeoDimEditor> takes over). The
  // legacy `navigate('/territories')` path is gone — that route is
  // deprecation-bannered + scheduled for removal in PR 44.12.
  const handleAddGeographicDimension = () => {
    setGeographicWizardOpen(true);
  };
  /**
   * Brief 44 PR 44.11 — GeoDimWizard.onCreate handler. Materializes
   * the wizard's `GeoDimDraft` into a fully-typed `DimensionRow`,
   * appends to editedDimensions, closes the wizard, and opens the
   * new row in the workspace's center pane (where GeoDimEditor
   * renders via the dimension_type === "geographic" branch).
   */
  const handleCreateGeographicDimension = (draft: GeoDimDraft) => {
    // Ensure a unique id within the current plan's editedDimensions.
    // The wizard suggests one, but the route owns final uniqueness.
    const existingIds = new Set(editedDimensions.map((d) => d.id));
    let id = draft.dim_id;
    if (existingIds.has(id)) {
      let suffix = 2;
      while (existingIds.has(`${draft.dim_id}_${suffix}`)) suffix += 1;
      id = `${draft.dim_id}_${suffix}`;
    }
    const newDim: DimensionRow = {
      id,
      display_name: draft.display_name,
      slug: draft.slug,
      data_type: draft.data_type,
      role: draft.role,
      dimension_type: draft.dimension_type,
      shape: draft.shape,
      geo_granularity: draft.geo_granularity,
      geo_scope: draft.geo_scope,
      geo_territories: draft.geo_territories.map((t) => ({
        id: t.id,
        label: t.label,
        members: [...t.members],
      })),
      levels: draft.levels.map((l) => ({
        kind: "categorical" as const,
        id: l.id,
        label: l.label,
      })),
    };
    setEditedDimensions((prev) => [...prev, newDim]);
    setGeographicWizardOpen(false);
    setGeographicActiveTab("levels");
    setEditingDimensionId(newDim.id);
  };
  const handleAddClassificationDimension = () => {
    navigate(`/rate-lab/${plan.rating_plan_id}/classification`);
  };

  /**
   * Brief 30 PR 30.2 — Inline-create flow for banded dims (mirrors
   * the categorical create from PR 30.1). Seeds 5 equal-width bands
   * across [0, 100] so the user sees the scrubber + level table
   * populated immediately + can tweak from there.
   */
  const handleAddBandedDimension = () => {
    let counter = editedDimensions.length + 1;
    let candidate = `dim_${counter}`;
    const existingIds = new Set(editedDimensions.map((d) => d.id));
    while (existingIds.has(candidate)) {
      counter += 1;
      candidate = `dim_${counter}`;
    }
    // Brief 66 §3.5 — the honest seed: ONE open band ("0 and up"), not
    // five fake 0-100 placeholders the actuary must delete by hand.
    // Clearing a band's hi cell authors an open end; "Add another
    // level" splits from there.
    const newDim: DimensionRow = {
      id: candidate,
      display_name: "",
      slug: candidate,
      data_type: "number",
      role: "rating-input",
      dimension_type: "standard",
      shape: "banded",
      levels: [
        {
          kind: "banded" as const,
          id: "band_0_up",
          label: "",
          lo: 0,
          hi: Number.POSITIVE_INFINITY,
        },
      ],
    };
    setEditedDimensions((prev) => [...prev, newDim]);
    setEditingDimensionId(newDim.id);
  };

  /**
   * Brief 27 PR 1 — Single Add handler off the workspace's tool pane.
   * Replaces the old shape-picker modal + 4 separate per-subtype
   * Add handlers. The workspace fires one of 5 choices; we dispatch
   * to the shape-appropriate flow:
   *   • categorical → DimensionStandardDrawer
   *   • banded → DimensionBandedDrawer
   *   • geographic → /territories route
   *   • classification → /classification route
   *   • composite → toast (PR 5 lands the picker)
   */
  const handleAddDimensionShape = (kind: DimensionShapeChoice) => {
    if (kind === "categorical") {
      // Brief 30 PR 30.1 — categorical "Add" creates the dim inline
      // and opens the workspace's inline editor for it.
      handleAddCategoricalDimension();
      return;
    }
    if (kind === "banded") {
      handleAddBandedDimension();
      return;
    }
    if (kind === "geographic") {
      handleAddGeographicDimension();
      return;
    }
    if (kind === "classification") {
      handleAddClassificationDimension();
      return;
    }
    // ADR-0051 — composite creation is retired: ADR-0039's
    // coverage_value slicing + the structural coverage dim cover the
    // 2-D case. The Add menu no longer offers it; this arm is
    // unreachable and exists only as the exhaustiveness backstop.
  };

  /**
   * Brief 30 PR 30.1 — Autosave commit handler. Fires when the inline
   * <DimensionEditor> patches the editing dim on field blur. We map
   * by id and replace the row (the inline editor patches the full
   * `DimensionRow` in `onChange`'s merged object).
   */
  const handleCommitDimension = (dim: DimensionRow) => {
    setEditedDimensions((prev) => prev.map((d) => (d.id === dim.id ? dim : d)));
  };

  /**
   * Brief 30 PR 30.5 — Delete-with-impact flow.
   *
   * Replaces the PR 30.1 window.confirm() placeholder. The editor's
   * delete button opens the `<DimensionDeletePrompt>` modal; the
   * modal renders the impact preview (reference list) + explicit
   * confirm/cancel. Confirm wires through here to do the actual
   * mutation.
   */
  const [deleteImpactDimId, setDeleteImpactDimId] = useState<string | null>(
    null,
  );

  const handleDeleteDimension = (dimId: string) => {
    setDeleteImpactDimId(dimId);
  };

  const handleConfirmDeleteDimension = () => {
    const dimId = deleteImpactDimId;
    if (dimId === null) return;
    const dim = editedDimensions.find((d) => d.id === dimId);
    // PR-D — never fall back to the slug / raw id in user-facing copy.
    const label = dim?.display_name || "Untitled dimension";
    setEditedDimensions((prev) => prev.filter((d) => d.id !== dimId));
    if (editingDimensionId === dimId) {
      setEditingDimensionId(null);
    }
    setDeleteImpactDimId(null);
    notify(`Deleted "${label}".`);
  };

  const handleCancelDeleteDimension = () => {
    setDeleteImpactDimId(null);
  };

  /**
   * Brief 30 PR 30.4 — Reference resolver. Returns the list of
   * places `dimId` is used (chains / factor tables / modifiers)
   * so the inline editor's `<UsedInPanel>` can render its
   * navigational hub. Pure walk over the plan + the fixture refs;
   * cached via the workspace's `useMemo`.
   *
   * Wraps the pure helper from @openrater/contracts. The dim's
   * `slug` is the substrate's lookup key; the `dimId` is the
   * route-stable id (today they're equal, but they're separate
   * fields for forward compat).
   *
   * Brief 34 PR 34.7 removed the curve walk: curves no longer
   * exist as a first-class concept (Brief 19 → Brief 34 supersession).
   */
  const handleResolveReferences = useCallback(
    (dimId: string) => {
      const dim = editedDimensions.find((d) => d.id === dimId);
      if (!dim) return [];
      const lite = findDimensionReferences({
        dimSlug: dim.slug,
        dimId: dim.id,
        stages: plan.stages,
        factorTables: planFactorTables,
      });
      // The lite shape is a strict subset of DimensionReference (no
      // React-specific fields). Pass through verbatim — the @openrater/ui
      // type is structurally compatible.
      return lite as readonly DimensionReference[];
    },
    [editedDimensions, plan.stages],
  );

  // Brief 30 PR 30.5 — Memoize the delete-target dim + its
  // references so the modal doesn't recompute on unrelated
  // re-renders. Lives here (after handleResolveReferences) so it
  // can call into the resolver.
  const deleteImpactDim = useMemo(
    () =>
      deleteImpactDimId === null
        ? null
        : (editedDimensions.find((d) => d.id === deleteImpactDimId) ?? null),
    [deleteImpactDimId, editedDimensions],
  );
  const deleteImpactReferences = useMemo(
    () =>
      deleteImpactDimId === null
        ? []
        : handleResolveReferences(deleteImpactDimId),
    [deleteImpactDimId, handleResolveReferences],
  );

  /**
   * Brief 30 PR 30.4 — onJumpToReference. The workspace fires this
   * when the user clicks a row in the Used-in panel. We switch on
   * the reference kind + dispatch the right navigation. For chain
   * refs the id encodes `stageId::chainIndex::factorIndex`; for the
   * other kinds the id is route-stable.
   */
  const handleJumpToReference = useCallback(
    (ref: DimensionReference) => {
      switch (ref.kind) {
        case "chain": {
          // For now toast — section-scroll-to-factor lands when the
          // CT editor accepts a deep-link query param. Same pattern
          // as the existing onOpenSourceForNode handler.
          notify(
            `Open the rating chain "${ref.label}" — available when you edit a factor inside a coverage chain.`,
          );
          return;
        }
        case "factor-table": {
          navigate(`/rate-lab/${plan.rating_plan_id}/factor-tables/${ref.id}`);
          return;
        }
        case "modifier": {
          notify(`The editor for "${ref.label}" is coming soon.`);
          return;
        }
      }
    },
    [navigate, notify, plan.rating_plan_id],
  );

  /**
   * Brief 30 PR 30.4 — Empty-state CTAs from <UsedInPanel>.
   * Both fire toasts in this PR. The actual deep-link flows are
   * heavier and live in a follow-up:
   *   • "Reference in a chain factor" → opens the chain factor
   *     drawer with this dim pre-keyed (touches FactorEditor)
   *   • "Use as factor table key" → opens a new factor table
   *     with this dim pre-selected (touches FactorTableEditor)
   */
  const handleReferenceInChain = useCallback(
    (dimId: string) => {
      const dim = editedDimensions.find((d) => d.id === dimId);
      // PR-D — never fall back to the slug / raw id in user-facing copy.
      const label = dim?.display_name || "Untitled dimension";
      notify(
        `Use "${label}" in a coverage chain — opens the factor form ready to connect.`,
      );
    },
    [editedDimensions, notify],
  );

  const handleUseAsFactorTableKey = useCallback(
    (dimId: string) => {
      // PR 14 (follow-up) — was "lands with API Lab slice 6" toast.
      // Now: switch to the Parametrize canvas (so the user can
      // immediately drop "<label>" onto an axis + Generate + Save).
      // Pre-seeding the axis automatically lands in a follow-up;
      // for now the toast names the dim so the user can grab the
      // right chip.
      const dim = editedDimensions.find((d) => d.id === dimId);
      const slug = dim?.slug ?? dimId;
      // Brief 67 §3.1 — land in CREATION with the dim already seeded
      // on the row axis (the old flow dropped the user on the canvas
      // and toasted which chip to drag).
      navigate(
        `/rate-lab/${plan.rating_plan_id}/workspace/parametrize?table=new&axis=${encodeURIComponent(slug)}`,
        { replace: false },
      );
    },
    [editedDimensions, navigate, plan.rating_plan_id],
  );

  /**
   * Brief 30 PR 30.6 — Composite axis side-channel.
   *
   * Fired after `onCommitDimension` has already persisted the new
   * axes vector. We only toast on `"reorder"` per the §−1 Q10 lock:
   * factor tables keyed on this composite re-key their column
   * order when axes reorder, so the actuary needs to know. Add /
   * remove are visible changes via the in-pane list itself; no
   * toast needed.
   */
  const handleCompositeAxisChange = useCallback(
    (
      dimId: string,
      _next: readonly string[],
      kind: "add" | "remove" | "reorder",
    ) => {
      if (kind !== "reorder") return;
      const dim = editedDimensions.find((d) => d.id === dimId);
      // PR-D — never fall back to the slug / raw id in user-facing copy.
      const label = dim?.display_name || "Untitled dimension";
      notify(
        `Axis order changed for "${label}". Factor tables keyed on this composite will re-key their columns to match.`,
      );
    },
    [editedDimensions, notify],
  );

  // ── 24.F — Parametrize Add handlers ───────────────────────────
  const handleAddFactorTable = useCallback(
    (nameSeed?: unknown) => {
      // Brief 67 §3.1 — "New table" ENTERS the editor act (?table=new).
      // The catalog is the section's resting state; creation is an act
      // you enter and leave. The axis-drop onboarding on the canvas
      // guides from there (the old instructional toast died with it).
      // Brief 89 R5 — the picker's create row seeds the future table's
      // NAME through the same URL grammar (`&name=`), mirroring the
      // `&axis=` pre-seed. Guarded to strings: some callers pass this
      // as a bare onClick handler (the event object is not a name).
      const params = new URLSearchParams(location.search);
      params.delete("mode");
      params.set("table", "new");
      if (typeof nameSeed === "string" && nameSeed.trim().length > 0) {
        params.set("name", nameSeed.trim());
      } else {
        params.delete("name");
      }
      navigate(`${location.pathname}?${params.toString()}`, { replace: false });
    },
    [location.pathname, location.search, navigate],
  );

  // Brief 70 §1 — CREATE-ON-PICK. The creation question (or the CSV
  // inference confirm, or the dims "Use as factor table key" jump)
  // CREATES the table immediately: minted identity, identity 1.00
  // cells, persisted through the steady-state bulk sync, and the URL
  // moves to ?table=<id>. No draft state ever exists.
  const mintFactorTableId = useCallback(
    (title: string): string => {
      const baseSlug =
        title
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "factor_table";
      const existingIds = new Set(editedFactorTables.map((ft) => ft.id));
      let id = baseSlug;
      let n = 2;
      while (existingIds.has(id)) {
        id = `${baseSlug}_${n}`;
        n += 1;
      }
      return id;
    },
    [editedFactorTables],
  );
  const createFactorTable = useCallback(
    (
      title: string,
      keyDims: readonly string[],
      cells: ReadonlyMap<string, number>,
    ) => {
      const id = mintFactorTableId(title);
      const next: (typeof SAMPLE_FACTOR_TABLES)[number] = {
        id,
        slug: id,
        display_name: title.trim(),
        description: "",
        ...(keyDims.length === 2
          ? { key_dimensions: [...keyDims] }
          : keyDims[0]
            ? { key_dimension: keyDims[0] }
            : {}),
      };
      setEditedFactorTables((prev) => [...prev, next]);
      if (cells.size > 0) {
        setEditedFactorTableCells((prev) => {
          const map = new Map(prev);
          map.set(id, new Map(cells));
          return map;
        });
      }
      const params = new URLSearchParams(location.search);
      params.set("table", id);
      params.delete("axis");
      // Brief 89 R5 — the `name` seed is consumed by this creation;
      // it leaves the URL with the creation act.
      params.delete("name");
      navigate(`${location.pathname}?${params.toString()}`, {
        replace: true,
      });
      return id;
    },
    [mintFactorTableId, location.pathname, location.search, navigate],
  );
  const handleCreateFromDimension = useCallback(
    (dimSlug: string) => {
      const dim = editedDimensions.find((d) => d.slug === dimSlug);
      if (!dim) return;
      const levels = levelsForKeying(dim);
      if (levels.length === 0) return;
      // Brief 89 R5 — a picker-created table keeps the AUTHOR'S name
      // (the `&name=` seed) over the derived "{dim} factors".
      const nameSeed = new URLSearchParams(location.search).get("name");
      const title =
        nameSeed && nameSeed.trim().length > 0
          ? nameSeed.trim()
          : `${dim.display_name || dim.slug} factors`;
      const cells = new Map(levels.map((l) => [l.id, 1] as const));
      createFactorTable(title, [dim.slug], cells);
      // CT-2's declared-row lands in SectionDetailPane's pending-insert
      // effect (declareAfterTowerLands) — AFTER the referencing step's
      // tower save, so the declaration's refetch can't adopt it away.
    },
    [editedDimensions, createFactorTable, location.search],
  );
  const handleCreateFromCsv = useCallback(
    (payload: {
      readonly title: string;
      readonly axes: {
        readonly rowDimSlug: string | null;
        readonly colDimSlug: string | null;
      };
      readonly cells: ReadonlyMap<string, number>;
    }) => {
      const keyDims = [payload.axes.rowDimSlug, payload.axes.colDimSlug].filter(
        (s): s is string => s !== null,
      );
      createFactorTable(payload.title, keyDims, payload.cells);
    },
    [createFactorTable],
  );

  // Brief 70 lock D7 — an axis change re-binds every chain that reads
  // the table (rebindChainsForTableAxes → one batched stage PATCH).
  // Without this the chain keeps the OLD dim slugs and the lookup
  // silently rates ×1.0 until an unrelated Assemble save.
  const handleFactorTableAxesChanged = useCallback(
    (tableId: string, newKeyDims: readonly string[]) => {
      const { patches, rebound } = rebindChainsForTableAxes(
        plan.stages,
        tableId,
        newKeyDims,
      );
      if (patches.length === 0) return;
      patchStageConfigMutation.mutate(
        {
          stage_patches: patches.map((p) => ({
            stage_id: p.stage_id,
            config_json: p.config_json,
          })),
        },
        {
          onSuccess: () => {
            notify(
              `Re-bound ${rebound.length} algorithm lookup${rebound.length === 1 ? "" : "s"} to the new axes.`,
            );
          },
        },
      );
    },
    [plan.stages, patchStageConfigMutation, notify],
  );
  const handleFactorTableDraftWriteThrough = useCallback(
    (
      tableId: string,
      draft: {
        readonly title: string;
        readonly axes: {
          readonly rowDimSlug: string | null;
          readonly colDimSlug: string | null;
        };
        readonly cells: ReadonlyMap<string, number> | null;
      },
    ) => {
      const keys = [draft.axes.rowDimSlug, draft.axes.colDimSlug].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      );
      const is2D = keys.length === 2;
      const trimmedTitle = draft.title.trim();
      setEditedFactorTables((prev) =>
        prev.map((ft) => {
          if (ft.id !== tableId) return ft;
          const next = { ...ft };
          // A non-empty title is a rename (identity is the id, 67.1a);
          // an empty mid-edit title never wipes the saved name.
          if (trimmedTitle) next.display_name = trimmedTitle;
          if (is2D) {
            delete (next as { key_dimension?: string }).key_dimension;
            (next as { key_dimensions?: readonly string[] }).key_dimensions =
              keys;
          } else if (keys[0]) {
            delete (next as { key_dimensions?: readonly string[] })
              .key_dimensions;
            (next as { key_dimension?: string }).key_dimension = keys[0];
          }
          return next;
        }),
      );
      if (draft.cells) {
        const cells = draft.cells;
        setEditedFactorTableCells((prev) => {
          const next = new Map(prev);
          next.set(tableId, new Map(cells));
          return next;
        });
      }
    },
    [],
  );

  // Cold-test N19 — delete a saved factor table from the catalog (and
  // drop its sidecar cells). Pure metadata edit; the deriver + Assemble
  // inventory recompute off `editedFactorTables` on the next render.
  const handleDeleteFactorTable = useCallback(
    (tableId: string) => {
      const removed = editedFactorTables.find((ft) => ft.id === tableId);
      setEditedFactorTables((prev) => prev.filter((ft) => ft.id !== tableId));
      setEditedFactorTableCells((prev) => {
        if (!prev.has(tableId)) return prev;
        const next = new Map(prev);
        next.delete(tableId);
        return next;
      });
      notify(
        removed
          ? `Deleted "${removed.display_name}" from the factor-table catalog.`
          : "Factor table deleted.",
      );
    },
    [editedFactorTables, notify],
  );
  // Brief 33 PR 33.1 — handleAddCurve / handleImportFactorTableCsv /
  // handleFitCurveFromData were the legacy 24.D ParametrizeWorkspace
  // tool-pane handlers. The new <ParametrizeCanvas> surface doesn't
  // expose them at the workspace level — CSV import comes back as a
  // toolbar action inside a generated grid (PR 33.5), PDF ingestion
  // is its own drawer (PR 33.6), and curves get reframed entirely by
  // Brief 34 (the moat brief). Removed.

  // ── Brief 39 — Gate Add handlers (collapsed) ───────────────────
  // Brief 39 absorbs eligibility / endorsement creation into the
  // Brief 70 §2 Phase 3 — Final-adjustments tail authoring (the §8/§9
  // move: modifiers + endorsements left Gate for the Algorithm's tail).
  // The build-up sheet's rows fire these. Modifier/endorsement editing
  // reuses the Brief 39 editor primitives in route-level drawers; min
  // premium routes to the ROUND drawer (v4 G6 — the projector never
  // executes `clamp`, so the old clamp floor silently changed nothing;
  // round.min_value_input is the floor the live scorer executes). All
  // writes go through the stage API.
  const faSection = PLAN_SECTIONS_BY_ID["final-adjustments"]!;
  const [modifierTailDraft, setModifierTailDraft] = useState<ModifierDraft>(
    () => emptyModifierDraft(),
  );
  const [endorsementTailDraft, setEndorsementTailDraft] =
    useState<EndorsementDraft>(() => emptyEndorsementDraft());

  const handleAddAdjustment = (
    kind: "modifier" | "min_premium" | "endorsement" | "loading",
  ) => {
    // Brief 78 P5.3 (G16) — the endorsement CREATE path, restored.
    // Same F06 grammar as the modifier: editor first on an in-memory
    // draft, stage created only on a valid save.
    if (kind === "endorsement") {
      const stage_id = uniqueStageId(
        slugifyForStageId("Endorsement", "endorsements").replace(
          /^(loading|adj)_/,
          "end_",
        ),
        plan.stages,
      );
      setEndorsementTailDraft(emptyEndorsementDraft());
      setEditor({ kind: "add-endorsement", stageId: stage_id });
      return;
    }
    // Brief 78 P5.3 (§3.3-4) — loadings author from the sheet too:
    // the existing M4.13 flat-factor drawer, opened on the loadings
    // section (it was only reachable from a dead render arm before).
    if (kind === "loading") {
      handleAddStage(PLAN_SECTIONS_BY_ID["loadings"]!);
      return;
    }
    if (kind === "min_premium") {
      // v4 G6 — the floor lives on the round stage (min_value_input),
      // the one the projector executes: max(total, floor) → round.
      // Edit the existing round stage if the plan has one; otherwise
      // author a fresh one with a literal $1 increment prefilled.
      const target = minPremiumTarget(plan.stages);
      if (target.action === "edit-round") {
        setRoundDraft(stageToRoundDraft(target.stage));
        setEditor({
          kind: "edit-round",
          section: faSection,
          stage: target.stage,
        });
      } else {
        setRoundDraft({
          ...emptyRoundDraft(),
          display_name: "Minimum premium & rounding",
        });
        setEditor({ kind: "add-round", section: faSection });
      }
      return;
    }
    // F06 — IRPM schedule: open the editor FIRST on an in-memory draft (one
    // category, ±25% cap). The stage is created only on save, once the actuary
    // has named at least one category, so we never POST a config the substrate
    // rejects (the old eager POST 422'd on the empty category name → the
    // editor never opened → the button was a dead click).
    const stage_id = uniqueStageId(
      slugifyForStageId("Schedule rating IRPM", "final-adjustments").replace(
        /^(loading|adj)_/,
        "mod_",
      ),
      plan.stages,
    );
    setModifierTailDraft({
      ...emptyModifierDraft(),
      modifier_id: stage_id,
      display_name: "Schedule rating (IRPM)",
      cap_pct: 25,
    });
    setEditor({ kind: "add-modifier", stageId: stage_id });
  };

  const handleEditAdjustment = (stageId: string) => {
    const stage = plan.stages.find((s) => s.stage_id === stageId);
    if (!stage) return;
    if (stage.stage_kind === "modifier.schedule") {
      const entry = planStagesToTailEntries([stage])[0];
      if (entry?.kind === "modifier") {
        setModifierTailDraft(entry.draft);
        setEditor({ kind: "edit-modifier", stageId });
      }
      return;
    }
    if (stage.stage_kind.startsWith("endorsement.")) {
      const entry = planStagesToTailEntries([stage])[0];
      if (entry?.kind === "endorsement") {
        setEndorsementTailDraft(entry.draft);
        setEditor({ kind: "edit-endorsement", stageId });
      }
      return;
    }
    // clamp / round / flat_factor reuse the M4.13/M4.15 drawers.
    handleEditStage(faSection, stage);
  };

  const handleDeleteAdjustment = (stageId: string) => {
    const stage = plan.stages.find((s) => s.stage_id === stageId);
    if (!stage) return;
    void removeMutation
      .mutateAsync({ stageId })
      .then(() => notify(`Removed "${stage.display_name}"`))
      .catch(() => {
        // apiErrorBus surfaces the failure card; nothing extra here.
      });
  };

  // Field refs for the endorsement trigger picker — declared inputs +
  // dimensions, grouped the same way the gate editors grouped them.
  const tailFieldRefs = useMemo(
    () => [
      ...stagesToInputDictEntries(plan.stages).map((e) => ({
        id: e.fieldName,
        type: e.dataType,
        category: "input" as const,
      })),
      ...editedDimensions.map((d) => ({
        id: d.slug,
        ...(d.data_type !== undefined ? { type: d.data_type } : {}),
        category: "dimension" as const,
      })),
    ],
    [plan.stages, editedDimensions],
  );

  const handleSaveTailDraft = async () => {
    if (editor.kind === "add-modifier" || editor.kind === "edit-modifier") {
      const request = modifierDraftToStageRequest(
        editor.stageId,
        modifierTailDraft,
      );
      if (!request) {
        notify("Name at least one rating category before saving the schedule.");
        return;
      }
      // F06 — "add-modifier" creates the stage on save (the stage doesn't exist
      // yet); "edit-modifier" patches the existing one.
      if (editor.kind === "add-modifier") {
        await addStageMutation.mutateAsync(request);
      } else {
        await patchStageConfigMutation.mutateAsync({
          stage_patches: [
            {
              stage_id: editor.stageId,
              display_name: request.display_name,
              config_json: request.config_json as Record<string, unknown>,
            },
          ],
        });
      }
      notify(`Saved "${request.display_name}"`);
      setEditor({ kind: "closed" });
      return;
    }
    if (
      editor.kind === "edit-endorsement" ||
      editor.kind === "add-endorsement"
    ) {
      if (!isEndorsementDraftValid(endorsementTailDraft)) {
        notify("Name the endorsement and complete its effect first.");
        return;
      }
      const request = endorsementDraftToStageRequest(
        editor.stageId,
        endorsementTailDraft,
      );
      if (!request) return;
      if (editor.kind === "add-endorsement") {
        // Brief 78 P5.3 (G16) — create on save (the F06 pattern).
        await addStageMutation.mutateAsync(request);
      } else {
        const existing = plan.stages.find((s) => s.stage_id === editor.stageId);
        if (existing && existing.stage_kind !== request.stage_kind) {
          // Effect kind changed → the stage KIND changes; config patches
          // can't do that, so replace the stage (remove + add).
          await removeMutation.mutateAsync({ stageId: editor.stageId });
          await addStageMutation.mutateAsync(request);
        } else {
          await patchStageConfigMutation.mutateAsync({
            stage_patches: [
              {
                stage_id: editor.stageId,
                display_name: request.display_name,
                config_json: request.config_json as Record<string, unknown>,
              },
            ],
          });
        }
      }
      notify(`Saved "${request.display_name}"`);
      setEditor({ kind: "closed" });
    }
  };

  // v4 G6 — edit-only: no live affordance may CREATE a clamp stage
  // (the projector never executes the kind). Existing clamps stay
  // editable so plans that carry one aren't bricked.
  const handleSaveClamp = async () => {
    if (editor.kind !== "edit-clamp") return;
    const draft = clampDraft;
    const description_template = "{factor_kind}: {applied:+.4f}";
    const configBase: Record<string, unknown> = {
      apply_as_multiplier: draft.apply_as_multiplier,
      factor_kind: "clamp",
      citation_rule: draft.citation_rule,
      citation_page: draft.citation_page,
      description_template,
      output_field: "value",
    };
    if (typeof draft.min_value === "number") {
      configBase["min_value"] = draft.min_value;
    }
    if (typeof draft.max_value === "number") {
      configBase["max_value"] = draft.max_value;
    }
    if (draft.max_pct_of_input.trim() !== "") {
      configBase["max_pct_of_input"] = draft.max_pct_of_input;
    }
    try {
      const existingCfg =
        (editor.stage.config_json as Record<string, unknown> | null) ?? {};
      const existing_input_path =
        typeof existingCfg["input_path"] === "string"
          ? (existingCfg["input_path"] as string)
          : "";
      const patch: PatchDraftRequest = {
        stage_patches: [
          {
            stage_id: editor.stage.stage_id,
            config_json: {
              ...existingCfg,
              ...configBase,
              input_path: existing_input_path,
            },
          },
        ],
      };
      await patchStageConfigMutation.mutateAsync(patch);
      notify(`Saved "${draft.display_name}"`);
      handleCloseClampDrawer();
    } catch (err) {
      void err;
    }
  };

  const handleSaveRound = async () => {
    if (editor.kind !== "add-round" && editor.kind !== "edit-round") return;
    const draft = roundDraft;
    // RoundConfig is extra="forbid": exactly {input_path, increment_input,
    // min_value_input, output_field}. Citations ride the STAGE record
    // (top-level AddStageRequest fields), never config_json. The substrate
    // requires min_value_input non-empty, so a blank floor persists as
    // "literal:0" — the no-op floor (max(total, 0) changes nothing).
    const minValueInput =
      draft.min_value_input.trim() === ""
        ? "literal:0"
        : draft.min_value_input.trim();
    try {
      if (editor.kind === "add-round") {
        const predecessor = lastFlatFactorPredecessor(plan, editor.section.id);
        const stage_id = uniqueStageId(
          slugifyForStageId(draft.display_name, editor.section.id).replace(
            /^(loading|adj)_/,
            "round_",
          ),
          plan.stages,
        );
        const request: AddStageRequest = {
          stage_id,
          stage_kind: "round",
          display_name: draft.display_name,
          config_json: {
            input_path: predecessor.input_path,
            increment_input: draft.increment_input,
            min_value_input: minValueInput,
            // Brief 80 D-D (finding E7) — the ledger, the policy
            // roll-up, and the quote API all read `total_premium`;
            // the old hardwired "final_premium_usd" published a total
            // nothing downstream could find.
            output_field: TOTAL_TOWER_OUTPUT_FIELD,
          },
          ...(draft.citation_rule.trim() !== ""
            ? { citation_rule: draft.citation_rule }
            : {}),
          ...(draft.citation_page.trim() !== ""
            ? { citation_page: draft.citation_page }
            : {}),
          ...(predecessor.stage_id !== null
            ? { insert_after_stage_id: predecessor.stage_id }
            : {}),
          inputs: [],
          outputs: [],
        };
        await addStageMutation.mutateAsync(request);
        notify(`Added "${draft.display_name}"`);
      } else {
        const existingCfg =
          (editor.stage.config_json as Record<string, unknown> | null) ?? {};
        const existing_input_path =
          typeof existingCfg["input_path"] === "string"
            ? (existingCfg["input_path"] as string)
            : "";
        const patch: PatchDraftRequest = {
          stage_patches: [
            {
              stage_id: editor.stage.stage_id,
              // Renames ride the patch (Brief 70.1).
              display_name: draft.display_name,
              // Built explicitly — spreading existingCfg would carry
              // legacy extra keys RoundConfig rejects wholesale.
              config_json: {
                input_path: existing_input_path,
                increment_input: draft.increment_input,
                min_value_input: minValueInput,
                output_field:
                  typeof existingCfg["output_field"] === "string"
                    ? (existingCfg["output_field"] as string)
                    : "final_premium_usd",
              },
            },
          ],
        };
        await patchStageConfigMutation.mutateAsync(patch);
        notify(`Saved "${draft.display_name}"`);
      }
      handleCloseRoundDrawer();
    } catch (err) {
      void err;
    }
  };

  const handleSaveFlatFactor = async () => {
    if (
      editor.kind !== "add-flat-factor" &&
      editor.kind !== "edit-flat-factor"
    ) {
      return;
    }
    const draft = flatFactorDraft;
    if (typeof draft.factor !== "number" || !Number.isFinite(draft.factor)) {
      notify("Factor must be a number.");
      return;
    }
    try {
      if (editor.kind === "add-flat-factor") {
        // Append a new stage to the section. Predecessor's output_field
        // becomes our input_path; we insert AFTER the predecessor.
        const predecessor = lastFlatFactorPredecessor(plan, editor.section.id);
        const stage_id = uniqueStageId(
          slugifyForStageId(draft.display_name, editor.section.id),
          plan.stages,
        );
        const description_template =
          draft.description_template.trim() === ""
            ? "{factor_kind}: ×{value}"
            : draft.description_template;
        const request: AddStageRequest = {
          stage_id,
          stage_kind: "flat_factor",
          display_name: draft.display_name,
          config_json: {
            // E6 — multi-coverage plans carry input_paths (every
            // coverage output; the multiplier distributes over the
            // sum). Single-output plans keep the legacy input_path.
            ...(predecessor.input_paths !== undefined
              ? { input_paths: [...predecessor.input_paths] }
              : { input_path: predecessor.input_path }),
            factor: draft.factor,
            factor_kind: draft.factor_kind,
            factor_unit: "multiplier",
            citation_rule: draft.citation_rule,
            citation_page: draft.citation_page,
            description_template,
            output_field: "value",
            // E6 — the drawer's optional {path, equals} gate.
            ...(draftPredicate(draft) !== undefined
              ? { predicate: draftPredicate(draft) }
              : {}),
          },
          ...(predecessor.stage_id !== null
            ? { insert_after_stage_id: predecessor.stage_id }
            : {}),
          inputs: [],
          outputs: [],
        };
        await addStageMutation.mutateAsync(request);
        notify(`Added "${draft.display_name}" to ${editor.section.name}`);
      } else {
        // Edit — preserve input_path + structural fields, replace the
        // actuary-authored ones.
        const existingCfg =
          (editor.stage.config_json as Record<string, unknown> | null) ?? {};
        const existing_input_path =
          typeof existingCfg["input_path"] === "string"
            ? (existingCfg["input_path"] as string)
            : "";
        const description_template =
          draft.description_template.trim() === ""
            ? "{factor_kind}: ×{value}"
            : draft.description_template;
        // E6 — a stage that carries input_paths (multi-coverage) must
        // NOT get input_path re-stamped: the backend enforces exactly
        // one of the two shapes.
        const hasInputPaths = Array.isArray(existingCfg["input_paths"]);
        const predicate = draftPredicate(draft);
        const patchedCfg: Record<string, unknown> = {
          ...existingCfg,
          ...(hasInputPaths ? {} : { input_path: existing_input_path }),
          factor: draft.factor,
          factor_kind: draft.factor_kind,
          factor_unit: "multiplier",
          citation_rule: draft.citation_rule,
          citation_page: draft.citation_page,
          description_template,
          output_field:
            typeof existingCfg["output_field"] === "string"
              ? (existingCfg["output_field"] as string)
              : "value",
        };
        // E6 — the drawer owns the predicate now: set it, or clear a
        // stale one when the path was blanked.
        if (predicate !== undefined) {
          patchedCfg["predicate"] = predicate;
        } else {
          delete patchedCfg["predicate"];
        }
        const patch: PatchDraftRequest = {
          stage_patches: [
            {
              stage_id: editor.stage.stage_id,
              config_json: patchedCfg,
            },
          ],
        };
        await patchStageConfigMutation.mutateAsync(patch);
        notify(`Saved "${draft.display_name}"`);
      }
      handleCloseFlatFactorDrawer();
    } catch (err) {
      void err;
    }
  };

  const handleSaveChainFactor = async () => {
    if (
      editor.kind !== "add-chain-factor" &&
      editor.kind !== "edit-chain-factor"
    ) {
      return;
    }
    const isEdit = editor.kind === "edit-chain-factor";
    const mutation = factorDraftToMutation(chainFactorDraft, {
      chainStageId: editor.chainStageId,
      chainName: editor.chainName,
      chainOutputPath: editor.chainOutputPath,
    });
    try {
      if (mutation.target === "chain_row") {
        const chainStage = plan.stages.find(
          (s) => s.stage_id === mutation.chainStageId,
        );
        if (!chainStage) {
          notify("That rating chain can't be found — refresh and try again.");
          return;
        }
        const nextConfig = isEdit
          ? replaceFactorLookup(
              chainStage.config_json,
              editor.chainName,
              editor.factorIndex,
              mutation.factorLookup,
            )
          : appendFactorLookup(
              chainStage.config_json,
              editor.chainName,
              mutation.factorLookup,
            );
        if (!nextConfig.ok) {
          notify(
            "We couldn't save your changes — check the entry and try again.",
          );
          return;
        }
        const patch: PatchDraftRequest = {
          stage_patches: [
            {
              stage_id: mutation.chainStageId,
              config_json: nextConfig.config,
            },
          ],
        };
        await patchStageConfigMutation.mutateAsync(patch);
      } else {
        // sibling_stage: POST a new flat_factor / formula stage.
        // Edit mode for siblings isn't wired yet (they're authored as
        // separate stages, edited via the stage chip list).
        if (isEdit) {
          notify(
            "Editing this step directly is coming soon — use the step list for now.",
          );
          return;
        }
        const stageRequest: AddStageRequest = {
          stage_id: mutation.stageId,
          stage_kind: mutation.siblingStageKind,
          display_name: mutation.displayName,
          config_json: mutation.config as unknown as Record<string, unknown>,
          ...(mutation.insertAfterStageId !== undefined
            ? { insert_after_stage_id: mutation.insertAfterStageId }
            : {}),
          inputs: [],
          outputs: [],
        };
        await addStageMutation.mutateAsync(stageRequest);
      }
      notify(
        isEdit
          ? `Saved changes to "${editor.chainName}"`
          : `Added factor to "${editor.chainName}"`,
      );
      handleCloseChainFactorDrawer();
    } catch (err) {
      // Mutation error stays on the hook's .error state; the drawer's
      // errorMessage prop reads it for the inline banner.
      void err;
    }
  };

  const chainFactorErrorMessage =
    addStageMutation.error instanceof RaterApiError
      ? addStageMutation.error.message
      : patchStageConfigMutation.error instanceof RaterApiError
        ? patchStageConfigMutation.error.message
        : (addStageMutation.error?.message ??
          patchStageConfigMutation.error?.message);

  // `isChainFactorSaving` drives every stage drawer's Save/Cancel disabled +
  // loading state. It MUST reflect only the drawer's OWN in-flight save —
  // never the raw `addStageMutation`/`patchStageConfigMutation` observers.
  // Those same observers are also driven by the background Assemble
  // normalization + autosave, whose `mutateAsync` can be detached mid-flight
  // when the component unmounts (notably React StrictMode's simulated unmount
  // on first load of a normalization-dirty draft), freezing the observer's
  // `useSyncExternalStore` snapshot at `isPending: true` indefinitely. Reading
  // that shared state is what left every drawer's Save+Cancel disabled on first
  // load until a reload. `isDrawerSaving` is set only around the drawer save
  // handlers (via `runDrawerSave`), so a stranded background observer can never
  // disable the drawers.
  const [isDrawerSaving, setIsDrawerSaving] = useState(false);
  const runDrawerSave = async (save: () => Promise<void>) => {
    setIsDrawerSaving(true);
    try {
      await save();
    } finally {
      setIsDrawerSaving(false);
    }
  };
  const isChainFactorSaving = isDrawerSaving;

  const activeSection =
    PLAN_SECTIONS_BY_ID[activeSectionId] ?? PLAN_SECTIONS[0]!;
  // P5.2 G13 — the pane's `stages` prop fed only the generic
  // section-list fallback, unreachable since every section anchors a
  // workspace arm (Brief 70 deleted the per-section arms; Brief 78
  // folded factor-tables into Rating). The bucket lookup died with
  // the accounting; the fallback renders empty if ever reached.
  const activeStages: StageSummary[] = [];

  // ── V2_INTERFACE_SPEC §2.3 — the Overview landing signals ────────
  // All computed from state the route already owns; <PlanOverview> is
  // pure presentation. Counts use the same sources the workspaces edit
  // (NOT the stage buckets — those undercount; the honest-readiness
  // rework is P2).
  // Brief 94 (U12) — the checklist speaks FILED constructs, not stage
  // kinds: one multiplicative_chain stage holds N coverage towers
  // (config_json.chains[]), one eligibility.gate stage holds N rules
  // (config_json.rules[]). Counting stages read "1 rating chain ·
  // 1 rule" against a 2-tower / 5-rule workbook. Modifier/endorsement
  // stages no longer masquerade as eligibility.
  const filedConstructCounts = useMemo(() => {
    let towers = 0;
    let gateRules = 0;
    for (const s of plan.stages) {
      const cfg = s.config_json as Record<string, unknown> | null;
      if (s.stage_kind === "multiplicative_chain") {
        const chains = cfg?.["chains"];
        towers += Array.isArray(chains) ? chains.length : 0;
      } else if (s.stage_kind === "eligibility.gate") {
        const rules = cfg?.["rules"];
        gateRules += Array.isArray(rules) ? rules.length : 0;
      }
    }
    return { towers, gateRules };
  }, [plan.stages]);

  //  — the ONE public counting of the algorithm ("3 chains ·
  // 24 steps"): the same rows the Rating tab renders (chain build-up
  // steps + Final-adjustment stage rows), shared with the report lede
  // via `countPublicAlgorithm`. Wire counts stay wire-only.
  const publicAlgoCounts = useMemo(
    () => countPublicAlgorithm(plan.stages ?? []),
    [plan.stages],
  );

  const overviewChecklist = useMemo(() => {
    // P2 G13 — counts come from the substrate, not the section buckets
    // (which under-counted); Brief 94 U12 sharpened them to filed
    // constructs (towers + rules) over stage kinds.
    const inputCount = stageKindCounts.inputs;
    const dimCount = editedDimensions.length;
    const tableCount = planFactorTables.length;
    const chainCount = filedConstructCounts.towers;
    const gateCount = filedConstructCounts.gateRules;
    const plural = (n: number, unit: string) =>
      `${n} ${unit}${n === 1 ? "" : "s"}`;
    return [
      {
        id: "inputs",
        // Brief 89 R6 — step 1 is a FORK, not a single path: declare
        // by hand, or land a book and add its columns as inputs. The
        // label matches the header chip (one phrase, §2.5).
        label: "Bring the plan's variables",
        done: inputCount > 0,
        detail: inputCount > 0 ? plural(inputCount, "input") : "No inputs yet",
        onOpen: () => handleSelectWorkspace("inputs"),
        actionLabel: "Declare inputs →",
        // Both CTAs land on Inputs — the genesis doors (or the source
        // act on a non-empty plan) are the first paint there.
        secondActionLabel: "Add them from a book →",
        onSecondOpen: () => handleSelectWorkspace("inputs"),
      },
      {
        id: "dimensions",
        label: "Define dimensions",
        done: dimCount > 0,
        detail:
          dimCount > 0 ? plural(dimCount, "dimension") : "No dimensions yet",
        onOpen: () => handleSelectWorkspace("dimensions"),
        actionLabel: "Add a dimension →",
      },
      {
        id: "tables",
        label: "Build factor tables",
        done: tableCount > 0,
        detail: tableCount > 0 ? plural(tableCount, "table") : "No tables yet",
        // Brief 78 (P5.1, D-D) — tables live in the Rating workspace
        // now; the row deep-links there (the rail is the catalog).
        onOpen: () => handleSelectWorkspace("assemble"),
        actionLabel: "Build a table →",
      },
      {
        id: "algorithm",
        label: "Build the algorithm",
        done: chainCount > 0,
        //  — THE public counting (chains · steps), the same
        // derivation the Rating tab renders and the report lede
        // states. "Rating towers" died with the fifth counting.
        detail:
          chainCount > 0
            ? `${plural(publicAlgoCounts.chains, "chain")} · ${plural(publicAlgoCounts.steps, "step")}`
            : "No chains yet",
        onOpen: () => handleSelectWorkspace("assemble"),
        actionLabel: "Start the build →",
      },
      {
        id: "gates",
        label: "Set eligibility",
        done: gateCount > 0,
        detail: gateCount > 0 ? plural(gateCount, "rule") : "No gates yet",
        onOpen: () => handleSelectWorkspace("gate"),
        actionLabel: "Add a gate →",
      },
    ];
    // handleSelectWorkspace is stable-enough (recreated per render but
    // navigation-only); the memo keys off the data that changes counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKindCounts, filedConstructCounts, publicAlgoCounts, editedDimensions, planFactorTables]);

  // Brief 75 — Overview's card reads the PERSISTED run history first
  // (server-scored, survives reloads and other browsers); the
  // localStorage book result remains a fallback until book runs land
  // in the next stacked PR.
  // Drift tracking: the edited-since-build fact for the
  // provenance row's chip. Refetches with the plan detail.
  const editsSinceBuildQuery = useQuery({
    queryKey: ["plan", plan.rating_plan_id, "edits-since-build"],
    queryFn: () => getEditsSinceBuild(plan.rating_plan_id),
  });

  const lastRunQuery = useQuery({
    queryKey: ["plan-runs", plan.rating_plan_id, "latest"],
    // 89.4 — probe runs are the plan sweeping itself, not a test of a
    // risk or a book; the "Latest run" signal skips them. limit 6 so a
    // burst of probes can't blank the card.
    queryFn: () => listPlanRuns(plan.rating_plan_id, { limit: 6 }),
    // 84.2 — the Ship hero's readiness strip shows the same latest run.
    enabled: isOverviewActive || activeWorkspace === "ship",
  });
  const latestNonProbeRun = useMemo(
    () =>
      (lastRunQuery.data?.runs ?? []).find((r) => r.kind !== "probe") ?? null,
    [lastRunQuery.data],
  );
  // Compact "✓ rated" line for the Ship hero: only a clean, completed
  // run counts — a failed or refused run is not go-live reassurance.
  const shipRunSummary = useMemo(() => {
    const latest = latestNonProbeRun;
    if (!latest || latest.status !== "done") return null;
    const headline = latest.headline as {
      premium?: number | null;
      row_status?: string;
      totals?: { written?: number };
    };
    if (headline.row_status === "error") return null;
    const amount =
      typeof headline.totals?.written === "number"
        ? headline.totals.written
        : typeof headline.premium === "number"
          ? headline.premium
          : null;
    if (amount === null) return null;
    const usd = amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    return `${usd} ${runKindNoun(latest.kind)} run · ${isoDate(latest.created_at)}`;
  }, [latestNonProbeRun]);
  const overviewLastTest = useMemo(() => {
    if (!isOverviewActive) return null;
    const latest = latestNonProbeRun;
    if (latest) {
      const headline = latest.headline as {
        premium?: number | null;
        row_status?: string;
        totals?: { written?: number; error_rows?: number };
      };
      const premiumLabel =
        latest.status === "error"
          ? "Failed"
          : headline.row_status === "error"
            ? "Cannot rate"
            : typeof headline.totals?.written === "number"
              ? headline.totals.written.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })
              : typeof headline.premium === "number"
                ? headline.premium.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  })
                : "—";
      return {
        premiumLabel,
        detail: `${runKindNoun(latest.kind)} run · ${isoDate(latest.created_at)}${
          latest.status !== "done" ? ` · ${latest.status}` : ""
        }`,
        onRun: () => handleSelectWorkspace("verify"),
      };
    }
    const scored = loadScoredResult(plan.rating_plan_id);
    if (!scored) return null;
    const total = scored.rows.reduce((sum, row) => {
      const v = row.outputs[scored.premiumColumn];
      return typeof v === "number" && Number.isFinite(v) ? sum + v : sum;
    }, 0);
    return {
      premiumLabel: total.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
      detail: `${scored.rowCount} row${scored.rowCount === 1 ? "" : "s"} scored · ${isoDate(scored.scoredAt)}`,
      onRun: () => handleSelectWorkspace("inputs"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverviewActive, plan.rating_plan_id, latestNonProbeRun]);

  const overviewVersions = useMemo(() => {
    const frozen = (snapshotsQuery.data?.snapshots ?? [])
      .slice(0, 4)
      .map((s) => ({
        id: s.snapshot_id,
        name: s.display_name,
        date: s.created_at.slice(0, 10),
        state: (s.published_at != null ? "published" : "frozen") as
          "published" | "frozen",
      }));
    return [
      ...(plan.status === "draft"
        ? [{ id: "__draft", name: "Working draft", state: "draft" as const }]
        : []),
      ...frozen,
    ];
  }, [snapshotsQuery.data, plan.status]);

  // Brief 92 — the workbook build report (null for hand-authored plans;
  // the 404 is a normal answer, folded to null in the hook).
  // Brief 92.R — the full build HISTORY (re-ingest appends; report 1
  // is the original build). The drawer pages through it.
  const buildReportsQuery = useBuildReports(plan.rating_plan_id);
  const buildReports = useMemo(
    () => buildReportsQuery.data ?? [],
    [buildReportsQuery.data],
  );
  const [buildReportOpen, setBuildReportOpen] = useState(false);
  const [buildReportIndex, setBuildReportIndex] = useState(0);
  const buildReport = buildReports[buildReportIndex] ?? buildReports[0] ?? null;

  const overviewFacts = useMemo(
    () =>
      [
        {
          label: "Product",
          value:
            plan.product && isProductCode(plan.product)
              ? PRODUCT_LABELS[plan.product]
              : (plan.line_of_business ?? "—"),
        },
        { label: "Jurisdiction", value: plan.jurisdiction ?? "—" },
        { label: "Effective", value: plan.effective_date ?? "—" },
        { label: "Created", value: plan.created_at?.slice(0, 10) ?? "—" },
      ] as const,
    [plan],
  );

  // V2_INTERFACE_SPEC §2.1 — the tab strip: full-text labels always,
  // NO icons (navigation is text-only), NO hue tints (color governance:
  // azure = interaction; one accent underline). Status is a 6px warn
  // dot for required-empty only. Overview leads; Test + Analytics park
  // right of the flex spacer — the quiet Build | Run grouping.
  const workspaceTabs = [
    { id: "overview", label: "Overview" },
    ...WORKSPACE_ORDER.map((ws) => {
      // B3 + P5.2 G13 — the required-empty dot reads the SAME live
      // sources the Overview checklist does (stage-kind counts + the
      // dimensions/FT catalogs), mirroring the spine's required flags
      // (risk-inputs · dimensions/classification · rating-chains).
      // The old per-section stage-bucket check is gone with the
      // buckets: loadings/final-adjustments/outputs buckets were
      // structurally unfillable, so the Algorithm (now Rating) dot
      // burned amber forever — even beside a "5 of 5 complete"
      // checklist. A tab dots iff its required substrate hasn't been
      // STARTED; compile-quality gating stays with `computePlanReadiness`
      // (the Run rail + health pill), not the strip.
      const hasRequiredEmpty =
        ws === "inputs"
          ? stageKindCounts.inputs === 0
          : ws === "dimensions"
            ? editedDimensions.length === 0
            : ws === "assemble"
              ? stageKindCounts.chains === 0
              : false;
      const isSibling = ws === "verify" || ws === "analytics" || ws === "ship";
      return {
        id: ws,
        label: WORKSPACE_LABELS[ws],
        ...(hasRequiredEmpty ? { status: "required-empty" as const } : {}),
        ...(isSibling ? { isSibling: true } : {}),
      };
    }),
  ];

  const handleSelectWorkspace = (next: string) => {
    // Overview is the bare plan URL (the §2.3 landing rule), not a
    // workspace segment. Query string carries forward so dev flags
    // (e.g. ?dims2=1) survive tab switches.
    if (next === "overview") {
      navigate(`/rate-lab/${plan.rating_plan_id}${window.location.search}`);
      return;
    }
    if (!isPlanBuilderWorkspace(next)) return;
    navigate(
      `/rate-lab/${plan.rating_plan_id}/workspace/${next}${window.location.search}`,
    );
  };

  // ── Brief 43 / PR 43.1 — Freeze version dialog handlers ──────
  //
  // Default name is a YYYY-MM-DD draft label; the user is free to
  // override. Live computation (not cached in state) so it stays
  // accurate if the dialog reopens on a different day.
  const freezeDefaultName = `draft_${new Date().toISOString().slice(0, 10)}`;

  const handleFreezeClose = useCallback(() => {
    setFreezeOpen(false);
    setFreezeErrorMessage(null);
  }, []);

  // ── G15 — Freeze must not race the debounced saves. ──
  // The server composes the snapshot body FROM THE DB, so any edit still
  // sitting in a 400–800ms debounce window would be silently missing from
  // the frozen version. Dims + factor tables flush locally (above); the
  // tower save lives in <SectionDetailPane> and the input mapping in
  // <InputsWorkspaceMount>, so each registers its flush here and the
  // freeze awaits them all first.
  const saveFlushesRef = useRef(new Map<string, () => Promise<void>>());
  const registerSaveFlush = useCallback(
    (key: string, flush: (() => Promise<void>) | null) => {
      if (flush) saveFlushesRef.current.set(key, flush);
      else saveFlushesRef.current.delete(key);
    },
    [],
  );
  // G24 (tab-close half) — fire every pending flush on pagehide,
  // best-effort. `keepalive` fetch / sendBeacon cannot carry these
  // payloads (replace-all bodies routinely exceed the 64KB in-flight
  // teardown quota), so delivery during a real tab close is
  // browser-dependent; the guarantee-grade protections remain the
  // SPA-nav unmount flushes, the G15 freeze barrier, and the G14
  // If-Match refusals. A payload diet that makes keepalive viable
  // rides the D7 book-home decision (G26).
  useEffect(() => {
    const onPageHide = () => {
      void flushDimsSave();
      void flushFtsSave();
      for (const flush of saveFlushesRef.current.values()) void flush();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [flushDimsSave, flushFtsSave]);

  const handleFreezeConfirm = useCallback(
    async (body: { display_name: string; notes: string | null }) => {
      setFreezeErrorMessage(null);
      // G15 — land every pending save before the server reads the DB. A
      // FAILED flush aborts the freeze (Law 2: refuse, never freeze state
      // that silently misses the user's last edits).
      try {
        await Promise.all([
          flushDimsSave(),
          flushFtsSave(),
          ...[...saveFlushesRef.current.values()].map((flush) => flush()),
        ]);
      } catch {
        setFreezeErrorMessage(
          "Couldn't save your latest edits, so the version wasn't frozen. " +
            "Resolve the save error and try again.",
        );
        return;
      }
      freezeSnapshotMutation.mutate(body, {
        onSuccess: (snapshot) => {
          notify(`Frozen as "${snapshot.display_name}".`);
          setFreezeOpen(false);
        },
        onError: (err) => {
          // Surface the 409 inline so the user can edit + retry
          // without losing the notes draft. Other errors fall
          // through to a toast (network blip, server 500, etc.)
          // and leave the dialog open so the user can decide
          // what to do — they keep their input either way.
          if (err instanceof RaterApiError && err.status === 409) {
            setFreezeErrorMessage(err.message);
          } else {
            const message =
              err instanceof Error
                ? err.message
                : "Couldn't freeze this version. Try again in a moment.";
            setFreezeErrorMessage(message);
          }
        },
      });
    },
    [freezeSnapshotMutation, notify, flushDimsSave, flushFtsSave],
  );

  // `isWritable` (draft-only) is already derived above for the merged
  // read-only-sync-gate; the header read-only treatment reuses it.

  return (
    <>
      {/* V2_INTERFACE_SPEC §2.1 — the wrapper: a 64px identity header
          (actions in-header: the Brief-84 status chip, the page's ONE
          primary, the ⋯ overflow) over the full-text tab strip. */}
      <PlanHeader
        title={plan.display_name}
        meta={[
          // P3.3 (ADR-0033) — friendly product label over the raw
          // line_of_business shim ("Businessowners" not "bop").
          plan.product && isProductCode(plan.product)
            ? PRODUCT_LABELS[plan.product]
            : plan.line_of_business,
          plan.jurisdiction,
          plan.effective_date,
        ]
          .filter(Boolean)
          .join(" · ")}
        // P3.2 — content hash kept off the visible line (right
        // altitude), available on hover for reproducibility.
        metaTitle={
          plan.content_hash
            ? `content ${plan.content_hash.slice(0, 12)}…`
            : undefined
        }
        // Brief 89 R7 — the pill never outruns the engine: "Ready to
        // rate" requires the RATE rail (compiles AND nothing the
        // structure reads is undeclared), else it speaks the next step.
        health={
          !isWritable
            ? "Read-only"
            : readiness.rateReady
              ? "Ready to rate"
              : (readiness.nextStepHint ?? "In progress")
        }
        healthTone={readiness.rateReady ? "ok" : "warn"}
        readOnly={!isWritable}
        // Brief 84 — no statusLabel: the PlanStatusChip in `actions` is
        // the ONE status display, for every lifecycle state.
        // §2.4 — the clickable build checklist (the same checkpoints
        // Overview shows; each deep-links to its section).
        checklist={[
          {
            // Brief 89 R6 — one phrase for step 1 everywhere; the
            // header chip and the Overview checklist stop disagreeing
            // ("Build the algorithm first." vs "Declare inputs").
            label: "Bring the plan's variables",
            done: readiness.hasInputs,
            onOpen: () => handleSelectWorkspace("inputs"),
          },
          {
            label: "Build the algorithm",
            done: readiness.hasAlgorithm,
            onOpen: () => handleSelectWorkspace("assemble"),
          },
          {
            // P2 G13 — the compile verdict IS the checkpoint (D1): a
            // runnable, issue-free projection. Replaces the deleted
            // factor-table rail (tables are a means, not a gate).
            label:
              readiness.errorIssueCount > 0
                ? `Fix ${readiness.errorIssueCount} authoring issue${readiness.errorIssueCount === 1 ? "" : "s"}`
                : "Compiles cleanly",
            done: readiness.compileReady,
            onOpen: () => handleSelectWorkspace("inputs"),
          },
        ]}
        actions={
          <>
            {/* Brief 84 D-C — THE derived headline status. A display that
                navigates (→ Ship, the home of the lifecycle verbs), never
                a control that mutates. Rendered for EVERY status — the
                thing the stepper could never do. */}
            <PlanStatusChip
              status={derivePlanStatus(plan)}
              onOpenShip={() => handleSelectWorkspace("ship")}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<Play size={12} aria-hidden />}
              // §2.4 — THE golden-path action: jump to the Test tab and
              // run the sample. On the Test tab already, it just runs.
              onClick={() => {
                if (activeWorkspace !== "verify" || isOverviewActive) {
                  handleSelectWorkspace("verify");
                }
                setTestRunRequest((n) => n + 1);
              }}
              // Brief 89 R7 — the golden path gates on the RATE rail:
              // a compiled plan whose structure reads undeclared inputs
              // would refuse; the title names the next step instead.
              disabled={!readiness.rateReady}
              title={
                readiness.rateReady
                  ? undefined
                  : (readiness.nextStepHint ?? "Finish the build first")
              }
            >
              Rate sample
            </Button>
            <Menu>
              <Menu.Trigger>
                <IconButton
                  variant="plain"
                  size="sm"
                  aria-label="Plan actions"
                  icon={<MoreHorizontal />}
                />
              </Menu.Trigger>
              <Menu.Items aria-label="Plan actions">
                <Menu.Item onSelect={() => setSettingsOpen(true)}>
                  <Settings size={14} aria-hidden /> Plan settings
                </Menu.Item>
                <Menu.Item
                  onSelect={() => {
                    void handleDuplicatePlan();
                  }}
                  disabled={duplicating}
                >
                  <Copy size={14} aria-hidden /> Duplicate plan
                </Menu.Item>
                <Menu.Item
                  onSelect={() => {
                    void navigator.clipboard.writeText(plan.rating_plan_id);
                    notify("Copied plan id.");
                  }}
                >
                  <Clipboard size={14} aria-hidden /> Copy plan id
                </Menu.Item>
              </Menu.Items>
            </Menu>
          </>
        }
      />
      <WorkspaceTabs
        tabs={workspaceTabs}
        active={isOverviewActive ? "overview" : activeWorkspace}
        onSelect={handleSelectWorkspace}
        ariaLabel="Plan sections"
      />
      <div className="plan-studio plan-studio--no-rail">
        {/* EmptyPlanChooser removed — the user already picked a template
         * at /rate-lab/new. Stale picker that always toasted "lands with
         * slices 3 + 6". Empty plans now fall straight into the
         * workspace content with each workspace's own empty state
         * (Inputs CTA / Dimensions empty / Gate CTAs / etc). */}
        {isOverviewActive ? (
          // V2_INTERFACE_SPEC §2.3 — the landing section. Pure
          // presentation; every signal computed here in the route.
          <>
            <OverviewSection
              checklist={overviewChecklist}
              lastTest={overviewLastTest}
              onRunFirstTest={() => handleSelectWorkspace("inputs")}
              versions={overviewVersions}
              facts={overviewFacts}
              note={plan.description ?? null}
              buildReport={
                buildReport
                  ? {
                      summary:
                        `workbook · ${buildReport.filename ?? buildReport.workbook_plan_id ?? "unnamed"} · ${buildReport.created_at.slice(0, 10)}` +
                        (buildReports.length > 1
                          ? ` · ${buildReports.length} builds`
                          : ""),
                      onView: () => {
                        setBuildReportIndex(0);
                        setBuildReportOpen(true);
                      },
                      // Brief 92.R door B — the revision path; the
                      // workbook's own identity targets the plan (D2).
                      onReingest: () => navigate("/rate-lab/new?mode=workbook"),
                      edits:
                        editsSinceBuildQuery.data?.edited === true
                          ? {
                              count: Math.max(
                                editsSinceBuildQuery.data.changes.length,
                                1,
                              ),
                              title:
                                editsSinceBuildQuery.data.changes.length > 0
                                  ? editsSinceBuildQuery.data.changes
                                      .slice(0, 4)
                                      .map(
                                        (c) =>
                                          `${c.table}[${c.field}] yours ${String(c.yours)} · workbook ${String(c.workbook)}`,
                                      )
                                      .join("\n")
                                  : (editsSinceBuildQuery.data.note ??
                                    undefined),
                            }
                          : null,
                    }
                  : null
              }
            />
            {/* Brief 92 — "where did this plan come from and how good
             * was the transcription", a month later. */}
            <Drawer
              open={buildReportOpen && buildReport !== null}
              onClose={() => setBuildReportOpen(false)}
              title="Build report"
              {...(buildReport
                ? {
                    subtitle:
                      `${buildReport.filename ?? "workbook"} · spec ${buildReport.spec_version} · ${buildReport.created_at.slice(0, 10)}` +
                      (buildReports.length > 1
                        ? ` · report ${buildReports.length - buildReportIndex} of ${buildReports.length}`
                        : ""),
                  }
                : {})}
            >
              <Drawer.Body>
                {buildReports.length > 1 ? (
                  <div className="plan-detail__report-pager">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={buildReportIndex >= buildReports.length - 1}
                      onClick={() => setBuildReportIndex((i) => i + 1)}
                    >
                      ← Older
                    </Button>
                    <span className="plan-detail__report-pager-label">
                      {buildReportIndex === 0
                        ? "Latest build"
                        : `Build of ${buildReport?.created_at.slice(0, 10)}`}
                      {buildReport?.workbook_version
                        ? ` · v${buildReport.workbook_version}`
                        : ""}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={buildReportIndex === 0}
                      onClick={() => setBuildReportIndex((i) => i - 1)}
                    >
                      Newer →
                    </Button>
                  </div>
                ) : null}
                {buildReport ? <BuildReportView report={buildReport} /> : null}
              </Drawer.Body>
            </Drawer>
          </>
        ) : activeWorkspace === "verify" ? (
          // Brief 75 (v4 P3) — the RUN zone: the sample-risk runner is
          // a RECORD, not a preview. The risk posts to the run API;
          // api-lab composes the substrate, the scoring service
          // computes the FILED premium, the run persists append-only
          // and renders in the history below.
          <RunSectionMount
            planId={plan.rating_plan_id}
            stages={plan.stages}
            dimensions={editedDimensions}
            currentContentHash={plan.content_hash ?? null}
            currentScoringFingerprint={runScoringFingerprint}
            // Brief 89 R7 — Run's verdict speaks the same RATE rail as
            // the pill (one voice; compileReady stays Ship's gate).
            ready={readiness.rateReady}
            blockingHint={readiness.nextStepHint}
            runRequest={testRunRequest}
            // Brief 95 D2 — the newest build's first verified test case
            // seeds the sample form (null → representative synthesis).
            seedCase={buildReports[0]?.vectors.cases[0] ?? null}
            onOpenBuild={() => navigate(`/rate-lab/${plan.rating_plan_id}`)}
            onOpenAlgorithm={() => handleSelectWorkspace("assemble")}
            // D-H — nudge only while the plan is a DRAFT (not yet live).
            onGoLive={
              derivePlanStatus(plan).kind === "draft"
                ? () => handleSelectWorkspace("ship")
                : null
            }
          />
        ) : activeWorkspace === "ship" ? (
          // Brief 76 (v4 P4.5) + Brief 84 (84.2) — the SHIP zone, the
          // go-live console: the status hero owns the ONE deploy verb
          // (Go live / Publish update → atomic freeze+publish); the
          // Versions timeline holds history + "Save a version…"
          // checkpoints; the API panel keeps keys + the live try-it.
          <ShipSectionMount
            planId={plan.rating_plan_id}
            stages={plan.stages}
            dimensions={editedDimensions}
            compileReady={readiness.compileReady}
            blockingHint={readiness.blockingHint}
            runSummary={shipRunSummary}
            onFreeze={() => {
              setFreezeErrorMessage(null);
              setFreezeOpen(true);
            }}
            notify={notify}
          />
        ) : activeWorkspace === "analytics" ? (
          // Brief 43 PR 43.2 — Analytics is a consumer workspace
          // (reads scored output, doesn't author substrate). Short-
          // circuit the section-pane dispatch and mount the workspace
          // directly. Subsequent PRs (43.3-43.6) replace the shell's
          // empty-state cards with real exhibits.
          <AnalyticsWorkspaceMount
            plan={plan}
            dimensions={editedDimensions}
            notify={notify}
            onFreezeVersion={() => {
              setFreezeErrorMessage(null);
              setFreezeOpen(true);
            }}
            onOpenRun={() =>
              navigate(`/rate-lab/${plan.rating_plan_id}/workspace/verify`)
            }
            // Brief 89 §3 — the probe band's "connect a book" door +
            // the authored FT catalog the probe exhibits read.
            onOpenInputs={() =>
              navigate(`/rate-lab/${plan.rating_plan_id}/workspace/inputs`)
            }
            factorTables={planFactorTables}
            // Re-rate projection inputs — mirror the live Inputs path so
            // the baseline snapshot scores the same premium column.
            chainRuntimeDefaults={resolveChainRuntime(plan.template_id)}
            // ADR-0041 Phase 2 — same cells the Inputs mount fingerprints
            // at score time, so the staleness check compares like-for-like.
            factorTableCells={editedFactorTableCells}
            // ADR-0064 — run-fed exhibit + probe-book staleness compare
            // this fingerprint before the content-hash fallback.
            currentScoringFingerprint={runScoringFingerprint}
          />
        ) : (
          <SectionDetailPane
            section={activeSection}
            stages={activeStages}
            allPlanStages={plan.stages}
            // Brief 58 Pillar C — durable input-dict bulk-add API from the
            // stable level; InputsWorkspaceMount enqueues into it.
            inputDeclarations={inputDeclarations}
            // 26.P0 — Dimensions feed in from the route's editable
            // state (replaces SAMPLE_DIMENSIONS read inside
            // SectionDetailPane). Inner component reads this prop
            // for both DimensionsWorkspace render + tower inventory.
            dimensions={editedDimensions}
            // Brief 39 follow-up — LOB-scoped FT catalog (empty
            // for non-BOP plans).
            factorTables={planFactorTables}
            planId={plan.rating_plan_id}
            // Brief 55 item 2 — no default sample dataset. The nonprofit_990
            // CSV was a D&O/GL template leftover that read as nonsense on an
            // Meridian BOP plan ("Use sample data — 2,000 nonprofit policies").
            // <DataSourcePicker> hides the affordance when sampleDataset is
            // omitted; a consumer can still pass a plan-appropriate sample.
            // Cold-test payoff fix — per-template chain runtime
            // constants (base rates + LCM). Resolved from template_id;
            // falls back to DEFAULT_CHAIN_RUNTIME (lcm 1.0 identity, no
            // input defaults) for plans with no entry. Without this the
            // nonprofit_990 chains have no base rate → null premiums.
            chainRuntimeDefaults={resolveChainRuntime(plan.template_id)}
            // G15 — the pane registers its pending-save flushes (tower
            // here; the input mapping one level down) so Freeze can land
            // them before the server composes the snapshot body.
            registerSaveFlush={registerSaveFlush}
            onAddStage={handleAddStage}
            onEditStage={handleEditStage}
            onSelectDimension={handleSelectDimension}
            onAddDimensionShape={handleAddDimensionShape}
            editingDimensionId={editingDimensionId}
            onEditingDimensionIdChange={setEditingDimensionId}
            onCommitDimension={handleCommitDimension}
            dimsSaveState={dimsSaveState}
            dimsSyncBlocked={dimensionsApi.isError}
            onRetryDimsSync={() => {
              void dimensionsApi.refetch();
            }}
            onOpenClassRegistry={handleOpenClassRegistry}
            onDeleteDimension={handleDeleteDimension}
            resolveReferences={handleResolveReferences}
            onJumpToReference={handleJumpToReference}
            onReferenceInChain={handleReferenceInChain}
            onUseAsFactorTableKey={handleUseAsFactorTableKey}
            onCompositeAxisChange={handleCompositeAxisChange}
            geographicActiveTab={geographicActiveTab}
            onGeographicActiveTabChange={setGeographicActiveTab}
            dimensionReturnTo={returnToWithHandler}
            onAddFactorTable={handleAddFactorTable}
            // PR 14 — Save handler for the Parametrize canvas's new
            // Save table button. Lives on the route so the appended
            // FT lands in editedFactorTables (used by Assemble +
            // Inputs immediately).
            onCreateFromDimension={handleCreateFromDimension}
            onCreateFromCsv={handleCreateFromCsv}
            onFactorTableDraftWriteThrough={handleFactorTableDraftWriteThrough}
            onFactorTableAxesChanged={handleFactorTableAxesChanged}
            ftSaveState={ftSaveState}
            onEnsureCoverageDimension={handleEnsureCoverageDimension}
            onDeleteFactorTable={handleDeleteFactorTable}
            // PR A2 — Sidecar map of FT id → cells map. Lets the
            // canvas re-seed an existing table with its saved cells
            // instead of the default 1.0 grid.
            factorTableCells={editedFactorTableCells}
            onBackToCatalog={handleBackToCatalog}
            editingTableId={editingTableId}
            creatingAxisSlug={creatingAxisSlug}
            onOpenFactorTableInline={handleOpenFactorTableInline}
            // Brief 82 D-D — the footer verdict (the ONE readiness
            // selector; computed above for the tabs/overview too).
            readiness={readiness}
            onNavigateToDimensions={() =>
              navigate(`/rate-lab/${plan.rating_plan_id}/workspace/dimensions`)
            }
            // Brief 70 Phase 3 — the build-up sheet's Final-adjustments
            // tail authoring (stage API; drawers live at this level).
            onAddAdjustment={handleAddAdjustment}
            onEditAdjustment={handleEditAdjustment}
            onDeleteAdjustment={handleDeleteAdjustment}
            // PR 12.2 — Assemble save: SectionDetailPane projects its
            // editedPlan → desired stages and hands them off; we diff
            // + dispatch the mutations + toast the result.
            onSaveAssembleStages={handleSaveAssembleStages}
            isSavingAssemble={isSavingAssemble}
            // Read-only gate — non-draft plans render Assemble (+ siblings)
            // without firing any autosave/normalization mutations.
            isWritable={isWritable}
          />
        )}
      </div>
      {/* PR 12.3 — Was the multi-state risk-inputs drawer (add /
       *  edit / delete-confirm). With InputNodeForm gone the only
       *  remaining state is delete-confirm; render that and only
       *  that. The drawer keeps a subtitle showing which section
       *  the deleted stage belongs to. */}
      <Drawer
        open={isDeleteConfirmDrawerOpen}
        onClose={handleCloseDrawer}
        title={drawerTitle(editor)}
        {...(editor.kind === "delete-confirm"
          ? {
              subtitle: `Section ${editor.section.num} · ${editor.section.name}`,
            }
          : {})}
      >
        <Drawer.Body>
          {editor.kind === "delete-confirm" ? (
            <DeleteConfirmation
              stageDisplayName={stageLabel(editor.stage)}
              error={
                removeMutation.error instanceof RaterApiError
                  ? removeMutation.error.message
                  : removeMutation.error
                    ? String(removeMutation.error)
                    : null
              }
            />
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          {editor.kind === "delete-confirm" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancelDelete}
                disabled={removeMutation.isPending}
                style={{ marginRight: "auto" }}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleConfirmDelete}
                loading={removeMutation.isPending}
              >
                Delete it
              </Button>
            </>
          ) : null}
        </Drawer.Footer>
      </Drawer>
      <ClampStageDrawer
        open={isClampDrawerOpen}
        mode="edit"
        {...(editor.kind === "edit-clamp"
          ? { contextLabel: editor.section.name }
          : {})}
        draft={clampDraft}
        onDraftChange={setClampDraft}
        onCancel={handleCloseClampDrawer}
        onSave={() => void runDrawerSave(handleSaveClamp)}
        saving={isChainFactorSaving}
        {...(chainFactorErrorMessage !== undefined
          ? { errorMessage: chainFactorErrorMessage }
          : {})}
      />
      {/* Brief 70 §2 Phase 3 — the Final-adjustments tail drawers. The
       * Brief 39 editor primitives survive the GateCanvas deletion as
       * the tail's editors; saves go through the stage API. */}
      <Drawer
        open={editor.kind === "edit-modifier" || editor.kind === "add-modifier"}
        onClose={handleCloseDrawer}
        title="Schedule rating (IRPM)"
        subtitle="Final adjustments · applies to the whole premium"
      >
        <Drawer.Body>
          {editor.kind === "edit-modifier" || editor.kind === "add-modifier" ? (
            <ModifierEditor
              draft={modifierTailDraft}
              onChange={setModifierTailDraft}
              onSave={() => {
                void handleSaveTailDraft();
              }}
              onCancel={handleCloseDrawer}
            />
          ) : null}
        </Drawer.Body>
      </Drawer>
      <Drawer
        open={
          editor.kind === "edit-endorsement" ||
          editor.kind === "add-endorsement"
        }
        onClose={handleCloseDrawer}
        title="Endorsement"
        subtitle="Final adjustments · attaches to the policy"
      >
        <Drawer.Body>
          {editor.kind === "edit-endorsement" ||
          editor.kind === "add-endorsement" ? (
            <EndorsementEditor
              draft={endorsementTailDraft}
              availableFields={tailFieldRefs}
              onChange={setEndorsementTailDraft}
              onSave={() => {
                void handleSaveTailDraft();
              }}
              onCancel={handleCloseDrawer}
            />
          ) : null}
        </Drawer.Body>
      </Drawer>
      <RoundStageDrawer
        open={isRoundDrawerOpen}
        mode={editor.kind === "edit-round" ? "edit" : "add"}
        {...(editor.kind === "add-round" || editor.kind === "edit-round"
          ? { contextLabel: editor.section.name }
          : {})}
        draft={roundDraft}
        onDraftChange={setRoundDraft}
        onCancel={handleCloseRoundDrawer}
        onSave={() => void runDrawerSave(handleSaveRound)}
        saving={isChainFactorSaving}
        {...(chainFactorErrorMessage !== undefined
          ? { errorMessage: chainFactorErrorMessage }
          : {})}
        // Brief 80 D-D — surface a legacy bespoke total field + the
        // one-click normalize onto the `total_premium` contract. Read
        // the LIVE stage (not the editor's open-time snapshot) so the
        // warning flips to the standard line the moment the patch
        // round-trips.
        {...(() => {
          if (editor.kind !== "edit-round") return {};
          const liveStage =
            plan.stages.find((s) => s.stage_id === editor.stage.stage_id) ??
            editor.stage;
          const cfg =
            (liveStage.config_json as Record<string, unknown> | null) ?? {};
          const of = cfg["output_field"];
          if (typeof of !== "string") return {};
          return {
            outputField: of,
            onNormalizeOutputField: () => {
              patchStageConfigMutation.mutate({
                stage_patches: [
                  {
                    stage_id: liveStage.stage_id,
                    config_json: {
                      ...cfg,
                      output_field: TOTAL_TOWER_OUTPUT_FIELD,
                    },
                  },
                ],
              });
            },
          };
        })()}
      />
      <FlatFactorStageDrawer
        open={isFlatFactorDrawerOpen}
        mode={editor.kind === "edit-flat-factor" ? "edit" : "add"}
        {...(editor.kind === "add-flat-factor" ||
        editor.kind === "edit-flat-factor"
          ? { contextLabel: editor.section.name }
          : {})}
        draft={flatFactorDraft}
        onDraftChange={setFlatFactorDraft}
        onCancel={handleCloseFlatFactorDrawer}
        onSave={() => void runDrawerSave(handleSaveFlatFactor)}
        saving={isChainFactorSaving}
        {...(chainFactorErrorMessage !== undefined
          ? { errorMessage: chainFactorErrorMessage }
          : {})}
      />
      <ChainFactorDrawer
        open={isChainFactorDrawerOpen}
        mode={editor.kind === "edit-chain-factor" ? "edit" : "add"}
        {...(editor.kind === "add-chain-factor" ||
        editor.kind === "edit-chain-factor"
          ? { chainName: editor.chainName }
          : {})}
        draft={chainFactorDraft}
        onDraftChange={setChainFactorDraft}
        onCancel={handleCloseChainFactorDrawer}
        onSave={() => void runDrawerSave(handleSaveChainFactor)}
        saving={isChainFactorSaving}
        // M4.3.10 — reference data for the pickers. 26.P0 — dims
        // now read from editedDimensions so new rows are pickable
        // in the chain-factor drawer immediately after save.
        // Factor tables stay on the fixture until their own
        // authoring lands.
        //
        // Brief 34 PR 34.7 removed the `curves` prop — curves are
        // gone (Brief 19 → Brief 34 supersession).
        dimensions={editedDimensions}
        factorTables={planFactorTables}
        {...(chainFactorErrorMessage !== undefined
          ? { errorMessage: chainFactorErrorMessage }
          : {})}
      />
      {/* Brief 30 PR 30.1 + 30.2 — both <DimensionStandardDrawer> and
          <DimensionBandedDrawer> are deleted. Categorical AND banded
          editing happen INLINE in the workspace center pane via
          <DimensionEditor> (wired through the workspace's
          `editingDimensionId` + `onCommitDimension` props).
          Geographic / Classification / Composite still flow through
          their existing routes / toasts; subsequent Brief 30 PRs
          inline those bodies too. */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        plan={plan}
      />
      {/* Brief 44 PR 44.11 — GeoDimWizard modal. Triggered by the
          DimensionsWorkspace tool pane's "+ Geographic" button. The
          modal walks the user through Granularity → Scope → Review +
          on Create materializes a DimensionRow via
          handleCreateGeographicDimension. */}
      <Modal
        open={geographicWizardOpen}
        onClose={() => setGeographicWizardOpen(false)}
        title="New geographic dimension"
        subtitle="Pick granularity + scope. Levels seed automatically."
        size="lg"
        dismissable
      >
        <GeoDimWizard
          existingSlugs={editedDimensions.map((d) => d.slug)}
          onCreate={handleCreateGeographicDimension}
          onCancel={() => setGeographicWizardOpen(false)}
        />
      </Modal>

      {/* Brief 30 PR 30.5 — delete-with-impact modal. Opens off the
          inline DimensionEditor's delete button. Shows the reference
          impact (from PR 30.4's resolver) so the user proceeds aware,
          not by surprise. */}
      <DimensionDeletePrompt
        open={deleteImpactDimId !== null}
        dim={deleteImpactDim}
        references={deleteImpactReferences}
        onConfirm={handleConfirmDeleteDimension}
        onCancel={handleCancelDeleteDimension}
        onJumpToReference={(ref) => {
          // Same handler as the inline editor's Used-in panel uses.
          // We close the modal first so the user lands on the
          // target without a stale modal sitting on top.
          setDeleteImpactDimId(null);
          handleJumpToReference(ref);
        }}
      />
      {/* Brief 43 / PR 43.1 — Freeze version dialog. Triggered from
          the PlanStudioHeader. Pure presentation; this route owns
          the mutation + error-mapping above. */}
      <FreezeVersionDialog
        open={freezeOpen}
        plan={{
          display_name: plan.display_name,
          line_of_business: plan.line_of_business,
          effective_date: plan.effective_date,
          content_hash: plan.content_hash ?? null,
        }}
        defaultName={freezeDefaultName}
        isSubmitting={freezeSnapshotMutation.isPending}
        errorMessage={freezeErrorMessage}
        onClose={handleFreezeClose}
        onConfirm={handleFreezeConfirm}
      />
    </>
  );
}

/**
 * Brief 34 PR 34.7 follow-up — Build the initial cell map for an
 * existing factor table being loaded into the ParametrizeCanvas
 * inline. Resolves `key_dimensions` (or legacy `key_dimension`) into
 * the row + col dim level lists, then materializes `1.0` for every
 * (row, col) coordinate.
 *
 * This is a fixture-only path — once API Lab slice 6 lands and the
 * factor table's actual cells flow through, the parent will hand
 * those in directly.
 */
function buildInitialCellsForTable(
  table: {
    readonly key_dimension?: string;
    readonly key_dimensions?: readonly string[];
  },
  dimensions: readonly DimensionRow[],
): ReadonlyMap<string, number> {
  const rowSlug = table.key_dimensions?.[0] ?? table.key_dimension ?? null;
  const colSlug = table.key_dimensions?.[1] ?? null;
  const rowDim = rowSlug ? dimensions.find((d) => d.slug === rowSlug) : null;
  const colDim = colSlug ? dimensions.find((d) => d.slug === colSlug) : null;
  const out = new Map<string, number>();
  // Cold-test M — key on the territory ids for a territory-grouped geo
  // dim (5 rows), not the 51 raw states. `levelsForKeying` returns the
  // raw levels for every other dim shape, so this is a no-op for the
  // categorical / banded tables.
  const rowLevels = rowDim ? levelsForKeying(rowDim) : [];
  const colLevels = colDim ? levelsForKeying(colDim) : [];
  if (rowLevels.length === 0) return out;
  if (colLevels.length > 0) {
    for (const r of rowLevels) {
      for (const c of colLevels) {
        if (r.id && c.id) out.set(cellKey(r.id, c.id), 1);
      }
    }
  } else {
    for (const r of rowLevels) {
      if (r.id) out.set(cellKey(r.id, null), 1);
    }
  }
  return out;
}

function drawerTitle(editor: EditorState): string {
  // PR 12.3 — Only `delete-confirm` reaches the top-level Drawer
  // now (add/edit kinds were removed with the InputNodeForm).
  if (editor.kind === "delete-confirm") {
    return `Delete ${editorKindLabel(editor.section)}`;
  }
  return "";
}

/** User-facing label for the entity-kind that this section accepts. */
function editorKindLabel(section: Section): string {
  if (section.id === "loadings") return "loading";
  if (section.id === "final-adjustments") return "adjustment";
  return "stage";
}

function DeleteConfirmation({
  stageDisplayName,
  error,
}: {
  stageDisplayName: string;
  error: string | null;
}) {
  return (
    <div className="delete-confirm">
      {error ? (
        <div className="add-stage-form__banner" role="alert">
          <strong>Couldn't delete.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      <h3 className="delete-confirm__title">
        Delete &ldquo;{stageDisplayName}&rdquo;?
      </h3>
      <p className="delete-confirm__body">
        This input source will be removed from the plan, and any stages
        downstream that reference its output will fail to compile. The action is
        logged in audit and can be inspected, but there&apos;s no undo button.
      </p>
    </div>
  );
}

/**
 * SectionDetailPane — the right pane.
 *
 * Shows the active section's stages + add affordance.
 */
function SectionDetailPane({
  section,
  stages,
  allPlanStages,
  inputDeclarations,
  planId,
  onAddStage,
  onEditStage,
  // 26.P0 — Dimension state plumbed from the route.
  dimensions,
  // Brief 39 follow-up — LOB-scoped factor-table catalog. Empty
  // array for non-BOP plans. Replaces the global
  // SAMPLE_FACTOR_TABLES reads inside this component.
  factorTables,
  onSelectDimension,
  // Brief 27 PR 1 — Single Add-shape handler off the workspace
  // tool pane. Replaces the 4 per-subtype Add handlers + the modal
  // picker entry point that lived here pre-Brief-27.
  onAddDimensionShape,
  // Brief 30 PR 30.1 — Inline editor state + handlers.
  editingDimensionId,
  onEditingDimensionIdChange,
  onCommitDimension,
  dimsSaveState,
  dimsSyncBlocked,
  onRetryDimsSync,
  onOpenClassRegistry,
  onDeleteDimension,
  // Brief 30 PR 30.4 — Used-in resolver + navigation.
  resolveReferences,
  onJumpToReference,
  onReferenceInChain,
  onUseAsFactorTableKey,
  onCompositeAxisChange,
  // Brief 44 PR 44.11 — Geographic inline editor + wizard plumbing.
  geographicActiveTab,
  onGeographicActiveTabChange,
  dimensionReturnTo,
  onAddFactorTable,
  // PR 14 — Parametrize canvas save handler + pending flag.
  onCreateFromDimension,
  onCreateFromCsv,
  onFactorTableDraftWriteThrough,
  onFactorTableAxesChanged,
  ftSaveState,
  // Brief 53 — ensure the canonical coverage dim for "+ Coverage split".
  onEnsureCoverageDimension,
  onDeleteFactorTable,
  // PR A2 — sidecar map of ft.id → cells map. Optional so legacy
  // consumers (none today) stay source-compatible.
  factorTableCells,
  // Brief 67 §3.1 — the editor act's back crumb (drops ?table=).
  onBackToCatalog,
  // Brief 34 PR 34.7 follow-up — inline editing
  editingTableId,
  creatingAxisSlug,
  onOpenFactorTableInline,
  // Brief 82 D-D — the Rating footer's verdict (the ONE readiness
  // selector, computed at the route level).
  readiness,
  onNavigateToDimensions,
  // Brief 70 Phase 3 — the build-up sheet's Final-adjustments tail
  // authoring (the route owns the drawers + stage mutations).
  onAddAdjustment,
  onEditAdjustment,
  onDeleteAdjustment,
  // PR 12.2
  onSaveAssembleStages,
  isSavingAssemble,
  // G15 — register this pane's pending-save flushes with the route so
  // Freeze awaits them (tower here; input mapping forwarded down).
  registerSaveFlush,
  // Read-only gate — false for proposed/active/archived plans. Gates the
  // tower autosave + flush-on-unmount and puts AssembleCanvas in read-only.
  isWritable,
  // J3 — sample-data affordance for the Inputs dropzone. Derived from
  // plan.template_id by the route; this component just forwards it
  // down to <InputsWorkspaceMount>.
  sampleDataset,
  // Cold-test payoff — per-template chain runtime constants (base
  // rates + LCM). Forwarded to InputsWorkspaceMount's projector call.
  chainRuntimeDefaults,
}: {
  section: Section;
  stages: StageSummary[];
  /**
   * 24.H — the full plan.stages list. The ASSEMBLE workspace
   * projects ALL assemble-relevant stages into one graph (rating
   * chains + loadings + final adjustments), regardless of which
   * specific section is active. Other workspaces use the
   * section-filtered `stages` above.
   */
  allPlanStages: StageSummary[];
  // Brief 58 Pillar C — durable input-dict bulk-add API from the stable
  // PlanDetailContent level; forwarded to <InputsWorkspaceMount>.
  inputDeclarations: InputDeclarationsApi;
  planId: string;
  onAddStage: (section: Section) => void;
  onEditStage: (section: Section, stage: StageSummary) => void;
  // 26.P0 — Dimension state plumbed from the route. The
  // DimensionsWorkspace + tower-inventory both read from this
  // (replacing the previous direct SAMPLE_DIMENSIONS
  // import inside this component).
  dimensions: readonly DimensionRow[];
  /**
   * Factor-table catalog scoped to this plan's LOB. For Meridian BOP
   * plans it's the seed fixture; for everything else it's `[]`
   * (blank build). The 5 in-pane consumers — DimensionsWorkspace,
   * tower-inventory factor chips, ParametrizeCanvas list + saved
   * mode, inline editor lookup, and the catalog passed to
   * AssembleCanvas — all read from this prop instead of the
   * SAMPLE_FACTOR_TABLES global.
   */
  factorTables: readonly (typeof SAMPLE_FACTOR_TABLES)[number][];
  // Brief 27 PR 1 — Dimensions workspace handlers. The workspace
  // owns its own chrome (tool pane + inspector); the route just
  // dispatches the user's shape choice + row selection.
  onSelectDimension: (id: string) => void;
  onAddDimensionShape: (shape: DimensionShapeChoice) => void;
  // Brief 30 PR 30.1 — Inline editor state + handlers.
  editingDimensionId: string | null;
  onEditingDimensionIdChange: (id: string | null) => void;
  onCommitDimension: (dim: DimensionRow) => void;
  // QA #5 — honest autosave status for the inline dimension editor,
  // derived from the real debounced write (bulkUpsertDimsMutation).
  dimsSaveState: "saving" | "saved" | "error";
  /** Brief 66 §3.2 — the dimensions GET failed; edits stay local. */
  dimsSyncBlocked: boolean;
  onRetryDimsSync: () => void;
  /** Brief 66 §3.3 — the explicit class-registry jump (carries search). */
  onOpenClassRegistry: (dimId: string) => void;
  onDeleteDimension: (dimId: string) => void;
  // Brief 30 PR 30.4 — Used-in resolver + navigation handlers.
  resolveReferences: (dimId: string) => readonly DimensionReference[];
  onJumpToReference: (ref: DimensionReference) => void;
  onReferenceInChain: (dimId: string) => void;
  onUseAsFactorTableKey: (dimId: string) => void;
  // Brief 30 PR 30.6 — Composite axis side-channel (toast on reorder).
  onCompositeAxisChange: (
    dimId: string,
    next: readonly string[],
    kind: "add" | "remove" | "reorder",
  ) => void;
  // Brief 44 PR 44.11 — Controlled tab id for the inline GeoDimEditor
  // when editing a geographic dim. Owned by the route so navigating
  // away + back returns to the same tab (Levels / Map / Territories).
  geographicActiveTab: GeoDimEditorTab;
  onGeographicActiveTabChange: (tab: GeoDimEditorTab) => void;
  // Brief 30 PR 30.7 — Optional back-crumb. When set, the inline
  // dim editor renders an extra crumb "← back to <label>" that the
  // user clicks to return to the consumer surface (e.g., the
  // factor table they deep-linked in from).
  dimensionReturnTo: {
    readonly label: string;
    readonly onClick: () => void;
  } | null;
  // 24.F — Parametrize workspace tool-pane handlers
  // Brief 89 R5 — accepts an optional name seed (`&name=` URL grammar)
  // from the picker's "Factor table …" create row.
  onAddFactorTable: (nameSeed?: string) => void;
  // Brief 70 §1 — create-on-pick (the creation question) + CSV-first.
  onCreateFromDimension: (dimSlug: string) => void;
  onCreateFromCsv: (payload: {
    readonly title: string;
    readonly axes: {
      readonly rowDimSlug: string | null;
      readonly colDimSlug: string | null;
    };
    readonly cells: ReadonlyMap<string, number>;
  }) => void;
  /** Brief 67 §3.2 — saved-table edits write through (autosave). */
  onFactorTableDraftWriteThrough: (
    tableId: string,
    draft: {
      readonly title: string;
      readonly axes: {
        readonly rowDimSlug: string | null;
        readonly colDimSlug: string | null;
      };
      readonly cells: ReadonlyMap<string, number> | null;
    },
  ) => void;
  // Brief 70 lock D7 — axis changes re-bind referencing chains.
  onFactorTableAxesChanged: (
    tableId: string,
    newKeyDims: readonly string[],
  ) => void;
  ftSaveState: "saving" | "saved" | "error" | undefined;
  // Brief 53 — idempotently seed the canonical Building / BPP coverage
  // structural dim, fired by the Parametrize "+ Coverage split".
  onEnsureCoverageDimension: () => void;
  // Cold-test N19 — delete a saved factor table by id.
  onDeleteFactorTable: (tableId: string) => void;
  // PR A2 — Saved cell values keyed by ft.id. When editing an
  // existing table, the canvas re-seeds from this map instead of
  // a default 1.0 grid.
  factorTableCells?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  // Brief 67 §3.1 — the editor act's back crumb (drops ?table=).
  onBackToCatalog: () => void;
  // Brief 34 PR 34.7 follow-up — Inline editing of an existing
  // factor table on the canvas (no separate detail route).
  editingTableId: string | null;
  // Brief 67 §3.1 — ?table=new&axis=<slug> row-axis pre-seed.
  creatingAxisSlug: string | null;
  onOpenFactorTableInline: (tableId: string) => void;
  // Brief 82 D-D — the Rating footer's verdict (computePlanReadiness,
  // computed once at the route level — the ONE selector).
  readiness: PlanReadiness;
  onNavigateToDimensions: () => void;
  // Brief 70 Phase 3 / Brief 78 P5.3 — Final-adjustments tail
  // authoring (stage API): IRPM · endorsement (G16) · loading · floor.
  onAddAdjustment: (
    kind: "modifier" | "min_premium" | "endorsement" | "loading",
  ) => void;
  onEditAdjustment: (stageId: string) => void;
  onDeleteAdjustment: (stageId: string) => void;
  // PR 12.2 — Assemble save handler. The Assemble workspace's
  // edited TowerPlan is reverse-projected via `towerPlanToStages`
  // and pushed through the diff helper in PlanDetailContent. The
  // route owns the mutations + toast.
  onSaveAssembleStages: (
    desired: readonly {
      readonly stage_id: string;
      readonly stage_kind: string;
      readonly display_name: string;
      readonly config_json: Record<string, unknown> | null;
    }[],
  ) => Promise<void>;
  // PR 12.2 — true while a save is in-flight; the button shows a
  // pending state.
  isSavingAssemble: boolean;
  // G15 — flush registration with the route-level freeze barrier.
  registerSaveFlush: (key: string, flush: (() => Promise<void>) | null) => void;
  // Read-only gate — `plan.status === "draft"`. When false the tower
  // autosave, the flush-on-unmount, and the Total-tower normalization are
  // all skipped, and AssembleCanvas renders read-only (no toast storm).
  isWritable: boolean;
  // J3 — optional sample-data affordance. Route looks up by
  // template_id; SectionDetailPane forwards to InputsWorkspaceMount.
  sampleDataset?: SampleDataset;
  // Cold-test payoff — chain runtime constants (lcm + base-rate input
  // defaults). Always supplied by the route (DEFAULT_CHAIN_RUNTIME
  // fallback), so non-optional here.
  chainRuntimeDefaults: ChainRuntimeDefaults;
}) {
  // Brief 67 §3.4 — armed factor-table delete. The prompt resolves the
  // table's Algorithm consumers (chains whose factor_lookups key on it)
  // so a load-bearing delete states its blast radius first.
  const [ftDeleteId, setFtDeleteId] = useState<string | null>(null);
  // Brief 82 D-C — the summoned table catalog (replaces the rail).
  const [tablesMenuOpen, setTablesMenuOpen] = useState(false);
  // Brief 82 R2 (F4) — the one-summoned-surface contract with the
  // sheet: opening the menu bumps the epoch (the sheet dismisses its
  // surfaces); the sheet summoning anything closes the menu.
  const [summonEpoch, setSummonEpoch] = useState(0);
  const toggleTablesMenu = useCallback(() => {
    if (!tablesMenuOpen) setSummonEpoch((e) => e + 1);
    setTablesMenuOpen(!tablesMenuOpen);
  }, [tablesMenuOpen]);
  useEffect(() => {
    if (!tablesMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTablesMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tablesMenuOpen]);
  const ftDeleteTarget = useMemo(
    () =>
      ftDeleteId === null
        ? null
        : (factorTables.find((t) => t.id === ftDeleteId) ?? null),
    [ftDeleteId, factorTables],
  );
  // Brief 67 §3.1 — ONE scan over the plan's chains maps every table
  // id to the lookups that read it. Feeds the catalog's "Used by"
  // column AND the armed delete prompt (same truth, two surfaces).
  const ftConsumersById = useMemo(() => {
    const map = new Map<string, { label: string; context?: string }[]>();
    for (const stage of allPlanStages) {
      if (stage.stage_kind !== "multiplicative_chain") continue;
      const cfg = stage.config_json as {
        chains?: ReadonlyArray<{
          name?: string;
          factor_lookups?: ReadonlyArray<{
            factor_kind?: string;
            name?: string;
          }>;
        }>;
      } | null;
      for (const chain of cfg?.chains ?? []) {
        for (const fl of chain.factor_lookups ?? []) {
          if (!fl.factor_kind) continue;
          const entry = {
            label: fl.name || fl.factor_kind,
            ...(chain.name ? { context: `${chain.name} chain` } : {}),
          };
          const list = map.get(fl.factor_kind);
          if (list) list.push(entry);
          else map.set(fl.factor_kind, [entry]);
        }
      }
    }
    return map;
  }, [allPlanStages]);
  const ftDeleteConsumers = useMemo(
    () => (ftDeleteId === null ? [] : (ftConsumersById.get(ftDeleteId) ?? [])),
    [ftDeleteId, ftConsumersById],
  );
  const ftDeleteCellCount = useMemo(() => {
    if (ftDeleteId === null) return 0;
    return factorTableCells?.get(ftDeleteId)?.size ?? 0;
  }, [ftDeleteId, factorTableCells]);

  const navigate = useNavigate();
  // Brief 70 §1 — the dims "Use as factor table key" jump
  // (?table=new&axis=<slug>) CREATES the table immediately: the intent
  // was explicit, so the creation question would be ceremony.
  useEffect(() => {
    if (editingTableId !== "new" || creatingAxisSlug === null) return;
    const dim = dimensions.find((d) => d.slug === creatingAxisSlug);
    if (dim && levelsForKeying(dim).length > 0) {
      onCreateFromDimension(creatingAxisSlug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTableId, creatingAxisSlug]);
  // 24.E — Gate workspace fires notify() for the read-only kinds
  // (eligibility + endorsement) that don't have a route handoff yet.
  const { notify } = useToast();
  const empty = stages.length === 0;

  // ── Brief 89 R5 — the picker's "Factor table …" create row ──────
  // The picker names the table + the tower awaiting the step; the
  // rate-by flow runs as-is (?table=new&name=…); when creation lands
  // (?table flips new → <id>), the referencing step inserts into the
  // waiting tower. Backing out of creation clears the wait.
  const [pendingPickerTable, setPendingPickerTable] = useState<{
    readonly towerId: string;
  } | null>(null);
  const handleCreateTableFromPicker = useCallback(
    (name: string, towerId: string) => {
      setPendingPickerTable({ towerId });
      onAddFactorTable(name);
    },
    [onAddFactorTable],
  );

  // ── 25.B.1 — Calculation Tower in-memory edit state ─────────
  //
  // The TowerPlan is derived from plan.stages, but the user may
  // edit it (insert / delete / change ops / group) before saving.
  // We hold the editedPlan locally; the substrate save path lands
  // when the API supports tower → stages reverse projection.
  //
  // Refresh policy: when the underlying stages change (e.g., the user
  // adds a stage via the legacy drawer flow), reset the editedPlan to
  // the new base.
  //
  // Brief 59 — key basePlan on the CONTENT of the server stages, not the
  // array identity. A pure `plan` refetch (window refocus, a sibling
  // workspace's read) hands back a fresh array with identical content;
  // if basePlan churned on that, the reset effect below would overwrite
  // an unsaved tower with the tower-less base before the 800ms autosave
  // fired (lost work). Keying on a content signature keeps basePlan
  // stable across those refetches; a genuine content change still bumps
  // the signature → basePlan recomputes → the reset adopts it once
  // (the post-save reconcile stays a single, loop-free adoption).
  // Brief 59 — content signature of a stage list: stage_id + kind +
  // config_json, sorted by id so it's order- and sequence-independent and
  // mirrors what the save-diff compares. Used both to keep basePlan stable
  // across pure refetches AND as the content-based dirty signal below.
  const stageContentSig = useCallback(
    (
      stages: readonly {
        readonly stage_id: string;
        readonly stage_kind: string;
        readonly config_json: Record<string, unknown> | null;
      }[],
    ): string =>
      JSON.stringify(
        stages
          .map((s) => [s.stage_id, s.stage_kind, s.config_json ?? {}])
          .sort((a, b) =>
            String(a[0]) < String(b[0])
              ? -1
              : String(a[0]) > String(b[0])
                ? 1
                : 0,
          ),
      ),
    [],
  );
  const baseStagesSignature = useMemo(
    () => stageContentSig(allPlanStages),
    [allPlanStages, stageContentSig],
  );
  const allPlanStagesRef = useRef(allPlanStages);
  allPlanStagesRef.current = allPlanStages;
  // Intentionally keyed on the content signature, not the array identity
  // (Brief 59); the memo reads the latest stages through the stable ref, so
  // exhaustive-deps is already satisfied and needs no suppression.
  const basePlan = useMemo(
    () => stagesToTowerPlan({ stages: allPlanStagesRef.current }),
    [baseStagesSignature],
  );
  const [editedPlan, setEditedPlan] = useState(basePlan);
  // Brief 70.1 / Brief 68 §3.1 — the autosave-race guard. The adoption
  // below used to be unconditional: when a save round-tripped (or any
  // genuine server change landed), basePlan recomputed and CLOBBERED
  // whatever the user edited while the save was in flight. Adoption now
  // requires that no unsaved work would be lost: the current projection
  // matches the incoming base (already in sync) OR matches exactly what
  // we dispatched (the save round-tripped with no edits since). When
  // mid-flight edits exist, we keep them — the content-dirty autosave
  // persists them and the NEXT round-trip adopts cleanly (loop-free:
  // skipping adoption changes no signatures).
  const projectedSigRef = useRef("");
  const baseSigRef = useRef("");
  baseSigRef.current = baseStagesSignature;
  const dispatchedSigRef = useRef("");
  useEffect(() => {
    const current = projectedSigRef.current;
    if (
      current === "" ||
      current === baseSigRef.current ||
      current === dispatchedSigRef.current
    ) {
      setEditedPlan(basePlan);
    }
  }, [basePlan]);

  // Brief 59 — the desired server stages for the current editedPlan, plus
  // a CONTENT-based dirty signal. Reference identity (`editedPlan !==
  // basePlan`) wrongly flags a freshly-spawned EMPTY tower as dirty: now
  // that inputs are preserved, an empty tower projects back to the exact
  // same stages as the server, so a ref-equality signal would autosave
  // forever in a no-op loop (churning re-renders + destabilizing edits).
  // Dirty = "what we'd persist differs from what's on the server" closes
  // that loop and still fires for real edits.
  const factorTablesCatalog = useMemo(
    () =>
      factorTables.map((ft) => ({
        id: ft.id,
        ...(ft.display_name ? { display_name: ft.display_name } : {}),
        ...(ft.key_dimension ? { key_dimension: ft.key_dimension } : {}),
        ...(ft.key_dimensions ? { key_dimensions: ft.key_dimensions } : {}),
      })),
    [factorTables],
  );
  const preservedStagesForSave = useMemo(
    () =>
      allPlanStages.map((s) => ({
        stage_id: s.stage_id,
        sequence: s.sequence,
        stage_kind: s.stage_kind,
        display_name: s.display_name,
        config_json: (s.config_json ?? {}) as Record<string, unknown>,
      })),
    [allPlanStages],
  );
  const projectedDesiredStages = useMemo(
    () =>
      towerPlanToStages(editedPlan, {
        preservedStages: preservedStagesForSave,
        factorTablesCatalog,
      }),
    [editedPlan, preservedStagesForSave, factorTablesCatalog],
  );
  const projectedStagesSig = stageContentSig(projectedDesiredStages);
  projectedSigRef.current = projectedStagesSig;
  const isTowerDirty = projectedStagesSig !== baseStagesSignature;

  // PR 12.2 — Save handler: reverse-project the editedPlan via
  // `towerPlanToStages`, then dispatch the diff through the
  // mutations the route owns. The factor-tables catalog is the
  // dim-key resolver (so chain factor_lookups[].dimensions[K].path
  // reconstructs correctly). Preserved stages flow through any
  // sidecar stage kinds the converter doesn't reverse-project yet
  // (modifier_schedule, flat_factor, clamp, round).
  // v4 P0.8 (G23) — consecutive tower-save failure streak. onSaveAssembleStages
  // now RETHROWS on failure; we count the streak so the autosave effect below
  // can back off + cap (no ~1Hz storm) and the SavePill can read "error"
  // ("Save failed — retrying") instead of a permanent, dishonest "Saving…".
  const [saveFailures, setSaveFailures] = useState(0);
  const handleSaveAssemble = useCallback(async () => {
    // Snapshot what this save carries — the adoption guard above lets
    // the post-save basePlan in only when nothing changed since.
    dispatchedSigRef.current = stageContentSig(projectedDesiredStages);
    try {
      await onSaveAssembleStages(
        projectedDesiredStages.map((s) => ({
          stage_id: s.stage_id,
          stage_kind: s.stage_kind,
          display_name: s.display_name,
          config_json: s.config_json,
        })),
      );
      setSaveFailures(0); // recovered → pill returns to "saved", cadence resets
    } catch (err) {
      // Toast ONCE on the first failure of a streak; the persistent pill +
      // backoff carry the ongoing state. Re-throw is swallowed here (callers
      // use `void handleSaveAssemble()`); the streak count is the signal.
      setSaveFailures((n) => {
        if (n === 0) {
          const msg = err instanceof Error ? err.message : String(err);
          notify(`Save failed: ${msg}`);
        }
        return n + 1;
      });
    }
  }, [projectedDesiredStages, onSaveAssembleStages, stageContentSig, notify]);

  // Brief 48 phase 4c / Brief 59 — AUTOSAVE the chain (the explicit "Save
  // chain" button is gone). The dirty signal is CONTENT-based (`isTowerDirty`
  // — the projected stages differ from the server's), NOT reference identity:
  // an empty tower that projects back to the same stages is therefore never
  // dirty and never loops. After a real save round-trips, the refetch bumps
  // `baseStagesSignature` → basePlan recomputes → the reset adopts it → the
  // projection now matches → not dirty (loop-free). Debounced 800ms so a
  // burst of edits coalesces; skipped while a save is already in flight.
  // v4 P0.8 (G23) — after this many consecutive failures we stop
  // auto-retrying and leave the honest "Save failed" pill up (a persistent
  // backend error, e.g. a doomed-422 stage payload, must not loop forever).
  const ASSEMBLE_MAX_AUTO_RETRIES = 5;
  useEffect(() => {
    if (!isWritable) return; // read-only plan — never autosave (would 409-storm)
    if (!isTowerDirty) return; // clean (projection matches the server)
    if (isSavingAssemble) return; // a save is already running — let it settle
    // Give up auto-retrying once the streak hits the cap. The edit stays in
    // the tower state (unsaved, not lost); a subsequent edit changes
    // projectedDesiredStages → isTowerDirty re-fires the effect, giving a
    // natural manual retry (and resetting the streak on success).
    if (saveFailures >= ASSEMBLE_MAX_AUTO_RETRIES) return;
    // Normal cadence is 800ms; after a failure, back off exponentially
    // (1.6s, 3.2s, 6.4s, …) so a persistent error can't hammer the backend.
    const delay =
      saveFailures === 0 ? 800 : Math.min(800 * 2 ** saveFailures, 15000);
    const timer = setTimeout(() => {
      void handleSaveAssemble();
    }, delay);
    return () => clearTimeout(timer);
  }, [
    isWritable,
    isTowerDirty,
    isSavingAssemble,
    saveFailures,
    handleSaveAssemble,
  ]);

  // Brief 59 — flush a pending tower save when the pane unmounts before
  // the 800ms debounce fires (switching to the Analytics workspace, or
  // leaving the plan route, right after a tower edit). The autosave
  // effect's cleanup clears the debounce timer on unmount, so without
  // this the edit would be dropped. Refs keep the unmount cleanup pointed
  // at the latest save fn + dirty signal without re-subscribing on every
  // keystroke. Best-effort during teardown; the content-stable basePlan
  // above is the load-bearing guarantee for in-app tab navigation.
  const handleSaveAssembleRef = useRef(handleSaveAssemble);
  handleSaveAssembleRef.current = handleSaveAssemble;
  const isTowerDirtyRef = useRef(false);
  isTowerDirtyRef.current = isTowerDirty;
  // Read-only plans never flush — the save would 409 (and handleSaveAssemble
  // is gated anyway). Kept in a ref so the unmount cleanup reads the latest.
  const isWritableRef = useRef(isWritable);
  isWritableRef.current = isWritable;
  // The flush must NOT fire during React StrictMode's simulated unmount on
  // initial mount. A non-canonical draft is normalization-dirty at mount, so
  // that synthetic unmount's cleanup would dispatch a full normalization save
  // that is entirely redundant — the remounted 800ms autosave persists the
  // same diff on the live observer. Worse, the redundant save's add_stage
  // `mutateAsync` drives the shared `addStageMutation` observer to `pending`,
  // then the very same synthetic unmount unsubscribes it (onUnsubscribe →
  // removeObserver), detaching it from the in-flight mutation before the 201
  // resolves and freezing its `useSyncExternalStore` snapshot at
  // `isPending: true`. (The drawers are insulated from that strand by
  // `isDrawerSaving` above; this guard removes the strand + the duplicate save
  // at the source.) Arm the flush only after the first commit has survived a
  // macrotask: StrictMode's simulated unmount runs synchronously within the
  // commit, so the setTimeout(0) below is cleared before it can arm — that
  // unmount is skipped, while a genuine later unmount (navigating away
  // mid-edit) still flushes.
  const flushArmedRef = useRef(false);
  useEffect(() => {
    const armTimer = setTimeout(() => {
      flushArmedRef.current = true;
    }, 0);
    return () => {
      clearTimeout(armTimer);
      if (
        flushArmedRef.current &&
        isWritableRef.current &&
        isTowerDirtyRef.current
      )
        void handleSaveAssembleRef.current();
    };
  }, []);

  // G15 — register the tower's on-demand flush with the route's freeze
  // barrier: a dirty tower saves (awaited) before the snapshot body is
  // composed server-side, so a freeze clicked inside the 800ms autosave
  // window can't miss the edit. Reuses the same latest-refs the unmount
  // flush reads; the save rethrows on failure (G23), which ABORTS the
  // freeze upstream.
  useEffect(() => {
    registerSaveFlush("tower", async () => {
      if (isWritableRef.current && isTowerDirtyRef.current) {
        await handleSaveAssembleRef.current();
      }
    });
    return () => registerSaveFlush("tower", null);
  }, [registerSaveFlush]);

  // ── Brief 89 R5 — declare-after-the-tower-lands ──────────────────
  // A declaration mutates plan.stages; its refetch recomputes basePlan
  // while the just-inserted step may still sit inside the 800ms
  // autosave window — the live walk lost a step exactly that way. So
  // every picker-create declaration defers one macrotask (the insert
  // commits, the dirty ref updates), lands the tower save, THEN
  // enqueues into the durable queue (Brief 58), deduped.
  const declareAfterTowerLands = useCallback(
    (entry: InputDictEntry) => {
      setTimeout(() => {
        void (async () => {
          try {
            if (isWritableRef.current && isTowerDirtyRef.current) {
              await handleSaveAssembleRef.current();
            }
          } catch {
            // The tower autosave retries on its own; declaring proceeds.
          }
          const declared = new Set(
            allPlanStages
              .filter((s) => s.stage_kind === "input_node")
              .map((s) => {
                const cfg =
                  s.config_json && typeof s.config_json === "object"
                    ? (s.config_json as Record<string, unknown>)
                    : {};
                const sp = cfg["source_path"];
                return typeof sp === "string" ? sp : s.stage_id;
              }),
          );
          if (!isDeclarableFieldName(entry.fieldName)) return;
          if (declared.has(entry.fieldName)) return;
          const queued = inputDeclarations.enqueue([entry]);
          if (queued > 0) {
            notify(`Declared ${entry.displayName} — it's in Inputs now.`);
          }
        })();
      }, 0);
    },
    [allPlanStages, inputDeclarations, notify],
  );

  // The picker's Input "…" create row: the sheet already inserted the
  // step; this lands the DECLARED dictionary row.
  const handleDeclareInputFromSheet = useCallback(
    (entry: {
      readonly fieldName: string;
      readonly displayName: string;
      readonly dtype: "float" | "string" | "bool";
    }) => {
      declareAfterTowerLands({
        id: "",
        fieldName: entry.fieldName,
        displayName: entry.displayName,
        dataType: entry.dtype,
        source: "form",
        required: true,
      });
    },
    [declareAfterTowerLands],
  );

  // Brief 89 R5 — when the picker-created table lands (?table flips
  // "new" → the minted id), the referencing step inserts into the
  // tower that was waiting for it, and the keying dim joins the
  // dictionary as a DECLARED row (CT-2) — after the tower save lands.
  // Backing out of creation clears the wait.
  const prevEditingTableIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevEditingTableIdRef.current;
    prevEditingTableIdRef.current = editingTableId;
    if (pendingPickerTable === null || prev !== "new") return;
    if (editingTableId === null) {
      setPendingPickerTable(null);
      return;
    }
    if (editingTableId === "new") return;
    setPendingPickerTable(null);
    const table = factorTables.find((t) => t.id === editingTableId);
    if (!table) return;
    const towerExists = editedPlan.towers.some(
      (t) => t.id === pendingPickerTable.towerId,
    );
    if (!towerExists) return;
    const keyDims =
      table.key_dimensions ??
      (table.key_dimension ? [table.key_dimension] : []);
    const keyed =
      keyDims.length > 0
        ? `keyed by ${keyDims
            .map((k) => dimensions.find((d) => d.slug === k)?.display_name ?? k)
            .join(" and ")}`
        : "factor lookup";
    const node = pickerItemToNode(
      {
        id: `ft:${table.id}`,
        kind: "factor-table",
        title: table.display_name,
        sentence: keyed,
        tableId: table.id,
      },
      editedPlan.nodes,
    );
    setEditedPlan(
      insertNodeAtEnd(editedPlan, pendingPickerTable.towerId, node),
    );
    notify(`${table.display_name} added to the build-up.`);
    const dimSlug = keyDims[0];
    const dim = dimSlug
      ? dimensions.find((d) => d.slug === dimSlug)
      : undefined;
    if (dim) {
      declareAfterTowerLands({
        id: "",
        fieldName: dim.slug,
        displayName: dim.display_name || dim.slug,
        dataType: dim.shape === "banded" ? "float" : "string",
        source: "derived",
        required: true,
        derivedFrom: dim.slug,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTableId, pendingPickerTable, factorTables]);

  // ADR-0055 — the plan's Final-adjustments tail is API-backed plan
  // substrate (draft-gated PUT; snapshots capture it). Authored here;
  // the cohort scoring view reads the same synced record. G15 — as the
  // EDITOR mount, this instance joins the freeze barrier so a freeze
  // lands a pending tail write first.
  const [policyTail, setPolicyTail] = usePolicyTailSynced(planId, {
    writable: isWritable,
    registerFlush: registerSaveFlush,
  });
  const declaredInputFields = useMemo(
    () => stagesToInputDictEntries(allPlanStages).map((e) => e.fieldName),
    [allPlanStages],
  );
  // Brief 62.6 PR3 — API Lab connectors the Final-adjustments "Connector" IRPM
  // source can bind in this plan's tail. When empty the editor keeps it disabled.
  const { data: connectorsData } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => listConnectors(),
  });
  const availableConnectors = useMemo<ConnectorOption[]>(
    () =>
      (connectorsData?.connectors ?? []).map((c) => ({
        connectorId: c.connector_id,
        version: c.version,
        displayName: c.display_name,
      })),
    [connectorsData],
  );

  // Brief 78 P5.4 (D-F) — ONE tail ledger. The policy tail projects
  // into the sheet's Final-adjustments rows (provenance "policy-tail");
  // the old below-sheet <FinalAdjustmentsEditor> mount is GONE — the
  // editor now opens as a drawer from the ledger (row click / the
  // "Policy tail" menu entry), and row delete filters the synced tail.
  const [policyTailDrawerOpen, setPolicyTailDrawerOpen] = useState(false);
  const policyTailRows = useMemo<SheetAdjustment[]>(
    () =>
      policyTail.map((a): SheetAdjustment => {
        if (a.kind === "schedule_rating") {
          const src =
            a.source.from === "literal"
              ? "underwriter judgment"
              : a.source.from === "column"
                ? `from the ${a.source.column} column`
                : `from connector ${a.source.connector_id}`;
          return {
            provenance: "policy-tail",
            id: a.id,
            name: a.display_name,
            sentence: `IRPM ${src} — composes per policy, capped ±${a.cap_pct}%`,
            kind: "modifier",
            meta: `± ${a.cap_pct}%`,
            op: "×",
          };
        }
        if (a.kind === "package_factor") {
          return {
            provenance: "policy-tail",
            id: a.id,
            name: a.display_name,
            sentence: a.when
              ? "package modifier — applies when its guard matches"
              : "package modifier — multiplies the policy premium",
            kind: "modifier",
            meta: `× ${a.factor}`,
            op: "×",
          };
        }
        if (a.kind === "endorsement") {
          const flat = a.effect.kind === "flat";
          return {
            provenance: "policy-tail",
            id: a.id,
            name: a.display_name,
            sentence: flat
              ? "policy endorsement — adds a flat amount"
              : "policy endorsement — multiplies the policy premium",
            kind: "endorsement",
            meta: flat
              ? `+ $${(a.effect as { amount: number }).amount.toLocaleString("en-US")}`
              : `× ${(a.effect as { factor: number }).factor}`,
            op: flat ? "+" : "×",
          };
        }
        return {
          provenance: "policy-tail",
          id: a.id,
          name: "Minimum premium (policy)",
          sentence: `never below $${a.floor.toLocaleString("en-US")} — floors the composed policy premium`,
          kind: "min_premium",
          meta: `$${a.floor.toLocaleString("en-US")} floor`,
          op: "floor",
        };
      }),
    [policyTail],
  );
  const handleDeletePolicyTailRow = useCallback(
    (adjustmentId: string) => {
      setPolicyTail(policyTail.filter((a) => a.id !== adjustmentId));
    },
    [policyTail, setPolicyTail],
  );

  // The Classification section has its own dedicated route — the
  // section pane offers a deep-link affordance. (M4.1.1 + M4.1.2.)
  const isClassification = section.id === "classification";
  // The Risk Inputs section renders its stages as a metadata-rich
  // table rather than the chip-list other sections use. (M4.2 +
  // M4.2.1.)
  const isRiskInputs = section.id === "risk-inputs";
  // The Coverage Chains section renders its stages as RatingChainCards
  // (one card per ChainSpec inside each multiplicative_chain stage).
  // (M4.3.8b.)
  const isRatingChains = section.id === "rating-chains";
  // The Dimensions section reads from a frontend fixture today
  // (SAMPLE_DIMENSIONS) — API Lab slice 4 will add the
  // real endpoints. (M4.4.)
  const isDimensions = section.id === "dimensions";

  // ── 24.C — DIMENSIONS workspace section gate ────────────────
  //
  // Four rail entries (Risk Inputs / Dimensions / Territories /
  // Classification) collapse into one unified workspace view. The
  // entry that's selected picks an initial subtype filter; the
  // workspace's onSelect handler routes to the subtype-appropriate
  // editor (drawer for Standard, /territories for Geographic,
  // /classification for Classification). Per Brief 24 v3 §2.2.1.
  //
  // Note: `isTerritories` + `isClassification` flags are declared
  // below — referenced first by `isDimensionsWorkspaceSection` so
  // the comment block can stay near the gate it controls.
  // Same pattern as Dimensions, sourced from
  // SAMPLE_FACTOR_TABLES. API Lab slice 6 lands the real
  // endpoint. (M4.5.)
  const isFactorTables = section.id === "factor-tables";
  // M4.7 — Modifiers section. Reads modifier_schedule stages from
  // plan.stages. Section pane renders one card per schedule.
  const isModifiers = section.id === "modifiers";
  // M4.8 — Loadings section. flat_factor stages with loading-style
  // factor_kind values render as a table of cumulative multipliers.
  const isLoadings = section.id === "loadings";
  // M4.9 — Final Adjustments section. Heterogeneous stage kinds
  // (clamp, round, flat_factor) render with kind-keyed "effect"
  // descriptions in a unified table.
  const isFinalAdjustments = section.id === "final-adjustments";
  // M4.10 — Outputs section. Reads the typed-outputs declaration
  // from a frontend fixture (no backend plan.outputs[] today).
  const isOutputs = section.id === "outputs";
  // M4.11 — final 3 sections, all fixture-driven (no backend yet).
  const isEligibility = section.id === "eligibility";
  const isTerritories = section.id === "territories";
  const isEndorsements = section.id === "endorsements";

  // 24.C → 24.F2 — Dimensions workspace section gate. Risk Inputs
  // broke back out as its own peer workspace (24.F2), so it's no
  // longer in this gate. The 3 remaining sub-sections still share
  // one workspace surface; deep-link from a sub-section URL still
  // pre-applies the subtype filter.
  const isDimensionsWorkspaceSection =
    isDimensions || isTerritories || isClassification;
  const dimensionsInitialFilter: DimensionSubtypeFilter = isTerritories
    ? "geographic"
    : isClassification
      ? "classification"
      : "all";
  // v2 Dimensions redesign (2-column) — opt-in dev flag while it's built out.
  // §2B: the same props feed either view; only the rendered surface differs.
  // Brief 66 §3.7 — THE CUTOVER: dims2 is the Dimensions surface. The
  // ?dims2 flag is retired; the legacy DimensionsWorkspace + the
  // DimensionEditor orchestrator are deleted in this same change
  // (preference #8 — the integration deletes what it replaces).
  const DimsView = DimensionsWorkspaceV2;

  // 24.F2 — Inputs workspace section gate. Risk Inputs is the only
  // section in this workspace today; the workspace shell wraps
  // <RiskInputsTable> with an Inputs-specific tool pane.
  const isInputsWorkspaceSection = isRiskInputs;

  // 24.E + Brief 39 — Gate workspace section gate. Three legacy
  // sections (Eligibility + Modifiers + Endorsements) collapse into
  // one Brief 39 <GateCanvas> authoring surface. The entry section
  // is informational only (the canvas always shows all 3 sub-sections
  // in the rail); no kind-filter prop is needed.
  const isGateWorkspaceSection = isEligibility || isModifiers || isEndorsements;

  // 24.H — Assemble workspace section gate. Five sections
  // (rating-chains + factor-tables + loadings + final-adjustments +
  // outputs) collapse into ONE Rating workspace (Brief 78/D9 folded
  // the former Parametrize gate in: the table catalog is the rail,
  // the editor is the inspector/takeover). The workspace pulls from
  // `allPlanStages` (not the active section's stages) so the sheet
  // shows the full data flow regardless of which section anchored.
  const isAssembleWorkspaceSection =
    isRatingChains ||
    isFactorTables ||
    isLoadings ||
    isFinalAdjustments ||
    isOutputs;

  // 24.F — sections inside a workspace shell get their own
  // workspace-level header (title + description + actions). The
  // section-pane's legacy header is suppressed so we don't render two
  // titles.
  const renderInWorkspaceShell =
    isInputsWorkspaceSection ||
    isDimensionsWorkspaceSection ||
    isGateWorkspaceSection ||
    isAssembleWorkspaceSection;

  return (
    <section
      className="section-pane"
      aria-labelledby={`section-pane-title-${section.id}`}
    >
      {renderInWorkspaceShell ? null : (
        <header className="section-pane__header">
          <div className="section-pane__title-block">
            <h2
              id={`section-pane-title-${section.id}`}
              className="section-pane__title"
            >
              <span className="section-pane__num" aria-hidden>
                {section.num}.
              </span>{" "}
              {section.name}
            </h2>
            <p className="section-pane__subtitle">{section.emptyHint}</p>
          </div>
          <div className="section-pane__header-meta">
            {section.required ? (
              <Chip tone="warning" variant="mono">
                required
              </Chip>
            ) : (
              <Chip tone="default" variant="mono">
                optional
              </Chip>
            )}
            <Chip tone="default" variant="mono">
              {section.scope}
            </Chip>
          </div>
        </header>
      )}

      <div className="section-pane__body">
        {isInputsWorkspaceSection ? (
          // Brief 38 PR 38.9 — the <InputsWorkspace> orchestrator (CSV/
          // webhook source + auto-recognition mapping + mismatch
          // resolution + live scoring preview). The mount keeps ALL its
          // logic and swaps to the v2 body (InputsPanelV2) internally
          // when ?v2=1 — §2B view swap, same wiring. Was the 24.F2
          // read-only <RiskInputsTable>.
          <InputsWorkspaceMount
            dimensions={dimensions}
            // G15 — the mapping's debounced PUT registers its flush with
            // the route-level freeze barrier through this pane.
            registerSaveFlush={registerSaveFlush}
            // PR 13.2 — feed the FT catalog so deriveRequiredInputs
            // can surface "expected inputs" from FT keys before any
            // chain references them.
            factorTables={factorTables}
            // PR D2a — feed the FT cells so stagesToRuntimePlan can
            // embed the actual factor values into lookup.direct
            // nodes. Without cells, every factor resolves to 1.0 and
            // scoring returns base × LCM (no factor variation). The
            // prop comes from SectionDetailPane's `factorTableCells`
            // (hoisted from PlanDetailRoute's `editedFactorTableCells`
            // via the same-named sidecar pattern as factorTables).
            // Conditional spread keeps exactOptionalPropertyTypes
            // happy — never pass `undefined` to an optional prop.
            {...(factorTableCells ? { factorTableCells } : {})}
            allPlanStages={allPlanStages}
            inputDeclarations={inputDeclarations}
            planId={planId}
            isWritable={isWritable}
            notify={notify}
            // J3 — Optional sample-data affordance on the CSV dropzone.
            // Derived from plan.template_id via the lookup below.
            // Omits the prop entirely (rather than passing undefined)
            // for templates without a known sample so
            // exactOptionalPropertyTypes is happy.
            {...(sampleDataset ? { sampleDataset } : {})}
            // Cold-test payoff — chain runtime constants (base rates +
            // LCM) for the projector. Always present.
            chainRuntimeDefaults={chainRuntimeDefaults}
          />
        ) : isDimensionsWorkspaceSection ? (
          // Brief 27 PR 1 — DimensionsWorkspace owns its own 3-column
          // shell (tool pane / center pane / inspector).
          //
          // Brief 30 PR 30.1 — categorical dim editing now happens
          // INLINE in the workspace center pane (no drawer). The
          // route passes `editingDimensionId` + the autosave commit
          // handler + delete handler; the workspace renders
          // <DimensionEditor> when editing or the browse list when
          // not. Banded / Geographic / Classification still flow
          // through onSelect → legacy drawers/routes (PR 30.2+).
          <DimsView
            dimensions={dimensions}
            initialFilter={dimensionsInitialFilter}
            resolveReferences={resolveReferences}
            onJumpToReference={onJumpToReference}
            geographicActiveTab={geographicActiveTab}
            onGeographicActiveTabChange={onGeographicActiveTabChange}
            onOpenClassRegistry={onOpenClassRegistry}
            // Read-only (archived / active / proposed): withhold every
            // write handler. The workspace already disables an affordance
            // whose handler is absent — rail add-buttons, inspector "Edit",
            // delete, editor entry — so the browse list + inspector VIEW
            // (summary / usage / live preview) stay fully usable while
            // authoring is cleanly gated. No component flag needed; mirrors
            // the frame's read-only treatment.
            {...(isWritable
              ? {
                  onSelect: onSelectDimension,
                  onAdd: onAddDimensionShape,
                  editingDimensionId,
                  onEditingDimensionIdChange,
                  onCommitDimension,
                  saveState: dimsSaveState,
                  syncBlocked: dimsSyncBlocked,
                  onRetrySync: onRetryDimsSync,
                  onDeleteDimension,
                  onReferenceInChain,
                  onUseAsFactorTableKey,
                  onCompositeAxisChange,
                }
              : {})}
            {...(dimensionReturnTo !== null
              ? { returnTo: dimensionReturnTo }
              : {})}
          />
        ) : isGateWorkspaceSection ? (
          // Brief 70 §3 — ELIGIBILITY: the appetite statement (one
          // readable document) replaces the 3-kind GateCanvas.
          // Modifier/endorsement stages stay in the plan; they join
          // the Algorithm's FINAL ADJUSTMENTS in Phase 3.
          <EligibilityMount
            planId={planId}
            allPlanStages={allPlanStages}
            dimensions={dimensions}
            isWritable={isWritable}
          />
        ) : isAssembleWorkspaceSection ? (
          // Brief 82 (D-A) — THE RATING TAB, one column: toolbar
          // (Tables menu · Open in Run · save pill) → the build-up
          // sheet at reading width → the readiness footer. The Brief
          // 78 panes (rail + inspector) are deleted; the Brief 67
          // editor is the ?table= takeover (R2 re-homes small grids
          // inline). The sheet keeps Brief 70's anatomy + wiring —
          // the edited TowerPlan over the same projection/autosave
          // machinery. O-1: no sample, no dollars — Run owns them.
          (() => {
            const creatingTable = editingTableId === "new";
            const openTableId = creatingTable ? null : editingTableId;
            const editingTable =
              openTableId !== null
                ? factorTables.find((t) => t.id === openTableId)
                : undefined;

            // ── The takeover: the full-width Brief 67 editor slides
            // over the sheet (creation + any open table in R1). The
            // wiring carries verbatim — same key/remount semantics,
            // same write-through, same armed delete. The ?expand=1
            // grammar still deep-links (it lands here identically).
            if (creatingTable || openTableId !== null) {
              const initialDraft: ParametrizeCanvasProps["initialDraft"] =
                editingTable
                  ? {
                      title: editingTable.display_name,
                      axes: {
                        rowDimSlug:
                          editingTable.key_dimensions?.[0] ??
                          editingTable.key_dimension ??
                          null,
                        colDimSlug: editingTable.key_dimensions?.[1] ?? null,
                      },
                      // PR A2 — Prefer saved cells (from sidecar) over
                      // the default 1.0-filled stub.
                      cells:
                        factorTableCells?.get(editingTable.id) ??
                        buildInitialCellsForTable(editingTable, dimensions),
                    }
                  : undefined;
              // Brief 82 R1 — with the inspector pane gone, "back"
              // always clears ?table= (there is nothing to collapse
              // INTO; the sheet is the reading state).
              const backToSheet = onBackToCatalog;
              return (
                <div className="rater-rating-takeover">
                  <div className="rater-rating-takeover__crumb">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ArrowLeft size={14} />}
                      onClick={backToSheet}
                    >
                      Back to sheet
                    </Button>
                  </div>
                  <ParametrizeCanvas
                    // Brief 67 §3.2 — the key carries the LOAD state
                    // (remount once the table/dim hydration resolves;
                    // see the deleted tab mount's history for why).
                    key={
                      creatingTable
                        ? "new-draft"
                        : openTableId !== null
                          ? `${openTableId}:${editingTable ? "loaded" : "loading"}`
                          : "catalog"
                    }
                    dimensions={dimensions}
                    factorTables={factorTables.map((t): FactorTableSummary => ({
                      id: t.id,
                      display_name: t.display_name,
                      slug: t.slug,
                      ...(t.description !== undefined
                        ? { description: t.description }
                        : {}),
                      ...(t.key_dimension !== undefined
                        ? { key_dimension: t.key_dimension }
                        : {}),
                      ...(t.key_dimensions !== undefined
                        ? { key_dimensions: t.key_dimensions }
                        : {}),
                    }))}
                    creating={creatingTable}
                    onBackToCatalog={backToSheet}
                    onOpenFactorTable={onOpenFactorTableInline}
                    onAddDimension={onNavigateToDimensions}
                    readOnly={!isWritable}
                    {...(initialDraft !== undefined ? { initialDraft } : {})}
                    {...(isWritable
                      ? {
                          // Brief 67 §3.4 — armed impact delete.
                          onDeleteFactorTable: (tableId: string) => {
                            setFtDeleteId(tableId);
                          },
                          onNewFactorTable: onAddFactorTable,
                        }
                      : {})}
                    editingExisting={openTableId !== null}
                    {...(ftSaveState !== undefined
                      ? { saveState: ftSaveState }
                      : {})}
                    {...(isWritable
                      ? {
                          // Brief 70 §1 — create-on-pick + CSV-first.
                          onCreateFromDimension,
                          onCreateFromCsv,
                          // Brief 67 §3.2 — saved-table edits WRITE
                          // THROUGH; the steady-state bulk sync persists.
                          onDraftChange: (
                            draft: ParametrizeCanvasDraft | null,
                          ) => {
                            if (openTableId !== null && draft) {
                              onFactorTableDraftWriteThrough(
                                openTableId,
                                draft,
                              );
                            }
                          },
                          // Brief 70 lock D7 — axis change re-binds
                          // every referencing chain.
                          ...(openTableId !== null
                            ? {
                                onAxesChanged: (
                                  newKeyDims: readonly string[],
                                ) => {
                                  onFactorTableAxesChanged(
                                    openTableId,
                                    newKeyDims,
                                  );
                                },
                              }
                            : {}),
                          onEnsureCoverageDimension,
                        }
                      : {})}
                  />
                  <FactorTableDeletePrompt
                    open={ftDeleteTarget !== null}
                    tableName={ftDeleteTarget?.display_name ?? ""}
                    cellCount={ftDeleteCellCount}
                    consumers={ftDeleteConsumers}
                    onConfirm={() => {
                      if (ftDeleteId !== null) onDeleteFactorTable(ftDeleteId);
                      setFtDeleteId(null);
                    }}
                    onCancel={() => setFtDeleteId(null)}
                  />
                </div>
              );
            }

            // ── One column (Brief 82 D-A): toolbar → sheet → footer. ──
            const menuTables = factorTables.map((t) => {
              const cells = factorTableCells?.get(t.id);
              let shapeLabel = "no cells yet";
              if (cells && cells.size > 0) {
                let min = Infinity;
                let max = -Infinity;
                for (const v of cells.values()) {
                  if (v < min) min = v;
                  if (v > max) max = v;
                }
                shapeLabel = `${cells.size} value${
                  cells.size === 1 ? "" : "s"
                } · ${min === max ? String(min) : `${min}–${max}`}`;
              }
              return {
                id: t.id,
                name: t.display_name,
                shapeLabel,
                usedByCount: ftConsumersById.get(t.id)?.length ?? 0,
              };
            });
            // Brief 82 D-D — the footer chips read the plan's own
            // structure (O-2: the plan's tower names, nothing else).
            // The tail-kind set is shared so this
            // footer and the public counting can't drift apart.
            const adjustmentCount =
              projectedDesiredStages.filter((s) =>
                SHEET_TAIL_STAGE_KINDS.has(s.stage_kind),
              ).length + policyTailRows.length;
            const footerSections = [
              ...getPerLevelTowers(editedPlan).map((t) => {
                const stepCount = t.entries.filter(
                  (e) =>
                    e.kind === "node" &&
                    editedPlan.nodes.get(e.nodeId)?.category !== "output",
                ).length;
                return {
                  sectionId: t.id,
                  name: t.name,
                  countLabel: `${stepCount} step${stepCount === 1 ? "" : "s"}`,
                };
              }),
              {
                sectionId: "__final",
                name: "Adjustments",
                countLabel: String(adjustmentCount),
              },
            ];
            const openRun = () =>
              navigate(`/rate-lab/${planId}/workspace/verify`);
            return (
              <>
                <div className="rater-rating-page" aria-label="Rating">
                  <div className="rater-rating-page__toolbar">
                    <SavePill
                      state={
                        // v4 P0.8 (G23) — a failing save is never a
                        // permanent "Saving…": a failure streak (with
                        // no save in flight) reads "error"; it clears
                        // back to "saved" on recovery.
                        saveFailures > 0 && !isSavingAssemble
                          ? "error"
                          : isSavingAssemble || isTowerDirty
                            ? "saving"
                            : "saved"
                      }
                      {...(saveFailures > 0 && !isSavingAssemble
                        ? { label: "Save failed — retrying" }
                        : {})}
                      testId="rater-rating-save-pill"
                    />
                    <span className="rater-rating-page__toolbar-spacer" />
                    <span className="rater-rating-page__menu-wrap">
                      <button
                        type="button"
                        className="rater-rating-page__toolbtn"
                        onClick={toggleTablesMenu}
                        aria-expanded={tablesMenuOpen}
                        data-testid="rater-rating-tables-btn"
                      >
                        <Table2 size={13} strokeWidth={1.8} aria-hidden />
                        Tables <b>{factorTables.length}</b>
                      </button>
                      {tablesMenuOpen ? (
                        <RatingTablesMenu
                          tables={menuTables}
                          onSelectTable={(tableId) => {
                            setTablesMenuOpen(false);
                            onOpenFactorTableInline(tableId);
                          }}
                          {...(isWritable
                            ? {
                                onNewTable: () => {
                                  setTablesMenuOpen(false);
                                  onAddFactorTable();
                                },
                              }
                            : {})}
                          onClose={() => setTablesMenuOpen(false)}
                        />
                      ) : null}
                    </span>
                  </div>
                  <AlgorithmMount
                    plan={editedPlan}
                    onPlanChange={setEditedPlan}
                    readOnly={!isWritable}
                    // Brief 89 R5 — the picker finishes the author's
                    // sentence: create-the-table (rate-by flow, step
                    // inserts on completion) / declare-the-input.
                    onCreateFactorTable={handleCreateTableFromPicker}
                    onDeclareInput={handleDeclareInputFromSheet}
                    stages={projectedDesiredStages}
                    dimensions={dimensions}
                    factorTables={factorTables}
                    {...(factorTableCells ? { factorTableCells } : {})}
                    runtimeDefaults={chainRuntimeDefaults}
                    // Brief 82 R2 — "Full screen" (and the catalog's
                    // takeover fallback) still ride the ?table=
                    // grammar; small grids edit IN the row below.
                    onOpenFactorTable={onOpenFactorTableInline}
                    // Brief 82 R2 (D-B) — the in-row grid editor. The
                    // route owns cells + the SAME write-through the
                    // takeover uses (Law 3); the sheet owns the
                    // container. Un-keyed tables fall back to Full
                    // screen only (null).
                    renderTableEditor={(tableId: string) => {
                      const t = factorTables.find((x) => x.id === tableId);
                      if (!t) return null;
                      const rowSlug =
                        t.key_dimensions?.[0] ?? t.key_dimension ?? null;
                      const colSlug = t.key_dimensions?.[1] ?? null;
                      const rowDim = rowSlug
                        ? (dimensions.find((d) => d.slug === rowSlug) ?? null)
                        : null;
                      if (!rowDim) return null;
                      const colDim = colSlug
                        ? (dimensions.find((d) => d.slug === colSlug) ?? null)
                        : null;
                      const rowLevels = levelsForKeying(rowDim)
                        .filter((l) => Boolean(l.id))
                        .map((l) => ({ id: l.id, label: l.label || l.id }));
                      const colLevels = colDim
                        ? levelsForKeying(colDim)
                            .filter((l) => Boolean(l.id))
                            .map((l) => ({
                              id: l.id,
                              label: l.label || l.id,
                            }))
                        : undefined;
                      const gridCells =
                        factorTableCells?.get(tableId) ??
                        buildInitialCellsForTable(t, dimensions);
                      return (
                        <RatingInlineGrid
                          rowDimName={rowDim.display_name}
                          rowLevels={rowLevels}
                          {...(colDim
                            ? { colDimName: colDim.display_name }
                            : {})}
                          {...(colLevels !== undefined ? { colLevels } : {})}
                          cells={gridCells}
                          cellKeyOf={(rowId, colId) => cellKey(rowId, colId)}
                          {...(isWritable
                            ? {
                                onCellChange: (rowId, colId, value) => {
                                  const next = new Map(gridCells);
                                  next.set(cellKey(rowId, colId), value);
                                  onFactorTableDraftWriteThrough(tableId, {
                                    title: t.display_name,
                                    axes: {
                                      rowDimSlug: rowSlug,
                                      colDimSlug: colSlug,
                                    },
                                    cells: next,
                                  });
                                },
                              }
                            : {})}
                        />
                      );
                    }}
                    // Brief 82 R2 (F4) — ONE summoned surface across
                    // sheet + toolbar: the sheet summoning closes the
                    // Tables menu; opening the menu bumps the epoch.
                    onSummon={() => setTablesMenuOpen(false)}
                    summonEpoch={summonEpoch}
                    onNavigateToDimensions={() =>
                      navigate(`/rate-lab/${planId}/workspace/dimensions`)
                    }
                    {...(isWritable
                      ? {
                          onAddAdjustment,
                          onEditAdjustment,
                          onDeleteAdjustment,
                          onDeletePolicyTail: handleDeletePolicyTailRow,
                        }
                      : {})}
                    // Brief 78 P5.4 (D-F) — ONE tail ledger: the
                    // policy tail's rows join the sheet's Final
                    // adjustments; its editor opens as a drawer.
                    policyTailRows={policyTailRows}
                    onOpenPolicyTail={() => setPolicyTailDrawerOpen(true)}
                  />
                  {/* Brief 82 D-D — the state of the build, always in
                      view; the ONE dollars handoff is Open in Run. */}
                  <RatingFooter
                    sections={footerSections}
                    // Brief 89 R7 — the footer verdict rides the RATE
                    // rail too ("1 input to declare" beats a green
                    // "Ready to rate" over a refusing sample).
                    ready={readiness.rateReady}
                    blockingHint={readiness.nextStepHint ?? undefined}
                    onOpenRun={openRun}
                  />
                </div>
                {/* Brief 78 P5.4 — the policy-tail editor, re-homed as
                 * a drawer off the ledger (was the below-sheet
                 * "Final adjustments — book roll-up" duplicate). */}
                <Drawer
                  open={policyTailDrawerOpen}
                  onClose={() => setPolicyTailDrawerOpen(false)}
                  title="Policy tail"
                  subtitle="Composes per policy after aggregation · plan_policy_tail"
                >
                  <Drawer.Body>
                    <FinalAdjustmentsEditor
                      title="Final adjustments — policy tail"
                      adjustments={policyTail}
                      onChange={setPolicyTail}
                      inputFields={declaredInputFields}
                      connectors={availableConnectors}
                      // ADR-0055 — a non-DRAFT plan's tail is immutable
                      // (the API 409s the PUT); the editor renders the
                      // read view.
                      readOnly={!isWritable}
                    />
                  </Drawer.Body>
                </Drawer>
                <FactorTableDeletePrompt
                  open={ftDeleteTarget !== null}
                  tableName={ftDeleteTarget?.display_name ?? ""}
                  cellCount={ftDeleteCellCount}
                  consumers={ftDeleteConsumers}
                  onConfirm={() => {
                    if (ftDeleteId !== null) onDeleteFactorTable(ftDeleteId);
                    setFtDeleteId(null);
                  }}
                  onCancel={() => setFtDeleteId(null)}
                />
              </>
            );
          })()
        ) : /* V2_INTERFACE_SPEC §2.5 — the per-section Rating-Chains
          Loadings / Final-Adjustments / Outputs arms were UNREACHABLE
          (the Assemble-workspace gate short-circuits to the canvas
          mount before SectionDetailPane sees those sections) and the
          Outputs arm leaked the SAMPLE_OUTPUTS fixture into
          every plan. Deleted; preserved in git history. */
        empty ? (
          <EmptyState
            icon={<ListPlus size={24} />}
            title={`No ${editorKindLabel(section)}s yet`}
          >
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => onAddStage(section)}
            >
              Add {editorKindLabel(section)}
            </Button>
          </EmptyState>
        ) : (
          // Generic stage-list render — kinds without a custom table.
          // Risk Inputs + Classification used to special-case here;
          // both are now caught by the DIMENSIONS workspace gate above.
          <>
            <ul className="section-pane__stages">
              {stages.map((stage) => (
                <li key={stage.stage_id}>
                  <StageChipButton
                    stage={stage}
                    onClick={() => onEditStage(section, stage)}
                  />
                </li>
              ))}
            </ul>
            <div className="section-pane__add">
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => onAddStage(section)}
              >
                Add {editorKindLabel(section)}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * SettingsDrawer — plan-level settings, accessed from the gear icon.
 *
 * Per plan-control-tower brief §−1.Q6: drawer (not full route), with
 * General / Lifecycle / Audit sections stacked in the body. PR 4
 * scope is read-only metadata + stubs for the mutating actions —
 * actual rename, fork, archive, promote, sign-off endpoints land
 * as their backend slices port (rename in slice 2.5; the others
 * already exist on slice 2 but the UI for them is follow-up work).
 */
function SettingsDrawer({
  open,
  onClose,
  plan,
}: {
  open: boolean;
  onClose: () => void;
  plan: PlanDetail;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Plan settings"
      subtitle={plan.display_name}
    >
      <Drawer.Body>
        <section className="settings-section">
          <h3 className="settings-section__title">General</h3>
          <dl className="settings-meta">
            <SettingsRow label="Display name" value={plan.display_name} />
            <SettingsRow label="Plan ID" value={plan.rating_plan_id} mono />
            <SettingsRow
              label="Line of business"
              value={plan.line_of_business.toUpperCase()}
            />
            <SettingsRow
              label="Jurisdiction"
              value={plan.jurisdiction ?? "multistate"}
            />
            <SettingsRow
              label="Effective date"
              value={plan.effective_date}
              mono
            />
            {plan.template_id ? (
              <SettingsRow label="Template" value={plan.template_id} />
            ) : null}
            {plan.content_hash ? (
              <SettingsRow
                label="Content hash"
                value={plan.content_hash}
                mono
              />
            ) : null}
            {plan.created_at ? (
              <SettingsRow
                label="Created"
                value={isoDateTime(plan.created_at)}
              />
            ) : null}
            {plan.last_edited_at ? (
              <SettingsRow
                label="Last edited"
                value={isoDateTime(plan.last_edited_at)}
              />
            ) : null}
          </dl>
        </section>

        {/* V2_INTERFACE_SPEC §2.5 — the disabled Rename/Promote/Fork/
            Archive stub wall was deleted (a wall of dead primaries
            reads as broken). The verbs return WITH their flows:
            duplicate lands in P2; promote/archive with the lifecycle
            backend. */}
        <section className="settings-section">
          <h3 className="settings-section__title">Lifecycle</h3>
          <p className="settings-section__copy">
            {/* Brief 84 — the SAME derived chip as the header; the old
                copy pointed at surfaces that no longer own the verbs. */}
            This plan is <PlanStatusChip status={derivePlanStatus(plan)} />.
            Versions and publishing live on the Ship tab — publishing is what
            turns the quote API on.
          </p>
        </section>

        <section className="settings-section">
          <h3 className="settings-section__title">Audit</h3>
          <p className="settings-section__copy">
            Every mutation to this plan is logged. The audit log read endpoint
            exists in slice 2; a focused UI for it lands in a follow-up brief.
          </p>
        </section>
      </Drawer.Body>
    </Drawer>
  );
}

function SettingsRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="settings-meta__row">
      <dt className="settings-meta__label">{label}</dt>
      <dd
        className={`settings-meta__value${
          mono ? " settings-meta__value--mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * StageChipButton — kind-aware chip representing a single stage.
 *
 * Replaces the inline `INPUT_NODE / Class code` rendering from PR #4.
 * Shows: kind-aware icon (lucide) + the human label only. The
 * `stage_kind` code is moved to the aria-label + the `title` tooltip
 * so it's reachable but not primary text.
 */
function StageChipButton({
  stage,
  onClick,
}: {
  stage: StageSummary;
  onClick: () => void;
}) {
  const label = stageLabel(stage);
  return (
    <button
      type="button"
      className="stage-chip"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      title={`${stage.stage_kind} · click to edit`}
    >
      <span className="stage-chip__icon" aria-hidden>
        {iconForStageKind(stage.stage_kind)}
      </span>
      <span className="stage-chip__name">{label}</span>
    </button>
  );
}

/**
 * Lucide icon per stage kind. Today only `input_node` is shipped; the
 * other 17 kinds get icons as their forms land in Phase A.4. Default
 * is a generic database icon.
 */
function iconForStageKind(kind: string) {
  switch (kind) {
    case "input_node":
      return <Database size={14} />;
    default:
      return <Database size={14} />;
  }
}

// ---- Loading / 404 / error ----

function PlanSkeleton() {
  return (
    <div className="plan-detail-skeleton" aria-busy="true" aria-live="polite">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--id" />
      <div className="plan-detail-skeleton__meta">
        <div className="skeleton skeleton--cell" />
        <div className="skeleton skeleton--cell" />
        <div className="skeleton skeleton--cell" />
        <div className="skeleton skeleton--cell" />
      </div>
      <div className="plan-detail-skeleton__grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton skeleton--card" />
        ))}
      </div>
    </div>
  );
}

function NotFoundCard({ id }: { id: string }) {
  return (
    <div className="plan-detail-empty" role="alert">
      <h2 className="plan-detail-empty__title">Plan not found</h2>
      <p className="plan-detail-empty__body">
        This plan was deleted, archived, or never existed. The URL says{" "}
        <code>{id}</code>.
      </p>
      <Link to="/rate-lab">
        <Button variant="primary" icon={<ArrowRight size={14} />}>
          Back to plans
        </Button>
      </Link>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="plan-detail-error" role="alert">
      <h2 className="plan-detail-empty__title">Couldn't load plan</h2>
      <p className="plan-detail-empty__body">{message}</p>
      <Button variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ---- Helpers ----

/**
 * M4.15 — Project a clamp stage's config_json down to the ClampDraft
 * shape the edit drawer expects. Defensive against malformed config.
 */
function stageToClampDraft(stage: StageSummary): ClampDraft {
  const cfg = (stage.config_json as Record<string, unknown> | null) ?? {};
  return {
    display_name: stage.display_name,
    min_value:
      typeof cfg["min_value"] === "number" ? (cfg["min_value"] as number) : "",
    max_value:
      typeof cfg["max_value"] === "number" ? (cfg["max_value"] as number) : "",
    max_pct_of_input:
      typeof cfg["max_pct_of_input"] === "string"
        ? (cfg["max_pct_of_input"] as string)
        : "",
    apply_as_multiplier: cfg["apply_as_multiplier"] === true,
    citation_rule:
      typeof cfg["citation_rule"] === "string"
        ? (cfg["citation_rule"] as string)
        : (stage.citation_rule ?? ""),
    citation_page:
      typeof cfg["citation_page"] === "string"
        ? (cfg["citation_page"] as string)
        : (stage.citation_page ?? ""),
  };
}

/**
 * M4.15 — Project a round stage's config_json down to RoundDraft.
 */
function stageToRoundDraft(stage: StageSummary): RoundDraft {
  const cfg = (stage.config_json as Record<string, unknown> | null) ?? {};
  return {
    display_name: stage.display_name,
    increment_input:
      typeof cfg["increment_input"] === "string"
        ? (cfg["increment_input"] as string)
        : typeof cfg["increment_input"] === "number"
          ? String(cfg["increment_input"])
          : "literal:1",
    min_value_input:
      typeof cfg["min_value_input"] === "string"
        ? (cfg["min_value_input"] as string)
        : typeof cfg["min_value_input"] === "number"
          ? String(cfg["min_value_input"])
          : "",
    citation_rule:
      typeof cfg["citation_rule"] === "string"
        ? (cfg["citation_rule"] as string)
        : (stage.citation_rule ?? ""),
    citation_page:
      typeof cfg["citation_page"] === "string"
        ? (cfg["citation_page"] as string)
        : (stage.citation_page ?? ""),
  };
}

/**
 * M4.13 — Project a flat_factor stage's config_json down to the
 * FlatFactorDraft shape the edit drawer expects. Defensive against
 * malformed config_json.
 */
function stageToFlatFactorDraft(stage: StageSummary): FlatFactorDraft {
  const cfg = (stage.config_json as Record<string, unknown> | null) ?? {};
  const factor =
    typeof cfg["factor"] === "number" ? (cfg["factor"] as number) : "";
  // E6 — surface an existing {path, equals} gate in the drawer.
  const pred = cfg["predicate"] as
    { path?: unknown; equals?: unknown } | null | undefined;
  const predicate_path = pred && typeof pred.path === "string" ? pred.path : "";
  const predicate_equals =
    pred && pred.equals !== undefined && pred.equals !== null
      ? String(pred.equals)
      : "";
  return {
    display_name: stage.display_name,
    factor_kind:
      typeof cfg["factor_kind"] === "string"
        ? (cfg["factor_kind"] as string)
        : "",
    factor: factor as number | "",
    citation_rule:
      typeof cfg["citation_rule"] === "string"
        ? (cfg["citation_rule"] as string)
        : (stage.citation_rule ?? ""),
    citation_page:
      typeof cfg["citation_page"] === "string"
        ? (cfg["citation_page"] as string)
        : (stage.citation_page ?? ""),
    description_template:
      typeof cfg["description_template"] === "string"
        ? (cfg["description_template"] as string)
        : "",
    predicate_path,
    predicate_equals,
  };
}

/**
 * E6 — coerce the drawer's raw predicate fields into the persisted
 * `{path, equals}` shape. Blank path → no predicate (always applies).
 * Blank equals → `true` (the boolean-flag common case); "true"/"false"
 * → booleans; finite numerics → numbers; anything else stays a string.
 */
function draftPredicate(
  draft: FlatFactorDraft,
): { path: string; equals: boolean | number | string } | undefined {
  const path = draft.predicate_path.trim();
  if (path === "") return undefined;
  const raw = draft.predicate_equals.trim();
  if (raw === "" || raw === "true") return { path, equals: true };
  if (raw === "false") return { path, equals: false };
  const n = Number(raw);
  if (raw !== "" && Number.isFinite(n)) return { path, equals: n };
  return { path, equals: raw };
}

/**
 * M4.13 — Find the stage whose output a newly-added flat_factor
 * loading should chain from. Kind-ordered upstream scan over the live
 * substrate:
 *   1. The modifier_schedule stage's output (loadings) — or the last
 *      flat_factor's (final-adjustments)
 *   2. OR the chain stage's output
 *   3. OR a synthesized fallback path the actuary can edit later
 *
 * P5.2 G13 — the old first preference ("the last stage already in
 * this section") read the stage buckets, which were ALWAYS empty for
 * loadings/final-adjustments (no kind mapped there and nothing wrote
 * `section_layout`), so the scan below was the only path ever taken.
 * The parameter died with the accounting; behavior is unchanged.
 *
 * Returns the predecessor's stage_id (for insert_after_stage_id)
 * + the input_path the new loading should read from.
 */
function lastFlatFactorPredecessor(
  plan: PlanDetail,
  sectionId: string,
): {
  stage_id: string | null;
  input_path: string;
  /** E6 — set INSTEAD of input_path on multi-coverage plans. */
  input_paths?: readonly string[];
} {
  // For loadings: chain from the modifier schedule, then the chain
  // stage. For final-adjustments: chain from the last loading or
  // the modifier.
  const upstreamOrder =
    sectionId === "loadings"
      ? ["modifier_schedule", "multiplicative_chain"]
      : ["flat_factor", "modifier_schedule", "multiplicative_chain"];
  for (const kind of upstreamOrder) {
    const candidate = [...plan.stages]
      .reverse()
      .find((s) => s.stage_kind === kind);
    if (candidate) {
      const cfg =
        (candidate.config_json as Record<string, unknown> | null) ?? {};
      // Platform-test finding E6 — a MULTI-coverage chain stage has no
      // single `.value` output: each chain publishes its own
      // output_field, so `stages.<id>.value` wired an orphan that
      // compiled the whole Run zone into `orphan_stage` errors. Target
      // ALL coverage outputs instead (the multiplier distributes over
      // the sum — filing-equivalent). Single-chain plans keep the
      // legacy `stages.<id>.<field>` shape.
      if (kind === "multiplicative_chain") {
        const chains = Array.isArray(cfg["chains"])
          ? (cfg["chains"] as ReadonlyArray<Record<string, unknown>>)
          : [];
        const outputs = chains
          .map((c) =>
            typeof c["output_field"] === "string"
              ? (c["output_field"] as string)
              : "",
          )
          .filter((f) => f !== "");
        if (outputs.length > 1) {
          return {
            stage_id: candidate.stage_id,
            input_path: `chain.${outputs[0]!}`,
            input_paths: outputs.map((f) => `chain.${f}`),
          };
        }
      }
      const output_field =
        typeof cfg["output_field"] === "string"
          ? (cfg["output_field"] as string)
          : kind === "modifier_schedule"
            ? "subtotal_after_chain_usd"
            : "value";
      return {
        stage_id: candidate.stage_id,
        input_path: `stages.${candidate.stage_id}.${output_field}`,
      };
    }
  }
  return { stage_id: null, input_path: "form_input.base_premium" };
}

/**
 * M4.13 — Generate a slug suitable for stage_id from a display name.
 * Prefixed by section so different sections' stage_ids never collide.
 * Caller passes the section id; uniqueStageId disambiguates against
 * existing stage_ids.
 */
function slugifyForStageId(displayName: string, sectionId: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = slug === "" ? "stage" : slug;
  const prefix = sectionId === "loadings" ? "loading" : "adj";
  return `${prefix}_${base}`;
}

/**
 * Append a `_N` suffix to make a stage_id unique among existing
 * stages. Stable + deterministic.
 */
function uniqueStageId(
  base: string,
  existing: readonly StageSummary[],
): string {
  const taken = new Set(existing.map((s) => s.stage_id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ModifierSchedulesPane + ModifierScheduleTable usage was removed in
// 24.E — the GATE workspace now lists modifier_schedule stages as
// summary rows (display_name + total_cap_pct + category_count) and
// click-handoff routes to the existing edit-stage drawer. The
// ModifierScheduleTable @openrater/ui primitive stays available for the
// workspace design-pass to surface a per-category detail when
// expanding a row.

function isNotFound(err: unknown): boolean {
  if (!err) return false;
  // RaterApiError keeps the status code. We don't import it directly here
  // to avoid a circular-feeling reach into the SDK; the check is loose
  // by design.
  const status = (err as { status?: number }).status;
  return status === 404;
}

type ChainConfigMutationResult =
  | { readonly ok: true; readonly config: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/**
 * Append a FactorLookup to the chain identified by `chainName` inside
 * a multiplicative_chain stage's config_json. Returns a `.ok=false`
 * result with the parse error message when the config_json doesn't
 * match `multiplicativeChainConfigSchema`, or when no chain matches
 * the given name. Pure function — caller is responsible for sending
 * the result to the backend.
 *
 * Used by M4.3.8b's `handleSaveChainFactor` when the adapter's
 * mutation target is "chain_row" + the editor is in add mode.
 */
function appendFactorLookup(
  configJson: Record<string, unknown> | null,
  chainName: string,
  factorLookup: FactorLookup,
): ChainConfigMutationResult {
  return mutateChain(configJson, chainName, (chain) => ({
    ...chain,
    factor_lookups: [...chain.factor_lookups, factorLookup],
  }));
}

/**
 * M4.3.9 — replace the FactorLookup at `factorIndex` inside the named
 * chain. Used by the edit-factor save path. Out-of-range indexes are
 * a hard error (the index came from a rendered card, so it should
 * always match unless the data raced).
 */
function replaceFactorLookup(
  configJson: Record<string, unknown> | null,
  chainName: string,
  factorIndex: number,
  factorLookup: FactorLookup,
): ChainConfigMutationResult {
  return mutateChain(configJson, chainName, (chain) => {
    if (factorIndex < 0 || factorIndex >= chain.factor_lookups.length) {
      throw new Error(
        `replaceFactorLookup: factorIndex ${factorIndex} out of range`,
      );
    }
    const next = chain.factor_lookups.slice();
    next[factorIndex] = factorLookup;
    return { ...chain, factor_lookups: next };
  });
}

/**
 * Shared mutation harness for the three chain config_json mutations.
 * Parses, locates the named chain, runs the transformer, returns
 * the patched config_json (or a typed error result).
 */
function mutateChain(
  configJson: Record<string, unknown> | null,
  chainName: string,
  transform: (
    chain: ReturnType<
      typeof multiplicativeChainConfigSchema.parse
    >["chains"][number],
  ) => ReturnType<
    typeof multiplicativeChainConfigSchema.parse
  >["chains"][number],
): ChainConfigMutationResult {
  const parsed = multiplicativeChainConfigSchema.safeParse(configJson ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "invalid config",
    };
  }
  const chainIdx = parsed.data.chains.findIndex((c) => c.name === chainName);
  if (chainIdx === -1) {
    return { ok: false, error: `chain "${chainName}" not found in config` };
  }
  try {
    const nextChains = parsed.data.chains.map((c, i) =>
      i === chainIdx ? transform(c) : c,
    );
    return {
      ok: true,
      config: {
        ...parsed.data,
        chains: nextChains,
      } as unknown as Record<string, unknown>,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Plan-level readiness — the three checkpoints that gate the Rate-sample
// button + drive the studio header's "next step" hint — now lives in
// `@openrater/ui` as `computePlanReadiness` (Brief 74 PR 74.0), shared with
// OpenRater Home so the two surfaces never give two different next steps.
// (Gate / modifiers / endorsements are intentionally NOT readiness gates —
// Brief 39 §11.)

/**
 * Pick the most-current human label for a stage.
 *
 * The slice-2 PATCH endpoint only updates `config_json`; the top-level
 * `display_name` field stays frozen after stage creation. When the
 * config carries a `name` (input_node + most kinds do), prefer that —
 * otherwise the chip would show stale text after every edit. As more
 * kinds ship, extend this with kind-specific paths if a kind names its
 * label differently.
 */
function stageLabel(stage: StageSummary): string {
  const cfg = stage.config_json as Record<string, unknown> | null | undefined;
  const fromConfig = cfg?.["name"];
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
    return fromConfig;
  }
  return stage.display_name;
}

// (Brief 84 — toneForStatus deleted with its last caller: the settings
// drawer's Lifecycle chip now renders the derived <PlanStatusChip>.)

// ─────────────────────────────────────────────────────────────────
// Brief 38 PR 38.9 — InputsWorkspace mount
//
// Adapts the legacy StageSummary[] + DimensionRow[] route state into
// the shape <InputsWorkspace> consumes (Plan + RequiredInputEntry[]
// + Dimension[] + PlanInputMapping state). The mapping is local-only
// in v1 — persistence to the backend ships in a follow-up PR (38.10
// + API Lab slice 11).
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Brief 35.8 PR D.1 — AssemblePreviewCard (hover preview content).
// ─────────────────────────────────────────────────────────────────
// Renders inside the 320×240 popover that `<CalcInventoryRail>`
// opens after a 240ms hover delay (mockup Frame 2 — "moat at the
// drag"). v1 ships a text-only card with title + metadata + a
// short hint. A future iteration can swap factor-table items for
// a real `<LineChart>` / `<BarChart>` once a stable row-data path
// exists in the consumer.

/**
 * Outcome of a snapshot re-rate. `result` is the scored batch (or
 * null when there's nothing to score); `failure` carries a deferred
 * toast message + cause that the mount surfaces from an EFFECT — never
 * during render — so the toast never setStates ToastProvider mid-render.
 */
interface SnapshotRerateOutcome {
  readonly result: ScoredBatchResult | null;
  readonly failure: {
    readonly message: string;
    readonly cause: unknown;
  } | null;
}

/**
 * Pure: project a frozen substrate snapshot body → runtime Plan →
 * re-rated ScoredBatchResult.
 *
 * Returns a null result with NO failure when there's nothing to score
 * — no snapshot loaded, no premium column, no live rows, or the
 * snapshot carries no runnable rating chain (`snapshotBodyToRuntimePlan`
 * returns null). A failure is reported ONLY when the engine actually
 * throws; the caller's effect logs + toasts it and the chart degrades
 * to the live draft on that side.
 */
function computeSnapshotRerate(
  snapshot: PlanSnapshot | undefined,
  liveRows: readonly Record<string, unknown>[],
  premiumColumn: string | null,
  options: StagesToRuntimePlanOptions,
  side: "baseline" | "comparison",
): SnapshotRerateOutcome {
  if (!snapshot || !premiumColumn || liveRows.length === 0) {
    return { result: null, failure: null };
  }
  const plan = snapshotBodyToRuntimePlan(snapshot.body, options);
  if (!plan) {
    // Snapshot has no scored plan — a clean empty baseline, not an
    // error. The chart falls back to the live draft on this side.
    return { result: null, failure: null };
  }
  try {
    return {
      result: rerateSnapshotRows({ plan, liveRows, premiumColumn }),
      failure: null,
    };
  } catch (cause) {
    return {
      result: null,
      failure: {
        message:
          side === "baseline"
            ? "Couldn't re-rate the baseline snapshot. Chart shows the live draft on both sides."
            : "Couldn't re-rate the comparison snapshot. Chart shows the live draft on the comparison side.",
        cause,
      },
    };
  }
}

/**
 * AnalyticsWorkspaceMount — Brief 64 consumer wrapper for the 3-act
 * <AnalyticsWorkspaceV2> (Overview · Compare · Present). Replaces the
 * Brief 43 single-slice wiring (the v1 <AnalyticsWorkspace> component +
 * its slice-options toolbar were removed in the Brief 64 integration).
 *
 * Resolves the ADR-0041 gate booleans from live state and projects the
 * dim catalog into the plan-agnostic `OverviewVariableSpec[]` the v2
 * workspace discovers variables from:
 *
 *   · hasScoredResult    — a persisted "Score all" batch exists (the
 *                          only hard gate; geo + snapshots degrade
 *                          gracefully per ADR-0041)
 *   · hasGeographicDim   — dim catalog has any `dimension_type ===
 *                          "geographic"` entry
 *   · hasSnapshots       — useSnapshotsList(planId).data.snapshots
 *                          (newest-first; feeds Baseline + Comparison)
 *   · variables          — each dimension → {kind, column, levels}:
 *                          geographic (territory `match` from
 *                          geo_territories) · numeric (shape "banded")
 *                          · else categorical; column resolves
 *                          columnMap[id] ?? source_field ?? id
 *
 * Then hands the props + the publish wiring down to
 * <AnalyticsWorkspaceV2>.
 */
function AnalyticsWorkspaceMount({
  plan,
  dimensions,
  notify,
  onFreezeVersion,
  onOpenRun,
  onOpenInputs,
  chainRuntimeDefaults,
  factorTableCells,
  factorTables,
  currentScoringFingerprint,
}: {
  readonly plan: PlanDetail;
  readonly dimensions: readonly DimensionRow[];
  readonly notify: (msg: string) => void;
  readonly onFreezeVersion: () => void;
  /** Brief 75 phase 4 — re-score lives on the Run tab now. */
  readonly onOpenRun: () => void;
  /** Brief 89 §3 — the probe band's "Open Inputs" (connect a book). */
  readonly onOpenInputs: () => void;
  // Re-rate projection inputs — MUST mirror what the live Inputs path
  // feeds stagesToRuntimePlan so the baseline emits the same premium
  // column the chart reads. `chainRuntimeDefaults` supplies the LCM +
  // base-rate input defaults that aren't carried in the substrate.
  readonly chainRuntimeDefaults: ChainRuntimeDefaults;
  // ADR-0041 Phase 2 — factor cells feed the staleness fingerprint
  // (must be the SAME map the Inputs mount fingerprints at score time).
  readonly factorTableCells?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Brief 89 §3 — the probe exhibits read the authored FT catalog. */
  readonly factorTables?: readonly FactorTableSummary[];
  /** ADR-0064 — the live substrate's scoring fingerprint (null while
   *  hydrating). Probe runs pin it at request time; the probe-book +
   *  run-fed exhibit staleness compare it before the content-hash
   *  fallback — the grammar that can see factor-table cell edits. */
  readonly currentScoringFingerprint: string | null;
}) {
  const snapshotsQuery = useSnapshotsList(plan.rating_plan_id);
  const snapshots = snapshotsQuery.data?.snapshots ?? [];
  const hasSnapshots = snapshots.length > 0;
  const hasGeographicDim = dimensions.some(
    (d) => d.dimension_type === "geographic",
  );
  // Brief 75 phase 4 — the exhibits read the PERSISTED record first:
  // the latest done book run (server-scored, provenance-pinned), its
  // rows relayed from the scoring result store via api-lab. The
  // browser-scored localStorage result remains a FALLBACK for plans
  // scored before runs existed; it is no longer written by anything.
  const latestBookRunQuery = useQuery({
    queryKey: ["plan-runs", plan.rating_plan_id, "book-done-latest"],
    queryFn: () =>
      listPlanRuns(plan.rating_plan_id, {
        kind: "book",
        status: "done",
        limit: 1,
      }),
  });
  const latestBookRun = latestBookRunQuery.data?.runs?.[0] ?? null;
  const runRowsQuery = useQuery({
    queryKey: [
      "plan-run-rows",
      plan.rating_plan_id,
      latestBookRun?.run_id ?? null,
    ],
    enabled: latestBookRun !== null,
    // A GC'd job store or scoring outage is a NAMED empty state (the
    // fallback below), not a crash loop.
    retry: 1,
    queryFn: async () => {
      const all: PlanRunRow[] = [];
      let offset = 0;
      // Exhibit cap mirrors the runner's own page ceiling; books at
      // the 50k job cap stay server-side — the exhibits read at most
      // ANALYTICS_RUN_ROW_CAP rows and say so via rowCount vs total.
      while (all.length < ANALYTICS_RUN_ROW_CAP) {
        const page = await getPlanRunRows(
          plan.rating_plan_id,
          latestBookRun!.run_id,
          { offset, limit: 2000 },
        );
        all.push(...page.rows);
        if (page.next_offset === null) break;
        offset = page.next_offset;
      }
      return all;
    },
  });
  const scoredResult = useMemo(() => {
    if (latestBookRun && runRowsQuery.data && runRowsQuery.data.length > 0) {
      const headline = latestBookRun.headline as {
        premium_field?: string;
      };
      return runRowsToScoredBatchResult({
        rows: runRowsQuery.data,
        premiumColumn: headline.premium_field ?? "total_premium",
        scoredAt: latestBookRun.finished_at ?? latestBookRun.created_at,
      });
    }
    // Fallback: a pre-runs browser-scored result (read-only legacy).
    return loadScoredResult(plan.rating_plan_id);
  }, [plan.rating_plan_id, latestBookRun, runRowsQuery.data]);
  const isRunFed =
    latestBookRun !== null &&
    (runRowsQuery.data?.length ?? 0) > 0 &&
    scoredResult !== null;
  const hasScoredResult = scoredResult !== null;

  // Brief 51 L1 — the plan's input mapping resolves each dim's id to the
  // physical CSV column its values live in (e.g. dim `zip` ← column
  // `territory`). Read from the same localStorage source the Inputs mount
  // writes (loadStoredInputMapping), so Analytics groups by the real
  // column instead of the dim id — the fix for the all-"—" territory table.
  const columnMap = useMemo<Readonly<Record<string, string>>>(
    () => loadStoredInputMapping(plan.rating_plan_id)?.column_map ?? {},
    [plan.rating_plan_id],
  );

  // Brief 43 §6.1 / ADR-0041 Phase 2 — recompute the scoring fingerprint
  // from the CURRENT substrate (same inputs the Inputs mount fingerprints
  // at score time) and compare to the one captured on the scored result.
  // A mismatch ⇒ the rating algorithm changed since this book was scored,
  // so the exhibits are stale → a non-blocking re-score banner.
  // G21 — the tail (API-synced record), the mapping's grouping/roll-up
  // declarations (localStorage write-through mirror, same source the
  // columnMap reads above), and the legacy geo transformers are folded in:
  // each changes premiums, so each must flip the stale chip.
  const [analyticsTail] = usePolicyTailSynced(plan.rating_plan_id, {
    writable: false,
  });
  const currentFingerprint = useMemo(() => {
    const mapping = loadStoredInputMapping(plan.rating_plan_id);
    return computeScoringFingerprint(
      plan.stages ?? [],
      dimensions,
      factorTableCells,
      {
        policyTail: analyticsTail,
        ...(mapping?.grouping_config != null
          ? { groupingConfig: mapping.grouping_config }
          : {}),
        ...(mapping?.rollup_fields
          ? { rollupFields: mapping.rollup_fields }
          : {}),
        geoTransformers: loadStoredGeoTransformers(plan.rating_plan_id),
      },
    );
  }, [
    plan.stages,
    plan.rating_plan_id,
    dimensions,
    factorTableCells,
    analyticsTail,
  ]);
  // Staleness — run-fed exhibits compare the run's pinned scoring
  // fingerprint to the live substrate's (ADR-0064; content-hash
  // fallback for runs that predate the pin — the same grammar as the
  // Run history rail); the legacy localStorage feed keeps its client
  // fingerprint compare.
  const isStale = isRunFed
    ? latestBookRun !== null &&
      isRunStale(latestBookRun, {
        contentHash: plan.content_hash ?? null,
        scoringFingerprint: currentScoringFingerprint,
      })
    : scoredResult?.planFingerprint != null &&
      scoredResult.planFingerprint !== currentFingerprint;

  // Brief 55 — offer "Eligibility tier" as a slice when the scored book
  // carries the verdict (a plan with an appetite gate surfaces the
  // `eligibility_tier` output column via the scoring bridge). Lets the
  // actuary break the book down by appetite tier (e.g. 1 submit / 19
  // standard for the Sample BOP sample).
  const hasTierColumn =
    scoredResult?.rows?.some((r) => r.outputs?.eligibility_tier != null) ??
    false;
  // L32 — resolve the SLICE the Analytics workspace opens on:
  //   1. the per-plan persisted choice (when it still matches a live
  //      dim) — survives reopen + reload,
  //   2. else the plan's geographic dim (so a geo-territory plan
  //      headlines the State map),
  //   3. else the first slice option (the prior behavior).
  // The persisted LEVEL / KPI / METRIC seed the workspace the same
  // way. Computed once per mount via useMemo; the workspace owns the
  // value after mount (uncontrolled-with-seed).
  const persistedAnalyticsView = useMemo(
    () => loadStoredAnalyticsView(plan.rating_plan_id),
    [plan.rating_plan_id],
  );
  // Brief 43 PR 43.6.e — own the baseline + comparison picker state
  // here so we can fetch the picked snapshot bodies + re-rate them
  // against the live scored rows. The workspace is now a controlled
  // component for these two values.
  const DRAFT_SENTINEL = "__draft__";
  const newestSnapshotId = snapshots[0]?.snapshot_id ?? "";
  const [baselineSnapshotId, setBaselineSnapshotId] =
    useState<string>(newestSnapshotId);
  const [comparisonValue, setComparisonValue] =
    useState<string>(DRAFT_SENTINEL);
  // Brief 93 §1.3 — report vs book. The report is the landing view;
  // the Book tab (report head) and the Report tab (book toolbar) flip
  // this. Route-owned so the choice survives act switches inside Book.
  const [analyticsView, setAnalyticsView] = useState<"report" | "book">(
    "report",
  );

  // Reset baseline when the snapshot list changes from underneath us
  // (e.g. user freezes a new version while this tab is open).
  useEffect(() => {
    if (
      newestSnapshotId &&
      !snapshots.some((s) => s.snapshot_id === baselineSnapshotId)
    ) {
      setBaselineSnapshotId(newestSnapshotId);
    }
  }, [snapshots, newestSnapshotId, baselineSnapshotId]);

  // Fetch picked snapshot bodies. `enabled` already guards on
  // missing ids inside the hook, so the comparison query stays idle
  // when "live draft" is picked.
  const baselineDetail = useSnapshotDetail(
    plan.rating_plan_id,
    baselineSnapshotId || undefined,
  );
  const comparisonSnapshotId =
    comparisonValue !== DRAFT_SENTINEL ? comparisonValue : undefined;
  const comparisonDetail = useSnapshotDetail(
    plan.rating_plan_id,
    comparisonSnapshotId,
  );

  // Re-rate each picked snapshot against the live scored rows.
  //
  // A snapshot's stored `body` is the SUBSTRATE shape (stages + dims +
  // factor tables), NOT a runtime Plan — `snapshotBodyToRuntimePlan`
  // projects it the same way the live Inputs path projects the draft,
  // then `rerateSnapshotRows` runs the engine. Memoized by snapshot
  // body + scored rows so we don't re-run the engine on unrelated
  // re-renders.
  //
  // The memo stays PURE: it returns the result plus a DEFERRED failure
  // (message + cause), and the effects below surface the toast +
  // console.error. Notifying from inside the memo would setState on
  // ToastProvider mid-render (React "Cannot update a component while
  // rendering a different component" warning).
  const premiumColumn = scoredResult?.premiumColumn ?? null;
  const liveInputRows = useMemo(
    () => (scoredResult ? scoredResult.rows.map((r) => r.inputs) : []),
    [scoredResult],
  );
  const projectionOptions = useMemo<StagesToRuntimePlanOptions>(
    () => ({
      planId: `${plan.rating_plan_id}-snapshot`,
      lcmOverride: chainRuntimeDefaults.lcm,
      defaults: chainRuntimeDefaults.inputDefaults,
    }),
    [plan.rating_plan_id, chainRuntimeDefaults],
  );
  const baselineRerate = useMemo(
    () =>
      computeSnapshotRerate(
        baselineDetail.data,
        liveInputRows,
        premiumColumn,
        projectionOptions,
        "baseline",
      ),
    [baselineDetail.data, liveInputRows, premiumColumn, projectionOptions],
  );
  const comparisonRerate = useMemo(
    () =>
      computeSnapshotRerate(
        comparisonDetail.data,
        liveInputRows,
        premiumColumn,
        projectionOptions,
        "comparison",
      ),
    [comparisonDetail.data, liveInputRows, premiumColumn, projectionOptions],
  );
  const baselineResult = baselineRerate.result;
  const comparisonResult = comparisonRerate.result;

  // Side effects for failed re-rates live HERE, not in the memo (see
  // the note above). `notify` is useCallback-stable and the outcome
  // object is referentially stable until its inputs change, so each
  // toast fires once per distinct failure.
  useEffect(() => {
    if (!baselineRerate.failure) return;
    console.error(
      "[Analytics] Re-rate failed for baseline snapshot",
      baselineRerate.failure.cause,
    );
    notify(baselineRerate.failure.message);
  }, [baselineRerate, notify]);
  useEffect(() => {
    if (!comparisonRerate.failure) return;
    console.error(
      "[Analytics] Re-rate failed for comparison snapshot",
      comparisonRerate.failure.cause,
    );
    notify(comparisonRerate.failure.message);
  }, [comparisonRerate, notify]);

  // Brief 64 — build the plan-agnostic rate-driver variable specs from the
  // dims: geographic (territory match from geo_territories) / numeric (banded)
  // / categorical, each keyed on its physical input column.
  const variables = useMemo<OverviewVariableSpec[]>(() => {
    const specs: OverviewVariableSpec[] = dimensions.map((d) => {
      const column = columnMap[d.id] ?? d.source_field ?? d.id;
      const label = d.display_name || d.slug || d.id;
      if (d.dimension_type === "geographic") {
        const terrs = d.geo_territories ?? [];
        const levels =
          terrs.length > 0
            ? terrs.map((t) => ({ id: t.id, label: t.label, match: t.members }))
            : levelsForKeying(d).map((l) => ({
                id: l.id,
                label: l.label ?? l.id,
              }));
        return { id: d.id, label, kind: "geographic" as const, column, levels };
      }
      if (d.shape === "banded") {
        return { id: d.id, label, kind: "numeric" as const, column };
      }
      const levels = levelsForKeying(d).map((l) => ({
        id: l.id,
        label: l.label ?? l.id,
      }));
      return {
        id: d.id,
        label,
        kind: "categorical" as const,
        column,
        ...(levels.length > 0 ? { levels } : {}),
      };
    });
    if (hasTierColumn) {
      specs.push({
        id: "eligibility_tier",
        label: "Eligibility tier",
        kind: "categorical",
        column: "eligibility_tier",
        levels: ELIGIBILITY_TIERS.map((t) => ({
          id: t,
          label: ELIGIBILITY_TIER_LABELS[t],
        })),
      });
    }
    return specs;
  }, [dimensions, columnMap, hasTierColumn]);

  const planLabel = plan.display_name || "Rate plan";

  // ── Brief 89 §3 (89.3) — analytics before data ───────────────────
  // The probe plan runs the SAME projection recipe the live Inputs
  // path feeds stagesToRuntimePlan (LCM + base-rate defaults), so a
  // probe cell's premium is what Run would file for that risk. The
  // policy tail is intentionally absent: probe cells are the plan's
  // core premium (chain + stage tail); the card's footer says so.
  const probePlan = useMemo(() => {
    try {
      return stagesToRuntimePlan(
        plan.stages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions as unknown as any,
        factorTables ?? [],
        factorTableCells ?? new Map(),
        {
          planId: `${plan.rating_plan_id}-probe-runtime`,
          lcmOverride: chainRuntimeDefaults.lcm,
          defaults: chainRuntimeDefaults.inputDefaults,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ).plan as unknown as any;
    } catch {
      return null;
    }
  }, [
    plan.stages,
    plan.rating_plan_id,
    dimensions,
    factorTables,
    factorTableCells,
    chainRuntimeDefaults,
  ]);
  const probeCardProps = useMemo(
    () => ({
      plan: probePlan,
      stages: plan.stages,
      dimensions,
      factorTables: factorTables ?? [],
      ...(factorTableCells ? { factorTableCells } : {}),
      onExportCsv: (filename: string, csv: string) => {
        downloadTextFile(filename, csv, "text/csv");
        notify("Rate card exported.");
      },
    }),
    [
      probePlan,
      plan.stages,
      dimensions,
      factorTables,
      factorTableCells,
      notify,
    ],
  );

  // ── Brief 89 §3.2 B3 (89.4) — the probe book ─────────────────────
  // The sweep is BUILT client-side (the same axis ranking the rate
  // card defaults to) but SCORED server-side as a persisted run
  // (kind:"probe") — reload-safe, provenance-pinned, and excluded
  // from the real-book exhibits by kind. Attribution reads the
  // persisted rows alone (diff vs the base cell), so a regenerated
  // page needs no side-channel sweep spec.
  const queryClient = useQueryClient();
  const probeSweep = useMemo(() => {
    if (!probePlan) return null;
    try {
      const pins = synthesizeRepresentativeRisk(
        plan.stages,
        dimensions as unknown as Parameters<
          typeof synthesizeRepresentativeRisk
        >[1],
      );
      return buildDefaultProbeSweep({
        stages: plan.stages,
        dimensions,
        factorTables: factorTables ?? [],
        ...(factorTableCells ? { cells: factorTableCells } : {}),
        pins,
      });
    } catch {
      return null;
    }
  }, [probePlan, plan.stages, dimensions, factorTables, factorTableCells]);
  const latestProbeQuery = useQuery({
    queryKey: ["plan-runs", plan.rating_plan_id, "probe-latest"],
    queryFn: () =>
      listPlanRuns(plan.rating_plan_id, { kind: "probe", limit: 1 }),
  });
  const latestProbe = latestProbeQuery.data?.runs?.[0] ?? null;
  // The GET is what finalizes a running probe (lazy finalize, D-E) —
  // poll its detail until terminal, then refresh every runs list.
  const probePollQuery = useQuery({
    queryKey: [
      "plan-run",
      plan.rating_plan_id,
      latestProbe?.run_id ?? null,
      "probe-poll",
    ],
    enabled: latestProbe !== null && latestProbe.status === "running",
    queryFn: () => getPlanRun(plan.rating_plan_id, latestProbe!.run_id),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    const s = probePollQuery.data?.status;
    if (s === "done" || s === "error") {
      void queryClient.invalidateQueries({
        queryKey: ["plan-runs", plan.rating_plan_id],
      });
    }
  }, [probePollQuery.data?.status, plan.rating_plan_id, queryClient]);
  const probeRowsQuery = useQuery({
    queryKey: [
      "plan-run-rows",
      plan.rating_plan_id,
      latestProbe?.run_id ?? null,
      "probe",
    ],
    enabled: latestProbe !== null && latestProbe.status === "done",
    retry: 1,
    // A probe caps itself around 500 cells — one page covers it.
    queryFn: async () =>
      (
        await getPlanRunRows(plan.rating_plan_id, latestProbe!.run_id, {
          offset: 0,
          limit: 2000,
        })
      ).rows,
  });
  const probePremiumColumn = useMemo(
    () => (probePlan ? resolvePremiumColumn(probePlan) : null),
    [probePlan],
  );
  const probeReadout = useMemo(
    () =>
      probeRowsQuery.data && probePremiumColumn
        ? analyzeProbeRows(probeRowsQuery.data, probePremiumColumn)
        : null,
    [probeRowsQuery.data, probePremiumColumn],
  );
  const probeLabels = useMemo(() => {
    const m = new Map<string, string>();
    try {
      const keys = dimInputKeys(plan.stages, dimensions, factorTables ?? []);
      for (const d of dimensions) {
        const k = keys.get(d.slug);
        if (k) m.set(k, d.display_name || d.slug);
      }
    } catch {
      // Labels fall back to raw input keys.
    }
    return m;
  }, [plan.stages, dimensions, factorTables]);
  // Brief 94 (U7) — the report caption's VALUES resolve through level
  // labels too ("Revenue band <$25K", never "Revenue band 0"): per
  // input key, a resolver over the dimension's levels — categorical/geo
  // match on level_id, banded on [min, max) containment.
  const probeValueLabels = useMemo(() => {
    const m = new Map<string, (value: string | number) => string | null>();
    try {
      const keys = dimInputKeys(plan.stages, dimensions, factorTables ?? []);
      for (const d of dimensions) {
        const k = keys.get(d.slug);
        if (!k || !Array.isArray(d.levels) || d.levels.length === 0) continue;
        const levels = d.levels as ReadonlyArray<Record<string, unknown>>;
        m.set(k, (value) => {
          for (const lvl of levels) {
            const label =
              typeof lvl["label"] === "string" && lvl["label"]
                ? (lvl["label"] as string)
                : null;
            if (lvl["kind"] === "banded") {
              const n = typeof value === "number" ? value : Number(value);
              if (!Number.isFinite(n)) continue;
              const min =
                typeof lvl["min"] === "number" ? (lvl["min"] as number) : -Infinity;
              const max =
                typeof lvl["max"] === "number" ? (lvl["max"] as number) : Infinity;
              if (n >= min && n < max) return label;
            } else {
              // Categorical/geo levels store their key as `id` (the
              // workbook's level_id lands there); inputs may also
              // arrive as a filed alias ("AK" for "ak").
              const id = String(lvl["id"] ?? lvl["level_id"] ?? "");
              const aliases = Array.isArray(lvl["aliases"])
                ? (lvl["aliases"] as readonly unknown[]).map(String)
                : [];
              const v = String(value);
              if (id === v || aliases.includes(v)) return label ?? id;
            }
          }
          return null;
        });
      }
    } catch {
      // Values fall back to their raw form.
    }
    return m;
  }, [plan.stages, dimensions, factorTables]);
  const [probeSubmitting, setProbeSubmitting] = useState(false);
  const generateProbe = useCallback(async () => {
    if (!probeSweep || probeSweep.rows.length === 0) return;
    setProbeSubmitting(true);
    try {
      await createPlanRun(plan.rating_plan_id, {
        kind: "probe",
        rows: probeSweep.rows,
        // ADR-0064 — pin the substrate the sweep was built from.
        ...(currentScoringFingerprint !== null
          ? { scoring_fingerprint: currentScoringFingerprint }
          : {}),
      });
      await queryClient.invalidateQueries({
        queryKey: ["plan-runs", plan.rating_plan_id],
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't start the probe run.");
    } finally {
      setProbeSubmitting(false);
    }
  }, [
    probeSweep,
    plan.rating_plan_id,
    currentScoringFingerprint,
    queryClient,
    notify,
  ]);
  const probeBookState = useMemo<ProbeBookState>(() => {
    if (!probePlan || !probeSweep || probeSweep.variables.length === 0) {
      return {
        phase: "empty",
        reason:
          "The probe book needs a rating step and a dimension with levels" +
          " — author those first; the sweep derives from them.",
      };
    }
    if (latestProbe?.status === "running") {
      return { phase: "running", cellCount: probeSweep.rows.length };
    }
    if (latestProbe?.status === "error") {
      return {
        phase: "error",
        message:
          probePollQuery.data?.error_message ??
          "The probe run failed — regenerate to re-score.",
      };
    }
    if (latestProbe?.status === "done") {
      if (probeReadout) {
        const when = isoDateTime(
          latestProbe.finished_at ?? latestProbe.created_at,
        );
        return {
          phase: "done",
          readout: probeReadout,
          labels: probeLabels,
          metaLabel: `Probe run · ${probeReadout.total} cells · ${
            latestProbe.plan_content_hash
              ? `draft@${latestProbe.plan_content_hash.slice(0, 8)} · `
              : ""
          }${when}`,
          // ADR-0064 — fingerprint-first: a factor-table cell edit
          // flips this line; content-hash fallback for older probes.
          stale: isRunStale(latestProbe, {
            contentHash: plan.content_hash ?? null,
            scoringFingerprint: currentScoringFingerprint,
          }),
        };
      }
      if (probeRowsQuery.isError) {
        return {
          phase: "error",
          message:
            "The probe run finished but its rows can't be read right now" +
            " — the scoring store may have been recycled. Regenerate to" +
            " re-score.",
        };
      }
      // Rows still in flight — a beat of "scoring" honesty beats a flash
      // of the generate button.
      return { phase: "running", cellCount: probeSweep.rows.length };
    }
    return {
      phase: "idle",
      plannedCells: probeSweep.rows.length,
      plannedVariables: probeSweep.variables.length,
    };
  }, [
    probePlan,
    probeSweep,
    latestProbe,
    probePollQuery.data?.error_message,
    probeReadout,
    probeRowsQuery.isError,
    probeLabels,
    plan.content_hash,
    currentScoringFingerprint,
  ]);

  // Brief 93 — the report's display-ready meta (label resolution is
  // the route's job; the report renders strings + slots).
  const productLabel =
    plan.product && isProductCode(plan.product)
      ? PRODUCT_LABELS[plan.product]
      : (plan.line_of_business ?? null);
  const stateLabel = plan.jurisdiction
    ? (STATE_LABEL_BY_CODE[plan.jurisdiction] ?? plan.jurisdiction)
    : "All states";

  // Brief 93 §1.1.6 (93.2) — the gates section's rows: the SAME
  // appetite read model the Eligibility document renders, phrased by
  // the same grammar (buildGateRows ← appetitePhrases). Field labels
  // + dtypes resolve like EligibilityMount's composer options:
  // declared inputs first, dimensions fill the rest.
  const appetite = useMemo(
    () => planStagesToAppetite(plan.stages ?? []),
    [plan.stages],
  );
  const gateFieldMeta = useMemo(() => {
    const m = new Map<string, { label?: string; dtype?: string }>();
    for (const e of stagesToInputDictEntries(plan.stages ?? [])) {
      m.set(e.fieldName, { label: e.displayName, dtype: e.dataType });
    }
    for (const d of dimensions) {
      if (!m.has(d.slug)) m.set(d.slug, { label: d.display_name });
    }
    return m;
  }, [plan.stages, dimensions]);
  const gateRows = useMemo(
    () =>
      buildGateRows([...appetite.row.rules, ...appetite.policy.rules], (v) =>
        gateFieldMeta.get(v),
      ),
    [appetite, gateFieldMeta],
  );

  // Brief 93 §1.1.7 (93.3) — workbook-built plans surface the
  // filing's verified test cases (the persisted build report; the
  // hook resolves 404 → null for hand-authored plans, so the section
  // falls back to the probe book).
  const analyticsBuildReport = useBuildReport(plan.rating_plan_id);
  const verifiedExamples = useMemo(
    () => buildVerifiedExamples(analyticsBuildReport.data ?? null),
    [analyticsBuildReport.data],
  );

  return (
    <AnalyticsWorkspaceV2
      hasScoredResult={hasScoredResult}
      hasSnapshots={hasSnapshots}
      hasGeographicDim={hasGeographicDim}
      onFreezeVersion={onFreezeVersion}
      isStale={isStale}
      onReScore={onOpenRun}
      // Brief 93 (R1) — the plan report is the landing view; the
      // probe exhibits (rate card / probe book) compose INTO it.
      view={analyticsView}
      onViewChange={setAnalyticsView}
      reportSlot={
        <PlanReport
          planLabel={planLabel}
          productLabel={productLabel}
          stateLabel={stateLabel}
          statusSlot={<PlanStatusChip status={derivePlanStatus(plan)} />}
          stages={plan.stages}
          dimensions={dimensions}
          factorTables={factorTables ?? []}
          {...(factorTableCells ? { factorTableCells } : {})}
          plan={probePlan}
          description={plan.description ?? null}
          workbookBuilt={analyticsBuildReport.data != null}
          gates={gateRows}
          defaultTierLabel={ELIGIBILITY_TIER_LABELS[appetite.defaultTier]}
          verifiedExamples={verifiedExamples}
          hasBook={hasScoredResult}
          onOpenBook={() => setAnalyticsView("book")}
          onOpenInputs={onOpenInputs}
          pinLabels={probeLabels}
          pinValueLabels={probeValueLabels}
          rateCardSlot={<RateCardExhibit {...probeCardProps} />}
          probeBookSlot={
            <ProbeBookCard
              state={probeBookState}
              onGenerate={() => void generateProbe()}
              busy={probeSubmitting}
            />
          }
        />
      }
      scoredResult={scoredResult}
      baselineResult={baselineResult}
      comparisonResult={comparisonResult}
      variables={variables}
      premiumColumn={premiumColumn ?? ""}
      {...(scoredResult?.lossColumn
        ? { lossColumn: scoredResult.lossColumn }
        : {})}
      planLabel={planLabel}
      snapshots={snapshots}
      baselineSnapshotId={baselineSnapshotId}
      onBaselineSnapshotIdChange={setBaselineSnapshotId}
      comparisonValue={comparisonValue}
      onComparisonValueChange={setComparisonValue}
      {...(persistedAnalyticsView?.kpiId
        ? { defaultKpiId: persistedAnalyticsView.kpiId }
        : {})}
      onExport={() => {
        // Brief 43 PR 43.7 — Export scored CSV. Pure helpers build
        // the body + filename (per §−1.Q6 lock); we trigger the
        // download via an in-memory Blob + anchor click. Silent
        // no-op when there's no scoredResult (the button shouldn't
        // be clickable in that case anyway — blocker strip is up).
        if (!scoredResult) {
          notify(
            "No scored result to export. Score the book on the Run tab first.",
          );
          return;
        }
        // Brief 43 CT-4 / ADR-0041 Phase 3 — side-by-side export. When a
        // baseline snapshot is selected (its re-rate is available), emit
        // baseline_ / draft_ / delta_pct_ columns; else single-side. The
        // helper guards on matching row counts + falls back on its own.
        const sideBySide =
          baselineResult != null &&
          baselineResult.rowCount === scoredResult.rowCount;
        const csv = buildAnalyticsScoredCsv(
          scoredResult,
          baselineResult != null ? { baselineResult } : {},
        );
        const filename = analyticsScoredCsvFilename(
          plan.rating_plan_id,
          scoredResult.scoredAt,
        );
        const blob = new Blob([csv], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        notify(
          sideBySide
            ? `Exported ${filename} — baseline vs draft + delta.`
            : `Exported ${filename}.`,
        );
      }}
    />
  );
}

function InputsWorkspaceMount({
  dimensions,
  factorTables,
  factorTableCells,
  allPlanStages,
  inputDeclarations,
  planId,
  isWritable,
  notify,
  sampleDataset,
  chainRuntimeDefaults,
  registerSaveFlush,
}: {
  readonly dimensions: readonly DimensionRow[];
  // PR 13.2 — FT catalog enables Pass 3 (FT keys) of the deriver.
  // Optional so consumers that don't have a catalog (none today,
  // but the prop is defensive) still work.
  readonly factorTables?: readonly {
    readonly id: string;
    readonly display_name?: string;
    readonly slug?: string;
    readonly key_dimension?: string;
    readonly key_dimensions?: readonly string[];
  }[];
  // PR D2a — Factor-table cells (Map<ftId, Map<cellKey, number>>)
  // feed the chain-plan projector. Without cells, the chain runs
  // with default 1.0 factors — every premium = base × LCM. Optional
  // (a plan with no FTs authored can still surface required inputs).
  readonly factorTableCells?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly allPlanStages: StageSummary[];
  // Brief 58 Pillar C — durable bulk-add API (from the stable level).
  readonly inputDeclarations: InputDeclarationsApi;
  readonly planId: string;
  // D6.1 input-mapping sync writes only on a draft plan; reads still hydrate.
  readonly isWritable: boolean;
  readonly notify: (msg: string) => void;
  // J3 — sample-data affordance. Forwarded directly to
  // <InputsWorkspace> → <CsvDropzone>. Omitted (rather than passed as
  // undefined) when the plan's template has no associated sample
  // dataset, keeping exactOptionalPropertyTypes happy.
  readonly sampleDataset?: SampleDataset;
  // Cold-test payoff — chain runtime constants (lcm + base-rate input
  // defaults) fed to stagesToRuntimePlan so premiums actually compute.
  readonly chainRuntimeDefaults: ChainRuntimeDefaults;
  // G15 — flush registration with the route-level freeze barrier.
  readonly registerSaveFlush: (
    key: string,
    flush: (() => Promise<void>) | null,
  ) => void;
}) {
  // Brief 62.5 PR4c / ADR-0055 — the cohort scoring resolves a model-sourced
  // IRPM in the plan's Final-adjustments tail via a client-side evaluator
  // built from the registry. The tail is the API-synced record (edits in the
  // Final-adjustments editor flow here reactively — no more stale
  // read-on-mount copy).
  const [policyTail] = usePolicyTailSynced(planId, { writable: isWritable });

  // Brief 62.6 PR3 — the connector book. When the plan's tail binds a
  // connector-sourced IRPM, scoring the cohort would make one PAID live call
  // per row, so we gate it behind the cost guardrail: the preview shows each
  // connector step as a no-op until the user confirms the run. The scoring
  // pane surfaces the exact projected rows (`onCohortRows`) so the per-row
  // pre-fetch keys by identical features (the per-run cache).
  const { data: connectorsData } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => listConnectors(),
  });

  // E09 — routes that target this plan's inputs + their persisted values, so the
  // Inputs workspace can mark a route-fed input "API · via {route}" (with its
  // resolved value + a jump back to API Lab) instead of a bare `form / —`. Both
  // degrade cleanly: a fetch error → no chips, never a crash.
  const navigate = useNavigate();
  const { data: routesData } = useQuery({
    queryKey: ["routes", planId],
    queryFn: () => listRoutes(planId),
  });
  const { data: inputValuesData } = useQuery({
    queryKey: ["input-values", planId],
    queryFn: () => listInputValues(planId),
  });
  const apiSourcedByKey = useMemo(() => {
    const m = new Map<string, { sourceLabel: string; value: string }>();
    // A route that pushes onto an input marks it api-sourced — even before it
    // has run (so the actuary sees the binding, with a "not run yet" value).
    for (const rt of routesData?.routes ?? []) {
      for (const p of rt.pushes) {
        if (!m.has(p.plan_input_key)) {
          m.set(p.plan_input_key, { sourceLabel: rt.name, value: "" });
        }
      }
    }
    // Overlay the persisted resolved value; also pick up route-sourced values
    // whose route was deleted but whose value still stands.
    for (const v of inputValuesData?.values ?? []) {
      const value = v.value == null ? "" : String(v.value);
      const existing = m.get(v.input_key);
      if (existing) {
        m.set(v.input_key, { ...existing, value });
      } else if (/route/i.test(v.source ?? "")) {
        m.set(v.input_key, { sourceLabel: v.source ?? "API", value });
      }
    }
    return m;
  }, [routesData, inputValuesData]);

  // ── Brief 89 (R2/R4) — the genesis predicate + duplicate target ──
  // Structural emptiness only: zero stages of ANY kind, zero dims,
  // zero factor tables (any authoring act dissolves the block; the
  // panel adds the live source/dictionary checks). The plans list
  // fetches only while a plan is at genesis — one cheap call — so the
  // "duplicate an existing plan" link shows only when a target exists.
  const genesisEligible =
    allPlanStages.length === 0 &&
    dimensions.length === 0 &&
    (factorTables?.length ?? 0) === 0;
  const { data: genesisPlans } = useQuery({
    queryKey: ["plans", "all", "genesis-duplicate-check"],
    queryFn: () => listPlans({ status: "all" }),
    enabled: genesisEligible,
  });
  const genesisHasDuplicateTarget = (genesisPlans ?? []).some(
    (p) => p.rating_plan_id !== planId,
  );

  const [cohortRows, setCohortRows] = useState<
    readonly Readonly<Record<string, unknown>>[]
  >([]);
  const [bookRun, setBookRun] = useState(false);
  // A new roster / mapping re-gates the book — no surprise paid calls when the
  // rows change under a previously-confirmed run.
  const handleCohortRows = useCallback(
    (rows: readonly Readonly<Record<string, unknown>>[]) => {
      setCohortRows(rows);
      setBookRun(false);
    },
    [],
  );
  const cohortConnector = useCohortConnectorEvaluator({
    adjustments: policyTail,
    rows: cohortRows,
    connectors: connectorsData?.connectors ?? [],
    enabled: bookRun,
  });
  const bookGuardrail = cohortConnector.hasConnectorSource ? (
    <BookCostGuardrail
      rowCount={cohortRows.length}
      connectors={cohortConnector.connectorLines}
      isRunning={cohortConnector.isRunning}
      progress={cohortConnector.progress}
      rollup={cohortConnector.rollup}
      onRun={() => setBookRun(true)}
    />
  ) : null;

  // PR 11i — `stages` (the Inputs-section subset) is no longer the
  // source of truth. `allPlanStages` (the full plan) drives
  // `deriveRequiredInputs`, which finds requirements across input
  // nodes + chain factor lookups + flat factors. The mount used to
  // accept a `stages` prop; removed since the deriver gives us the
  // canonical set.
  // PR 11b — lazy initializer reads any previously-saved mapping for
  // this plan from localStorage. Persistence to the Plan substrate
  // (`Plan.input_mapping`, Brief 38 PR 38.1 schema) is a follow-up
  // once the API Lab `PATCH /api/v1/plans/:id` slice accepts that
  // field; until then localStorage keeps the user's CSV + column_map
  // alive across reloads, matching the GateCanvasMount pattern.
  const [inputMapping, setInputMapping] = useState<PlanInputMapping | null>(
    () => loadStoredInputMapping(planId),
  );

  // Persist on every change. Empty/cleared state IS persisted (null
  // means "user has nothing wired" — preserve that across reloads).
  useEffect(() => {
    storeInputMapping(planId, inputMapping);
  }, [planId, inputMapping]);

  // (v1 cutover 2026-06-09) — the create-inputs-from-columns CTA (Brief 49,
  // superseded by P0.2 declare-from-book-columns) and the geo-transformer
  // EDITOR (Brief 44; P1.2 geo is dormant) were v1-<InputsWorkspace>-only and
  // went with it. A geo transformer previously persisted is still APPLIED at
  // score time (projectRowsToExternalInputs below), so keep it read-only —
  // there's just no v2 surface to change it (no setter → no persist effect).
  const [geoTransformerByInputId] = useState<Readonly<Record<string, string>>>(
    () => loadStoredGeoTransformers(planId),
  );

  // -------------------------------------------------------------------
  // D6.1 / ADR-0027 — API-backed input mapping sync.
  //
  // Same pattern as the dim + FT syncs above (D6.2, D6.3). On mount:
  //   · API has mapping → setInputMapping(api.mapping)
  //   · API empty + local non-empty → upsert local to API
  //   · Both empty → no-op (the user lands on the empty
  //     DataSourcePicker drawer)
  //
  // Steady-state writes go through the PUT endpoint, debounced ~400ms.
  // When the user clears the mapping (`setInputMapping(null)`), the
  // debounced effect fires a DELETE to the API to mirror the local
  // state. localStorage stays as a write-through fallback.
  // -------------------------------------------------------------------
  const inputMappingApi = useInputMapping(planId);
  const upsertInputMappingMutation = useUpsertInputMapping(planId);
  const deleteInputMappingMutation = useDeleteInputMapping(planId);
  const inputMappingInitialSyncRef = useRef(false);
  // ── v4 G14 — same precondition machinery as the dims + FT syncs:
  // the last-seen envelope content_hash rides every PUT; a stale write
  // 412s, we stop the sync and say so once.
  const mappingHashRef = useRef<string | null>(null);
  const mappingConflictRef = useRef(false);
  const onMappingWriteSettled = useCallback(
    (
      res: { content_hash?: string | null | undefined } | undefined,
      err: unknown,
    ) => {
      if (typeof res?.content_hash === "string") {
        mappingHashRef.current = res.content_hash;
      }
      if (
        err instanceof RaterApiError &&
        err.code === "stale_write" &&
        !mappingConflictRef.current
      ) {
        mappingConflictRef.current = true;
        notify(
          "The book & mapping changed in another tab — your last edit " +
            "wasn't saved. Reload to continue editing.",
        );
      }
    },
    [notify],
  );
  const mappingIfMatch = () =>
    mappingHashRef.current !== null ? { ifMatch: mappingHashRef.current } : {};
  // G14 — the dims reconnect guard, generalized (Brief 66 §3.2): edits
  // made while the mapping GET is failing must WIN the initial sync.
  const mappingEditedWhileBlockedRef = useRef(false);
  useEffect(() => {
    if (inputMappingApi.isError) mappingEditedWhileBlockedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMapping]);
  useEffect(() => {
    inputMappingInitialSyncRef.current = false;
    mappingEditedWhileBlockedRef.current = false;
  }, [planId]);

  useEffect(() => {
    if (inputMappingInitialSyncRef.current) return;
    if (!inputMappingApi.isSuccess) return;
    const apiEnvelope = inputMappingApi.data;
    // G14 — token captured at reconcile time only (see the dims note).
    if (typeof apiEnvelope?.content_hash === "string") {
      mappingHashRef.current = apiEnvelope.content_hash;
    }
    if (apiEnvelope !== null && !mappingEditedWhileBlockedRef.current) {
      // API wins — hydrate local state from server-truth.
      setInputMapping(apiEnvelope.mapping as unknown as PlanInputMapping);
    } else if (
      mappingEditedWhileBlockedRef.current &&
      inputMapping !== null &&
      isWritable
    ) {
      // G14 (Brief 66 §3.2 grammar) — the user edited while the service
      // was down; their local state is the freshest truth. Push it.
      mappingEditedWhileBlockedRef.current = false;
      upsertInputMappingMutation.mutate(
        {
          mapping: inputMapping as unknown as Record<string, unknown>,
          ...mappingIfMatch(),
        },
        {
          onSuccess: (res) => onMappingWriteSettled(res, undefined),
          onError: (err) => onMappingWriteSettled(undefined, err),
        },
      );
    } else if (inputMapping !== null && isWritable) {
      // API empty + local non-empty → migrate localStorage → API. Gated on
      // writability: never migrate a stale local cache onto a frozen plan.
      upsertInputMappingMutation.mutate(
        {
          mapping: inputMapping as unknown as Record<string, unknown>,
          ...mappingIfMatch(),
        },
        {
          onSuccess: (res) => onMappingWriteSettled(res, undefined),
          onError: (err) => onMappingWriteSettled(undefined, err),
        },
      );
    }
    inputMappingInitialSyncRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMappingApi.isSuccess, planId]);

  // Steady-state debounced write — PUT when there's a mapping,
  // DELETE when the user cleared it.
  //
  // G15/G24 — flushable, same contract as the dims + FT syncs at the
  // stable level: Freeze lands a pending write before the snapshot body
  // is composed (registered below), and a route-leave unmount lands it
  // instead of dropping it.
  const mappingDebounce = useRef(createFlushableDebounce(400)).current;
  const mappingWriteNowRef = useRef<() => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  mappingWriteNowRef.current = () =>
    inputMapping === null
      ? deleteInputMappingMutation.mutateAsync()
      : upsertInputMappingMutation
          .mutateAsync({
            mapping: inputMapping as unknown as Record<string, unknown>,
            ...mappingIfMatch(),
          })
          .then(
            (res) => {
              onMappingWriteSettled(res, undefined);
              return res;
            },
            (err: unknown) => {
              onMappingWriteSettled(undefined, err);
              throw err;
            },
          );
  useEffect(() => {
    if (!inputMappingInitialSyncRef.current) return;
    // Read-only plans never write back — gates both the PUT (upsert) and the
    // DELETE (clear), so a frozen plan's mapping is never re-written or wiped.
    if (!isWritable) return;
    // G14 — after a detected conflict, stop overwriting (reload to
    // continue); writing again would clobber the other writer.
    if (mappingConflictRef.current) return;
    mappingDebounce.arm(() => {
      if (inputMapping === null) {
        deleteInputMappingMutation.mutate();
      } else {
        upsertInputMappingMutation.mutate(
          {
            mapping: inputMapping as unknown as Record<string, unknown>,
            ...mappingIfMatch(),
          },
          {
            onSuccess: (res) => onMappingWriteSettled(res, undefined),
            onError: (err) => onMappingWriteSettled(undefined, err),
          },
        );
      }
    });
    return () => mappingDebounce.disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMapping, planId]);
  useEffect(() => {
    registerSaveFlush("input-mapping", () =>
      mappingDebounce.flush(() => mappingWriteNowRef.current()),
    );
    return () => registerSaveFlush("input-mapping", null);
  }, [registerSaveFlush, mappingDebounce]);
  // G24 (SPA-nav half) — land a pending mapping write on unmount.
  useEffect(
    () => () => {
      void mappingDebounce.flush(() => mappingWriteNowRef.current());
    },
    [mappingDebounce],
  );

  // PR 11i — derive the canonical required-inputs list from the
  // WHOLE plan (Brief 38 §4.2), not just the Inputs section's
  // input_node stages.
  //
  // The old code (PR 38.9) walked only `stages` (the Inputs section).
  // That missed every requirement contributed by chains + flat-
  // factors: a plan that uses a dim via a factor lookup (e.g., the
  // user creates a "class" dim + factor table + chain, no explicit
  // input_node) surfaced ZERO required inputs — the mapping table
  // was empty.
  //
  // `deriveRequiredInputs` (PR 11h) walks `allPlanStages` for:
  //   · input_node stages → "inputs" rows
  //   · multiplicative_chain factor_lookups → "dimensions" rows
  //     (carries dimSlug for alias resolution + value-match)
  //   · multiplicative_chain base_input/exposure_input/lcm → "inputs"
  //   · flat_factor input_path(s) → "inputs"
  //
  // The Dimension catalog feeds dim display_name + shape-aware dtype
  // so banded dims default to number, categorical to string.
  const requiredInputs = useMemo<readonly IwRequiredInputEntry[]>(() => {
    // Cast DimensionRow[] (the route's editable shape) up to
    // Dimension[] — the deriver only reads slug + display_name +
    // shape, all of which carry. Avoids an explicit
    // identity-shaped projector on the hot path.
    const derived = deriveRequiredInputs(
      allPlanStages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dimensions as unknown as any,
      // PR 13.2 — pass the FT catalog so Passes 3 + 4 fire on
      // plans that have dims / factor tables but no chain yet.
      {
        factorTables: factorTables ?? [],
      },
    );
    return derived.map((d): IwRequiredInputEntry => {
      // Brief 44 PR 44.11.c — When the required input is a geo dim
      // reference, attach a `geo` block so the ColumnMappingTable
      // can render <GeoTransformerPicker> beneath the row.
      const dim = d.dimSlug
        ? dimensions.find((row) => row.slug === d.dimSlug)
        : undefined;
      const geo =
        dim?.dimension_type === "geographic" && dim.geo_granularity
          ? {
              granularity: dim.geo_granularity,
              displayName: dim.display_name || dim.slug,
            }
          : undefined;
      return {
        id: d.id,
        name: d.name,
        category: d.category,
        dtype: d.dtype,
        ...(d.dimSlug ? { dimSlug: d.dimSlug } : {}),
        ...(geo ? { geo } : {}),
        // Brief 89 R8 — the unset-constant flag rides through so the
        // panel keeps constant slots out of the ghost/Match lanes.
        ...(d.constantSlot ? { constantSlot: true as const } : {}),
        // origin lands in the subLabel slot — Brief 38 §6 shows
        // "Class factor · Building chain" sublabels in the rail.
        subLabel: d.origin,
      };
    });
  }, [allPlanStages, dimensions, factorTables]);

  // Build a minimal "echo" Plan with one input → output pair per
  // derived required-input. The pane uses this to surface mapped
  // CSV values in the preview before the real `stagesToRuntimePlan`
  // compiler lands (PR 11a-bis: unpacks `multiplicative_chain` +
  // `flat_factor` + `modifier_schedule` + `clamp`/`round` stages
  // into runtime nodes + edges).
  //
  // PR 11i — switched the source of truth from `stages` (Inputs
  // section only) to `requiredInputs` (full §4.2 derivation), so
  // the echo plan matches the mapping table 1:1 even when the user's
  // plan has no explicit input_node stages (e.g., a class-dim
  // factor-table chain authored end-to-end in Parametrize +
  // Assemble).
  const echoPlan = useMemo(() => {
    type EchoNode = { id: string; kind: string; params: unknown };
    type EchoEdge = {
      from: { node: string; port: string };
      to: { node: string; port: string };
    };
    const nodes: EchoNode[] = [];
    const edges: EchoEdge[] = [];

    for (const req of requiredInputs) {
      // The runtime's `input` node reads `externalInputs[fieldName]`,
      // and `projectRowsForBatch` keys the projected map by
      // `requiredInput.id`. Setting fieldName = req.id keeps both
      // sides aligned.
      const fieldType: "number" | "string" | "boolean" | "date" =
        req.dtype === "number"
          ? "number"
          : req.dtype === "boolean"
            ? "boolean"
            : req.dtype === "date"
              ? "date"
              : "string";
      const inputNodeId = `in_${req.id}`;
      const outputNodeId = `out_${req.id}`;
      nodes.push({
        id: inputNodeId,
        kind: "input",
        params: { fieldName: req.id, fieldType },
      });
      nodes.push({
        id: outputNodeId,
        kind: "output",
        params: { fieldName: req.id, fieldType },
      });
      edges.push({
        from: { node: inputNodeId, port: "value" },
        to: { node: outputNodeId, port: "value" },
      });
    }

    return {
      id: "rate-lab.inputs-echo-plan",
      version: "0.1.0",
      name: "Inputs preview (echo mode — PR 11a+11i)",
      line: "bop",
      effective: "2026-01-01",
      nodes,
      edges,
    };
  }, [requiredInputs]);

  // Project DimensionRow[] (the route's editable shape) into the
  // narrower Dimension shape <InputsWorkspace> reads. We pass it
  // through — @openrater/ui's autoMatch + detectMismatches consume
  // `.slug`, `.display_name`, `.levels` which all carry.
  const dims = useMemo(
    () =>
      dimensions.map((d) => ({
        id: d.id,
        slug: d.slug,
        display_name: d.display_name,
        data_type: d.data_type,
        role: d.role,
        ...(d.dimension_type !== undefined
          ? { dimension_type: d.dimension_type }
          : {}),
        ...((d as { shape?: unknown }).shape !== undefined
          ? { shape: (d as { shape?: unknown }).shape }
          : {}),
        ...((d as { levels?: unknown }).levels !== undefined
          ? { levels: (d as { levels?: unknown }).levels }
          : {}),
      })),
    [dimensions],
  );
  // PR D2a — Project authored chain stages + client-side factor
  // tables into a real runtime Plan. Before D2a the Inputs workspace
  // executed only the echo plan above (every output = input echo),
  // so Score-all couldn't actually produce premiums. The projector
  // emits chain.mult + lookup.direct nodes with the FT cells embedded
  // inline (Map<ftId, Map<cellKey, number>>), so the engine resolves
  // each factor at run time from the localStorage-backed authoring
  // state without round-tripping to the API.
  //
  // Scope (v1): only multiplicative_chain stages with lookup_method=
  // "direct" + 1-D dim bindings. flat_factor / modifier_schedule /
  // clamp / round / eligibility lands incrementally. The IRS-990
  // template scopes itself to chains so all v1 work powers it.
  //
  // The default LCM override is 1.35 — matches the Loss Cost
  // Multiplier on the IRS-990 spreadsheet; users authoring a
  // different LCM in their chainSpec can map an `lcm` column to
  // override. (A future PR can per-chain detect the lcm override
  // from the chainSpec config — for v1 the hardcoded default is fine
  // because LCM rarely changes across rows.)
  // P2 G9 — the min-premium floor's scope follows the composition
  // context: a GROUPED book floors once per policy (post-IRPM, via the
  // synthetic tail step below); everything else floors per row.
  const bookIsGrouped = !!inputMapping?.grouping_config?.policy_id_column;
  const chainProjection = useMemo(() => {
    const { plan: base, issues } = stagesToRuntimePlan(
      allPlanStages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dimensions as unknown as any,
      factorTables ?? [],
      factorTableCells ?? new Map(),
      {
        planId: `${planId}-runtime`,
        minPremiumScope: bookIsGrouped ? "policy" : "row",
        // Cold-test payoff — LCM + base-rate defaults come from the
        // per-template map (CHAIN_RUNTIME_DEFAULTS_BY_TEMPLATE), not a
        // hardcoded constant. `defaults` is the projector's PR-D2b
        // hook: each base-rate field (do_base_rate / gl_base_rate)
        // becomes an `input` node defaultValue so the chain's
        // `form_input.do_base_rate` resolves to the plan constant when
        // the CSV doesn't carry it. Without this, base × factors =
        // null → every premium em-dash.
        lcmOverride: chainRuntimeDefaults.lcm,
        defaults: chainRuntimeDefaults.inputDefaults,
      },
    );
    // Brief 62.4 / ADR-0055 — attach the authored Final-adjustments tail so
    // the cohort scoring view applies the filed premium + per-row build-up
    // trace. The API-synced value is a reactive dep, so a tail edit
    // re-scores immediately. When no tail is authored this is a no-op
    // (base passes through unchanged).
    const plan =
      policyTail.length > 0 ? { ...base, policy_tail: policyTail } : base;
    // ADR-0056 — `issues` rides the memo so the batch mount + issue
    // banner can render projection degradations (wired in G8 PR3).
    return { plan, issues };
  }, [
    allPlanStages,
    dimensions,
    factorTables,
    factorTableCells,
    planId,
    chainRuntimeDefaults,
    policyTail,
    bookIsGrouped,
  ]);
  const chainPlan = chainProjection.plan;

  // Brief 80 D-E (finding E7) — the composition-contract issues join
  // the projector's own: a grouping without a premium roll-up, a round
  // stage publishing a bespoke total field, or a grouping column the
  // loaded book doesn't carry each NAME themselves in the same strip,
  // before any run returns null premiums.
  const compositionIssues = useMemo(
    () =>
      collectCompositionIssues(
        allPlanStages,
        inputMapping,
        inputMapping?.source.kind === "csv"
          ? inputMapping.source.columns
          : undefined,
        // 93.4 — so the missing-roll-up warning can exempt the
        // total-less transcription, whose policies compose fine with
        // NO premium roll-up declared. `chainPlan` is the projected
        // rating plan (it IS `effectivePlan` whenever chains exist; the
        // echo fallback carries no money outputs, so the exemption
        // cannot misfire there).
        resolvePlanPremiumContext(
          chainPlan as unknown as PremiumPlanLike,
          allPlanStages,
        ),
      ),
    [allPlanStages, inputMapping, chainPlan],
  );
  const authoringIssues = useMemo(
    () => [...chainProjection.issues, ...compositionIssues],
    [chainProjection.issues, compositionIssues],
  );

  // The effective plan for scoring: prefer the chain plan when it
  // has at least one chain output (a multiplicative_chain stage was
  // authored). Fall back to the echo plan so the Inputs workspace
  // still shows mapped CSV values per row when no chain exists yet
  // (the early-author flow).
  const chainHasOutputs = chainPlan.nodes.some((n) => n.kind === "chain.mult");
  const effectivePlan = chainHasOutputs ? chainPlan : echoPlan;

  // The declared dtype of each input (from its `input_node` stage), keyed by
  // the input id the column-map projects to. `projectRowsToExternalInputs`
  // needs this to COERCE the raw CSV strings — without it every value stays a
  // string, so a numeric chain sum (e.g. `prop_limit_band = building_limit +
  // bpp_limit`) string-CONCATENATES ("800000"+"50000") into the wrong band and
  // a boolean predicate (`sprinklered`) reads a non-empty string as truthy.
  // Both silently mis-rate. The substrate already carries the type; honoring it
  // here makes Score-all + the policy roll-up agree with the typed runtime.
  const inputDtypesById = useMemo<
    Record<string, "number" | "boolean" | "date" | "string">
  >(() => {
    const m: Record<string, "number" | "boolean" | "date" | "string"> = {};
    for (const s of allPlanStages) {
      if (s.stage_kind !== "input_node") continue;
      const cfg = (s.config_json ?? {}) as Record<string, unknown>;
      const inputId =
        typeof cfg.source_path === "string" ? cfg.source_path : undefined;
      const dt =
        typeof cfg.data_type === "string"
          ? cfg.data_type.toLowerCase()
          : undefined;
      if (!inputId || !dt) continue;
      m[inputId] =
        dt === "money" ||
        dt === "int" ||
        dt === "integer" ||
        dt === "number" ||
        dt === "float" ||
        dt === "decimal" ||
        dt === "currency"
          ? "number"
          : dt === "bool" || dt === "boolean"
            ? "boolean"
            : dt === "date" || dt === "datetime"
              ? "date"
              : "string";
    }
    return m;
  }, [allPlanStages]);

  // E08/E03 PR D — when the book is grouped into policies (D1) + fields are
  // declared to roll up (D2), rate each location, reduce to the policy, and
  // run the policy-level appetite gates (D4). The grouped result renders in
  // the Inputs v2 policy list (<InputsPanelV2>, `policyRollupResults` prop).
  // Empty (→ per-row scoring) unless a policy_id column + roll-up fields are
  // configured. Pure; recomputes on mapping / plan changes.
  const policyRollupResults = useMemo<readonly PolicyBookResult[]>(() => {
    const grouping = inputMapping?.grouping_config;
    const declared = inputMapping?.rollup_fields ?? [];
    // Law 1 (93.4) — a total-less plan declares NO premium basis (any
    // premium-named roll-up would suppress the dec-page sum), so its
    // coverages get rolled HERE or they get rolled nowhere. `bookRun`
    // and `/score-policy` both synthesize them from the shared
    // `extraPolicyRollupFields`; this path — the browser's own policy
    // composition — read `rollup_fields` raw and so had no such leg,
    // which is why removing the premium leg would otherwise blank the
    // panel. Scoped to the coverage-sum case on purpose: every other
    // plan keeps the prior behavior exactly, bail included.
    const planPremium = resolvePlanPremiumContext(
      effectivePlan as unknown as PremiumPlanLike,
      allPlanStages,
    );
    const declaredNames = declared.map((f) => f.fieldName);
    const coverageSum = isCoverageSumBook(declaredNames, planPremium);
    const rollupFields: readonly AuthoredRollupField[] = coverageSum
      ? [
          ...declared,
          ...extraPolicyRollupFields(
            declaredNames,
            planPremium,
            COVERAGE_SUM_COLUMN,
          ).map((fieldName) => ({ fieldName, reducer: "sum" as const })),
        ]
      : declared;
    if (
      !grouping?.policy_id_column ||
      rollupFields.length === 0 ||
      inputMapping?.source.kind !== "csv"
    ) {
      return [];
    }
    const rawRows = (inputMapping.source.sample_rows ??
      []) as readonly Readonly<Record<string, unknown>>[];
    if (rawRows.length === 0) return [];

    // Brief glm-irpm-lightbox-in-policy-rollup — attach the authored policy tail
    // (read on mount) so the rolled premium subtotal composes through the GLM
    // IRPM → loadings → minimum premium. A model-sourced IRPM needs the
    const tail = policyTail;

    try {
      const projected = projectRowsToExternalInputs(
        rawRows as readonly Readonly<Record<string, string>>[],
        inputMapping.column_map,
        {
          geoTransformers: geoTransformerByInputId as Readonly<
            Record<string, GeoTransformerId>
          >,
          inputDtypes: inputDtypesById,
        },
      );
      const keyed = keyedRowsFromBook(projected, rawRows, grouping);
      const baseConfig = policyBookConfigFromPlan(allPlanStages, rollupFields);
      // P2 G9 — the plan's authored floor applies ONCE per policy,
      // post-IRPM, as the terminal tail step (the projection above
      // omitted the per-row floor under minPremiumScope: "policy").
      const composedTail = appendPlanFloor(
        tail,
        planMinimumPremium(allPlanStages),
      );
      const config =
        composedTail.length > 0
          ? {
              ...baseConfig,
              policyTail: composedTail,
              // The GLM reads the rolled Σ features; these per-policy CONSTANTS
              // (the loadings' guards + the GLM tenure) come from the first
              // location row of each policy.
              policyInputKeys: ["years_in_business", "is_first_term"],
            }
          : baseConfig;
      const compiled = compilePlan(effectivePlan as unknown as Plan);
      const composed = evaluatePolicyBook(
        compiled,
        keyed,
        config,
        // S1 — always inject the resolver: literal + column tails resolve
        // inline; a legacy model source refuses by name inside it.
        { resolveAdjustment: makeIrpmAdjustmentResolver() },
      );
      if (!coverageSum) return composed;
      // Materialize the synthesized dec-page sum onto each policy under
      // the name every surface already knows it by (COVERAGE_SUM_COLUMN
      // — what the run summary advertises as `premium_field` and what
      // the batch builders write per row). The panel then headlines it
      // through the ordinary rolled-field read; without it the headline
      // falls through to `rolled[0]`, a TIV column.
      return composed.map((p) => {
        const sum = sumMoneyFields(p.rollup.rolled, planPremium.moneyFields);
        if (sum === null) return p;
        return {
          ...p,
          rollup: {
            ...p.rollup,
            rolled: { ...p.rollup.rolled, [COVERAGE_SUM_COLUMN]: sum },
          },
        };
      });
    } catch {
      return [];
    }
  }, [
    inputMapping,
    allPlanStages,
    effectivePlan,
    geoTransformerByInputId,
    inputDtypesById,
    policyTail,
  ]);

  // Test-2 Phase 3 — per-row "Enrich book", driven by the plan's authored
  // Route(s), NOT a hardcoded connector. For each row + each route: resolve the
  // bound inputs from the row (binding.plan_input_key → its mapped CSV column),
  // invoke the route's connection, and write each push (output_port →
  // plan_input_key) back onto the row + the mapping (column_map + a `sum`
  // roll-up, so it rolls to the policy + feeds the policy GLM IRPM). A connector
  // missing its key short-circuits with guidance; a per-row connector/network
  // failure degrades gracefully (the row stays unenriched, never a crash).
  // setInputMapping auto-persists (debounced PUT).
  const [enriching, setEnriching] = useState(false);
  const handleEnrichBook = useCallback(
    async (mapping: PlanInputMapping) => {
      if (mapping.source.kind !== "csv") {
        notify("Enrich book is CSV-only");
        return;
      }
      const rows = mapping.source.sample_rows ?? [];
      if (rows.length === 0) {
        notify("No rows to enrich");
        return;
      }
      const routes = routesData?.routes ?? [];
      if (routes.length === 0) {
        notify(
          "No enrichment route yet — in API Lab, bind an input (e.g. address) to " +
            "a connection and push an output back (e.g. square footage), then retry.",
        );
        return;
      }
      // Pre-flight: each route's connection must have its API key set.
      const connOf = (id: string) =>
        connectorsData?.connectors.find((c) => c.connector_id === id);
      const needsKey = routes
        .map((r) => connOf(r.connection_id))
        .find((c) => c && c.needs_secret && !c.configured);
      if (needsKey) {
        notify(
          `${needsKey.display_name} needs an API key — add it in API Lab → the ` +
            "connection's settings (it's stored encrypted).",
        );
        return;
      }

      const columns = mapping.source.columns;
      const colFor = (planInputKey: string): string | undefined =>
        mapping.column_map[planInputKey] ??
        columns.find((c) => c.toLowerCase() === planInputKey.toLowerCase()) ??
        columns.find((c) =>
          c.toLowerCase().includes(planInputKey.toLowerCase()),
        );

      setEnriching(true);
      let matched = 0;
      let missed = 0;
      let cost = 0;
      const pushedKeys = new Set<string>();
      try {
        const enriched = await Promise.all(
          rows.map(async (row) => {
            let next = { ...row };
            let rowFilled = false;
            for (const route of routes) {
              const inputs: Record<string, unknown> = {};
              for (const b of route.bindings) {
                const col = colFor(b.plan_input_key);
                const v = col != null ? String(row[col] ?? "").trim() : "";
                if (v !== "") inputs[b.param_name] = v;
              }
              // Skip a route whose bound inputs aren't all present on this row.
              if (
                route.bindings.length > 0 &&
                Object.keys(inputs).length < route.bindings.length
              ) {
                continue;
              }
              try {
                const res = await invokeConnector(route.connection_id, inputs);
                cost += res.cost_usd;
                for (const p of route.pushes) {
                  const val = res.outputs[p.output_port];
                  if (val != null) {
                    // Stored as a string (CSV convention); the roll-up coerces it.
                    next = { ...next, [p.plan_input_key]: String(val) };
                    pushedKeys.add(p.plan_input_key);
                    rowFilled = true;
                  }
                }
              } catch {
                // 401 / upstream / network — leave this route's outputs unfilled.
              }
            }
            if (rowFilled) matched += 1;
            else missed += 1;
            return next;
          }),
        );

        // Wire every pushed column into the mapping (+ a `sum` roll-up each).
        const nextColumns = [...columns];
        const nextColumnMap = { ...mapping.column_map };
        const nextRollup = [...(mapping.rollup_fields ?? [])];
        for (const key of pushedKeys) {
          if (!nextColumns.includes(key)) nextColumns.push(key);
          nextColumnMap[key] = key;
          if (!nextRollup.some((f) => f.fieldName === key)) {
            nextRollup.push({ fieldName: key, reducer: "sum" as const });
          }
        }
        // Brief 65 §3.6 — apply against CURRENT state, not the snapshot
        // captured at click time: edits made during the run (remap, alias,
        // Replace) must survive. If the book itself changed identity
        // mid-run (Replace / new upload), the enriched rows describe a
        // book that no longer exists — drop them instead of resurrecting it.
        let staleBook = false;
        setInputMapping((prev) => {
          const prevRows =
            prev?.source.kind === "csv"
              ? (prev.source.sample_rows ?? [])
              : null;
          if (!prev || prevRows === null || prevRows.length !== rows.length) {
            staleBook = true;
            return prev;
          }
          const prevColumns =
            prev.source.kind === "csv" ? prev.source.columns : [];
          const mergedColumns = [...prevColumns];
          for (const key of pushedKeys) {
            if (!mergedColumns.includes(key)) mergedColumns.push(key);
          }
          const mergedColumnMap = { ...prev.column_map };
          const mergedRollup = [...(prev.rollup_fields ?? [])];
          for (const key of pushedKeys) {
            mergedColumnMap[key] = key;
            if (!mergedRollup.some((f) => f.fieldName === key)) {
              mergedRollup.push({ fieldName: key, reducer: "sum" as const });
            }
          }
          // Merge ONLY the pushed columns onto the current rows — any other
          // cell edits made mid-run win over the snapshot.
          const mergedRows = prevRows.map((prevRow, i) => {
            const enrichedRow = enriched[i];
            if (!enrichedRow) return prevRow;
            const merged: Record<string, unknown> = { ...prevRow };
            for (const key of pushedKeys) {
              if (enrichedRow[key] != null) merged[key] = enrichedRow[key];
            }
            return merged;
          });
          return {
            ...prev,
            source: {
              kind: "csv",
              columns: mergedColumns,
              sample_rows: mergedRows as typeof prevRows,
            },
            column_map: mergedColumnMap,
            ...(mergedRollup.length > 0 ? { rollup_fields: mergedRollup } : {}),
          };
        });
        if (staleBook) {
          notify(
            "The book changed while enriching — the run's results were discarded. Re-run Fill from API Lab on the new book.",
          );
          return;
        }
        const connName =
          connOf(routes[0]!.connection_id)?.display_name ?? "the connector";
        notify(
          `Enriched ${matched}/${rows.length} location${rows.length === 1 ? "" : "s"}` +
            (missed ? ` · ${missed} unmatched` : "") +
            ` · est. $${cost.toFixed(2)} · ${connName}`,
        );
      } catch (e) {
        notify(`Enrich failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setEnriching(false);
      }
    },
    [routesData, connectorsData, notify, setInputMapping],
  );

  // ── Brief 52 — declared-input dictionary (the "Declare" panel) ──
  // Reuses the slice-2 stage CRUD: declared inputs ARE input_node
  // stages (D1). On save the plan-detail query invalidates → the new
  // stage flows back through `allPlanStages` → `declaredInputs` +
  // `requiredInputs` re-derive, so the Gate picker + CSV mapper light
  // up automatically.
  const addStageMutation = useAddStage(planId);
  const patchStageConfigMutation = usePatchStageConfig(planId);
  const removeStageMutation = useRemoveStage(planId);
  const declaredInputs = useMemo(
    () => stagesToInputDictEntries(allPlanStages),
    [allPlanStages],
  );
  const dictBusy =
    addStageMutation.isPending ||
    patchStageConfigMutation.isPending ||
    removeStageMutation.isPending ||
    // Brief 58 Pillar C — a bulk declare is still draining (in the
    // background, at the stable level). Disable re-triggering until done.
    inputDeclarations.pendingCount > 0;
  const handleUpsertInput = useCallback(
    (entry: InputDictEntry) => {
      const isExisting = allPlanStages.some(
        (s) => s.stage_kind === "input_node" && s.stage_id === entry.id,
      );
      if (isExisting) {
        // Platform-test finding E10d — a fieldName rename must carry
        // the plan's input mapping with it. `column_map` is keyed BY
        // field name; leaving the old key meant the book column kept
        // feeding a field that no longer exists, and the renamed field
        // arrived unmapped (values silently raw strings — bool gates
        // stopped matching). The stage patch itself already rewrites
        // `name` + `source_path` together (entryToConfigJson).
        const prevEntry = declaredInputs.find((e) => e.id === entry.id);
        const oldField = prevEntry?.fieldName;
        const newField = entry.fieldName;
        if (oldField && newField && oldField !== newField) {
          setInputMapping((prev) => {
            if (!prev || !(oldField in prev.column_map)) return prev;
            const nextColumnMap: Record<string, string> = {};
            for (const [k, v] of Object.entries(prev.column_map)) {
              nextColumnMap[k === oldField ? newField : k] = v;
            }
            return { ...prev, column_map: nextColumnMap };
          });
        }
        patchStageConfigMutation.mutate({
          stage_patches: [entryToConfigPatch(entry)],
        });
      } else {
        addStageMutation.mutate(entryToAddStageRequest(entry, "$last"));
      }
    },
    [
      allPlanStages,
      addStageMutation,
      patchStageConfigMutation,
      declaredInputs,
      setInputMapping,
    ],
  );
  const handleDeleteInput = useCallback(
    (id: string) => removeStageMutation.mutate({ stageId: id }),
    [removeStageMutation],
  );
  const handleBulkAddInputs = useCallback(
    (entries: readonly InputDictEntry[]) => {
      // Dedupe against what's already declared, then hand the rest to the
      // DURABLE queue (Brief 58 Pillar C). Previously this looped
      // `addStageMutation.mutateAsync` HERE — inside a component that
      // unmounts on tab switch — so navigating away mid-loop orphaned the
      // remaining saves and lost the work. Now the queue + drain live at
      // the stable PlanDetailContent level (and in localStorage), so the
      // 28 saves complete in the background and resume after a reload.
      const existingFields = new Set(declaredInputs.map((e) => e.fieldName));
      const existingIds = new Set(
        allPlanStages
          .filter((s) => s.stage_kind === "input_node")
          .map((s) => s.stage_id),
      );
      const fresh = entries.filter(
        (e) =>
          // A ':' names a binding namespace (literal:1), never a field —
          // one-click Declare must not mint an input from one, no matter
          // what upstream list produced the entry.
          isDeclarableFieldName(e.fieldName) &&
          !existingFields.has(e.fieldName) &&
          !existingIds.has(e.id),
      );
      if (fresh.length === 0) {
        notify("Those inputs are already declared");
        return;
      }
      const queued = inputDeclarations.enqueue(fresh);
      notify(`Declaring ${queued} input${queued === 1 ? "" : "s"}…`);
    },
    [declaredInputs, allPlanStages, inputDeclarations, notify],
  );

  // Brief 61 D2 — fields the rating structure needs (dims, factor-table
  // keys, chain paths) that haven't been declared as typed inputs yet.
  // Drives the "Declare all" converge prompt.
  const undeclaredInputs = useMemo(() => {
    const declaredFields = new Set(declaredInputs.map((e) => e.fieldName));
    // Brief 89 R8 — unset chain constants never count as (or bulk-
    // declare into) missing inputs; their repair lives in Rating.
    return requiredInputs
      .filter((r) => !declaredFields.has(r.id) && r.constantSlot !== true)
      .map((r) => ({ id: r.id, name: r.name }));
  }, [requiredInputs, declaredInputs]);

  const handleDeclareAll = useCallback(() => {
    const declaredFields = new Set(declaredInputs.map((e) => e.fieldName));
    const fresh = requiredInputs
      .filter((r) => !declaredFields.has(r.id) && r.constantSlot !== true)
      .map((r): InputDictEntry => ({
        id: "",
        fieldName: r.id,
        displayName: r.name,
        dataType:
          r.dtype === "number"
            ? "float"
            : r.dtype === "boolean"
              ? "bool"
              : r.dtype === "date"
                ? "date"
                : "string",
        // A dim ref with a slug is resolved/derived; a raw input is form.
        source: r.dimSlug ? "derived" : "form",
        required: true,
        ...(r.dimSlug ? { derivedFrom: r.dimSlug } : {}),
      }));
    if (fresh.length > 0) handleBulkAddInputs(fresh);
  }, [requiredInputs, declaredInputs, handleBulkAddInputs]);

  // The mount keeps ALL its logic/wiring; the v2 body (InputsPanelV2) IS
  // the Inputs surface — the v1 <InputsWorkspace> render was deleted
  // 2026-06-09 (§2B: same controlled substrate, view-only swap). The
  // `?v2=0` escape hatch no longer reaches a v1 Inputs body.
  return (
    <>
      <InputsPanelV2
        stages={allPlanStages}
        inputMapping={inputMapping}
        // ADR-0056 — the dry-compile's structured issues: the preview
        // must never look confident over a silently degraded plan.
        projectionIssues={authoringIssues}
        // §2.4 — the book round-trip IN: a one-row CSV template from the
        // declared inputs (Score-all already round-trips OUT).
        onDownloadCsvTemplate={() => {
          const headers = stagesToInputDictEntries(allPlanStages).map(
            (e) => e.fieldName,
          );
          if (headers.length === 0) return;
          downloadTextFile(
            `book-template-${planId}.csv`,
            `${headers.join(",")}\n`,
            "text/csv",
          );
        }}
        // Gate write on draft-only — a non-draft plan keeps the connected
        // book visible but loses Replace/dropzone (read-only consistency).
        onMappingChange={isWritable ? setInputMapping : undefined}
        // Phase B — the column-mapping table + auto-recognition. Same
        // required-inputs + dimension catalog the v1 mapping table consumes.
        requiredInputs={requiredInputs}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions={dims as any}
        // Phase C — live premium preview (keystroke-speed, browser
        // engine). EXECUTION lives on the Run tab (Brief 75 phase 4).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plan={effectivePlan as any}
        inputDtypes={inputDtypesById}
        onOpenRun={() => navigate(`/rate-lab/${planId}/workspace/verify`)}
        // P2.1 — webhook data source. Compose the shipped v1 helpers:
        // testWebhookRequest (best-effort browser fetch; auth env-vars stay
        // server-side) → inferPayloadSchema → typed source columns. The
        // returned fields land on inputMapping.source.payload_schema.fields
        // (via the view's onChange), so the mapping table + Score-all light
        // up exactly like the CSV path. Gated on write (read-only plans keep
        // the config visible but can't re-fetch).
        onInferSchema={
          isWritable
            ? async (config) => {
                const r = await testWebhookRequest(config);
                if (!r.ok) {
                  return {
                    ok: false,
                    error: r.error ?? "Couldn't reach the endpoint.",
                  };
                }
                if (r.parsed === undefined) {
                  return {
                    ok: false,
                    error: "The response wasn't JSON we could read.",
                  };
                }
                const rootPath = config.payload_schema.root_path;
                const { fields } = inferPayloadSchema(
                  r.parsed,
                  rootPath ? { rootPath } : {},
                );
                if (fields.length === 0) {
                  return {
                    ok: false,
                    error: "No fields found in the response body.",
                  };
                }
                return { ok: true, fields };
              }
            : undefined
        }
        // P2.2 — policy grouping + roll-up. The mount already rates each
        // location, reduces to the policy, and runs policy-scope appetite
        // gates (policyRollupResults). The v2 body reads/writes the grouping
        // + roll-up config on inputMapping (via onMappingChange) and renders
        // the per-policy view in place of the per-row strip when active.
        policyRollupResults={policyRollupResults}
        // P2.3 — connector enrich + route→input provenance. The mount owns the
        // per-row connector invoke (handleEnrichBook) + the api-sourced map
        // (routes → "API · via {route}" + resolved value). Enrich writes the
        // mapping, so it's gated on write; the provenance chips are read-only
        // and always wired (incl. the jump back to API Lab).
        onEnrichBook={isWritable ? handleEnrichBook : undefined}
        enriching={enriching}
        apiSourcedByKey={apiSourcedByKey}
        onOpenApiLab={() =>
          navigate(`/api-lab?plan=${encodeURIComponent(planId)}`)
        }
        //   — the "Fetch from an API" door follows
        // the API Lab ship flag; off for the MVP cold test.
        showApiSourceDoor={showApiLab()}
        // Parity — the paid-connector cost guardrail (Brief 62.6 PR3). The
        // mount builds the guardrail node + owns the cohort connector run
        // state; the v2 body renders it above the preview + surfaces the
        // projected cohort rows so the mount can price + pre-fetch. Null /
        // no-op for plans whose tail binds no connector.
        {...(bookGuardrail ? { bookGuardrail } : {})}
        onCohortRows={handleCohortRows}
        // Parity — apply the plan's Final-adjustments tail (IRPM) to the per-row
        // premium preview so it shows the FILED premium, not the raw chain.
        // The connector evaluator (post-guardrail-run) resolves connector-
        // sourced IRPM. No-op for no-tail plans.
        {...(cohortConnector.connectorEvaluator
          ? { connectorEvaluator: cohortConnector.connectorEvaluator }
          : {})}
        // P0.1 — declared-input dictionary CRUD (declare / rename / retype /
        // delete). The InputsPanelV2 dictionary table gates authoring on
        // write (isWritable, via onMappingChange); read-only on non-drafts.
        dictionary={{
          inputs: declaredInputs,
          onUpsert: handleUpsertInput,
          onDelete: handleDeleteInput,
          busy: dictBusy,
          // P0.2 — contextual bulk declare (no new surface): the structure's
          // undeclared fields, and one-click declare-from-book columns.
          undeclaredCount: undeclaredInputs.length,
          onDeclareAll: handleDeclareAll,
          onBulkAdd: handleBulkAddInputs,
        }}
        maxSampleRows={10000}
        {...(sampleDataset ? { sampleDataset } : {})}
        // Brief 89 (R2–R4) — the two-door genesis block for a fully-
        // empty plan. The algorithm door goes to Rating (its empty
        // state is the correct second beat); duplicate goes to the
        // plan list (the ⋯ menu there owns the copy verb).
        genesis={
          genesisEligible
            ? {
                onAlgorithmDoor: () =>
                  navigate(`/rate-lab/${planId}/workspace/assemble`),
                ...(genesisHasDuplicateTarget
                  ? { onDuplicate: () => navigate("/rate-lab") }
                  : {}),
              }
            : undefined
        }
      />
    </>
  );
}

// ── PR 11b — Inputs workspace localStorage persistence ──────────
//
// Persists `inputMapping` keyed by `planId` so the user's
// CSV + column_map + alias_overrides survive reloads.
//
// Backend persistence to `Plan.input_mapping` (Brief 38 PR 38.1
// substrate) is a follow-up — once the API Lab `PATCH
// /api/v1/plans/:id` slice accepts that field, this layer becomes
// a write-through cache and the localStorage read on mount becomes
// an optimistic-hydration fallback. Storage schema is the same
// `PlanInputMapping` shape so the migration is mechanical.

const INPUTS_MAPPING_STORAGE_PREFIX = "openrater:inputs-mapping:v1:";

function loadStoredInputMapping(planId: string): PlanInputMapping | null {
  try {
    const raw = localStorage.getItem(
      `${INPUTS_MAPPING_STORAGE_PREFIX}${planId}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // Minimal shape check — the writer is this module, so trust the
    // structure on hot paths. A schema bump would land alongside a
    // version-prefix bump on `INPUTS_MAPPING_STORAGE_PREFIX`.
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as PlanInputMapping;
  } catch {
    return null;
  }
}

function storeInputMapping(
  planId: string,
  mapping: PlanInputMapping | null,
): void {
  try {
    const key = `${INPUTS_MAPPING_STORAGE_PREFIX}${planId}`;
    if (mapping === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(mapping));
  } catch {
    // localStorage can throw under quota or private-mode — swallow,
    // the in-memory state still works for the session.
  }
}

// Brief 44 PR 44.11.c — Geographic-transformer per-input persistence.
// Mirrors the input-mapping pattern above; keyed by `planId`. Stored
// as `Record<requiredInput.id, GeoTransformerId>`. The runtime
// application (actually applying the transformer at score time) is
// a follow-up; this layer just persists the user's UI choice.
const INPUTS_GEO_TRANSFORMER_STORAGE_PREFIX =
  "openrater:inputs-geo-transformer:v1:";

function loadStoredGeoTransformers(
  planId: string,
): Readonly<Record<string, string>> {
  try {
    const raw = localStorage.getItem(
      `${INPUTS_GEO_TRANSFORMER_STORAGE_PREFIX}${planId}`,
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

// (v1 cutover 2026-06-09) — `storeGeoTransformers` went with the geo editor;
// the geo state is now read-only (`loadStoredGeoTransformers` only).

// ───────────────────────────────────────────────────────────────────
// L32 — Analytics view-state per-plan persistence.
//
// The Analytics workspace's SLICE / LEVEL / KPI / METRIC selection was
// ephemeral (component useState), so reopening the tab reset SLICE to
// the first option ("NTEE major") — never the geographic State map,
// even on a geo-territory plan. This helper persists the selection
// keyed by planId, mirroring the inputs-mapping / dimensions /
// factor-tables shadow caches above (same `openrater:<feature>:v1:`
// convention; registered in PLAN_LOCAL_STORAGE_PREFIXES so a hard
// delete purges it). Cross-filter state stays ephemeral (Brief 43
// §3.4) and is NOT stored here.
const ANALYTICS_VIEW_STORAGE_PREFIX = "openrater:analytics-view:v1:";

function loadStoredAnalyticsView(planId: string): AnalyticsViewState | null {
  try {
    const raw = localStorage.getItem(
      `${ANALYTICS_VIEW_STORAGE_PREFIX}${planId}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const v = parsed as Record<string, unknown>;
    // Minimal shape check — the writer is this module. `sliceId` +
    // `kpiId` + `metricColumn` are strings; `levelId` is string|null.
    if (typeof v.sliceId !== "string") return null;
    if (typeof v.kpiId !== "string") return null;
    if (typeof v.metricColumn !== "string") return null;
    if (v.levelId !== null && typeof v.levelId !== "string") return null;
    return {
      sliceId: v.sliceId,
      levelId: (v.levelId as string | null) ?? null,
      kpiId: v.kpiId as AnalyticsKpiId,
      metricColumn: v.metricColumn,
    };
  } catch {
    return null;
  }
}

/**
 * Trigger a client-side download of a text file. Uses the Blob +
 * temporary <a> pattern (no library) — works in every evergreen
 * browser, no-op safely in environments without `document` (e.g.
 * an SSR pass).
 */
function downloadTextFile(
  filename: string,
  contents: string,
  mimeType: string,
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Brief 39 consumer integration — Gate workspace mount ──────────
//
// Wraps <GateCanvas> with controlled state (entries, active,
// activeDraft). Entries persist to `localStorage` keyed by plan id
// so saves survive across navigation + reloads. First mount on a
// fresh plan seeds from `SAMPLE_GATE_ENTRIES` (8 Meridian BOP examples);
// subsequent mounts read the user's authored set.
//
// Backend persistence (API Lab slices 8 + 9 for modifiers +
// endorsements, plus `Plan.gates` index for the filter list) is
// still a follow-up — but the localStorage layer means the UX
// behaves like a real save: rail updates immediately, reloads
// preserve the user's work, no "follow-up PR" deferral copy in
// every toast.
//
// `availableFields` is fixture-driven for now — once
// `<InputsWorkspaceMount>` hoists its mapping to the route or a
// shared context, this swaps to `inputMapping?.column_map`.

// PR A1 + A2 — Dim catalog + FT catalog persistence.
//
// Without these, authoring 11 factor tables + 6 dimensions for a real
// plan (e.g. the IRS 990 D&O+GL plan) is destroyed on every refresh.
// localStorage as a bridge until API Lab slices 4 + 6 ship.
//
// One key per plan id per kind. JSON shape mirrors the in-memory
// shape; reads are TRUSTED (the writer is this same module).
const DIM_STORAGE_PREFIX = "openrater:dimensions:v1:";
const FT_STORAGE_PREFIX = "openrater:factor-tables:v1:";
const FT_CELLS_STORAGE_PREFIX = "openrater:factor-table-cells:v1:";

function loadStoredDimensions(planId: string): readonly DimensionRow[] | null {
  try {
    const raw = localStorage.getItem(`${DIM_STORAGE_PREFIX}${planId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as readonly DimensionRow[]) : null;
  } catch {
    return null;
  }
}

function loadStoredFactorTables(
  planId: string,
): readonly (typeof SAMPLE_FACTOR_TABLES)[number][] | null {
  try {
    const raw = localStorage.getItem(`${FT_STORAGE_PREFIX}${planId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as readonly (typeof SAMPLE_FACTOR_TABLES)[number][])
      : null;
  } catch {
    return null;
  }
}

function storeFactorTables(
  planId: string,
  fts: readonly (typeof SAMPLE_FACTOR_TABLES)[number][],
): void {
  try {
    localStorage.setItem(`${FT_STORAGE_PREFIX}${planId}`, JSON.stringify(fts));
  } catch {
    // Quota / private-mode — swallow.
  }
}

/**
 * PR A2 — Cell-value sidecar. Maps don't JSON-serialize, so cells
 * land as `{ [ftId]: Array<[cellKey, number]> }`. Hydrated to a
 * Map<ftId, Map<cellKey, number>> on read so the consumer can call
 * `.get(ftId).get(cellKey)` directly.
 */
function loadStoredFactorTableCells(
  planId: string,
): Map<string, Map<string, number>> {
  try {
    const raw = localStorage.getItem(`${FT_CELLS_STORAGE_PREFIX}${planId}`);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Array<[string, number]>>;
    const out = new Map<string, Map<string, number>>();
    for (const [ftId, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue;
      out.set(ftId, new Map(entries));
    }
    return out;
  } catch {
    return new Map();
  }
}

function storeFactorTableCells(
  planId: string,
  cells: ReadonlyMap<string, ReadonlyMap<string, number>>,
): void {
  try {
    const serializable: Record<string, Array<[string, number]>> = {};
    for (const [ftId, ftCells] of cells.entries()) {
      serializable[ftId] = Array.from(ftCells.entries());
    }
    localStorage.setItem(
      `${FT_CELLS_STORAGE_PREFIX}${planId}`,
      JSON.stringify(serializable),
    );
  } catch {
    // Quota / private-mode — swallow.
  }
}

// ── Brief 70 §3 — EligibilityMount: the appetite statement ─────────
//
// Replaces GateCanvasMount (the 3-kind canvas). The section IS one
// readable document; persistence is the consolidated per-scope
// eligibility.gate stage (appetiteSync). Modifier/endorsement stages
// are untouched here — they join the Algorithm's FINAL ADJUSTMENTS in
// Phase 3 (Brief 68 §3.3).
function EligibilityMount({
  planId,
  allPlanStages,
  dimensions,
  isWritable,
}: {
  readonly planId: string;
  readonly allPlanStages: readonly StageSummary[];
  readonly dimensions: readonly DimensionRow[];
  readonly isWritable: boolean;
}) {
  const appetite = useMemo(
    () => planStagesToAppetite(allPlanStages),
    [allPlanStages],
  );
  const addStageMutation = useAddStage(planId);
  const patchMutation = usePatchStageConfig(planId);
  const removeMutation = useRemoveStage(planId);

  // The composer's field sources — the GateCanvasMount derivation:
  // declared inputs (the dictionary) + dimensions for the row scope;
  // ADR-0046 policy aggregates for the policy scope.
  const inputMappingApi = useInputMapping(planId);
  const declaredInputs = useMemo(
    () => stagesToInputDictEntries(allPlanStages),
    [allPlanStages],
  );
  const rowFields = useMemo<readonly AppetiteFieldOption[]>(() => {
    // Brief 89.3 follow-up — a dimension-backed field rides its
    // authored level list so the composer's value seat offers real
    // levels instead of free text (typed `fr` against level ids like
    // "Fire Resistive" authored a decline rule that never fired).
    // Declared inputs that SHARE a dim's slug (the dedupe-first path:
    // territory, wind_hail_pct, …) carry the same levels.
    const levelsBySlug = new Map(
      dimensions.map((d) => [d.slug, gateValueLevels(d)]),
    );
    const declared = declaredInputs.map((e) => {
      const lv = levelsBySlug.get(e.fieldName) ?? [];
      return {
        id: e.fieldName,
        label: e.displayName,
        dtype: e.dataType,
        group: "Inputs" as const,
        ...(lv.length > 0 ? { levels: lv } : {}),
      };
    });
    const dims = dimensions.map((d) => {
      const lv = levelsBySlug.get(d.slug) ?? [];
      return {
        id: d.slug,
        label: d.display_name,
        group: "Dimensions" as const,
        ...(lv.length > 0 ? { levels: lv } : {}),
      };
    });
    return [...declared, ...dims];
  }, [declaredInputs, dimensions]);
  const policyFields = useMemo<readonly AppetiteFieldOption[]>(() => {
    const rf = (
      inputMappingApi.data?.mapping as {
        rollup_fields?: ReadonlyArray<{ fieldName: string }>;
      }
    )?.rollup_fields;
    return policyAggregateFields((rf ?? []).map((f) => f.fieldName)).map(
      (id) => ({ id, dtype: "number", group: "Policy totals" as const }),
    );
  }, [inputMappingApi.data]);

  const saveState: "saving" | "saved" | "error" | undefined =
    addStageMutation.isError || patchMutation.isError || removeMutation.isError
      ? "error"
      : addStageMutation.isPending ||
          patchMutation.isPending ||
          removeMutation.isPending
        ? "saving"
        : addStageMutation.isSuccess ||
            patchMutation.isSuccess ||
            removeMutation.isSuccess
          ? "saved"
          : undefined;

  // Finding E3 — resolve a rule variable to its declared dtype so
  // appetiteScopeConfig persists rule values AS the field's type
  // (class codes stay strings, money thresholds become numbers).
  const dtypeOf = useCallback(
    (scope: "row" | "policy") => (variable: string) =>
      (scope === "row" ? rowFields : policyFields).find(
        (f) => f.id === variable,
      )?.dtype,
    [rowFields, policyFields],
  );

  const writeScope = useCallback(
    (scope: "row" | "policy", rules: readonly AppetiteRule[]) => {
      const existing =
        scope === "row" ? appetite.row.stageId : appetite.policy.stageId;
      const config = appetiteScopeConfig(
        scope,
        rules,
        appetite.defaultTier,
        dtypeOf(scope),
      );
      if (existing !== null) {
        patchMutation.mutate({
          stage_patches: [{ stage_id: existing, config_json: config }],
        });
      } else {
        addStageMutation.mutate({
          stage_id: APPETITE_STAGE_ID[scope],
          stage_kind: "eligibility.gate",
          display_name:
            scope === "row" ? "Location appetite" : "Policy appetite",
          config_json: config,
          insert_after_stage_id: "$last",
          inputs: [],
          outputs: [],
        });
      }
    },
    [appetite, patchMutation, addStageMutation, dtypeOf],
  );

  const rulesOfScope = (scope: "row" | "policy") =>
    scope === "row" ? appetite.row.rules : appetite.policy.rules;

  const handleAdd = useCallback(
    (scope: "row" | "policy", rule: Omit<AppetiteRule, "id">) => {
      const id = `r_${Math.random().toString(36).slice(2, 10)}`;
      writeScope(scope, [...rulesOfScope(scope), { ...rule, id }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writeScope, appetite],
  );
  const handleUpdate = useCallback(
    (scope: "row" | "policy", id: string, rule: Omit<AppetiteRule, "id">) => {
      writeScope(
        scope,
        rulesOfScope(scope).map((r) => (r.id === id ? { ...rule, id } : r)),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writeScope, appetite],
  );
  const handleDelete = useCallback(
    (scope: "row" | "policy", id: string) => {
      writeScope(
        scope,
        rulesOfScope(scope).filter((r) => r.id !== id),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writeScope, appetite],
  );
  const handleReorder = useCallback(
    (scope: "row" | "policy", orderedIds: readonly string[]) => {
      const byId = new Map(rulesOfScope(scope).map((r) => [r.id, r]));
      writeScope(
        scope,
        orderedIds
          .map((id) => byId.get(id))
          .filter((r): r is AppetiteRule => r !== undefined),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writeScope, appetite],
  );
  const handleDefaultTier = useCallback(
    (tier: EligibilityTier) => {
      const patches: {
        stage_id: string;
        config_json: Record<string, unknown>;
      }[] = [];
      if (appetite.row.stageId) {
        patches.push({
          stage_id: appetite.row.stageId,
          config_json: appetiteScopeConfig(
            "row",
            appetite.row.rules,
            tier,
            dtypeOf("row"),
          ),
        });
      }
      if (appetite.policy.stageId) {
        patches.push({
          stage_id: appetite.policy.stageId,
          config_json: appetiteScopeConfig(
            "policy",
            appetite.policy.rules,
            tier,
            dtypeOf("policy"),
          ),
        });
      }
      if (patches.length > 0) {
        patchMutation.mutate({ stage_patches: patches });
      } else {
        // No stage yet — seed the row stage so the default persists.
        addStageMutation.mutate({
          stage_id: APPETITE_STAGE_ID.row,
          stage_kind: "eligibility.gate",
          display_name: "Location appetite",
          config_json: appetiteScopeConfig("row", [], tier, dtypeOf("row")),
          insert_after_stage_id: "$last",
          inputs: [],
          outputs: [],
        });
      }
    },
    [appetite, patchMutation, addStageMutation, dtypeOf],
  );

  // The consolidation moment — explicit, most-restrictive-first
  // (verdict-preserving), idempotent + resumable: each run re-derives
  // from the CURRENT stages, so a mid-flight failure just leaves the
  // button offered again.
  const handleConsolidate = useCallback(async () => {
    const gates = allPlanStages.filter(
      (s) => s.stage_kind === "eligibility.gate",
    );
    for (const scope of ["row", "policy"] as const) {
      const scoped = gates.filter(
        (g) =>
          ((g.config_json as Record<string, unknown> | null)?.scope ??
            "row") === scope,
      );
      if (scoped.length <= 1) continue;
      const ordered = consolidationOrder(
        scope === "row" ? appetite.row.rules : appetite.policy.rules,
      );
      for (const g of scoped) {
        await removeMutation.mutateAsync({ stageId: g.stage_id });
      }
      await addStageMutation.mutateAsync({
        stage_id: APPETITE_STAGE_ID[scope],
        stage_kind: "eligibility.gate",
        display_name: scope === "row" ? "Location appetite" : "Policy appetite",
        config_json: appetiteScopeConfig(
          scope,
          ordered,
          appetite.defaultTier,
          dtypeOf(scope),
        ),
        insert_after_stage_id: "$last",
        inputs: [],
        outputs: [],
      });
    }
  }, [allPlanStages, appetite, removeMutation, addStageMutation, dtypeOf]);

  return (
    <AppetiteStatement
      rowRules={appetite.row.rules}
      policyRules={appetite.policy.rules}
      defaultTier={appetite.defaultTier}
      rowFields={rowFields}
      policyFields={policyFields}
      consolidated={appetite.consolidated}
      readOnly={!isWritable}
      {...(saveState !== undefined ? { saveState } : {})}
      {...(isWritable
        ? {
            onConsolidate: () => {
              void handleConsolidate();
            },
            onAddRule: handleAdd,
            onUpdateRule: handleUpdate,
            onDeleteRule: handleDelete,
            onReorder: handleReorder,
            onDefaultTierChange: handleDefaultTier,
          }
        : {})}
    />
  );
}

/**
 * RunSectionMount — V2_INTERFACE_SPEC §2.4 (the Brief-63 payoff).
 *
 * Owns the sample-risk field state + the project→compile→run pipeline —
 * the SAME one Algorithm's Verify mode runs (stagesToRuntimePlan →
 * synthesizeRepresentativeRisk → compilePlan → runPlan), so Test and
 * Verify can never disagree. <RunSection> stays presentational.
 *
 * The page's one primary ("Rate sample" in the plan header) requests
 * runs via the `runRequest` nonce; Enter inside the form runs too.
 */
function RunSectionMount({
  planId,
  stages,
  dimensions,
  currentContentHash,
  currentScoringFingerprint,
  ready,
  blockingHint,
  runRequest,
  onOpenBuild,
  onOpenAlgorithm,
  onGoLive,
  seedCase,
}: {
  readonly planId: string;
  readonly stages: readonly StageSummary[];
  readonly dimensions: readonly DimensionRow[];
  /** Brief 95 D2 — the newest build report's first verified test case
   *  (null = hand-authored plan or pre-95.4 report). Its inputs overlay
   *  the synthesized representative values, so "Rate sample" reproduces
   *  a verified filed example on first click. */
  readonly seedCase: {
    readonly case_id: string;
    readonly name: string | null;
    readonly inputs: Readonly<Record<string, unknown>>;
  } | null;
  /** The draft's current content hash — the staleness FALLBACK for
   *  runs that predate the fingerprint pin (ADR-0064). */
  readonly currentContentHash: string | null;
  /** ADR-0064 — the live substrate's scoring fingerprint (null while
   *  hydrating). Sample + book runs pin it at request time; the
   *  history rail's "plan changed since this run" qualifier compares
   *  it first — the grammar that can see factor-table cell edits. */
  readonly currentScoringFingerprint: string | null;
  readonly ready: boolean;
  readonly blockingHint: string | null;
  readonly runRequest: number;
  readonly onOpenBuild: () => void;
  readonly onOpenAlgorithm: () => void;
  /** Brief 84 D-H — present only while the plan is a DRAFT: a green
   *  sample result offers "Go live →" (deep-link to Ship). */
  readonly onGoLive: (() => void) | null;
}) {
  // The representative risk seeds the form; every field stays editable.
  const representative = useMemo(
    () =>
      synthesizeRepresentativeRisk(
        stages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions as unknown as any,
      ),
    [stages, dimensions],
  );
  // Brief 95 D2 — a verified filed example beats synthesis: overlay the
  // build report's first test-case inputs onto the DECLARED fields
  // (unknown keys stay out — the field list is the plan's, not the
  // workbook's). Synthesis remains the fallback for hand-authored plans.
  const seeded = useMemo(() => {
    if (!seedCase) return representative;
    const out: Record<string, unknown> = { ...representative };
    for (const [key, value] of Object.entries(seedCase.inputs)) {
      if (key in out && value !== null && value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }, [representative, seedCase]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // W16 — an actuary reads declared display names, not runtime slugs.
  // Input-dictionary names win (via the shared  resolution —
  // the SAME derivation the Inputs tab and gate prose read), then
  // dimension names, then a humanized slug for anything undeclared.
  // Keys stay the runtime slugs the engine consumes.
  const labelByField = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dimensions) {
      if (d.slug && d.display_name) m.set(d.slug, d.display_name);
    }
    for (const e of stagesToInputDictEntries(stages)) {
      // A resolved name equal to the slug carries no display info —
      // let a mapped dimension's name stand rather than clobber it.
      if (e.fieldName && e.displayName !== e.fieldName) {
        m.set(e.fieldName, e.displayName);
      }
    }
    return m;
  }, [stages, dimensions]);
  const fields = useMemo(
    () =>
      Object.entries(seeded).map(([key, v]) => ({
        key,
        label: labelByField.get(key) ?? humanizeFieldName(key),
        value: overrides[key] ?? String(v ?? ""),
        placeholder: String(v ?? ""),
      })),
    [seeded, overrides, labelByField],
  );

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    premiumLabel: string;
    outputs: { field: string; valueLabel: string }[];
    ranAtLabel: string;
    qualifier: string;
  } | null>(null);
  // §14 (audit P4-01) — the run's raw persisted result, kept alongside
  // the display projection so the evaluated trace renders in place
  // (success AND refusal — the failing step is the diagnosis).
  const [lastRunEnvelope, setLastRunEnvelope] =
    useState<ServerRunResultLike | null>(null);
  const traceView = useMemo(
    () =>
      lastRunEnvelope
        ? buildServerRunTraceView({
            result: lastRunEnvelope,
            stages: stages as unknown as readonly TraceStageLike[],
            dimensions: dimensions as unknown as readonly TraceDimensionLike[],
          })
        : null,
    [lastRunEnvelope, stages, dimensions],
  );

  // Brief 75 (v4 P3) — "Run sample" is a RECORD, not a preview: the
  // risk posts to POST /plans/{id}/runs; api-lab composes the plan's
  // OWN substrate, the scoring service computes the FILED premium
  // (composed.final — tail + policy gates + floor, P2 G4), and the run
  // persists append-only. The browser engine no longer runs here
  // (keystroke-speed preview lives in Inputs + the sheet).
  const queryClient = useQueryClient();
  // book intake — the run detail's rows re-trace through this same
  // sample path: `riskOverride` carries a stored row's projected
  // inputs verbatim (already typed by the projection).
  const run = useCallback(async (riskOverride?: Record<string, unknown>) => {
    setRunning(true);
    setError(null);
    try {
      // Merge the edited fields over the seeded risk, keeping each
      // field's original TYPE (numeric defaults parse back to numbers
      // so banded lookups keep working).
      const risk: Record<string, unknown> = riskOverride
        ? { ...riskOverride }
        : { ...seeded };
      for (const [key, raw] of riskOverride
        ? []
        : Object.entries(overrides)) {
        const original = seeded[key];
        if (typeof original === "number") {
          const n = Number(raw);
          risk[key] = Number.isFinite(n) ? n : raw;
        } else {
          risk[key] = raw;
        }
      }
      const planRun = await createPlanRun(planId, {
        kind: "sample",
        inputs: risk,
        // ADR-0064 — pin the substrate this risk was rated against.
        ...(currentScoringFingerprint !== null
          ? { scoring_fingerprint: currentScoringFingerprint }
          : {}),
      });
      // Every persisted run — including a refusal — shows in history.
      void queryClient.invalidateQueries({ queryKey: ["plan-runs", planId] });
      const payload = (planRun.result ?? {}) as {
        outputs?: Record<string, unknown>;
        views?: {
          premium?: number | null;
          premiumBasis?: string;
          tier?: string | null;
        };
        composed?: { final?: number; subtotal?: number };
        row_status?: string;
        rowIssues?: ReadonlyArray<{ severity: string; message: string }>;
      };
      // §14 — keep the raw persisted result for the trace panel, on
      // BOTH paths (a refusal's trace shows WHERE it failed).
      setLastRunEnvelope(
        (planRun.result ?? null) as ServerRunResultLike | null,
      );
      // ADR-0056 — a refused row names its structured reasons; it never
      // renders a number.
      if (payload.row_status === "error") {
        setResult(null);
        const errs = (payload.rowIssues ?? []).filter(
          (i) => i.severity === "error",
        );
        setError(
          errs.length > 0
            ? `This risk can't be rated: ${errs.map((i) => i.message).join(" ")}`
            : "This risk can't be rated — the step-by-step trace below shows where it failed.",
        );
        return;
      }
      const premium = payload.views?.premium;
      if (typeof premium !== "number" || !Number.isFinite(premium)) {
        setResult(null);
        const hasChain = stages.some(
          (st) => st.stage_kind === "multiplicative_chain",
        );
        // Blame honestly: a clean row with numbers in `outputs` is a
        // plan-shape gap (no resolvable premium view), NOT a problem
        // with this risk's inputs.
        const producedNumbers = Object.values(payload.outputs ?? {}).some(
          (v) => typeof v === "number" && Number.isFinite(v),
        );
        setError(
          !hasChain
            ? "No rating chains yet — build a coverage in the Algorithm tab to rate this risk."
            : producedNumbers
              ? "The coverages priced — see the outputs in the trace below — but the plan exposes no premium field the scoring service could resolve."
              : "The chains ran but no coverage produced a number — check that the limit / exposure inputs on this risk are filled.",
        );
        return;
      }
      const fmt = (v: number) =>
        v.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        });
      const outputs = Object.entries(payload.outputs ?? {})
        .filter(
          (e): e is [string, number] =>
            typeof e[1] === "number" && Number.isFinite(e[1]),
        )
        .map(([field, value]) => ({
          field,
          valueLabel: fmt(value),
        }));
      setResult({
        premiumLabel: fmt(premium),
        outputs,
        ranAtLabel: `ran ${new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        // Law 1 — with a composed build-up this IS the filed number;
        // without one the plan authored no tail (still server-scored).
        // A coverage_sum premium says what it is: the plan declares no
        // total row, so the headline is the sum over its coverages.
        qualifier: payload.composed
          ? "Filed premium — tail + policy gates applied, server-scored. Saved to run history."
          : payload.views?.premiumBasis === "coverage_sum"
            ? "Sum of the coverage premiums — this plan declares no total row. Server-scored; saved to run history."
            : "Plan premium — no policy tail authored. Server-scored; saved to run history.",
      });
    } catch (err) {
      setResult(null);
      // A transport failure has no persisted run — no trace to show.
      setLastRunEnvelope(null);
      setError(
        err instanceof Error
          ? `Couldn't rate this risk: ${err.message}`
          : "Couldn't rate this risk.",
      );
    } finally {
      setRunning(false);
    }
  }, [
    representative,
    overrides,
    stages,
    planId,
    currentScoringFingerprint,
    queryClient,
  ]);

  // §14 — run-history trace drawer: any DONE sample row opens its
  // persisted trace (the record IS the evidence; book runs score with
  // trace off and get no affordance).
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  // book intake — the run detail rides `?run=<id>` on the Run tab
  // so chat's rerate_book answer can deep-link straight to the rows.
  const [searchParams, setSearchParams] = useSearchParams();
  const detailRunId = searchParams.get("run");
  const openRunDetail = useCallback(
    (runId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("run", runId);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );
  const closeRunDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("run");
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);
  const traceRunQuery = useQuery({
    queryKey: ["plan-run", planId, traceRunId, "trace"],
    queryFn: () => getPlanRun(planId, traceRunId!),
    enabled: traceRunId !== null,
  });
  const historyTraceView = useMemo(() => {
    const res = traceRunQuery.data?.result as
      ServerRunResultLike | null | undefined;
    return res
      ? buildServerRunTraceView({
          result: res,
          stages: stages as unknown as readonly TraceStageLike[],
          dimensions: dimensions as unknown as readonly TraceDimensionLike[],
        })
      : null;
  }, [traceRunQuery.data, stages, dimensions]);

  // The header primary requests runs via the nonce (0 = never).
  const lastRunRequest = useRef(0);
  useEffect(() => {
    if (runRequest > 0 && runRequest !== lastRunRequest.current) {
      lastRunRequest.current = runRequest;
      if (ready) run();
    }
  }, [runRequest, ready, run]);

  // Brief 75 — the persisted run history (newest first). Every entry is
  // a server-scored record pinned to what produced it; a hash mismatch
  // vs the current draft renders the standing staleness qualifier.
  const runsQuery = useQuery({
    queryKey: ["plan-runs", planId],
    queryFn: () => listPlanRuns(planId, { limit: 8 }),
  });
  const runRows = runsQuery.data?.runs ?? [];

  // ── Brief 75 phase 3 — the connected book's facts (read-only; the
  // mapping is AUTHORED in Inputs — Run only executes it).
  const mappingQuery = useQuery({
    queryKey: ["plan-input-mapping", planId, "run-tab"],
    queryFn: () => getInputMapping(planId),
  });
  const mappingRecord = mappingQuery.data?.mapping ?? null;
  const mappingSource = (mappingRecord?.source ?? null) as {
    kind?: string;
    sample_rows?: readonly unknown[];
  } | null;
  const book =
    mappingSource?.kind === "csv" &&
    (mappingSource.sample_rows?.length ?? 0) > 0
      ? {
          rowCount: mappingSource.sample_rows?.length ?? 0,
          grouped: !!(
            mappingRecord as { grouping_config?: { policy_id_column?: string } }
          )?.grouping_config?.policy_id_column,
        }
      : null;

  // ── Brief 75 phase 3 — "Score book": submit the async book run and
  // poll ITS detail (the GET lazily finalizes the job) until terminal.
  const [pendingBookRunId, setPendingBookRunId] = useState<string | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const bookRunQuery = useQuery({
    queryKey: ["plan-run", planId, pendingBookRunId],
    queryFn: () => getPlanRun(planId, pendingBookRunId!),
    enabled: pendingBookRunId !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
    // The GET is what finalizes the run (lazy finalize, D-E) — keep
    // polling even when the tab is backgrounded, or a user who tabs
    // away comes back to a permanently "running" run.
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    const status = bookRunQuery.data?.status;
    if (status === "done" || status === "error") {
      void queryClient.invalidateQueries({ queryKey: ["plan-runs", planId] });
    }
  }, [bookRunQuery.data?.status, planId, queryClient]);
  const scoreBook = useCallback(async () => {
    setBookError(null);
    try {
      const run = await createPlanRun(planId, {
        kind: "book",
        // ADR-0064 — pin the substrate this book was scored against.
        ...(currentScoringFingerprint !== null
          ? { scoring_fingerprint: currentScoringFingerprint }
          : {}),
      });
      setPendingBookRunId(run.run_id);
      void queryClient.invalidateQueries({ queryKey: ["plan-runs", planId] });
    } catch (err) {
      setBookError(
        err instanceof Error ? err.message : "Couldn't start the book run.",
      );
    }
  }, [planId, currentScoringFingerprint, queryClient]);
  const bookRun = bookRunQuery.data ?? null;
  // Phase 4 — with no run in flight, the pane hydrates from the LATEST
  // done book run (the persisted record survives reloads); a pending
  // run always wins the display while it settles.
  const latestDoneBookQuery = useQuery({
    queryKey: ["plan-runs", planId, "book-done-latest"],
    queryFn: () =>
      listPlanRuns(planId, { kind: "book", status: "done", limit: 1 }),
  });
  const latestDoneBookId = latestDoneBookQuery.data?.runs?.[0]?.run_id ?? null;
  const fallbackBookQuery = useQuery({
    queryKey: ["plan-run", planId, latestDoneBookId, "hydrate"],
    enabled: pendingBookRunId === null && latestDoneBookId !== null,
    queryFn: () => getPlanRun(planId, latestDoneBookId!),
  });
  const shownBookRun =
    bookRun ??
    (pendingBookRunId === null ? (fallbackBookQuery.data ?? null) : null);
  const bookSummary =
    shownBookRun?.status === "done"
      ? (shownBookRun.result as {
          totals?: {
            written?: number;
            declined_indicative?: number;
            error_rows?: number;
          };
          policies?: readonly {
            policy_id: string;
            location_count: number;
            premium: number | null;
            tier: string;
            row_errors?: number;
          }[];
          row_count?: number;
          premium_field?: string;
        } | null)
      : null;
  const fmtUsd = (v: number) =>
    v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });


  return (
    <>
      <RunSection
        ready={ready}
        blockingHint={blockingHint}
        onOpenBuild={onOpenBuild}
        fields={fields}
        onFieldChange={(key, value) =>
          setOverrides((prev) => ({ ...prev, [key]: value }))
        }
        onReset={() => setOverrides({})}
        onRun={() => void run()}
        running={running}
        result={result}
        error={error}
        onOpenAlgorithm={onOpenAlgorithm}
        traceView={traceView}
        // Brief 95 D2 — say WHERE the numbers came from (cold-test law).
        seedHint={
          seedCase
            ? `Seeded from ${seedCase.case_id} — the filing's own verified ` +
              "example. Edit any field, then press Enter or Rate sample."
            : undefined
        }
        // Brief 95 D1 — no link on an input-less plan (the endpoint 422s).
        bookTemplateUrl={
          fields.length > 0 ? bookTemplateUrl(planId) : undefined
        }
      />
      {/* Brief 84 D-H — the ONE cross-tab nudge: a green sample on a
          not-yet-live plan offers the next step. A link to Ship (the
          verb's one home), never an inline publish. */}
      {onGoLive && result && !error && result.premiumLabel.startsWith("$") ? (
        <p className="rater-runhist__golive">
          Looks right?{" "}
          <Button variant="plain" size="xs" onClick={onGoLive}>
            Go live →
          </Button>
        </p>
      ) : null}
      <section className="rater-runhist" aria-label="Score the book">
        <h3 className="rater-runhist__title">Book</h3>
        {book === null ? (
          <p className="rater-runhist__meta">
            No book connected —{" "}
            {fields.length > 0 ? (
              <>
                <a
                  className="rater-runhist__meta-link"
                  href={bookTemplateUrl(planId)}
                >
                  download the book template (CSV)
                </a>
                , fill a row per risk, and upload it in Inputs.
              </>
            ) : (
              "upload a CSV in Inputs to score one here."
            )}
          </p>
        ) : (
          <div className="rater-runhist__list">
            <div className="rater-runhist__row">
              <span className="rater-runhist__meta">
                {book.rowCount.toLocaleString("en-US")} row
                {book.rowCount === 1 ? "" : "s"}
                {book.grouped ? " · grouped by policy" : ""} — scored
                server-side; the run persists below.
              </span>
              <span aria-hidden />
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={12} aria-hidden />}
                disabled={
                  !ready || bookRun?.status === "running" || book.rowCount === 0
                }
                onClick={() => void scoreBook()}
              >
                {bookRun?.status === "running" ? "Scoring book…" : "Score book"}
              </Button>
            </div>
            {bookError ? (
              <div className="rater-runhist__row">
                <span className="rater-runhist__premium is-error">
                  {bookError}
                </span>
              </div>
            ) : null}
            {bookSummary?.totals ? (
              <div className="rater-runhist__row">
                <span className="rater-runhist__premium">
                  {fmtUsd(bookSummary.totals.written ?? 0)} written
                </span>
                <span className="rater-runhist__meta">
                  {(bookSummary.totals.declined_indicative ?? 0) > 0
                    ? `· ${fmtUsd(bookSummary.totals.declined_indicative ?? 0)} declined (indicative) `
                    : ""}
                  {(bookSummary.totals.error_rows ?? 0) > 0
                    ? `· ${bookSummary.totals.error_rows} row${(bookSummary.totals.error_rows ?? 0) === 1 ? "" : "s"} cannot be rated `
                    : ""}
                  · {bookSummary.row_count ?? 0} rows scored
                </span>
              </div>
            ) : null}
            {(bookSummary?.policies ?? []).map((p) => (
              <div className="rater-runhist__row" key={p.policy_id}>
                <span className="rater-runhist__kind" data-kind="book">
                  {p.policy_id}
                </span>
                <span
                  className={`rater-runhist__premium${
                    (p.row_errors ?? 0) > 0 ? " is-error" : ""
                  }`}
                >
                  {(p.row_errors ?? 0) > 0
                    ? "cannot be rated"
                    : p.premium !== null
                      ? fmtUsd(p.premium)
                      : "—"}
                </span>
                <span className="rater-runhist__meta">
                  {p.location_count} location
                  {p.location_count === 1 ? "" : "s"} · {p.tier}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      {runRows.length > 0 ? (
        <section className="rater-runhist" aria-label="Run history">
          <h3 className="rater-runhist__title">Run history</h3>
          <ul className="rater-runhist__list">
            {runRows.map((r) => {
              const headline = r.headline as {
                premium?: number | null;
                row_status?: string;
                row_count?: number;
                totals?: Record<string, unknown>;
              };
              const premium =
                typeof headline.premium === "number"
                  ? headline.premium.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })
                  : null;
              // A book run headlines its facet totals (ADR-0056: the
              // written number, qualified by refusals) — "—" is
              // reserved for a run still in flight.
              const totals = headline.totals as
                | {
                    written?: number;
                    error_rows?: number;
                    declined?: number;
                  }
                | undefined;
              const bookFacet =
                totals && typeof totals.written === "number"
                  ? `${totals.written.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })} written${
                      totals.error_rows
                        ? ` · ${totals.error_rows} cannot be rated`
                        : ""
                    }`
                  : null;
              // 89.4 — a probe's line reads rows, not dollars: the
              // written sum over a synthetic sweep is not a book
              // number. Use "rows scored" with real plurals.
              const probeFacet =
                r.kind === "probe" && typeof headline.row_count === "number"
                  ? `${headline.row_count.toLocaleString("en-US")} row${
                      headline.row_count === 1 ? "" : "s"
                    } scored${
                      typeof totals?.declined === "number" &&
                      totals.declined > 0
                        ? ` · ${totals.declined} declined`
                        : ""
                    }`
                  : null;
              const facet =
                r.status === "error"
                  ? "failed"
                  : r.status === "running"
                    ? "running…"
                    : headline.row_status === "error"
                      ? "cannot be rated"
                      : (probeFacet ?? bookFacet ?? premium ?? "—");
              // ADR-0064 — fingerprint-first: a factor-table cell edit
              // flips this qualifier; content-hash fallback for runs
              // that predate the pin.
              const stale = isRunStale(r, {
                contentHash: currentContentHash,
                scoringFingerprint: currentScoringFingerprint,
              });
              // book intake — a done book/probe run's row is a DOOR
              // to the run detail (rows live there, not in any chat).
              const isDoor =
                (r.kind === "book" || r.kind === "probe") &&
                r.status === "done";
              return (
                <li
                  key={r.run_id}
                  className={`rater-runhist__row${isDoor ? " is-door" : ""}`}
                  {...(isDoor
                    ? {
                        role: "button" as const,
                        tabIndex: 0,
                        "aria-label": `Open ${runKindNoun(r.kind)} run detail`,
                        onClick: () => openRunDetail(r.run_id),
                        onKeyDown: (e: ReactKeyboardEvent<HTMLLIElement>) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openRunDetail(r.run_id);
                          }
                        },
                      }
                    : {})}
                >
                  {/*  — run kinds speak user language: Quote /
                      Book / Probe, never the wire tokens. */}
                  <span className="rater-runhist__kind" data-kind={r.kind}>
                    {runKindNoun(r.kind)}
                  </span>
                  <span
                    className={`rater-runhist__premium${
                      headline.row_status === "error" || r.status === "error"
                        ? " is-error"
                        : ""
                    }`}
                  >
                    {facet}
                  </span>
                  <span className="rater-runhist__meta">
                    {isoDateTime(r.created_at)}
                    {r.snapshot_id
                      ? ` · ${r.snapshot_id}`
                      : r.plan_content_hash
                        ? ` · draft@${r.plan_content_hash.slice(0, 8)}`
                        : ""}
                    {stale ? " · plan changed since this run" : ""}
                  </span>
                  {/* §14 — a done sample run's persisted trace opens in
                      a drawer (book runs score with trace off). */}
                  {r.kind === "sample" && r.status === "done" ? (
                    <Button
                      variant="plain"
                      size="xs"
                      onClick={() => setTraceRunId(r.run_id)}
                    >
                      Trace
                    </Button>
                  ) : null}
                  {isDoor ? (
                    <span className="rater-runhist__door" aria-hidden>
                      Rows →
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <Drawer
        open={traceRunId !== null}
        onClose={() => setTraceRunId(null)}
        title="Run trace"
        {...(() => {
          const row = runRows.find((r) => r.run_id === traceRunId);
          return row
            ? { subtitle: isoDateTime(row.created_at) }
            : {};
        })()}
        size="lg"
      >
        {/* Drawer.Body owns the drawer's padding + scroll — the panel
            is chrome-less by contract and must not run edge-to-edge. */}
        <Drawer.Body>
          {traceRunQuery.isPending && traceRunId !== null ? (
            <p className="rater-runhist__meta">Loading the run…</p>
          ) : historyTraceView && historyTraceView.nodeOrder.length > 0 ? (
            <TracePanel
              run={historyTraceView.run}
              nodeOrder={historyTraceView.nodeOrder}
              nodeLabels={historyTraceView.nodeLabels}
              groups={historyTraceView.groups}
              withheldOutputs={historyTraceView.withheldOutputs}
              {...(historyTraceView.composed
                ? { composed: historyTraceView.composed }
                : {})}
            />
          ) : (
            <p className="rater-runhist__meta">
              This run carries no step-by-step trace.
            </p>
          )}
        </Drawer.Body>
      </Drawer>
      {/* book intake — the run detail: rows get a home. */}
      <Drawer
        open={detailRunId !== null}
        onClose={closeRunDetail}
        title="Run detail"
        size="lg"
      >
        <Drawer.Body>
          {detailRunId !== null ? (
            <RunDetailBody
              planId={planId}
              runId={detailRunId}
              onTraceRow={(inputs) => {
                closeRunDetail();
                void run(inputs);
              }}
            />
          ) : null}
        </Drawer.Body>
      </Drawer>
    </>
  );
}

/**
 * RunDetailBody — the per-row home of a book or probe run. The
 * header states the run's identity
 * (kind · totals · substrate pin · time); the table is the
 * constitution's row grammar (# · premium · tier · status · first
 * issue) — an errored row carries its NAMED reason and no verdict,
 * never a $0, never a blank. A one-click chip filters to problems;
 * a row's "Trace" re-rates its stored projected inputs through the
 * sample path, landing in the existing quote review UI.
 */
function RunDetailBody({
  planId,
  runId,
  onTraceRow,
}: {
  readonly planId: string;
  readonly runId: string;
  readonly onTraceRow: (inputs: Record<string, unknown>) => void;
}) {
  const runQuery = useQuery({
    queryKey: ["plan-run", planId, runId],
    queryFn: () => getPlanRun(planId, runId),
  });
  const run = runQuery.data ?? null;
  const isRowKind = run?.kind === "book" || run?.kind === "probe";
  const rowsQuery = useQuery({
    queryKey: ["plan-run-rows", planId, runId],
    queryFn: () => getPlanRunRows(planId, runId, { limit: 2000 }),
    enabled: run !== null && isRowKind && run.status === "done",
  });
  const [problemsOnly, setProblemsOnly] = useState(false);

  if (runQuery.isPending) {
    return <p className="rater-runhist__meta">Loading the run…</p>;
  }
  if (run === null) {
    return <p className="rater-runhist__meta">This run no longer exists.</p>;
  }

  const result = (run.result ?? {}) as {
    totals?: {
      written?: number;
      declined_indicative?: number;
      declined?: number;
      error_rows?: number;
    };
    row_count?: number;
  };
  const totals = result.totals;
  const fmtUsd = (v: number) =>
    v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  const page = rowsQuery.data ?? null;
  const allRows = page?.rows ?? [];
  const declinedCount = allRows.filter(
    (r) =>
      r.row_status !== "error" &&
      String(r.views?.["tier"] ?? r.eligibility_tier ?? "") === "decline",
  ).length;
  const errorCount = allRows.filter((r) => r.row_status === "error").length;
  const visible = problemsOnly
    ? allRows
        .map((r, i) => [r, i] as const)
        .filter(
          ([r]) =>
            r.row_status === "error" ||
            String(r.views?.["tier"] ?? r.eligibility_tier ?? "") ===
              "decline",
        )
    : allRows.map((r, i) => [r, i] as const);

  return (
    <div className="rater-rundetail">
      <div className="rater-rundetail__head">
        <span className="rater-runhist__kind" data-kind={run.kind}>
          {runKindNoun(run.kind)}
        </span>
        <span className="rater-rundetail__totals">
          {totals && typeof totals.written === "number"
            ? `${fmtUsd(totals.written)} written`
            : run.status}
          {totals && (totals.declined_indicative ?? 0) > 0
            ? ` · ${fmtUsd(totals.declined_indicative ?? 0)} declined (indicative)`
            : ""}
          {totals && (totals.error_rows ?? 0) > 0
            ? ` · ${totals.error_rows} cannot be rated`
            : ""}
        </span>
        <span className="rater-runhist__meta">
          {run.snapshot_id
            ? run.snapshot_id
            : run.plan_content_hash
              ? `draft@${run.plan_content_hash.slice(0, 8)}`
              : ""}
          {" · "}
          {isoDateTime(run.created_at)}
        </span>
      </div>
      {isRowKind && run.status === "done" ? (
        rowsQuery.isPending ? (
          <p className="rater-runhist__meta">Loading the rows…</p>
        ) : rowsQuery.isError ? (
          <p className="rater-runhist__meta">
            The rows for this run aren't available anymore — the scoring
            job's result store has let them go. The totals above remain
            the run's record.
          </p>
        ) : page !== null ? (
          <>
            <button
              type="button"
              className={`rater-rundetail__filter${problemsOnly ? " is-on" : ""}`}
              onClick={() => setProblemsOnly((v) => !v)}
              aria-pressed={problemsOnly}
            >
              {page.total.toLocaleString("en-US")} row
              {page.total === 1 ? "" : "s"} · {declinedCount} declined ·{" "}
              {errorCount} error{errorCount === 1 ? "" : "s"}
              {problemsOnly ? " — showing problems" : ""}
            </button>
            <div className="rater-rundetail__tablewrap">
              <table className="rater-rundetail__table">
                <thead>
                  <tr>
                    <th className="is-num">#</th>
                    <th className="is-num">Premium</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th>First issue</th>
                    <th aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(([r, i]) => {
                    const premium = r.views?.["premium"];
                    const tier =
                      r.row_status === "error"
                        ? null
                        : ((r.views?.["tier"] as string | null | undefined) ??
                          r.eligibility_tier ??
                          null);
                    const firstIssue =
                      (r.rowIssues?.[0]?.["message"] as string | undefined) ??
                      null;
                    return (
                      <tr
                        key={i}
                        className={
                          r.row_status === "error"
                            ? "is-error"
                            : tier === "decline"
                              ? "is-declined"
                              : ""
                        }
                      >
                        <td className="is-num">{i + 1}</td>
                        <td className="is-num">
                          {typeof premium === "number"
                            ? fmtUsd(premium)
                            : "—"}
                        </td>
                        <td>{tier ?? "—"}</td>
                        <td>
                          {r.row_status === "error"
                            ? "cannot be rated"
                            : tier === "decline"
                              ? "declined"
                              : "rated"}
                        </td>
                        <td className="rater-rundetail__issue">
                          {firstIssue ?? ""}
                        </td>
                        <td>
                          <Button
                            variant="plain"
                            size="xs"
                            onClick={() =>
                              onTraceRow(
                                r.inputs as Record<string, unknown>,
                              )
                            }
                          >
                            Trace
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {page.next_offset !== null ? (
              <p className="rater-runhist__meta">
                Showing the first{" "}
                {allRows.length.toLocaleString("en-US")} of{" "}
                {page.total.toLocaleString("en-US")} rows.
              </p>
            ) : null}
          </>
        ) : null
      ) : run.status !== "done" ? (
        <p className="rater-runhist__meta">
          This run is {run.status} — rows appear once it finishes.
        </p>
      ) : (
        <p className="rater-runhist__meta">
          A quote run's full payload lives on the run itself — use its
          Trace button in the history.
        </p>
      )}
    </div>
  );
}

/**
 * ShipSectionMount — Brief 76 (v4 P4.5): the Ship zone.
 *
 * Two panes. VERSIONS: the freeze → publish timeline — publish is THE
 * act that lights the API up (D-F), and the divergence chip says when
 * the working draft has drifted from what's live (D-C: drift is
 * VISIBLE, never silently ignored, never hard-locked). API: the panel
 * an integrator copies from — endpoint, per-plan keys (secret shown
 * once, D-D), an editable wire-shape request seeded with the plan's
 * representative risk, and a live try-it that round-trips the REAL
 * `/quote` — the same composed FILED premium the Run tab shows for the
 * same risk on the same version (Law 1).
 */
function ShipSectionMount({
  planId,
  stages,
  dimensions,
  compileReady,
  blockingHint,
  runSummary,
  onFreeze,
  notify,
}: {
  readonly planId: string;
  readonly stages: readonly StageSummary[];
  readonly dimensions: readonly DimensionRow[];
  /** The dry-compile verdict — gates the Go live primary (84.2). */
  readonly compileReady: boolean;
  readonly blockingHint: string | null;
  /** Compact latest-run line for the hero's readiness strip, or null. */
  readonly runSummary: string | null;
  readonly onFreeze: () => void;
  readonly notify: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["publish-status", planId],
    queryFn: () => getPublishStatus(planId),
  });
  //   — the workbook-back export rides the newest
  // build report's stored bytes; the hash names what you get.
  const shipBuildReport = useBuildReport(planId);
  const workbookHash = shipBuildReport.data?.workbook_hash ?? null;
  const snapshotsQuery = useSnapshotsList(planId);
  const keysQuery = useQuery({
    queryKey: ["plan-api-keys", planId],
    queryFn: () => listApiKeys(planId),
  });
  // Brief 84 D-D — the Connect card: which apps serve this plan, and
  // how far along each Hub journey is (exposed → mapped → tested →
  // live on {app}). Read-only here; the Hub owns the verbs.
  const connectionsQuery = useQuery({
    queryKey: ["plan-connections", planId],
    queryFn: () => getPlanConnections(planId),
  });
  const connections = connectionsQuery.data ?? null;
  const status = statusQuery.data ?? null;
  const snapshots = snapshotsQuery.data?.snapshots ?? [];

  // ── Publish (moved here from Analytics/Present — D-F) ──
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const publish = useCallback(
    async (snapshotId: string, displayName: string) => {
      setPublishingId(snapshotId);
      try {
        await publishSnapshot(planId, snapshotId);
        // Brief 84 (kills F5) — publish changes the plan's HEADLINE
        // status, so every surface that displays it refetches: the plan
        // detail (header chip), the plans index (list row), and Home
        // (the "Published & live" vital + attention rows). Local panes
        // refetch inline so THIS tab updates in the same tick.
        // "plan-connections" rides along: since the republish tripwire
        // (audit gap #3, #418) the Connect card's re-test chip flips ON
        // the moment the live version moves off the tested one — a
        // stale card here would say "live on {app}" while the wire is
        // demoted, the exact lie this epic exists to kill.
        await Promise.all([
          statusQuery.refetch(),
          snapshotsQuery.refetch(),
          queryClient.invalidateQueries({ queryKey: plansQueryKeys.all }),
          queryClient.invalidateQueries({ queryKey: ["home"] }),
          queryClient.invalidateQueries({
            queryKey: ["plan-connections", planId],
          }),
        ]);
        notify(`Published “${displayName}” — the API now serves it.`);
      } catch (e) {
        notify(
          `Couldn't publish: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      } finally {
        setPublishingId(null);
      }
    },
    [planId, statusQuery, snapshotsQuery, queryClient, notify],
  );

  // ── Go live / Publish update (Brief 84 D-B — the ONE verb) ──
  // The dialog wraps the atomic POST /plans/{id}/publish: freeze the
  // draft + publish it in one confirm. The suggested name mirrors the
  // server's auto-namer (first free v{N}) so what the user sees is
  // what an empty submit would produce.
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [goLiveBusy, setGoLiveBusy] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const defaultVersionName = useMemo(() => {
    const taken = new Set(snapshots.map((s) => s.display_name));
    let n = snapshots.length + 1;
    while (taken.has(`v${n}`)) n += 1;
    return `v${n}`;
  }, [snapshots]);
  const handleGoLive = useCallback(
    async (body: {
      readonly version_name: string;
      readonly notes: string | null;
    }) => {
      setGoLiveBusy(true);
      setGoLiveError(null);
      try {
        const result = await goLive(planId, {
          version_name: body.version_name,
          ...(body.notes !== null ? { notes: body.notes } : {}),
        });
        // Same invalidation set as the timeline publish (84.1), plus
        // the Connect card: the republish tripwire (#418) demotes live
        // apps until the NEW version passes a re-test, and the card
        // must show the amber re-test chip in this same tick.
        await Promise.all([
          statusQuery.refetch(),
          snapshotsQuery.refetch(),
          queryClient.invalidateQueries({ queryKey: plansQueryKeys.all }),
          queryClient.invalidateQueries({ queryKey: ["home"] }),
          queryClient.invalidateQueries({
            queryKey: ["plan-connections", planId],
          }),
        ]);
        setGoLiveOpen(false);
        notify(`Live — ${result.snapshot.display_name} is serving quotes now.`);
      } catch (e) {
        setGoLiveError(
          e instanceof RaterApiError && e.code === "snapshot_name_collision"
            ? `A version named “${body.version_name}” already exists — pick another name.`
            : e instanceof Error
              ? e.message
              : "Couldn't publish — unknown error.",
        );
      } finally {
        setGoLiveBusy(false);
      }
    },
    [planId, statusQuery, snapshotsQuery, queryClient, notify],
  );

  // ── API keys (D-D: the secret exists ONCE, right here) ──
  const [minted, setMinted] = useState<ApiKeyCreated | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const mintKey = useCallback(async () => {
    setKeyBusy(true);
    try {
      const created = await mintApiKey(planId, {});
      setMinted(created);
      await keysQuery.refetch();
    } catch (e) {
      notify(
        `Couldn't mint a key: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setKeyBusy(false);
    }
  }, [planId, keysQuery, notify]);
  const revokeKey = useCallback(
    async (keyId: string) => {
      setKeyBusy(true);
      try {
        await revokeApiKey(planId, keyId);
        setMinted((m) => (m?.key_id === keyId ? null : m));
        await keysQuery.refetch();
        notify("Key revoked — it stops verifying immediately.");
      } catch (e) {
        notify(
          `Couldn't revoke: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      } finally {
        setKeyBusy(false);
      }
    },
    [planId, keysQuery, notify],
  );
  const activeKeys = (keysQuery.data ?? []).filter(
    (k) => k.revoked_at === null,
  );

  // ── The try-it: an editable wire-shape request, seeded with the
  // plan's representative risk (the same synthesis Run's form uses). ──
  const representative = useMemo(
    () =>
      synthesizeRepresentativeRisk(
        stages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions as unknown as any,
      ),
    [stages, dimensions],
  );
  const sampleRequest = useMemo(
    () => JSON.stringify({ inputs: representative }, null, 2),
    [representative],
  );
  const [requestText, setRequestText] = useState<string | null>(null);
  const effectiveRequest = requestText ?? sampleRequest;
  const [quoteDraft, setQuoteDraft] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const runQuote = useCallback(async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(effectiveRequest) as Record<string, unknown>;
    } catch {
      setQuoteError("The request body isn't valid JSON — fix it and retry.");
      setQuote(null);
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    try {
      const result = await quotePlan(
        planId,
        parsed as { inputs?: Record<string, unknown> },
        quoteDraft ? { draft: true } : {},
      );
      setQuote(result);
    } catch (e) {
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : "Quote failed.");
    } finally {
      setQuoting(false);
    }
  }, [effectiveRequest, planId, quoteDraft]);

  const copyText = useCallback(
    (label: string, text: string) => {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => notify(`${label} copied.`))
        .catch(() => notify(`Couldn't copy the ${label.toLowerCase()}.`));
    },
    [notify],
  );

  const endpoint = `${getApiBase() || window.location.origin}/api/v1/plans/${planId}/quote`;
  const fmtUsd = (v: number) =>
    v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  const publishedId = status?.published_snapshot_id ?? null;

  // Deploy status — three honest dots. Scoring reachability is PROVEN
  // by a quote round-trip, never asserted (no fake green).
  const scoringProof = quote
    ? ("ok" as const)
    : quoteError && /unreachable|scoring/i.test(quoteError)
      ? ("down" as const)
      : ("untried" as const);

  const liveSnap = snapshots.find((s) => s.snapshot_id === publishedId);
  const liveName = liveSnap?.display_name ?? "the live version";
  const liveSince = status?.published_at
    ? isoDate(status.published_at)
    : null;

  return (
    <div className="rater-ship">
      {/* ── ZONE 1 · STATUS — the sentence + the ONE verb (84.2) ── */}
      <section className="rater-ship__pane rater-ship__hero" aria-label="Status">
        {!status?.published ? (
          <>
            <p className="rater-ship__sentence">
              Not live yet
              <span className="rater-ship__since">
                {" "}
                — callers can't quote this plan.
              </span>
            </p>
            <div className="rater-ship__ready">
              <span
                className={
                  compileReady ? "rater-ship__check is-ok" : "rater-ship__check"
                }
              >
                {compileReady
                  ? "✓ compiles clean"
                  : `● ${blockingHint ?? "finish the build first"}`}
              </span>
              {runSummary ? (
                <span className="rater-ship__check is-ok">
                  ✓ rated — {runSummary}
                </span>
              ) : null}
            </div>
            <div className="rater-ship__heroact">
              <Button
                variant="primary"
                size="sm"
                icon={<Rocket size={12} aria-hidden />}
                disabled={!compileReady}
                title={
                  compileReady
                    ? undefined
                    : (blockingHint ?? "Finish the build first")
                }
                onClick={() => {
                  setGoLiveError(null);
                  setGoLiveOpen(true);
                }}
              >
                Go live
              </Button>
              <span className="rater-ship__hint">
                cuts {defaultVersionName} and turns the quote API on — your
                draft stays editable
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="rater-ship__sentence rater-ship__sentence--live">
              ● Live — {liveName}
              <span className="rater-ship__since">
                {liveSince ? ` · serving quotes since ${liveSince}` : ""}
              </span>
            </p>
            <div className="rater-ship__row rater-ship__row--bare">
              <span className="rater-ship__k">POST</span>
              <code className="rater-ship__code">{endpoint}</code>
              <span className="rater-ship__spacer" aria-hidden />
              <IconButton
                variant="ghost"
                size="sm"
                icon={<Copy size={14} />}
                aria-label="Copy endpoint"
                onClick={() => copyText("Endpoint", `POST ${endpoint}`)}
              />
            </div>
            <p className="rater-ship__meta">
              api {statusQuery.isSuccess ? "●" : "…"}
              {" · "}scoring{" "}
              {scoringProof === "ok"
                ? "● proven by the last quote"
                : scoringProof === "down"
                  ? "✕ unreachable"
                  : "— not proven yet (run the try-it below)"}
              {" · "}
              {activeKeys.length === 0
                ? "key optional — open in dev"
                : `key required — ${activeKeys.length} active`}
            </p>
            {status.diverged ? (
              <>
                <p className="rater-ship__diverge" role="status">
                  ⚠ Your draft has changed since {liveName} — callers still get
                  the live bytes.
                </p>
                <div className="rater-ship__heroact">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Rocket size={12} aria-hidden />}
                    onClick={() => {
                      setGoLiveError(null);
                      setGoLiveOpen(true);
                    }}
                  >
                    Publish update → {defaultVersionName}
                  </Button>
                  <span className="rater-ship__hint">
                    callers switch versions immediately
                  </span>
                </div>
              </>
            ) : status.published_content_hash === null ? (
              <p className="rater-ship__meta">
                The live version predates drift tracking — publish an update to
                enable the divergence signal.
              </p>
            ) : (
              <p className="rater-ship__meta">Draft matches the live version.</p>
            )}
          </>
        )}
      </section>

      {/* ── ZONE 2 · CONNECT — the path to the front app, made visible
             (Brief 84 D-D). One journey ladder, shared verbatim with the
             Hub's read model; the Hub keeps the verbs. ── */}
      <section className="rater-ship__pane" aria-label="Connected apps">
        <div className="rater-ship__head">
          <h3 className="rater-ship__title">Connected apps</h3>
          <span className="rater-ship__spacer" aria-hidden />
          <Link className="rater-ship__hublink" to="/integrations">
            Open Integrations →
          </Link>
        </div>
        {connections === null ? (
          <p className="rater-ship__meta">
            {connectionsQuery.isError
              ? "Couldn't read the integration seam — is api-lab up?"
              : "Reading connections…"}
          </p>
        ) : connections.connections.length > 0 ? (
          <ul className="rater-ship__list">
            {connections.connections.map((c) => {
              const ladder = ["unmapped", "mapped", "tested", "live"];
              const idx = ladder.indexOf(c.exposed.status);
              const covered =
                c.exposed.consumed_required - c.exposed.consumed_missing;
              // The republish tripwire (2026-07-11 audit) — two amber
              // facts a republish can create on a connection:
              //   1. The green test receipt pins an EARLIER version, so
              //      the live wire is unproven — re-test in the Hub.
              //   2. The new version consumes required inputs nobody
              //      mapped: status derives back to "unmapped" while the
              //      wire stays live (refusing) — map in the Hub.
              const staleReceipt =
                c.exposed.live_version_untested === true &&
                (c.exposed.status === "live" || c.exposed.status === "tested");
              const staleLabel =
                c.exposed.last_test_version_name != null &&
                c.exposed.published_version_name != null
                  ? `Tested ${c.exposed.last_test_version_name} · live is ${c.exposed.published_version_name} — re-test`
                  : "Tested an older version — re-test";
              const mappingGap =
                c.exposed.status === "unmapped" &&
                c.exposed.consumed_missing > 0 &&
                c.exposed.live;
              const steps = [
                { label: "exposed", done: true },
                {
                  label:
                    c.exposed.consumed_required > 0
                      ? `mapped ${covered}/${c.exposed.consumed_required}`
                      : "mapped",
                  done: idx >= 1,
                },
                { label: "tested", done: idx >= 2 },
              ];
              return (
                <li className="rater-ship__row" key={c.integration_id}>
                  <span className="rater-ship__name">{c.integration_name}</span>
                  <span className="rater-ship__journey">
                    {steps.map((s) => (
                      <span
                        key={s.label}
                        className={
                          s.done
                            ? "rater-ship__step rater-ship__step--done"
                            : "rater-ship__step"
                        }
                      >
                        {s.done ? "✓ " : ""}
                        {s.label}
                      </span>
                    ))}
                    {c.exposed.live ? (
                      <span className="rater-ship__live">
                        ● live on {c.integration_name}
                      </span>
                    ) : (
                      <span className="rater-ship__step">
                        {c.exposed.status === "unmapped"
                          ? "→ map fields in Integrations"
                          : c.exposed.status === "mapped"
                            ? "→ run a test in Integrations"
                            : "→ flip live in Integrations"}
                      </span>
                    )}
                    {staleReceipt && (
                      <span
                        className="rater-ship__warn"
                        title="The green test receipt pins an earlier version — re-run the Test step in Integrations so the live version has its own proof."
                      >
                        {staleLabel}
                      </span>
                    )}
                    {mappingGap && (
                      <span
                        className="rater-ship__warn"
                        title="The published version consumes required inputs that aren't mapped — live quotes refuse until the Map step in Integrations covers them."
                      >
                        {c.exposed.consumed_missing} required input
                        {c.exposed.consumed_missing === 1 ? "" : "s"} unmapped —
                        map in Integrations
                      </span>
                    )}
                  </span>
                  <span className="rater-ship__spacer" aria-hidden />
                  <Link
                    className="rater-ship__hublink"
                    to={`/integrations/${c.integration_id}`}
                  >
                    Open Integrations →
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : !connections.any_integration ? (
          <p className="rater-ship__meta">
            No apps connected. Pair your front app once in Integrations —
            every plan you publish becomes exposable, and updates flow with
            no further steps.
          </p>
        ) : status?.published ? (
          <p className="rater-ship__meta">
            {connections.any_paired
              ? "An app is paired — expose this plan in Integrations to serve it."
              : "An integration exists but isn't paired yet — finish pairing in Integrations, then expose this plan."}
          </p>
        ) : (
          <p className="rater-ship__meta">
            This plan becomes exposable to connected apps the moment it's live.
          </p>
        )}
      </section>

      {/* ── ZONE 3 · VERSIONS — history + checkpoints ── */}
      <section className="rater-ship__pane" aria-label="Versions">
        <div className="rater-ship__head">
          <h3 className="rater-ship__title">Versions</h3>
          <Button variant="ghost" size="sm" onClick={onFreeze}>
            Save a version…
          </Button>
        </div>
        {snapshots.length === 0 ? (
          <p className="rater-ship__meta">
            No versions yet — Go live cuts {defaultVersionName} and turns the
            quote API on. Need a checkpoint without publishing? Save a version.
          </p>
        ) : (
          <ul className="rater-ship__list">
            {snapshots.map((snap) => {
              const isLive = snap.snapshot_id === publishedId;
              return (
                <li className="rater-ship__row" key={snap.snapshot_id}>
                  <span className="rater-ship__name">{snap.display_name}</span>
                  <span className="rater-ship__meta">
                    saved {isoDate(snap.created_at)}
                    {" · "}
                    {snap.snapshot_id}
                  </span>
                  <span className="rater-ship__spacer" aria-hidden />
                  {isLive ? (
                    <span className="rater-ship__live">● live</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={publishingId !== null}
                      onClick={() =>
                        void publish(snap.snapshot_id, snap.display_name)
                      }
                    >
                      {publishingId === snap.snapshot_id
                        ? "Publishing…"
                        : "Publish this"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/*   — the canonical container comes back
            out: the exact ingested bytes, hash-stamped. */}
        {workbookHash ? (
          <p className="rater-ship__meta">
            <a
              className="rater-ship__hublink"
              href={`${getApiBase()}/api/v1/plans/${encodeURIComponent(planId)}/workbook`}
              download
            >
              Download the workbook (sha256 {workbookHash.slice(0, 12)}…) →
            </a>{" "}
            — re-ingesting it answers "already built": the export IS the
            source.
          </p>
        ) : null}
      </section>

      {/* ── ZONE 4 · API — keys + the try-it (endpoint + health live
             in the hero now) ── */}
      <section className="rater-ship__pane" aria-label="API">
        <div className="rater-ship__head">
          <h3 className="rater-ship__title">API</h3>
          <span className="rater-ship__meta">keys &amp; try-it</span>
        </div>
        {!status?.published ? (
          <p className="rater-ship__meta">
            Goes live with your first publish — quotes serve from the published
            version, never from unsaved edits.
          </p>
        ) : (
          <>
            <div className="rater-ship__row rater-ship__row--bare">
              <KeyRound size={14} aria-hidden className="rater-ship__icon" />
              {activeKeys.length === 0 ? (
                <span className="rater-ship__meta">
                  Open here (no key required in dev) — mint a key for an
                  external caller; it gates only when the deploy sets
                  RATER_QUOTE_REQUIRE_KEY.
                </span>
              ) : (
                <span className="rater-ship__meta">
                  {activeKeys.map((k) => (
                    <span className="rater-ship__key" key={k.key_id}>
                      <code>{k.secret_prefix}…</code>
                      <button
                        type="button"
                        className="rater-ship__revoke"
                        onClick={() => void revokeKey(k.key_id)}
                        disabled={keyBusy}
                      >
                        revoke
                      </button>
                    </span>
                  ))}
                </span>
              )}
              <span className="rater-ship__spacer" aria-hidden />
              <Button
                variant="ghost"
                size="sm"
                disabled={keyBusy}
                onClick={() => void mintKey()}
              >
                Mint API key
              </Button>
            </div>
            {minted ? (
              <div className="rater-ship__secret" role="status">
                <span>
                  Key minted — copy it NOW; it is shown once and stored hashed:
                </span>
                <code className="rater-ship__code">{minted.secret}</code>
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<Copy size={14} />}
                  aria-label="Copy API key"
                  onClick={() => copyText("API key", minted.secret)}
                />
              </div>
            ) : null}
            <div className="rater-ship__tryit">
              <div className="rater-ship__head">
                <span className="rater-ship__k">Request</span>
                <span className="rater-ship__spacer" aria-hidden />
                {requestText !== null ? (
                  <Button
                    variant="plain"
                    size="xs"
                    onClick={() => setRequestText(null)}
                  >
                    Reset to sample
                  </Button>
                ) : null}
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<Copy size={14} />}
                  aria-label="Copy request"
                  onClick={() =>
                    copyText(
                      "Request",
                      `curl -X POST '${endpoint}' -H 'content-type: application/json' -d '${effectiveRequest.replace(/\n\s*/g, " ")}'`,
                    )
                  }
                />
              </div>
              <textarea
                className="rater-ship__request"
                value={effectiveRequest}
                spellCheck={false}
                rows={Math.min(14, effectiveRequest.split("\n").length + 1)}
                onChange={(e) => setRequestText(e.target.value)}
                aria-label="Quote request body"
              />
              <div className="rater-ship__row rater-ship__row--bare">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Play size={12} aria-hidden />}
                  disabled={quoting}
                  onClick={() => void runQuote()}
                >
                  {quoting ? "Quoting…" : "Quote"}
                </Button>
                <label className="rater-ship__toggle">
                  <input
                    type="checkbox"
                    checked={quoteDraft}
                    onChange={(e) => setQuoteDraft(e.target.checked)}
                  />
                  quote the draft instead
                </label>
              </div>
              {quoteError ? (
                <p className="rater-ship__result is-error" role="alert">
                  {quoteError}
                </p>
              ) : quote ? (
                quote.row_status === "error" ? (
                  <p className="rater-ship__result is-error" role="status">
                    cannot be rated
                    {quote.row_issues?.[0]
                      ? ` — ${String((quote.row_issues[0] as { message?: unknown }).message ?? "")}`
                      : ""}
                  </p>
                ) : (
                  <p className="rater-ship__result" role="status">
                    <strong>
                      {quote.premium !== null ? fmtUsd(quote.premium) : "—"}
                    </strong>{" "}
                    filed
                    {quote.tier ? ` · ${quote.tier}` : ""}
                    {quote.location_count
                      ? ` · ${quote.location_count} locations`
                      : ""}
                    {" · "}
                    {quote.version.kind}
                    {quote.version.snapshot_id
                      ? ` ${quote.version.snapshot_id}`
                      : ""}
                    {typeof (quote.composed as { subtotal?: unknown } | null)
                      ?.subtotal === "number" && quote.premium !== null
                      ? ` · subtotal ${fmtUsd((quote.composed as { subtotal: number }).subtotal)} → final`
                      : ""}
                  </p>
                )
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* Brief 84 D-B — the ONE verb's dialog (Go live / Publish update). */}
      <GoLiveDialog
        open={goLiveOpen}
        mode={status?.published ? "update" : "first"}
        defaultVersionName={defaultVersionName}
        liveVersionName={status?.published ? liveName : undefined}
        // The republish tripwire (audit gap #3, #418): apps serving this
        // plan LIVE pause until the new version passes a Hub re-test —
        // the dialog names them BEFORE the confirm.
        liveConnectionNames={(connections?.connections ?? [])
          .filter((c) => c.exposed.live)
          .map((c) => c.integration_name)}
        isSubmitting={goLiveBusy}
        errorMessage={goLiveError}
        onClose={() => {
          if (!goLiveBusy) setGoLiveOpen(false);
        }}
        onConfirm={(body) => void handleGoLive(body)}
      />
    </div>
  );
}
