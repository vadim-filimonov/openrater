/**
 * Brief 44 PR 44.7 + 44.9 — TerritoryGrouping public exports.
 */
export { TerritoryGrouping } from "./TerritoryGrouping";
export type { TerritoryGroupingProps } from "./TerritoryGrouping";

export {
  addLevelToTerritory,
  createTerritory,
  deleteTerritory,
  removeLevelFromTerritory,
  renameTerritory,
  territoryByLevel,
  ungroupedLevelIds,
} from "./territoryOps";
export type { GeoTerritory } from "./territoryOps";

export { migrateTerritorySchemaToGeoDim } from "./migrateTerritorySchema";
export type {
  MigratedGeoDim,
  MigrationOptions,
} from "./migrateTerritorySchema";
