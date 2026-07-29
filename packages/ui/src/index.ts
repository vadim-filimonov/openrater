/**
 * @openrater/ui — Labs-specific components.
 *
 * The layer above @openrater/design-system that knows about insurance
 * rating concepts. Composes against @openrater/contracts for types and
 * @openrater/design-system for primitives. No HTTP, no app state, no
 * routing.
 *
 * Currently exported:
 *   - `EntityRefPicker` (M2.4 — Brief 7) — the cross-section
 *     reference-picker primitive
 *
 * Coming next (M2.5+):
 *   - `ClassPicker`, `DimensionRefPicker`, `FactorTableRefPicker`,
 *     `InputSourceRefPicker`, `CoverageChainRefPicker`
 *   - `PlanStatusBar`, `UnifiedErrorPanel`, `ErrorRow`,
 *     `IssueSeverityChip`, `ErrorFilter`, `SectionIssueDot`
 *   - `TracePanel`, `TraceCascade`, `TraceStep`, `CitationLink`
 *   - `PlanCompareView`, `CompareTree`, `CompareNode`,
 *     `RateImpactBadge`, `DiffSummaryChip`
 *   - `LobBadge`, `LobFilterTabs`, `LobGroupedList`, `LobPremiumTotal`
 *   - And so on across the briefs in M3 + M4.
 */

export { EntityRefPicker } from "./EntityRefPicker";
export type {
  EntityRefPickerProps,
  EntityRefOption,
  EntityRefPickerEmptyAction,
} from "./EntityRefPicker";

// PlanDeleteDialog — K1.4 (two-stage plan delete confirmation)
export { PlanDeleteDialog } from "./PlanDeleteDialog";
export type {
  PlanDeleteDialogProps,
  PlanDeleteImpact,
  PlanDeleteMode,
  PlanDeleteTarget,
} from "./PlanDeleteDialog";

// ── Brief 13 — unified error surface (M2.5) ─────────────────────
export { IssueSeverityChip, AllClearChip } from "./IssueSeverityChip";
export type { IssueSeverityChipProps } from "./IssueSeverityChip";

export { ErrorRow } from "./ErrorRow";
export type { ErrorRowProps } from "./ErrorRow";

export {
  ErrorFilter,
  applyErrorFilter,
  EMPTY_FILTER_STATE,
} from "./ErrorFilter";
export type { ErrorFilterProps, ErrorFilterState } from "./ErrorFilter";

export { UnifiedErrorPanel } from "./UnifiedErrorPanel";
export type { UnifiedErrorPanelProps } from "./UnifiedErrorPanel";

export { PlanStatusBar, formatRelativeTime } from "./PlanStatusBar";
export type { PlanStatusBarProps } from "./PlanStatusBar";

export {
  SectionIssueDot,
  computeSectionCounts,
  formatCountsTooltip,
} from "./SectionIssueDot";
export type { SectionIssueDotProps } from "./SectionIssueDot";

// ── Brief 74 (PR 74.0) — shared plan-readiness selector ─────────
// Lifted from rate-lab's PlanDetailRoute so OpenRater Home + the
// per-plan Overview compute one "next step" from one source.
export { computePlanReadiness } from "./PlanReadiness";
export type { PlanReadiness, PlanReadinessSubstrate } from "./PlanReadiness";

// ── Brief 88 §3.3 (88.3) — the ONE greeting every Lab landing mounts ─
export { SurfaceHeader } from "./SurfaceHeader/SurfaceHeader";
export type { SurfaceHeaderProps } from "./SurfaceHeader/SurfaceHeader";

// ── Brief 74 — OpenRater Home primitives (one voice + story order
//    per Brief 88; VitalSigns retired by 88.2 — its numbers moved into
//    the status line, Your-plans rows, and the Your-book block) ─
export { StateHero, NavLabs } from "./PlatformHome";
export type {
  StateHeroProps,
  HeroTone,
  NavLabsProps,
  NavLabItem,
} from "./PlatformHome";

// ── Brief 74 (PR 74.2) — the attention triage (the real brain),
//    re-ranked + grouped + single-voiced by Brief 88 (88.0);
//    88.2 adds the door / first-run / book / plan-row vocabulary ──
export {
  computePlatformAttention,
  summarizeAttention,
  isAlarm,
  isSetup,
  AttentionList,
  statusLineFor,
  attentionCopy,
  doorCopy,
  firstRunCopy,
  exhibitsCopy,
  planRowNextStep,
  referencePlanNote,
  REFERENCE_PLAN_NOTES,
} from "./PlatformHome";
export type {
  AttentionGroup,
  AttentionKind,
  AttentionSeverity,
  PlanFacts,
  ConnectorFacts,
  AttentionListProps,
  StatusLine,
  AttentionSummary,
  PlanRowFacts,
} from "./PlatformHome";

// ── M2.6 — Command palette (PHASE_B_PLAN.md §0.2) ──────────────
export {
  CommandPalette,
  useCommandPaletteHotkey,
} from "./CommandPalette";
export type { CommandPaletteProps, Command } from "./CommandPalette";

// ── M3.1 — Trace panel (Brief 3) ───────────────────────────────
export { CitationLink } from "./CitationLink";
export type { CitationLinkProps } from "./CitationLink";

// ── A5.3b — <Citation /> primitive (design-language §11) ─────────
//
// Single canonical citation rendering. Resolves audit §8.5 — the
// four inconsistent formats across Factor Tables, Class
// Translator, and Territories. Each surface migrates in its
// respective redesign PR (A5.6/7/8/9).
//
// Distinct from <CitationLink>: that primitive is for trace-panel
// hyperlinks to the source; this one is the inline rendering of a
// citation rule with structured source/rule/page parts.
export { Citation, formatTableCitation } from "./Citation";
export type { CitationProps, CitationPage } from "./Citation";

export {
  TraceStep,
  pickHeadlineOutput,
  formatValue,
} from "./TraceStep";
export type { TraceStepProps } from "./TraceStep";

export {
  TracePanel,
  TraceCascade,
  buildOrderedSteps,
  pickFeaturedOutput,
  buildServerRunTraceView,
} from "./TracePanel";
export type {
  TracePanelProps,
  TraceCascadeProps,
  ServerAdjustmentStepLike,
  ServerComposedLike,
  ServerRunResultLike,
  ServerRunTraceView,
  TraceDimensionLike,
  TraceGroup,
  TraceStageLike,
} from "./TracePanel";

// ── M3.2 — Comparison primitive (Brief 12) ─────────────────────
export {
  RateImpactBadge,
  formatSignedDollars,
  formatSignedPct,
} from "./RateImpactBadge";
export type { RateImpactBadgeProps } from "./RateImpactBadge";

export { DiffSummaryChip } from "./DiffSummaryChip";
export type { DiffSummaryChipProps } from "./DiffSummaryChip";

export { CompareNode } from "./CompareNode";
export type { CompareNodeProps } from "./CompareNode";

export { PlanCompareView, CompareTree } from "./PlanCompareView";
export type {
  PlanCompareViewProps,
  CompareTreeProps,
} from "./PlanCompareView";

// ── M3.3 — TestRunner (plan-test-runner-hardening brief) ──────
export { TestRunner } from "./TestRunner";
export type { TestRunnerProps } from "./TestRunner";

// ── Brief 51 — writable per-plan class registry ────────────────
// (Supersedes the read-only <ClassBrowser> + <ClassDetailPane> from
// Brief 8 / M4.1 — both deleted with the ClassificationRoute rewrite,
// per the consumer-integration cleanup rule. ClassRegistry is the
// single classification surface now.)
export {
  ClassRegistry,
  ClassEditDrawer,
  ClassBulkImportOverlay,
  parseClassTableCsv,
  mapRowToDraft,
  recordToDraft,
  emptyDraft,
} from "./ClassRegistry";
export type {
  ClassRegistryProps,
  ClassEditDrawerProps,
  ClassBulkImportOverlayProps,
  ClassRegistryRecord,
  ClassDraft,
  ClassCsvParseResult,
  ClassCsvRow,
} from "./ClassRegistry";

// ── M4.2 — Risk Inputs section (Brief 4) ───────────────────────
//
// REMOVED 2026-05-24 (Brief 38 cleanup). The legacy `<RiskInputsTable>`
// (a static, read-only summary card) is superseded by the new
// `<InputsWorkspace>` orchestrator (CSV/webhook source + auto-
// recognition mapping + mismatches + live scoring preview).
// `RiskInputRow` / `RiskInputsTableProps` are gone with it.

// ── M4.4 — Dimensions section ───────────────────────────────────
// The <DimensionsTable> render was deleted (dead since the v2 BuildUpSheet
// / ParametrizeCanvas cutover — no JSX mount). `DimensionRow` outlived the
// table: re-homed to DimensionsTable/types.ts, still the canonical
// dimension row shape consumed across labs-ui + rate-lab. The directory
// barrel below keeps the import path stable. `DimensionsTableProps` (the
// dead component's props) went with the component.
export type { DimensionRow } from "./DimensionsTable";

// ── 24.C / Brief 27 PR 1 / Brief 30 PR 30.1 — DIMENSIONS surface ─
//
// The unified Dimensions surface. Brief 27 PR 1 set the 3-column
// chrome (#174); Brief 27 PR 2 added the scale-adaptive scrubber
// (#175); Brief 30 PR 30.1 inlines the dimension EDITOR in the
// center pane (replacing the legacy <DimensionStandardDrawer>).
//
// Tool pane: 4 always-visible Add shape buttons + Composite + Templates.
// Center pane: browse list OR inline <DimensionEditor> (when
// `editingDimensionId` is set + points to a categorical dim).
// Right inspector: selected dim summary.
// Brief 66 cutover — dims2 IS the Dimensions surface (the legacy
// workspace + editor orchestrator are deleted).
export { DimensionsWorkspaceV2 } from "./DimensionsWorkspace";
export type {
  DimensionsWorkspaceProps,
  DimensionShapeChoice,
  DimensionSubtypeFilter,
} from "./DimensionsWorkspace";

