// The `<DimensionsTable>` render was deleted (dead since the v2
// BuildUpSheet / ParametrizeCanvas cutover — no JSX mount, no consumers).
// Its one surviving export, the `DimensionRow` row type, is re-homed to
// the types-only `./types` module and re-exported here so the directory
// barrel (`./DimensionsTable` / `../DimensionsTable`) keeps resolving for
// every consumer. `DimensionsTableProps` went with the component.
export type { DimensionRow } from "./types";
