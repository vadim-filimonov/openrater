/**
 * Stage → runtime-Plan projection — reuses the ONE projector.
 *
 * `stagesToRuntimePlan` is the SAME pure module the Rate Lab canvas uses
 * (`@openrater/ui/InputsWorkspace/stagesToRuntimePlan`), so server-side
 * `plan_stages` scoring inherits the E13 projector completion (ADR-0044:
 * exposure÷divisor, filed-rate roundings, banded→lookup.range, dual-input→
 * lookup.multi, the plan tail) with zero forking.
 *
 * The module is value-pure (its only runtime import is `normalizePath`;
 * the React-adjacent imports are `import type`, and we relocated
 * `RequiredInputCategory` to a pure module so the projector's type graph
 * carries NO React `.tsx`). This is the documented interim deep-import
 * (via an @openrater/ui subpath export); ADR-0045 records full extraction into
 * a pure package as the clean follow-up.
 *
 * We mirror the projector's StageLike/FactorTableLike shapes locally and
 * cast at the call boundary — the engine's compilePlan is the real gate.
 */

import type { Dimension, Plan } from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  type FactorTableCellsMap,
} from "@openrater/ui/InputsWorkspace/stagesToRuntimePlan";

type StagesArg = Parameters<typeof stagesToRuntimePlan>[0];
type FactorTablesArg = Parameters<typeof stagesToRuntimePlan>[2];
type ProjectorOptionsArg = Parameters<typeof stagesToRuntimePlan>[4];

/** Local mirror of the projector's options (loose optionals to accept
 *  the zod-inferred request shape under exactOptionalPropertyTypes). */
export interface ProjectorOptions {
  readonly planId?: string | undefined;
  readonly planName?: string | undefined;
  readonly lcmOverride?: number | undefined;
  readonly defaults?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProjectStagesInput {
  readonly stages: readonly {
    stage_id: string;
    stage_kind: string;
    display_name?: string | undefined;
    config_json?: unknown;
  }[];
  readonly dimensions: readonly unknown[];
  readonly factorTables: readonly {
    id: string;
    display_name?: string | undefined;
    key_dimension?: string | undefined;
    key_dimensions?: readonly string[] | undefined;
    // ADR-0063 — read by the projector to emit lookup.multi.interpolateOn.
    interpolation?: { mode: "linear"; axis: string } | null | undefined;
  }[];
  /** Wire shape of the cell sidecar (JSON has no Map). */
  readonly factorTableCells: Readonly<Record<string, Record<string, number>>>;
  readonly options?: ProjectorOptions | undefined;
}

/** Rebuild the `Map<tableId, Map<cellKey, factor>>` the projector expects. */
function toCellsMap(
  wire: Readonly<Record<string, Record<string, number>>>,
): FactorTableCellsMap {
  return new Map(
    Object.entries(wire).map(([tableId, byKey]) => [
      tableId,
      new Map(Object.entries(byKey)),
    ]),
  );
}

export function projectStagesToPlan(input: ProjectStagesInput): Plan {
  // TODO: return the full ProjectionResult and carry `issues` into
  // the /score response as `planIssues` — lands with the
  // input-dictionary validation step.
  return stagesToRuntimePlan(
    input.stages as unknown as StagesArg,
    input.dimensions as unknown as Dimension[],
    input.factorTables as unknown as FactorTablesArg,
    toCellsMap(input.factorTableCells),
    input.options as unknown as ProjectorOptionsArg,
  ).plan;
}

/** P2 G4 (ADR-0056) — the issues-carrying projection (plan + structured
 *  degradations). `projectStagesToPlan` above stays for the batch
 *  worker's legacy path. */
export function projectStagesToProjection(
  input: ProjectStagesInput,
): ReturnType<typeof stagesToRuntimePlan> {
  return stagesToRuntimePlan(
    input.stages as unknown as StagesArg,
    input.dimensions as unknown as Dimension[],
    input.factorTables as unknown as FactorTablesArg,
    toCellsMap(input.factorTableCells),
    input.options as unknown as ProjectorOptionsArg,
  );
}