// Brief 33 PR 33.1 — ParametrizeCanvas shell + canvas/saved-tables
// mode toggle. New primary surface for the Parametrize workspace;
// dim chips in the left rail, dotted-grid canvas with Frame 2
// onboarding when empty + Frame 12 saved-tables list under the
// "Saved tables" mode pill. Axis-drop frame + generated grid land
// in PRs 33.2 / 33.3.
// Brief 70 §3 — Eligibility IS one readable document (the appetite
// statement): numbered sentence rules + the default-tier closing seat.
export { AppetiteStatement } from "./AppetiteStatement";
export type {
  AppetiteFieldOption,
  AppetiteRuleView,
  AppetiteStatementProps,
} from "./AppetiteStatement";
// Brief 89.3 follow-up — a dimension-backed gate field's authored
// value space (level ids per shape), for the composer's value seat.
export { gateValueLevels } from "./AppetiteStatement";
export type { GateValueLevel } from "./AppetiteStatement";

// Brief 70 Phase 1 — the shared ordered-list grammar (rules, steps).
export { OrderedSheet, OrderedSheetStaticRow } from "./OrderedSheet";
export type {
  OrderedSheetProps,
  OrderedSheetRow,
  OrderedSheetStaticRowProps,
} from "./OrderedSheet";

// Brief 70 §2 — the rate build-up sheet (the Algorithm IS the filing
// exhibit; replaces the spatial canvas outright per lock D2).
export { BuildUpSheet, pickerItemToNode } from "./BuildUpSheet";
export type {
  BuildUpSheetProps,
  SheetAdjustment,
  SheetFactorTableMeta,
  SheetPickerItem,
} from "./BuildUpSheet";

// Brief 70 Phase 1 — the one armed delete (the three sibling prompts
// merge here; FactorTableDeletePrompt delegates already).
export { ImpactDeletePrompt } from "./ImpactDeletePrompt";
export type {
  ImpactDeletePromptProps,
  ImpactReference,
} from "./ImpactDeletePrompt";

// Brief 70 Phase 1 — the mad-libs sentence grammar (Eligibility rules,
// FT axis choice, Algorithm bindings).
export { StatementComposer } from "./StatementComposer";
export type {
  ComposerOption,
  ComposerSlot,
  ComposerSlotKind,
  StatementComposerProps,
} from "./StatementComposer";

// Brief 70 Phase 1 — the canonical dimension language. shapeOf /
// SHAPE_META / countLabel extracted from dims2 (which re-consumes
// them); <DimToken> is the one way a dimension renders outside its
// home workspace.
export {
  DimToken,
  SHAPE_META,
  countLabel,
  shapeOf,
  shapeOfCanonical,
} from "./dimensionMeta";
export type { DimTokenProps, DimensionShape } from "./dimensionMeta";

// The one save-status pill (replaces the per-surface bespoke pills).
export { SavePill } from "./SavePill/SavePill";
export type { SavePillProps, SaveState } from "./SavePill/SavePill";

export { ParametrizeCanvas, levelsForKeying } from "./ParametrizeCanvas";
// Brief 67 §3.4 — armed factor-table delete (the platform pattern).
export { FactorTableDeletePrompt } from "./ParametrizeCanvas";
export type {
  FactorTableDeletePromptProps,
  FactorTableDeleteConsumer,
} from "./ParametrizeCanvas";
export type {
  ParametrizeCanvasProps,
  ParametrizeCanvasDraft,
  FactorTableSummary,
} from "./ParametrizeCanvas";

// Brief 53 — the canonical Building / BPP coverage structural dimension
// + its slug, seeded by the Parametrize "+ Coverage split" affordance.
export {
  CANONICAL_COVERAGE_DIMENSION,
  CANONICAL_COVERAGE_SLUG,
} from "./coverageDimension";

// Brief 33 PR 33.2 — FactorTableNode (axis-drop frame).
// The active-draft surface inside <ParametrizeCanvas>'s canvas mode.
// Native HTML5 drag-drop: dim chips put their slug in the
// `application/x-rater-dim` MIME; axis slots accept the drop +
// surface a visual drop-target highlight. Generate stays disabled
// until at least one axis is filled (per Brief 33 §−1 Q3 — 1-D
// tables are first-class).
//
// PR 33.3 — FactorTableNode also embeds <FactorTableGrid2D> when
// cells are materialized (replaces the axis-drop frame).
export { FactorTableNode } from "./FactorTableNode";
export type {
  FactorTableNodeProps,
  FactorTableNodeAxes,
  FactorTableNodeStatus,
} from "./FactorTableNode";

// Brief 33 PR 33.3 — FactorTableGrid2D (materialized 2-D grid).
// Embedded inside <FactorTableNode> once the user clicks Generate.
// 1-D when colAxis omitted; 2-D otherwise. Cells use cellKey() to
// derive Map keys ("rowId" for 1-D, "rowId::colId" for 2-D).
//
// PR 33.4 adds the selection model — click selects, double-click
// edits; Shift/⌘ extend / toggle; row/col/corner headers select
// their axis cells.
export {
  FactorTableGrid2D,
  cellKey,
  COL_VIRTUALIZE_THRESHOLD,
} from "./FactorTableGrid2D";
export type {
  FactorTableGrid2DProps,
  FactorTableGrid2DAxis,
  FactorTableGrid2DAxisValue,
} from "./FactorTableGrid2D";

// Brief 33 PR 33.4 — FactorTablePowerTools (bulk-edit toolbar).
// Sits above the materialized grid. Operates on the current cell
// selection: Set to constant, +/-N% multiplier, Clear.
export { FactorTablePowerTools } from "./FactorTablePowerTools";
export type { FactorTablePowerToolsProps } from "./FactorTablePowerTools";

// Brief 33 PR 33.7 — FactorTableCmdK (⌘K jump-to-cell palette).
// Opens on ⌘K when a factor-table draft is materialized. Token-
// match across row + col labels; Enter jumps; Escape closes.
export { FactorTableCmdK } from "./FactorTableCmdK";
export type { FactorTableCmdKProps } from "./FactorTableCmdK";

// Brief 33 PR 33.5 — CsvImportPreview2D (label-match drawer).
// Pre-import inspection drawer for 2-D factor table CSV. Matches
// CSV rows by LABEL (not position). User can re-key warn/bad rows
// via inline dropdowns; nothing commits until Apply. Pure pres.
// Ships with the matchCsv2D + parseCsv2D libraries — both pure
// functions consumable from non-React contexts.
export {
  CsvImportPreview2D,
  matchCsv2D,
  parseCsv2D,
} from "./CsvImportPreview2D";
export type {
  CsvImportPreview2DProps,
  CsvImport2D,
  ImportPreview2D,
  MatchedRow as CsvMatchedRow,
  UnmatchedRow as CsvUnmatchedRow,
  MissingDimLevel as CsvMissingDimLevel,
  CellDiff as CsvCellDiff,
  MatchQuality as CsvMatchQuality,
  MatchCsvOptions,
  ParseCsv2DOptions,
} from "./CsvImportPreview2D";

// Brief 30 PR 30.1 / PR 30.2 — Inline DimensionEditor stack.
//   PR 30.1: DimensionEditor shell + categorical body (LevelRowsTable
//            + UsedInPanel) — replaces <DimensionStandardDrawer>.
//   PR 30.2: banded body (lo/hi cells + BandedScrubberStrip wrapping
//            PR #175's scrubber) + GeneratePanel for equal-width /
//            log-scale band generation — replaces <DimensionBandedDrawer>.
// Future PRs add composite body (30.6), geographic/classification
// chrome wrap (30.6/30.7).
export {
  LevelRowsTable,
  UsedInPanel,
  DimensionDeletePrompt,
  GeneratePanel,
  slugifyLabel,
  // Pure utilities for consumers building banded patches outside
  // the editor (route handlers, fixture seeders, test scaffolds).
  applyGenerateRecipe,
  breakpointsToLevels,
  defaultBandId,
  defaultBandLabel,
  generateEqualWidthBands,
  generateLogScaleBands,
  hasHandTunedLevels,
  levelsToBreakpoints,
  patchBandedBoundary,
} from "./DimensionEditor";
export type {
  LevelRowsTableProps,
  LevelRow,
  LevelInlineWarning,
  UsedInPanelProps,
  DimensionReference,
  DimensionDeletePromptProps,
  GeneratePanelProps,
  BandedGenerateMethod,
  BandedGenerateRecipe,
} from "./DimensionEditor";

// ── M4.5 — Factor Tables section ────────────────────────────────
export { FactorTablesTable } from "./FactorTablesTable";
export type {
  FactorTableRow,
  FactorTablesTableProps,
} from "./FactorTablesTable";

// ── M4.6 — Curves section REMOVED (Brief 34 PR 34.7) ─────────────
//
// The legacy `<CurvesTable>` + `CurveRow` are gone. Brief 34
// supersedes Brief 19: a 1-D banded factor table renders via
// `<LineChart>` (PR 34.1) and that IS the curve visualization.

// ── 24.D — PARAMETRIZE workspace (Brief 24 v3 §2.3) ──────────
//
// REMOVED 2026-05-24 (Brief 33 cleanup). The legacy table-shaped
// `<ParametrizeWorkspace>` (Factor Tables list + drill-in route) is
// superseded by `<ParametrizeCanvas>` (Brief 33) — a dotted-grid
// canvas with dim-chip drag-onto-axes + materialized 2-D grid
// editor + chart pane + Power Tools + CSV/PDF ingestion. The
// "Saved tables" mode of <ParametrizeCanvas> covers the list-shape
// fallback when needed.

// ── 24.E — GATE workspace (Brief 24 v3 §2.4) ─────────────────
//
// Unifies Eligibility + Modifiers + Endorsements into one workspace.
// Brief 55 — the legacy read-only <GateWorkspace> (3-way accept /
// refer / decline) was deleted; <GateCanvas> is the authoring surface
// and <TierVerdictChip> renders the 4-tier verdict.

// ── 24.H — ASSEMBLE workspace REMOVED (replaced by 25.B
//         CalculationTower above). The AssembleWorkspace primitives
//         lived here until 2026-05-21; the surface is now the
//         vertical funnel from Brief 25. The Canvas primitive
//         (ADR-0024) stays available for future graph surfaces.

