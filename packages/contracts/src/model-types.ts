/**
 * Model contract — sub-brief 24.A.
 *
 * Declares the shape of a model export — a function that the rating
 * algorithm can bind to as one source of factor values (alongside
 * direct values, curves, factor tables).
 *
 * Models may be supplied by third-party systems in industry formats:
 *      - PMML (Predictive Model Markup Language; XML)
 *      - ONNX (Open Neural Network Exchange; binary)
 *      - JSON coefficients (the simple case — flat GLM weights)
 *
 * The ModelExport contract is source-agnostic. The UI's Parametrize
 * workspace (sub-brief 24.E) uses this contract to render the model
 * binding panel.
 *
 * Engine impact: NONE. Models are evaluated externally (by the
 * source); their outputs flow into tables the engine reads as
 * regular factor values. The engine doesn't see "model" — it sees
 * a factor table with values that happen to come from a model.
 *
 * External formats are first-class; the engine consumes only their
 * deterministic factor outputs.
 */

import type { PlanCitation } from "./plan-types";

/**
 * Where a model export originates. Determines how it's parsed +
 * evaluated; doesn't change the binding UI.
 */
export type ModelSource =
  | "model-lab" // OpenRater internal Model Lab registry
  | "external-pmml" // PMML XML export
  | "external-onnx" // ONNX binary export
  | "external-json"; // Flat JSON (GLM coefficients, lookup tables)

/**
 * The data type a model input or output uses.
 *
 * Currently a subset of DimensionDataType — models read variables
 * (which ARE dimensions) and output numbers. If a future model
 * needs a non-numeric output (e.g., a categorical classifier),
 * we extend then.
 */
export type ModelDataType = "string" | "number" | "currency" | "boolean" | "enum";

/**
 * One required or optional input a model declares. The Parametrize
 * UI shows each input as a binding dropdown that the actuary maps
 * to a plan variable.
 */
export interface ModelInput {
  /** The model's internal name for this input (e.g., "building_age"). */
  readonly name: string;
  /** Expected value type. */
  readonly type: ModelDataType;
  /** When true, the binding panel blocks save until this input is bound. */
  readonly required: boolean;
  /** Optional one-line description for the binding UI. */
  readonly description?: string;
  /**
   * For `type: "enum"`, the valid options. Bindings against a plan
   * variable must produce a value in this set.
   */
  readonly options?: readonly string[];
}

/**
 * One output the model produces. Currently outputs are always numeric
 * (factor values, loss costs, premiums) — the rating algorithm treats
 * model output as a number.
 */
export interface ModelOutput {
  readonly name: string;
  /** Always "number" for now. Future: categorical outputs. */
  readonly type: "number";
  readonly description?: string;
}

/**
 * The canonical ModelExport — the shape every Parametrize-workspace
 * Model binding panel reads from. Source-agnostic; the source field
 * tells consumers how to evaluate the model.
 *
 * Invariants:
 *   - `id` is unique within a plan
 *   - `inputs[*].name` is unique within the model
 *   - `outputs[*].name` is unique within the model
 *   - At least one output (a model that produces nothing is useless)
 */
export interface ModelExport {
  readonly id: string;
  readonly display_name: string;
  readonly source: ModelSource;
  /** Optional version tag for audit + lock workflows. */
  readonly version?: string;
  readonly description?: string;
  readonly inputs: readonly ModelInput[];
  readonly outputs: readonly ModelOutput[];
  /**
   * Optional citation — for industry models, the reference paper
   * or model documentation URL.
   */
  readonly citation?: PlanCitation;
}

/**
 * Returns the names of inputs the actuary MUST bind before the
 * model can run. The Parametrize binding panel uses this to drive
 * save-disabled state.
 */
export function requiredInputNames(model: ModelExport): readonly string[] {
  return model.inputs.filter((i) => i.required).map((i) => i.name);
}

/**
 * Returns the input matching a name, or null. Used by the binding
 * panel when a binding mutation needs to look up its target input.
 */
export function findModelInput(
  model: ModelExport,
  name: string,
): ModelInput | null {
  return model.inputs.find((i) => i.name === name) ?? null;
}

/**
 * Returns the output matching a name, or null.
 */
export function findModelOutput(
  model: ModelExport,
  name: string,
): ModelOutput | null {
  return model.outputs.find((o) => o.name === name) ?? null;
}
