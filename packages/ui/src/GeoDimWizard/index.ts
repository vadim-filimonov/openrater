/**
 * Brief 44 PR 44.2 — GeoDimWizard public exports.
 */
export { GeoDimWizard } from "./GeoDimWizard";
export type { GeoDimWizardProps, GeoDimDraft } from "./GeoDimWizard";

export {
  STATE_SEED,
  STATE_CODES,
  STATE_LABEL_BY_CODE,
  COUNTY_SEED,
  getLevelsForScope,
  previewLevelCount,
  resolveScopeStates,
} from "./geoLevelSeeds";
export type { SeedLevel } from "./geoLevelSeeds";
