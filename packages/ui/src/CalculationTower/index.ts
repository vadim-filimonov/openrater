/**
 * CalculationTower — the SUBSTRATE module (Brief 70 §2 cutover).
 *
 * The spatial canvas (towers-as-columns, ×-coins, the drag inventory
 * rail, drop slots, TowerTabBar, the Verify toggle) was deleted with
 * lock D2 — <BuildUpSheet> is the Algorithm surface now. What remains
 * here is the projection substrate the sheet (and the autosave
 * machinery) is built on:
 *
 *   - types.ts                 — TowerPlan / Tower / TowerNode / NodeRef
 *   - stages-to-tower-plan.ts  — substrate stages → TowerPlan
 *   - tower-plan-to-stages.ts  — TowerPlan → substrate stages (save)
 *   - plan-mutations.ts        — pure in-memory edit helpers
 *   - build-up.ts              — the running-total fold (the receipt)
 *   - chainTraceValues.ts      — scored run trace → per-node values
 *   - tower-status.ts          — will-it-price classification
 *   - icons.ts                 — node-kind icon resolution
 */

export type {
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
} from "./types";

export { stagesToTowerPlan } from "./stages-to-tower-plan";
export { towerPlanToStages } from "./tower-plan-to-stages";
export {
  countPublicAlgorithm,
  countTowerPlanSteps,
  SHEET_TAIL_STAGE_KINDS,
} from "./public-counts";
export type { PublicAlgorithmCounts } from "./public-counts";
export type {
  FactorTableCatalogEntry,
  TowerPlanToStagesOptions,
} from "./tower-plan-to-stages";

export {
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
} from "./plan-mutations";
export type { DimLevelSpawnSpec, DimSpawnSpec } from "./plan-mutations";

export { computeTowerBuildUp } from "./build-up";
export type { BuildUpStep, TowerBuildUp, ValueResolver } from "./build-up";

export {
  buildTowerValueResolver,
  premiumForTower,
  // Brief 78 P5.3 (§3.3-1) — run issues → sheet steps (the honest
  // sample column's alignment).
  mapRunIssuesToTowerSteps,
} from "./chainTraceValues";
export type {
  RunResultLike,
  RunIssueLike,
  ChainSpecForScoring,
  TowerIssueMap,
} from "./chainTraceValues";

export {
  computeAllTowerStatuses,
  computeTowerStatus,
  isSubstantiveEntry,
  towerWillPrice,
} from "./tower-status";
export type { TowerStatus } from "./tower-status";

export { resolveIcon } from "./icons";