// ── 24.F — Workspace shell + tool pane primitives ────────────
//
// The consistent chrome every Brief 24 workspace inherits: header
// strip on top + ~268px tool pane on the left + content area on the
// right. The tool pane is the *authoring* surface; the content area
// is the *browsing* / canvas surface. Per
// docs/design-briefs/24f-workspace-shell.md.
export { WorkspaceShell } from "./WorkspaceShell";
export { WorkspaceToolPane } from "./WorkspaceShell";
export type {
  WorkspaceShellProps,
  WorkspaceToolPaneProps,
  WorkspaceToolPaneSectionProps,
  WorkspaceToolPaneButtonProps,
} from "./WorkspaceShell";

// ── Polish PR 6 — WorkspaceFrame (canonical 3-column geometry) ─
//
// The audit-prescribed shell that locks rail=240, stage=1fr,
// inspector=320, gap=0, no border/radius on the root. Supersedes
// the per-workspace bespoke grids (Dimensions/Gate/Parametrize/
// Assemble) that pixel-disagreed on column widths. See
// docs/design/UI_AUDIT.md §I.
export { WorkspaceFrame } from "./WorkspaceFrame";
export type { WorkspaceFrameProps } from "./WorkspaceFrame";

// ── 24.F2 — WorkspaceTabs (primary top-tab nav) ──────────────
//
// Replaces the 24.B left rail with a horizontal tab strip. Each tab
// is a Brief-24-v3 workspace (Inputs / Dimensions / Parametrize /
// Gate / Assemble / Verify). URL persistence happens at the route
// layer; the primitive is pure presentation.
export { WorkspaceTabs } from "./WorkspaceTabs";
export type {
  WorkspaceTabsProps,
  WorkspaceTabSpec,
} from "./WorkspaceTabs";

// ── Brief 70 §2 — the Algorithm substrate (post-cutover) ─────
//
// The Brief 25/35/48 spatial canvas (CalculationTower, CalcNode,
// the inventory rail, drop validation, TowerTabBar, TotalTowerCard,
// the ribbon, the build-up gutter, node selection) was DELETED with
// Brief 70 lock D2 — <BuildUpSheet> is the Algorithm surface. What
// remains is the projection substrate both directions of the
// autosave machinery and the sheet are built on.
export {
  stagesToTowerPlan,
  towerPlanToStages,
  // MVP-013 — the ONE public counting of the algorithm (chains · steps).
  countPublicAlgorithm,
  countTowerPlanSteps,
  SHEET_TAIL_STAGE_KINDS,
  defaultOperatorForNode,
  insertNodeAtEnd,
  insertNodeAtPosition,
  deleteEntryAt,
  deleteNodeById,
  changeOperatorAt,
  groupEntries,
  ungroupEntry,
  setRatingDimension,
  duplicateNode,
  renameNode,
  setChainBaseValue,
  setConstantValue,
  setFactorPredicate,
  setAxisSource,
  setTowerExposure,
  spawnTowersFromDim,
  addEmptyTower,
  TOTAL_TOWER_ID,
  TOTAL_TOWER_OUTPUT_FIELD,
  isTotalTower,
  getPerLevelTowers,
  shouldShowTotalTower,
  addTotalTower,
  removeTotalTower,
  computeTowerBuildUp,
  buildTowerValueResolver,
  premiumForTower,
  mapRunIssuesToTowerSteps,
  computeAllTowerStatuses,
  computeTowerStatus,
  isSubstantiveEntry,
  towerWillPrice,
  resolveIcon,
} from "./CalculationTower";
export type {
  PublicAlgorithmCounts,
  TowerMode,
  NodeCategory,
  NodeSubtype,
  Operator,
  ValueChip,
  NodeBadge,
  ModelInputSourceKind,
  ModelInputBinding,
  AxisSource,
  NodeRef,
  TowerNode,
  TowerGroup,
  TowerEntry,
  Tower,
  ConstantDef,
  ModelDef,
  TowerPlan,
  TowerProjectionOptions,
  FactorTableCatalogEntry,
  TowerPlanToStagesOptions,
  DimSpawnSpec,
  DimLevelSpawnSpec,
  TowerStatus,
  BuildUpStep,
  TowerBuildUp,
  ValueResolver,
  RunResultLike,
  RunIssueLike,
  ChainSpecForScoring,
  TowerIssueMap,
} from "./CalculationTower";


