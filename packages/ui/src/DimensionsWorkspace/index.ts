// Brief 66 cutover — dims2 IS the Dimensions surface; the legacy
// DimensionsWorkspace is deleted. The workspace contract types live in
// DimensionsWorkspaceV2 now.
export { DimensionsWorkspaceV2 } from "./DimensionsWorkspaceV2";
export type {
  DimensionsWorkspaceProps,
  DimensionShapeChoice,
  DimensionSubtypeFilter,
} from "./DimensionsWorkspaceV2";
