// Brief 66 cutover — the legacy <DimensionEditor> orchestrator, the
// composite editor (ADR-0051), the scrubber strip, and the edit-in-place
// popover are DELETED. What remains are the primitives the dims2 surface
// composes.

export { LevelRowsTable, slugifyLabel } from "./LevelRowsTable";
export type {
  LevelRowsTableProps,
  LevelRow,
  LevelInlineWarning,
} from "./LevelRowsTable";

export { useBandedInlineWarnings } from "./useBandedInlineWarnings";

export { UsedInPanel } from "./UsedInPanel";
export type { UsedInPanelProps, DimensionReference } from "./UsedInPanel";

// Brief 30 PR 30.5 — Delete with impact modal (Frame 10).
export { DimensionDeletePrompt } from "./DimensionDeletePrompt";
export type { DimensionDeletePromptProps } from "./DimensionDeletePrompt";

export { GeneratePanel } from "./GeneratePanel";
export type { GeneratePanelProps } from "./GeneratePanel";

// Brief 66 §3.5 — the bulk authoring paths mount in dims2 now.
export { parseLevelPaste } from "./parseLevelPaste";
export { parseBandPaste } from "./parseBandPaste";

export {
  applyGenerateRecipe,
  breakpointsToLevels,
  defaultBandId,
  defaultBandLabel,
  formatBandNumber,
  generateEqualWidthBands,
  generateLogScaleBands,
  hasHandTunedLevels,
  levelsToBreakpoints,
  patchBandedBoundary,
} from "./banded-utils";
export type {
  BandedGenerateMethod,
  BandedGenerateRecipe,
} from "./banded-utils";