// ── 24.G — Canvas primitive (substrate; ADR-0024) ────────────
//
// Thin wrapper around @xyflow/react's <ReactFlow> with our design-
// token aesthetics applied (background, controls palette, edge
// stroke, node defaults). Substrate-only — no rate-lab UI mounts it
// yet; 24.H (ASSEMBLE workspace) will be the first consumer.
//
// Re-exports the library's types under our domain names so consumers
// depend on one place. Convenience helpers (applyNodeChanges,
// applyEdgeChanges, addEdge) are re-exported from @xyflow/react.
//
// Reverses ADR-0019's hand-roll precedent for canvases specifically;
// the build-vs-buy math doesn't hold once you need full
// graph-editor mechanics (drag, connect, marquee, zoom, viewport).
// See ADR-0024 for the full reasoning + when-to-revisit criteria.
export {
  Canvas,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "./Canvas";
export type {
  CanvasProps,
  CanvasNode,
  CanvasEdge,
  CanvasNodeChange,
  CanvasEdgeChange,
  CanvasConnection,
  CanvasNodeTypes,
  CanvasEdgeTypes,
} from "./Canvas";

// ── M4.7 — Modifiers (Brief 15) ─────────────────────────────────
export { ModifierScheduleTable } from "./ModifierScheduleTable";
export type {
  ModifierScheduleCategoryRow,
  ModifierScheduleTableProps,
} from "./ModifierScheduleTable";

// ── M4.8 / M4.9 / M4.10 — Loadings / Final Adjustments / Outputs ─
// REMOVED. The read-only <LoadingsTable>, <FinalAdjustmentsTable> and
// <OutputsTable> summary cards were dead after the v2 BuildUp / Assemble
// cutover — no JSX mount, no consumers. Their only fixtures
// (SAMPLE_OUTPUTS et al.) were already tombstoned in
// PlanDetailRoute. Components + row types (LoadingRow / FinalAdjustmentRow
// / OutputRow + their *Props) all deleted; preserved in git history.
// (The live <ClampStageDrawer> / <RoundStageDrawer> Final-Adjustment CRUD
// primitives below are unrelated and stay.)

// ── M4.12 — FlatFactorStageDrawer (CRUD for flat_factor stages) ─
export {
  FlatFactorStageDrawer,
  emptyFlatFactorDraft,
  isFlatFactorDraftComplete,
} from "./FlatFactorStageDrawer";
export type {
  FlatFactorDraft,
  FlatFactorStageDrawerProps,
} from "./FlatFactorStageDrawer";

// ── M4.15 — ClampStageDrawer + RoundStageDrawer (Final Adj CRUD) ─
export {
  ClampStageDrawer,
  emptyClampDraft,
  isClampDraftComplete,
} from "./ClampStageDrawer";
export type {
  ClampDraft,
  ClampStageDrawerProps,
} from "./ClampStageDrawer";

export {
  RoundStageDrawer,
  emptyRoundDraft,
  isRoundDraftComplete,
} from "./RoundStageDrawer";
export type {
  RoundDraft,
  RoundStageDrawerProps,
} from "./RoundStageDrawer";

// ── M4.11 — Final 3 sections (closes the 14-section spine) ──────
// All three are now REMOVED:
//   · <EligibilityRulesTable> — deleted in Brief 55; the Gate workspace
//     authors tiers via <GateCanvas>.
//   · <TerritoriesTable> + <EndorsementsTable> — dead after the v2
//     cutover (no JSX mount; their only fixtures, SAMPLE_
//     TERRITORIES / _ENDORSEMENTS, were unreferenced). Components + row
//     types (TerritoryRow / EndorsementRow + their *Props) deleted;
//     preserved in git history.

// ── M4.3 — Coverage Chains section (Brief 5) ───────────────────
export { RatingChainCard } from "./RatingChainCard";
export type {
  ChainFactor,
  ChainOperator,
  RatingChainCardProps,
} from "./RatingChainCard";

// ── M4.3.1 — ClassPicker (chain-factor-level; Brief 8 Phase 1) ─
export { ClassPicker } from "./ClassPicker";
export type { ClassPickerOption, ClassPickerProps } from "./ClassPicker";

// ── M4.3.2 — Chain factor kind picker (entry to factor editor) ─
export {
  ChainFactorKindSelect,
  FACTOR_KIND_HINTS,
  FACTOR_KIND_LABELS,
  FACTOR_KIND_OPTIONS,
} from "./ChainFactorKindSelect";
export type {
  ChainFactorKind,
  ChainFactorKindSelectProps,
} from "./ChainFactorKindSelect";

// ── M4.3.3 — FactorEditor (kind + per-kind config form) ────────
export {
  FactorEditor,
  emptyDraftForKind,
  isFactorDraftComplete,
} from "./FactorEditor";
export type { FactorDraft, FactorEditorProps } from "./FactorEditor";

// ── M4.3.4 — DimensionRefPicker (chain-factor-level) ───────────
export { DimensionRefPicker } from "./DimensionRefPicker";
export type {
  DimensionRefOption,
  DimensionRefPickerProps,
} from "./DimensionRefPicker";

// ── M4.3.5 — FactorTableRefPicker ──────────────────────────────
//
// (CurveRefPicker removed in Brief 34 PR 34.7 — curves no longer
// exist as a first-class concept; banded factor tables render as
// line charts via <FactorTableViz>.)
export { FactorTableRefPicker } from "./FactorTableRefPicker";
export type {
  FactorTableRefOption,
  FactorTableRefPickerProps,
} from "./FactorTableRefPicker";

// ── M4.3.7 — ChainFactorDrawer (drawer-wrap of FactorEditor) ───
export { ChainFactorDrawer } from "./ChainFactorDrawer";
export type { ChainFactorDrawerProps } from "./ChainFactorDrawer";

// ── M4.3.8a — FactorDraft → backend mutation adapter (pure) ───
export { factorDraftToMutation } from "./ChainFactorDrawer";
export type {
  FactorDraftAdapterContext,
  FactorDraftMutation,
} from "./ChainFactorDrawer";

// ── M4.3.9 — reverse adapter for edit-factor (FactorLookup → draft)
export { factorLookupToDraft } from "./ChainFactorDrawer";

// ── M5.1.1 / M5.1.2 / M5.1.3 / M5.1.9 — REMOVED 2026-05-24
//
// Brief 35.7 cleanup. The Brief 18 standalone factor-table editor path
// is gone. These 4 primitives were dedicated to the legacy
// /plans/:id/factor-tables/:tableId route (now a redirect to the
// Parametrize canvas) and had no other consumers:
//
//   - <FactorTableGrid> (M5.1.1) — 1-D virtualized table editor.
//     Superseded by <FactorTableGrid2D> (Brief 33) inside
//     <FactorTableNode> on the Parametrize canvas, which handles
//     1-D (`colAxis` omitted) AND 2-D in one primitive with
//     materialized cell editing + Power Tools + Insights panel.
//
//   - <FactorRowDrawer> (M5.1.2) — per-row edit drawer for a
//     legacy 1-D row. Superseded by inline cell editing on the
//     canvas grid + <LevelEditPopover> (Brief 30 PR 30.7) for
//     dim-level edits from within a factor table.
//
//   - <FactorTableEditor> (M5.1.3) — orchestrator that composed
//     Grid + RowDrawer + a header into the section-detail route.
//     Superseded by <ParametrizeCanvas> (Brief 33) — the entire
//     "open a factor table" UX now lives on the canvas.
//
//   - <FactorTableHistoryDrawer> (M5.1.9) — read-only audit log
//     surface for the legacy editor. The Phase B audit panel
//     (cross-cutting via TracePanel + plan-level history) is the
//     forward-looking story; no per-table history surface
//     remains in v1.
//
//   - <FactorTableImportDrawer> + ConflictPreview (M5.1.4),
//     FactorTableExport helpers (M5.1.5), and
//     <FactorTableCompareDrawer> (M5.1.6) — DELETED 2026-06-10
//     (Brief 67.5). Their claimed consumer (the TerritoriesRoute /
//     Territory drawers) never ported to openrater; every reference
//     was the barrel itself. CSV import is the canvas drawer
//     (CsvImportPreview2D) + catalog CSV-first creation now.

// ── M5.1.9 — FactorTableHistoryDrawer (Brief 18 PR #9) ─────────
//
// REMOVED 2026-05-24 (Brief 35.7 cleanup). See the M5.1.1-9 tombstone
// block above for the full reasoning.

// ── 26.P1 / Brief 27 PR 2 — BreakpointScrubber ─────────────────
//
// Hand-rolled SVG slider with N draggable handles. The primary
// authoring path for banded dimensions (continuous variables
// bucketed into bands — Building Age, TIV Tier, etc.). Pure
// presentation primitive; parent owns the breakpoint vector.
// Follows ADR-0019's hand-rolled-SVG-with-tokens convention.
//
// Brief 27 PR 2 added scale-adaptive density: `mode="auto"`
// (default) picks `full` for ≤ 10 bands, `compact` for 11+. In
// compact mode per-band text labels drop out (they'd overlap)
// and hover/focus tooltips replace them. Callers can override
// with `mode="full"` / `mode="compact"`.
export {
  BreakpointScrubber,
  formatNumber as formatScrubberNumber,
  resolveScrubberMode,
  COMPACT_MODE_THRESHOLD,
} from "./BreakpointScrubber";
export type {
  BreakpointScrubberProps,
  BreakpointScrubberMode,
} from "./BreakpointScrubber";

// ── 26.P1 — ChipInput (Brief 26 PR #6) ─────────────────────────
//
// Controlled chip-cloud editor — Enter / Tab / "," / blur commit;
// Backspace on empty removes; comma-paste auto-expands; ≤cap.
// Used by <LevelMappingRow> for categorical alias lists. Could
// also serve future label / tag editors.
export { ChipInput } from "./ChipInput";
export type { ChipInputProps } from "./ChipInput";

// ── 26.P1 — LevelMappingRow (Brief 26 PR #6) ───────────────────
//
// Kind-aware per-level row: chip-cloud aliases for categorical
// levels ("Restaurant" → 71641); lo/hi numeric inputs for banded
// levels; read-only territory_ref for geographic. Pure controlled
// component — consumed by future polish of the categorical drawer
// (Brief 26 §16 PR 7) and the banded drawer's band table.
export { LevelMappingRow } from "./LevelMappingRow";
export type {
  LevelMappingRowProps,
  LevelMappingRowLevel,
} from "./LevelMappingRow";

// ── 26.P1 — DimensionShapePicker (DELETED — Brief 27 PR 1) ─────
//
// The modal that asked the user which shape to add (categorical /
// banded / geographic / classification) is gone. Its job is now
// the persistent-tool-pane buttons on <DimensionsWorkspace> — see
// Brief 27 §3 and the workspace export above. `DimensionShapeChoice`
// keeps its name and is re-exported from <DimensionsWorkspace>.

// ── 26.P1 — FactorTableMatrix — DELETED 2026-06-10 (Brief 67.5).
// The 2-D matrix mode shipped INTO the canvas grid (FactorTableGrid2D,
// Brief 33); this sibling editor was never mounted in openrater.

// ── 26.P1 — DimensionBandedDrawer (DELETED — Brief 30 PR 30.2) ─
//
// The headline new authoring surface from Brief 26 — a side drawer
// for banded dimensions. Brief 30 PR 30.2 deleted it in favor of
// the inline editor's banded body (lo/hi cells + scrubber strip +
// Generate panel). All four legacy exports
// (DimensionBandedDrawer / emptyDimensionBandedDraft / rebucket*)
// are replaced by primitives from `./DimensionEditor`. See the
// DimensionEditor export block above.

// ── M5.2.x — CurvePlot / CurveBreakpointTable / CurveFormPicker /
//          CurvePresetGallery / CurveEditor / CurveImportDrawer /
//          CurveFitDrawer / CurveCompareDrawer / CurveHistoryDrawer
//
// REMOVED in Brief 34 PR 34.7. Brief 19's hand-rolled curve stack
// is superseded by Brief 34's <FactorTableViz> (1-D banded factor
// tables render via <LineChart>, the canonical curve visualization).

// ── Brief 20 surface removed — Brief 44 PR 44.12 ────────────────
//
// The full Brief 20 territory-map authoring stack — TerritoryMap,
// TerritoryMapEditor, TerritoryBoundaryListEditor, TerritoryImport-
// Drawer, CoverageDiagnosticsDrawer, TerritoryCompareDrawer,
// TerritoryHistoryDrawer — is gone. Brief 44 supersedes:
//   · GeoMapEditor replaces TerritoryMap (one MapLibre primitive
//     for both editor + analytics + factor-table reuse).
//   · GeoDimEditor + GeoDimWizard replace TerritoryMapEditor.
//   · TerritoryGrouping (PR 44.7) replaces the territory-grouping
//     side of the editor.
//   · The unified `geographic` Dimension subtype (PR 44.1
//     substrate) replaces the standalone TerritorySchema entity.
//
// Pure helpers from Brief 20 (boundary types, CSV schema, USPS/
// FIPS validators) survive in @openrater/contracts/territory-types
// only because migrateTerritorySchemaToGeoDim (PR 44.9) needs
// them as input types. Everything else is gone.

// Brief 34 PR 34.1 — Chart primitives (1-D).
// Hand-rolled SVG charts for factor-table visualization. Shared
// axis math (computeYTicks / computeXPositions / pickVisibleXLabels)
// lives in @openrater/ui/LineChart and is consumed by both charts.
//
// <LineChart> — 1-D banded (ordered) — polyline + markers with
// monotonicity-break outlier highlighting.
// <BarChart> — 1-D categorical (unordered) — bars tinted by
// deviation from baseline (azure < 1 < orange).
export { LineChart, formatTickLabel } from "./LineChart";
export type { LineChartProps, LineChartDatum } from "./LineChart";
export {
  computeYTicks,
  computeXPositions,
  pickVisibleXLabels,
  valueToY,
  CHART_VIEWBOX,
  PLOT_INSET,
  DEFAULT_BASELINE,
} from "./LineChart";
export type { YTick } from "./LineChart";

export { BarChart } from "./BarChart";
export type {
  BarChartProps,
  BarChartDatum,
  BarChartSortMode,
} from "./BarChart";



// Brief 34 PR 34.2 — Chart primitives (2-D).
// <HeatmapGrid> — 2-D categorical × categorical. The grid IS the
// chart (cell-background encoding via 7-bucket heatBucket).
// <LineMultiples> — 2-D banded × categorical small multiples. One
// line per col; all-default cols get the dashed-gray treatment.
export { HeatmapGrid } from "./HeatmapGrid";
export type { HeatmapGridProps } from "./HeatmapGrid";
export {
  heatBucket,
  formatHeatCell,
  HEAT_BASELINE,
  HEAT_LEGEND_ENTRIES,
} from "./HeatmapGrid";
export type { HeatBucket } from "./HeatmapGrid";

export {
  LineMultiples,
  LINE_MULTIPLES_PALETTE,
} from "./LineMultiples";
export type { LineMultiplesProps } from "./LineMultiples";

// Brief 34 PR 34.3 — Auto-insights DSL + panel.
// Pure, deterministic, hand-rolled. Each generator is composable
// and individually testable. `runInsights()` orchestrates them.
// `<InsightsPanel>` renders the resulting list with severity
// variants + optional click-to-jump per anchored insight.
export {
  InsightsPanel,
  INSIGHTS_DEFAULT_LIMIT,
  runInsights,
  generateRange,
  generateMonotonicityBreak,
  generateOutlier,
  generateAllDefault,
  generateDiagonalSmooth,
  generateAllOnSide,
  generateNarrowSpread,
  INSIGHTS_BASELINE,
} from "./InsightsPanel";
export type {
  InsightsPanelProps,
  Insight,
  InsightInput,
  InsightKind,
  InsightSeverity,
  CellAnchor as InsightCellAnchor,
} from "./InsightsPanel";

// Brief 34 PR 34.4 — FactorTableViz orchestrator + split-view glue.
// Auto-picks the chart per table shape, surfaces a pill picker
// for user override, composes InsightsPanel below. Mounts in
// FactorTableNode via the new `chartPane` slot.
export { FactorTableViz } from "./FactorTableViz";
export type { FactorTableVizProps } from "./FactorTableViz";
export {
  resolveChartType,
  availableChartTypes,
  DEFAULT_VIZ_CONFIG,
} from "./FactorTableViz";
export type {
  ChartType,
  VizConfigChartType,
  VizConfig,
  TableShape,
  PickerEntry,
} from "./FactorTableViz";

// ── Brief 45 PR 45.1 — Chart-experience redesign primitives ─────
//
// `<FactorVizHeroStrip>` renders the three KPIs (Mean / Range /
// Coverage) above every chart pane (§−1 Q7 lock). The helper
// modules — `colorRamp` (continuous gradient) + `factorStats`
// (the underlying KPI math + uniformity test) — are re-exported
// from FactorTableViz so the chart primitives in PRs 45.2-45.5
// can pull them via a single path.
export { FactorVizHeroStrip } from "./FactorVizHeroStrip";
export type { FactorVizHeroStripProps } from "./FactorVizHeroStrip";

// Brief 45 PR 45.2 — Rich tooltip primitive + its pure data adapter.
export { FactorTooltip } from "./FactorTooltip";
export type {
  FactorTooltipProps,
  FactorTooltipAnchor,
} from "./FactorTooltip";

// Brief 45 PR 45.4 — Dense-mode primitives: histogram + outliers.
export { FactorDistribution } from "./FactorDistribution";
export type { FactorDistributionProps } from "./FactorDistribution";

export { OutlierDrawer } from "./OutlierDrawer";
export type { OutlierDrawerProps } from "./OutlierDrawer";

// ── Brief 64 PR 64.2 — Analytics v2 Overview "Rate Drivers" tornado ──
export { RateDriversList } from "./RateDriversList";
export type { RateDriversListProps, RateDriverSort } from "./RateDriversList";

// Brief 64 PR 64.2 — the type-adaptive detail exhibit (click a driver).
export { DimensionDetailExhibit } from "./AnalyticsWorkspace/DimensionDetailExhibit";
export type { DimensionDetailExhibitProps } from "./AnalyticsWorkspace/DimensionDetailExhibit";

// Brief 64 PR 64.1 — Analytics v2 pure math (consumed by the route wiring).
export { computePlanOverview } from "./AnalyticsWorkspace/overview-math";
export type {
  PlanOverview,
  VariableOverview,
  OverviewVariableSpec,
  OverviewLevelDef,
  OverviewVariableKind,
} from "./AnalyticsWorkspace/overview-math";
// `binIndexForValue` stays module-internal — FactorTableViz already exports
// a same-named helper for its factor histogram (different domain).
export { computeEqualCountBins } from "./AnalyticsWorkspace/binning";
export type {
  EqualCountBin,
  EqualCountBinning,
  EqualCountGroups,
} from "./AnalyticsWorkspace/binning";

// Brief 64 PR 64.4 — Compare act: portfolio dislocation.
export { computeDislocation } from "./AnalyticsWorkspace/dislocation";
export type {
  Dislocation,
  DislocationSummary,
  DislocationBin,
} from "./AnalyticsWorkspace/dislocation";
export { DislocationExhibit } from "./AnalyticsWorkspace/DislocationExhibit";
export type { DislocationExhibitProps } from "./AnalyticsWorkspace/DislocationExhibit";

// Brief 64 PR 64.4 — Compare act: impact-by-variable + staleness banner.
export { computeImpactByVariable } from "./AnalyticsWorkspace/impact";
export type {
  VariableImpact,
  ImpactByVariableResult,
  ComputeImpactArgs,
} from "./AnalyticsWorkspace/impact";
export { ImpactByVariable } from "./AnalyticsWorkspace/ImpactByVariable";
export type { ImpactByVariableProps } from "./AnalyticsWorkspace/ImpactByVariable";
export { StalenessBanner } from "./AnalyticsWorkspace/StalenessBanner";
export type { StalenessBannerProps } from "./AnalyticsWorkspace/StalenessBanner";

// Brief 64 PR 64.5 — Present act: on-screen executive summary.
export { ExecutiveSummary } from "./AnalyticsWorkspace/ExecutiveSummary";
export type {
  ExecutiveSummaryProps,
  ExecMover,
} from "./AnalyticsWorkspace/ExecutiveSummary";

// Brief 64 PR 64.6 — the three-act Analytics orchestrator (Overview /
// Compare / Present). Replaces the Brief 43 single-slice <AnalyticsWorkspace>.
export { AnalyticsWorkspaceV2 } from "./AnalyticsWorkspace/AnalyticsWorkspaceV2";
export type { AnalyticsWorkspaceV2Props } from "./AnalyticsWorkspace/AnalyticsWorkspaceV2";

// Brief 89 §3 (89.3) — analytics before data: probe mode + the rate card.
// Brief 93 (93.1) — the plan report replaced <AnalyticsProbeMode>.
export { PlanReport } from "./AnalyticsWorkspace/PlanReport";
export type { PlanReportProps } from "./AnalyticsWorkspace/PlanReport";
// Brief 93 (93.2) — the gates section's row builder (the route feeds
// it the appetite read model + field meta).
export { buildGateRows } from "./AnalyticsWorkspace/report-gates";
export type { ReportGateRow } from "./AnalyticsWorkspace/report-gates";
// Brief 93 (93.3) — the worked-examples workbook variant (the route
// feeds it the persisted build report).
export { buildVerifiedExamples } from "./AnalyticsWorkspace/report-examples";
export type { VerifiedExamples } from "./AnalyticsWorkspace/report-examples";
export { RateCardExhibit } from "./AnalyticsWorkspace/RateCardExhibit";
export type { RateCardExhibitProps } from "./AnalyticsWorkspace/RateCardExhibit";
export { StructuralDrivers } from "./AnalyticsWorkspace/StructuralDrivers";
export { computeStructuralDrivers } from "./AnalyticsWorkspace/probe-math";
export type { StructuralDriver } from "./AnalyticsWorkspace/probe-math";

// Brief 89 §3.2 B3 (89.4) — the probe book: sweep + readout + card.
export { ProbeBookCard } from "./AnalyticsWorkspace/ProbeBookCard";
export type {
  ProbeBookCardProps,
  ProbeBookState,
} from "./AnalyticsWorkspace/ProbeBookCard";
export {
  buildProbeSweep,
  buildDefaultProbeSweep,
  analyzeProbeRows,
  dimInputKeys,
} from "./AnalyticsWorkspace/probe-math";
export type {
  ProbeSweep,
  ProbeResultRow,
  ProbeReadout,
  ProbeVariableReadout,
} from "./AnalyticsWorkspace/probe-math";

// Brief 64 PR 64.3 — territory map grouping type (route builds these).
export type { MapTerritory } from "./AnalyticsWorkspace/MapPanel";

export {
  factorGradient,
  factorGradientLegend,
  FACTOR_GRADIENT_MIN,
  FACTOR_GRADIENT_MAX,
  FACTOR_GRADIENT_NEUTRAL,
  computeFactorStats,
  isUniform,
  formatFactorValue,
  formatCoverageFraction,
  formatCoveragePercent,
  UNIFORM_THRESHOLD,
  computeFactorTooltipData,
  computePercentile,
  formatPercentileLabel,
  formatDeviationLabel,
  computeFactorDistribution,
  sturgesBinCount,
  formatBinLabel,
  binIndexForValue,
  isDense,
  MAX_BINS,
  MIN_BINS,
  DEFAULT_OUTLIER_COUNT,
  DENSE_THRESHOLD,
} from "./FactorTableViz";
export type {
  GradientLegendStop,
  FactorCellValue,
  FactorStats,
  FactorTooltipData,
  FactorDatum,
  GetChainReferences,
  ComputeFactorTooltipDataArgs,
  FactorDistributionPayload,
  FactorDistributionDatum,
  HistogramBin,
  OutlierEntry,
  ComputeFactorDistributionArgs,
} from "./FactorTableViz";

// ── Brief 38 PR 38.2 — InputsWorkspace auto-recognition ─────────
//
// Pure module: given a plan's required inputs + a source's columns +
// (optional) sample rows + (optional) dimensions for value-matching,
// returns confidence-scored candidate columns per input. v1 ships
// with name-match (Levenshtein + token + containment) + value-match
// (alias-resolved against dim levels) blended at 0.6 / 0.4. The
// `<ColumnMappingTable>` primitive (PR 38.3) consumes this output to
// pre-fill the mapping UI.
export {
  autoMatchColumns,
  bucketConfidence,
  scoreCandidate,
  levenshtein,
  nameSimilarity,
  tokenize,
} from "./InputsWorkspace";
export type {
  AutoMatchOptions,
  MatchCandidate,
  MatchDtype,
  RequiredInput,
  SourceColumn,
} from "./InputsWorkspace";

// ── Brief 38 PR 38.3 — ColumnMappingTable primitive ─────────────
//
// The core mapping UX from Frames 2-4 of the Brief 38 mockup. A
// sectioned table of required-input rows × source-column dropdowns,
// with confidence chips + status badges + sample values. Controlled
// (parent owns the mapping value + onChange). Composes Combobox
// from @openrater/design-system for the source-column picker.
//
// Sub-primitives + helpers:
//   - applyAutoMatchToMapping(inputs, candidates, current, opts)
//     translates autoMatch output into a draft mapping with
//     first-come-first-served conflict resolution
//   - deriveMappingStatus(value, candidates, isMismatched)
//     decides which status pill to show per row
// (the v1 <ColumnMappingTable> primitive was deleted in the v2 cutover;
//  its types are reused by the deriver + InputsPanelV2)
export type {
  RequiredInputCategory,
  RequiredInputEntry,
  MappingFilter,
} from "./InputsWorkspace";

// ── Brief 49 — Create inputs from CSV columns ───────────────────
// Pure transform backing the empty-state "Create inputs from these
// columns" CTA: columns + sample rows → DimensionRow[] + slug→column map.
export { buildInputsFromCsvColumns } from "./InputsWorkspace";
export type {
  BuildInputsOptions,
  BuildInputsResult,
} from "./InputsWorkspace";

// ── Brief 50 — Route match confidence ───────────────────────────
// Pure scoring for the external-lookup review gate: compares the value
// searched by against the value returned (echo_of outputs) → badge level.
export {
  matchConfidence,
  MATCH_STRONG_THRESHOLD,
  MATCH_PARTIAL_THRESHOLD,
} from "./InputsWorkspace";
export type {
  MatchConfidence,
  MatchConfidenceLevel,
} from "./InputsWorkspace";

// ── Brief 62.3 — cohort Final-adjustments tail (the I8-close path) ──
export { applyCohortPolicyTail } from "./InputsWorkspace";
export type { CohortRowTail, ApplyCohortPolicyTailArgs } from "./InputsWorkspace";

// ── Brief 62.4 — the plan's Final-adjustments tail editor ──
export { FinalAdjustmentsEditor } from "./FinalAdjustmentsEditor";
export type {
  FinalAdjustmentsEditorProps,
  ConnectorOption,
} from "./FinalAdjustmentsEditor";

export {
  applyAutoMatchToMapping,
  deriveMappingStatus,
} from "./InputsWorkspace";
export type {
  ApplyAutoMatchOptions,
  ApplyAutoMatchResult,
  MappingStatus,
} from "./InputsWorkspace";

// ── Brief 38 PR 38.4 — Mismatch detection + banner ─────────────
//
// detectMismatches walks the column_map + sample rows + dimensions
// to surface HARD (red, blocks scoring) and SOFT (yellow, suggested
// fix) mismatches with Levenshtein-ranked suggestions. The
// <MismatchBanner> renders one card per detected mismatch with
// Apply / Reject / Edit aliases actions. Alias write-back helpers
// (applyAliasOverride, removeAliasOverride, appendDimAlias) are
// immutable updaters that pair with Plan.input_mapping.alias_overrides
// (PR 38.1) + Brief 30 dim aliases.
// (the v1 <MismatchBanner> primitive was deleted in the v2 cutover —
//  InputsPanelV2 renders mismatches inline-on-the-row)
export {
  detectMismatches,
  hasHardMismatch,
  mismatchedInputIds,
  applyAliasOverride,
  removeAliasOverride,
  appendDimAlias,
} from "./InputsWorkspace";
export type {
  AliasOverrides,
  DetectMismatchesOptions,
  Mismatch,
  MismatchedValue,
  MismatchSuggestion,
} from "./InputsWorkspace";

// ── Cold-test L22 — out-of-range banded-value detection ─────────
// detectOutOfRange scans run-result traces for `derive.band` nodes
// that flagged a value outside every band. Pairs with the
// `clampToNearest` projector default so the ScoringPreviewPane can
// loudly report clamped rows instead of letting them silently price
// at the neutral 1.0 factor.
export { detectOutOfRange, hasOutOfRange } from "./InputsWorkspace";
export type { OutOfRangeBand } from "./InputsWorkspace";

// ── Brief 38 PR 38.5 — DataSourcePicker + CSV upload ───────────
//
// The top-bar source toggle (CSV / Webhook) plus the dropzone +
// loaded-summary primitives for the CSV variant of Brief 38's source
// picker. Composes the parseCsv pure module that produces
// CsvSourceSnapshot (columns + sample rows + inferred dtypes +
// warnings) — the shape downstream PRs (mapping table,
// detectMismatches, scoring preview) consume.
//
// Pure presentation; no I/O beyond FileReader for file uploads.
// State (source kind, loaded CSV) lives in the orchestrator (PR 38.8).
// (the v1 picker/dropzone/summary primitives were deleted in the v2
//  cutover; SampleDataset + SourceKind are reused)
export type {
  SampleDataset,
  SourceKind,
} from "./InputsWorkspace";

export { parseCsv, parseCsvForInputs } from "./InputsWorkspace";
export type {
  CsvParseError,
  CsvParseFailure,
  CsvParseResult,
  CsvParseSuccess,
  CsvParseWarning,
  CsvSourceSnapshot,
  ParseCsvForInputsOptions,
  ParseCsvOptions,
} from "./InputsWorkspace";

// ── Brief 45 K11 — off-main-thread CSV parsing wrapper ─────────
export { parseCsvForInputsAsync } from "./InputsWorkspace";

// ── Brief 38 PR 38.6 — ScoringPreviewPane + projectRows ─────────
//
// The right-pane live preview: projects N rows through executePlanBatch
// on every mapping change and renders the result with a "Live · Xms"
// timing badge. Brief 38 P3 perf gate (sub-100ms re-score). Composes
// projectRowsForBatch — the pure module that bridges CSV row data to
// the engine's externalInputs shape (column mapping + alias overrides +
// dtype coercion).
// (the v1 <ScoringPreviewPane> was deleted in the v2 cutover —
//  InputsPanelV2 scores inline via these projectors)
export {
  projectRow,
  projectRows,
  projectRowsToExternalInputs,
} from "./InputsWorkspace";
export type {
  InputDimMap,
  InputDtypeMap,
  ProjectRowOptions,
  ProjectRowError,
  ProjectedRow,
} from "./InputsWorkspace";

// ── Brief 38 PR 38.7 — WebhookConfigDrawer + auth + test-request
//
// The Q7 ★ pivot drawer (URL + method + headers + 4 auth modes with
// env-var indirection + payload schema with auto-infer + test
// request). Composes inferPayloadSchema (pure JSON walker) and
// testWebhookRequest (reference fetch impl). Save persists to
// Plan.input_mapping.source via PR 38.1's substrate.
// (the v1 <WebhookConfigDrawer> primitive was deleted in the v2 cutover;
//  WebhookSource (v2) composes these helpers)
export {
  emptyWebhookConfig,
  applyAuthToHeaders,
  testWebhookRequest,
} from "./InputsWorkspace";
export type {
  WebhookConfig,
  WebhookTestResult,
} from "./InputsWorkspace";

// ── PR 11h — Required-inputs derivation (Brief 38 §4.2) ────────
//
// Walks plan stages to derive the canonical required-inputs list.
// Replaces the consumer-site duck-typing that only saw input_node
// stages (the gap the user surfaced post-PR-11b verification).
// `RequiredInputCategory` re-exported earlier via ColumnMappingTable.
export {
  deriveRequiredInputs,
  normalizeRequiredInputPath,
} from "./InputsWorkspace";
export type {
  DerivedRequiredInput,
  DeriveRequiredInputsStage,
} from "./InputsWorkspace";

// ── PR D2a — Stages → runtime Plan projector ─────────────────────
//
// Wires authored multiplicative_chain stages + client-side factor
// tables into a runtime Plan that scores premiums. Consumer-facing
// counterpart to deriveRequiredInputs (one tells you what to ask the
// user for, the other tells the runtime how to compute).
export {
  stagesToRuntimePlan,
  PROJECTOR_EXECUTED_STAGE_KINDS,
} from "./InputsWorkspace";
export type {
  FactorTableCellsMap,
  ProjectionResult,
  StagesToRuntimePlanOptions,
} from "./InputsWorkspace";
// Brief 48 §3.4 / phase 3 — representative-risk synthesizer for scored Verify.
export { synthesizeRepresentativeRisk } from "./InputsWorkspace";

// G-5 — Chunked batch scoring (perf fix; preserves order + count).
export {
  executePlanBatchChunked,
  shouldUseChunkedScoring,
  DEFAULT_CHUNK_SIZE,
} from "./InputsWorkspace";
export type {
  BatchProgress,
  ExecutePlanBatchChunkedOptions,
} from "./InputsWorkspace";

export { inferPayloadSchema } from "./InputsWorkspace";
export type {
  InferPayloadSchemaOptions,
  InferPayloadSchemaResult,
  InferPayloadSchemaWarning,
  PayloadSchemaField,
} from "./InputsWorkspace";

// ── Brief 38 PR 38.8 — InputsWorkspace orchestrator ────────────
//
// The closure: composes all 6 prior PR primitives into a single
// workspace primitive. Consumes a Plan + RequiredInputs +
// Dimensions + the current PlanInputMapping; emits mapping
// mutations through onMappingChange. Optional multi-product tab
// support via productMode. Closes Brief 38 — cold-test rubric
// at docs/cold-tests/brief-38-inputs-workspace.md.
// (the v1 InputsWorkspace orchestrator COMPONENT + Brief 61 <InputTable>
//  were deleted in the v2 cutover — InputsPanelV2 + DictionaryTable
//  replace them; these are the shared substrate types + pure helpers)
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

// ── Brief 55 — TierVerdictChip (the 4-tier eligibility verdict) ──
export { TierVerdictChip, TIER_CHIP_TONE } from "./TierVerdictChip";
export type { TierVerdictChipProps } from "./TierVerdictChip";

// ── E08/E03 brief D6 — PolicyRollupPanel ────────────────────────
// The grouped multi-location scoring result: one row per policy (its
// appetite verdict + rolled-up fields), expandable to the per-location
// contributions. Consumes `evaluatePolicyBook` output (PolicyBookResult[]).
export { PolicyRollupPanel } from "./PolicyRollupPanel";
export type { PolicyRollupPanelProps } from "./PolicyRollupPanel";

// ── Brief 39 PR 39.2 — FilterRuleEditor ─────────────────────────
//
// Authoring surface for one filter rule (eligibility / appetite
// gate). Quick-form (default) up to 3 AND-joined conditions OR
// Advanced read-only tree visualization. Brief 55 — native 4-tier
// picker (preferred / standard / submit / decline) via
// <TierVerdictChip>. Used by <GateCanvas> (PR 39.5). Reuses Brief
// 38's hard-mismatch banner when conditions reference unmapped
// input fields.
export {
  FilterRuleEditor,
  emptyFilterRuleDraft,
  isFilterRuleDraftValid,
  isConditionRowValid,
  getReferencedFields,
  FILTER_OPS,
  FILTER_OP_LABELS,
} from "./FilterRuleEditor";
export type {
  FilterOp,
  FilterConditionRow,
  FilterRuleDraft,
  FilterFieldRef,
  FilterRuleEditorProps,
} from "./FilterRuleEditor";

// ── E03 / brief D3 — ComputedExprEditor ─────────────────────────
//
// Author a derived computed field (tiv = building_limit + bpp_limit)
// as a closed arithmetic AST (`ComputedExpr` from @openrater/contracts) —
// a flat left-to-right sequence of input/constant operands joined by
// + − × ÷, with a live formula + value preview. Surfaced in the
// InputEditorDrawer's "Derived (computed)" source.
export {
  ComputedExprEditor,
  flattenComputedExpr,
  buildComputedExpr,
} from "./ComputedExprEditor";
export type { ComputedExprEditorProps } from "./ComputedExprEditor";

// ── Brief 39 PR 39.3 — ModifierEditor ───────────────────────────
//
// One editor, three modes per Brief 39 §−1 Q2 lock: Schedule
// (IRPM-style categories with ±N% + cap), Flat (single factor or
// additive amount), Provision (fixed multiplier). All three share
// the head + kind picker + citation; fields hide/show by selected
// kind. Used by <GateCanvas> (PR 39.5).
export {
  ModifierEditor,
  emptyModifierDraft,
  emptyCategoryRow,
  isModifierDraftValid,
  computeCategoryRangeSums,
} from "./ModifierEditor";
export type {
  ModifierKind,
  ModifierFlatEffect,
  ModifierAppliesTo,
  ModifierCategoryRow,
  ModifierDraft,
  ModifierEditorProps,
} from "./ModifierEditor";

// ── Brief 39 PR 39.4 — EndorsementEditor ────────────────────────
//
// Authoring surface for one endorsement (form-based add-on that
// auto-attaches when its trigger matches the input). Three effect
// kinds per Brief 39 §−1 Q4 lock: factor (multiply premium),
// additive (flat $ amount), sublimit (cap coverage). Form number
// is free-text + suggested ISO BOP fixtures dropdown (Q9 lock).
// Trigger uses single-condition v1 mirroring the substrate's
// EndorsementTrigger shape (PR 39.1). Reuses the hard-mismatch
// banner pattern when trigger references unmapped input fields
// (Q3 STRICT lock — PR 39.6 wires the validation).
export {
  EndorsementEditor,
  emptyEndorsementDraft,
  isEndorsementDraftValid,
  isTriggerRowComplete,
  getReferencedFields as getEndorsementReferencedFields,
  DEFAULT_FORM_SUGGESTIONS,
  ENDORSEMENT_OPS,
  ENDORSEMENT_OP_LABELS,
} from "./EndorsementEditor";
export type {
  EndorsementOp,
  EndorsementEffectKind,
  EndorsementTriggerRow,
  EndorsementDraft,
  EndorsementFieldRef,
  EndorsementFormSuggestion,
  EndorsementEditorProps,
} from "./EndorsementEditor";

// ── Brief 70 §3 — the GateCanvas died with the cutover ──────────
//
// The 3-pane Gate orchestrator + its inventory/validation helpers
// were deleted: <AppetiteStatement> is the Eligibility surface, and
// modifiers/endorsements author as the Algorithm's Final-adjustments
// tail (the Brief 39 editor primitives above survive as those
// editors; rate-lab's integrations/tailSync owns the conversions).


// Phase H.6 — ClampVisualizer (Brief 41 §−1 Q3).
// Compact SVG number-line showing a modifier.model clamp envelope.
// Consumed by ModifierEditor's "Model" tab + (deferred) the trace
// step renderer that surfaces "factor_used" against its filed cap.
export { ClampVisualizer, computeXBounds, factorToX } from "./ClampVisualizer";
export type { ClampVisualizerProps } from "./ClampVisualizer";

// ── Brief 43 PR 43.1 — FreezeVersionDialog ──────────────────────
//
// "Save a version…" (Brief 84 copy): names + saves the current draft
// as an immutable checkpoint WITHOUT changing what callers get. Pure
// presentation — the caller wires `useFreezeSnapshot`.
export { FreezeVersionDialog } from "./FreezeVersionDialog";
export type { FreezeVersionDialogProps } from "./FreezeVersionDialog";

// ── Brief 84 D-B — GoLiveDialog: the ONE deploy verb ────────────
//
// Go live (first) / Publish update (after): freeze + publish in one
// confirm, with the honest what-happens list. The caller wires the
// api-client `goLive` and maps the 409 collision to `errorMessage`.
export { GoLiveDialog } from "./GoLiveDialog";
export type { GoLiveDialogProps } from "./GoLiveDialog";

// ── Brief 43 PR 43.2-43.5 — AnalyticsWorkspace ──────────────────
//
// PR 43.2 shipped the shell + 3 v1 empty-state cards.
// PR 43.3 added the top toolbar (4 pickers + Export button).
// PR 43.4 added the chart exhibit + exhibit-math module.
// PR 43.5 adds the map exhibit (tile-grid US choropleth) + the
// bucketing math + the state grid layout.
export {
  // Brief 64 — the v1 <AnalyticsWorkspace> component was removed (replaced
  // by <AnalyticsWorkspaceV2>); the KPI catalog now lives in analytics-types
  // and is re-exported through the AnalyticsWorkspace folder index.
  ANALYTICS_KPIS,
  computeSliceExhibit,
  formatKpiValue,
  formatDeltaPct,
  deltaTone,
  kpiValue,
  bucketForValue,
  bucketMap,
  STATE_TILE_GRID,
  STATE_CODES,
  // PR 43.6.a — scored-result persistence bridge
  runRowsToScoredBatchResult,
  toScoredBatchResult,
  persistScoredResult,
  loadScoredResult,
  clearScoredResult,
  resolvePremiumColumn,
  // The synthesized-column contract + THE plan-premium resolver for
  // total-less plans (#482/#483 seams; hoisted 93.4 — the scoring
  // service imports the same module, so there is no browser twin).
  COVERAGE_SUM_COLUMN,
  COVERAGE_SUM_COLUMN_LABEL,
  isTotalLessMultiCoverage,
  resolvePlanPremiumContext,
  sumMoneyFields,
  totalLessTailRefusalMessage,
  // The BOOK's premium basis — the mapping's `rollup_fields` on top of
  // the plan's declarations. Shared with the scoring service's two
  // composers so the browser's LOCAL policy roll-up resolves the same
  // basis the run will.
  declaredPremiumRollup,
  extraPolicyRollupFields,
  isCoverageSumBook,
  premiumBasisField,
  rolledPolicyPremium,
  // G-4 — Loss column auto-detect for the LR KPI.
  resolveLossColumn,
  // Brief 43 §6.1 / ADR-0041 Phase 2 — staleness fingerprint.
  computeScoringFingerprint,
  // PR 43.6.d — per-snapshot re-rate. Footer helpers
  // (exhibitRowCount / formatRelativeTime) are intentionally NOT
  // re-exported at the top level — the workspace uses them
  // internally, and the existing PlanStatusBar.formatRelativeTime
  // already occupies that name with a different signature.
  rerateSnapshotRows,
  // Re-rate fix — substrate snapshot body → runtime Plan projector.
  snapshotBodyToRuntimePlan,
  // ADR-0055 — both-shape readers for the body's singleton substrates
  // (the API serializes them as ENVELOPES; fixtures may carry them bare).
  snapshotBodyInputMapping,
  snapshotBodyPolicyTail,
  // PR 43.7 — Export scored CSV.
  buildAnalyticsScoredCsv,
  analyticsScoredCsvFilename,
  // Cold-test L27 — premium-metric column discovery for the multi-LOB
  // Analytics metric picker.
  derivePremiumMetricColumns,
  defaultPremiumMetricColumn,
} from "./AnalyticsWorkspace";
export type {
  AnalyticsKpiId,
  AnalyticsKpiSpec,
  AnalyticsSliceOption,
  AnalyticsSnapshotSummary,
  // L32 — persisted view-state shape (slice / level / kpi / metric).
  AnalyticsViewState,
  AnalyticsScoredRow,
  ScoredBatchResult,
  LevelStat,
  SliceExhibit,
  PremiumMetricOption,
  ChoroplethBucket,
  StateCode,
  ToScoredBatchResultArgs,
  BuildAnalyticsScoredCsvOptions,
} from "./AnalyticsWorkspace";

// Brief 44 PR 44.2 — Geographic dim creation wizard. Three-step flow
// (granularity → scope → review) producing a GeoDimDraft ready for
// the upsert mutation. Lands ahead of the GeoDimEditor (PR 44.3) so
// the dimension subtype has a producer-side entry point.
// NOTE: STATE_CODES is intentionally not re-exported at this top level
// because AnalyticsWorkspace already owns that name (tile-grid order).
// Consumers needing the alphabetical seed order import from the sub-
// path `@openrater/ui/GeoDimWizard` or derive it from `STATE_SEED`.
export {
  GeoDimWizard,
  STATE_SEED,
  STATE_LABEL_BY_CODE,
  COUNTY_SEED,
  getLevelsForScope,
  previewLevelCount,
  resolveScopeStates,
} from "./GeoDimWizard";
export type {
  GeoDimWizardProps,
  GeoDimDraft,
  SeedLevel,
} from "./GeoDimWizard";

// Brief 44 PR 44.3 — Geographic dim editor. 3-tab post-creation
// surface (Levels / Map / Territories). Map tab now wires to PR 44.4's
// GeoMapEditor; Territories tab is a placeholder pointing to PR 44.7.
export { GeoDimEditor } from "./GeoDimEditor";
export type {
  GeoDimEditorProps,
  GeoDimEditorDimension,
  GeoDimEditorTab,
} from "./GeoDimEditor";

// Bundled us-atlas geography catalog — shared by <UsChoropleth>. The
// MapLibre <GeoMapEditor> was retired in the maps-next-gen pass.
export {
  getStateOutline,
  getCountiesInState,
  getCountyByGeoid,
  loadGeoCatalog,
  STATE_FIPS_TO_USPS,
  STATE_USPS_TO_FIPS,
} from "./GeoMapEditor";
export type {
  GeoStateFeature,
  GeoCountyFeature,
} from "./GeoMapEditor";
export { UsChoropleth } from "./UsChoropleth";
export type { UsChoroplethProps } from "./UsChoropleth";

// Brief 44 PR 44.6 — Input-mapping geographic transformers. Pure
// library (zip5_to_state / fips5_to_state / state_name_to_usps /
// zip5_to_county stub) + a small <GeoTransformerPicker> primitive
// for the Inputs workspace row.
export {
  GeoTransformerPicker,
  applyTransformer,
  suggestTransformer,
  identity as geoIdentity,
  zip5_to_state,
  zip5_to_county,
  fips5_to_state,
  state_name_to_usps,
  GEO_TRANSFORMER_META,
} from "./GeoTransformerPicker";
export type {
  GeoTransformerPickerProps,
  GeoTransformerId,
  GeoTransformerMeta,
} from "./GeoTransformerPicker";

// Brief 44 PR 44.7 — Territory drag-bucket. Pure state ops
// (addLevelToTerritory / removeLevelFromTerritory / createTerritory /
// deleteTerritory / renameTerritory) + <TerritoryGrouping> component
// consumed by the GeoDimEditor's Territories tab.
//
// PR 44.9 also lives here — migrateTerritorySchemaToGeoDim converts
// the legacy Brief 20 schema shape to a Brief 44 geographic dim.
export {
  TerritoryGrouping,
  addLevelToTerritory,
  createTerritory,
  deleteTerritory,
  removeLevelFromTerritory,
  renameTerritory,
  territoryByLevel,
  ungroupedLevelIds,
  migrateTerritorySchemaToGeoDim,
} from "./TerritoryGrouping";
export type {
  TerritoryGroupingProps,
  GeoTerritory,
  MigratedGeoDim,
  MigrationOptions,
} from "./TerritoryGrouping";

// ── Policy authoring (Brief 46) — compose product Plans into a policy ──
// Brief 62.4: <PolicyBuildUp> → <PremiumBuildUp> (the ordered-tail waterfall);
// both consumers now mount <PremiumBuildUp> directly (the alias was removed).
export { PremiumBuildUp } from "./PremiumBuildUp";
export type { PremiumBuildUpProps } from "./PremiumBuildUp";
// Brief 62.6 PR3 — connector book cost preview + confirm-above-threshold.
export { BookCostGuardrail, estimateBookCost, formatUsd } from "./BookCostGuardrail";
export type {
  BookCostGuardrailProps,
  BookCostRollup,
  ConnectorCostLine,
  BookCostEstimate,
} from "./BookCostGuardrail";
export { PolicyLineChip } from "./PolicyLineChip";
export type { PolicyLineChipProps } from "./PolicyLineChip";
// Brief: portfolio-redesign v2 §6 — <PolicyComposer> left with its only
// consumer (/portfolio/compose); the composePolicy ENGINE lives on in
// @openrater/contracts.

// Brief 65 §2/§3 — the Model Lab producer surface is now the Modeling Studio
// (<ModelStudioApp> + the labs-ui Studio components above). The legacy v1
// registry surface (<ModelLabSurface> + <ShadowRatingDialog> + <ModelAuditTimeline>,
// Brief 62.5) was superseded by the Studio and deleted (CLAUDE.md pref #8).

// Brief 62.5 PR5b — plan-level shadow re-rate: override a tail model-step's
// version → filed-premium impact (consumer brief §−1 backend #7). Still used by
// the Rate Lab plan tail; NOT part of the deleted v1 Model Lab surface.
export {
  PremiumShadowControl,
  type PremiumShadowControlProps,
  type ShadowableStep,
} from "./PremiumShadow";

// ── Brief 52 / 61 — Input Dictionary (declared typed inputs) ────
// The Brief 52 inline <InputDictionaryEditor> was replaced by the
// Brief 61 <InputEditorDrawer> + unified <InputTable> and deleted.
export { InputEditorDrawer } from "./InputDictionary";
export type {
  InputEditorDrawerProps,
  InputDictEntry,
  InputSourceKindValue,
  DictIssue,
} from "./InputDictionary";
export {
  seedInputsFromCsv,
  parseInputDictJson,
  validateDictionary,
  fieldNameToStageId,
  humanizeFieldName,
  isDeclarableFieldName,
  resolveInputDisplayName,
  DATA_TYPE_GROUPS,
  SOURCE_OPTIONS,
  // Brief 58 Pillar C — durable input-dict bulk-add queue.
  enqueuePendingDeclarations,
  peekPendingDeclarations,
  dequeuePendingDeclaration,
  clearPendingDeclarations,
  drainPendingDeclarations,
} from "./InputDictionary";

// MVP-019 — the one absolute date rendering (ISO; time when it matters).
export { isoDate, isoDateTime } from "./format/dates";
// MVP-017 — the title-caser's acronym allowlist (BPP, BOP, ILF, LCM).
export { fixAcronymCase } from "./format/acronyms";

// V2_INTERFACE_SPEC §2.1 — the live plan chrome (header + the Brief 84
// derived-status chip). Re-homed from tower-v2/ at the Brief 70 cutover.
export { PlanHeader, PlanStatusChip } from "./PlanShell";
export type {
  PlanHeaderProps,
  PlanHeaderChecklistItem,
  PlanStatusChipProps,
} from "./PlanShell";

// V2_INTERFACE_SPEC §2.4 — the Test tab (rate one sample risk).
export {
  RunSection,
  deriveRunView,
  formatRunPremium,
  // FCA #10 — declared-dictionary field list + typed payload builder,
  // plus the Ship try-it's wire sample and the shared seed rule.
  deriveRunFields,
  buildSampleRisk,
  buildWireSampleInputs,
  declaredRowKeys,
  overlayVerifiedCase,
  // FCA #14 (display half) — parts-don't-sum reconciliation line.
  roundingReconciliationCaveat,
} from "./RunSection";
export type {
  RunSectionProps,
  RunField,
  RunOutput,
  RunView,
  DerivedRunView,
  DeriveRunFieldsArgs,
} from "./RunSection";

// V2_INTERFACE_SPEC §2.3 — the plan's landing section.
export { OverviewSection } from "./OverviewSection";
export type {
  OverviewSectionProps,
  OverviewChecklistItem,
  OverviewVersionRow,
  OverviewLastTest,
} from "./OverviewSection";
// FCA #11 — verification honesty on the landing surface (checklist
// row + health-pill qualifier for mismatched builds).
export {
  verificationChecklistItem,
  verificationHealthOverride,
} from "./OverviewSection";
export type { VerificationVectorsLike } from "./OverviewSection";

// Brief 89 §2.1 (R2–R4) — the two-door first-landing block for a
// fully-empty plan. Consumed by InputsPanelV2's genesis mode.
export { PlanGenesis } from "./PlanGenesis";
export type { PlanGenesisProps } from "./PlanGenesis";

// Interface Guide v2 — station S2: the rebuilt Inputs body.
// `policyHeadlinePremium` is the policy list's displayed-premium rule
// (composed post-tail final ?? rolled subtotal) — exported so the
// cold-test fixture gate asserts the DISPLAYED oracle headline.
export { InputsPanelV2, policyHeadlinePremium } from "./inputs-v2";
export type { InputsPanelV2Props } from "./inputs-v2";

// ── Brief: portfolio-redesign v2 §6 — the book-of-record component
// family (Book/Map/Trends acts, KPI authoring, Save to Portfolio) left
// with its substrate. `portfolio/rerate.ts` survives: it is the book
// re-rate math the Exhibit's book mode (P3) reuses. ──
export {
  portfolioBookToPolicyRows,
  policyFinalPremium,
  policyBookDislocation,
} from "./portfolio/rerate";
export type {
  RerateBookSubmission,
  PolicyDislocation,
  PolicyBookDislocationOptions,
} from "./portfolio/rerate";

// Brief 82 (D-A) — the Brief 78 Rating workspace panes (RatingRail +
// RatingTableInspector) are DELETED: the tab is one column; the
// catalog is a summoned menu and the editor opens in place. Standing
// rule 8 — no dead exports left behind.

// Brief 82 R2 (D-B) — the in-row table editor: 1-D and 2-D grids at
// content width, inside the expanded step row.
export { RatingInlineGrid } from "./RatingInlineGrid";
export type {
  RatingGridLevel,
  RatingInlineGridProps,
} from "./RatingInlineGrid";

export const PACKAGE_NAME = "@openrater/ui" as const;

// P2 G4 (ADR-0056) — policy-book config extraction (one premium, one
// code path: the scoring service + the route compose through THIS).
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
} from "./InputsWorkspace";
export type {
  AuthoredRollupField,
  AuthoredGrouping,
} from "./InputsWorkspace";
// The premium-resolution shapes consumers narrow their plans to.
export type {
  PlanPremiumContext,
  PremiumPlanLike,
  PremiumStageLike,
} from "./AnalyticsWorkspace/premium-resolution";

// ── Brief 86 P1 — Data Lab Browse (the reading room) ─────────────

// WorkbookBuild — Brief 92 (build a plan from a transcription workbook:
// the /rate-lab/new door's flow + the shared build-report view).
export {
  WorkbookBuildPanel,
  BuildReportView,
  builtLine,
  checkFailedHeadline,
  groupIssuesBySheet,
  manifestTiles,
  vectorsVerdictLine,
  // FCA #19 — one verification-verdict vocabulary, three surfaces.
  vectorChecksSummary,
} from "./WorkbookBuild";
export type {
  WorkbookBuildPanelProps,
  BuildReportViewProps,
} from "./WorkbookBuild";
