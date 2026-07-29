/**
 * Block kinds — pure execute() implementations.
 *
 * Each kind is a standalone module exporting a `BlockKind`. Phase A.1
 * ports them one-batch-at-a-time from the legacy
 * `<prototype>/plan-builder/src/blocks/kinds/` directory.
 *
 * Per the original port plan: only the PURE half (params type + execute +
 * jacobian + validate) ports here. React renderBody/renderInspector
 * live in the rate-lab frontend.
 *
 * Importing this barrel does NOT register the kinds — registration is
 * an explicit opt-in via `registerBuiltinKinds()` so consumers (tests,
 * runtime callers, integrators with custom kind sets) can choose
 * whether to load the v0 set or roll their own.
 */

export { ConstantKind } from "./constant";
export type {
  ConstantParams,
  ConstantInputs,
  ConstantOutputs,
} from "./constant";

export { MathOpKind, executeMath } from "./math-op";
export type {
  MathOp,
  MathOpParams,
  MathOpInputs,
  MathOpOutputs,
} from "./math-op";

export { RoundKind, roundToDecimals } from "./round";
export type { RoundParams, RoundInputs, RoundOutputs } from "./round";

export { InterpolateKind } from "./interpolate";
export type {
  InterpolateParams,
  InterpolateInputs,
  InterpolateOutputs,
  InterpolatePoint,
} from "./interpolate";

export { InputKind } from "./input";
export type { InputParams, InputInputs, InputOutputs } from "./input";

export { InputSourceKind } from "./input-source";
export type {
  InputSourceParams,
  InputSourceInputs,
  InputSourceOutputs,
  InputSourceSourceType,
} from "./input-source";

export { OutputKind } from "./output";
export type { OutputParams, OutputInputs, OutputOutputs } from "./output";

export { DirectLookupKind } from "./lookup-direct";
export type {
  DirectLookupParams,
  DirectLookupInputs,
  DirectLookupOutputs,
} from "./lookup-direct";

export { RangeLookupKind } from "./lookup-range";
export type {
  RangeBucket,
  RangeLookupParams,
  RangeLookupInputs,
  RangeLookupOutputs,
} from "./lookup-range";

export { ClassificationLookupKind } from "./lookup-classification";
export type {
  ClassificationLookupParams,
  ClassificationLookupInputs,
  ClassificationLookupOutputs,
} from "./lookup-classification";

export { MultiLookupKind } from "./lookup-multi";
export type {
  MultiLookupRow,
  MultiLookupParams,
  MultiLookupInputs,
  MultiLookupOutputs,
} from "./lookup-multi";

export { TerritoryLookupKind } from "./lookup-territory";
export type {
  TerritoryRates,
  SnapshottedTerritory,
  TerritoryLookupParams,
  TerritoryLookupInputs,
  TerritoryLookupOutputs,
} from "./lookup-territory";

export { ChainMultKind } from "./chain-mult";
export type {
  ChainMultParams,
  ChainMultInputs,
  ChainMultOutputs,
} from "./chain-mult";

export { ChainAddKind } from "./chain-add";
export type {
  ChainAddParams,
  ChainAddInputs,
  ChainAddOutputs,
} from "./chain-add";

// Brief 19's CurveEvaluateKind removed in Brief 34 PR 34.7.
// Brief 34's <FactorTableViz> supersedes the curve concept.

export { PredicateKind, evaluatePredicate } from "./predicate";
export type {
  PredicateOp,
  PredicateParams,
  PredicateInputs,
  PredicateOutputs,
} from "./predicate";

export { RangeCheckKind } from "./range-check";
export type {
  RangeCheckParams,
  RangeCheckInputs,
  RangeCheckOutputs,
} from "./range-check";

export { BranchKind } from "./branch";
export type {
  BranchParams,
  BranchInputs,
  BranchOutputs,
} from "./branch";

export { GlmModelKind } from "./model-glm";
export type {
  GlmModelParams,
  GlmModelInputs,
  GlmModelOutputs,
} from "./model-glm";

export { RatingModelKind } from "./model-rating";
export type {
  RatingModelParams,
  RatingModelInputs,
  RatingModelOutputs,
} from "./model-rating";

export { SubplanKind } from "./subplan";
export type {
  SubplanParams,
  SubplanInputs,
  SubplanOutputs,
} from "./subplan";

export { UnknownKind } from "./unknown";
export type {
  UnknownParams,
  UnknownInputs,
  UnknownOutputs,
} from "./unknown";

// ── M1.2 Phase B additions ───────────────────────────────────────
export { InputClassExposureKind } from "./input-class-exposure";
export type {
  InputClassExposureParams,
  InputClassExposureInputs,
  InputClassExposureOutputs,
} from "./input-class-exposure";

export { ChainLobSumKind } from "./chain-lob-sum";
export type {
  ChainLobSumParams,
  ChainLobSumInputs,
  ChainLobSumOutputs,
} from "./chain-lob-sum";

export {
  ChainDimSumKind,
  DEFAULT_DIM_SUM_OUTPUT_FIELD,
} from "./chain-dim-sum";
export type {
  ChainDimSumParams,
  ChainDimSumInputs,
  ChainDimSumOutputs,
} from "./chain-dim-sum";

export {
  EligibilityGateKind,
  // Brief 81 (finding E8) — THE rule matcher + the conditions view.
  eligibilityRuleMatches,
  ruleConditions,
} from "./eligibility-gate";
export type {
  EligibilityGateParams,
  EligibilityGateInputs,
  EligibilityGateOutputs,
  EligibilityRule,
  EligibilityCondition,
  SingleConditionEligibilityRule,
  CompoundEligibilityRule,
} from "./eligibility-gate";

export { ModifierScheduleKind } from "./modifier-schedule";
export type {
  ModifierScheduleParams,
  ModifierScheduleInputs,
  ModifierScheduleOutputs,
} from "./modifier-schedule";

export { UwReportKind } from "./uw-report";
export type {
  UwReportParams,
  UwReportInputs,
  UwReportOutputs,
} from "./uw-report";

export { ChainFromReportKind } from "./chain-from-report";
export type {
  ChainFromReportParams,
  ChainFromReportInputs,
  ChainFromReportOutputs,
} from "./chain-from-report";

// ── Brief 39 PR 39.1 — endorsement.* kinds ──────────────────────
//
// Three discrete kinds that share the trigger shape (variable +
// op + value, evaluated against ctx.externalInputs) and differ
// only in the effect math. The Gate workspace authors all three
// through one editor (Brief 39 PR 39.4).
export {
  EndorsementFactorKind,
  EndorsementAdditiveKind,
  EndorsementSublimitKind,
  EndorsementRateBranchKind,
  evaluateEndorsementTrigger,
} from "./endorsement";

// ── Phase H.7 — modifier.model kind (Brief 41) ──────────────────
//
// Model-wrapped IRPM. The kind wraps a pricing model (GLM, GBM,
// neural, …) with filed safeguards: clamp envelope (min/max) +
// fallback factor when any declared_input is missing. V19
// conformance vector locks the fallback path.
export { ModifierModelKind } from "./modifier-model";
export type {
  ModelInputDeclaration,
  ModelClampEnvelope,
  ModifierModelParams,
  ModifierModelInputs,
  ModifierModelOutputs,
} from "./modifier-model";

// ── PR D3.2 (Phase D) — derive.band kind ────────────────────────
//
// Per ADR-0026: bridges raw numeric inputs (revenue = 45000) to
// banded dim level ids (02_25k_50k). The projector inserts this
// kind before lookup.direct whenever the bound dim has shape:
// "banded". Trace shows the binning as its own visible step.
export { DeriveBandKind } from "./derive-band";
export type {
  DeriveBandParams,
  DeriveBandInputs,
  DeriveBandOutputs,
} from "./derive-band";

// ── ADR-0025 / FCA #21 — derive.composite kind ──────────────────
//
// Joins member-dim level ids into a composite dim's level id
// ("pts_1·lic_10_plus"). The projector inserts this whenever a
// lookup axis binds a shape:"composite" dim — each member resolves
// through its own derivation first, then this node joins them with
// the substrate's COMPOSITE_LEVEL_SEPARATOR. Before it existed, the
// spec-recommended composite shape built into a plan that refused
// every row.
export { DeriveCompositeKind } from "./derive-composite";
export type {
  DeriveCompositeParams,
  DeriveCompositeInputs,
  DeriveCompositeOutputs,
} from "./derive-composite";

// ── ADR-0028 — derive.territory kind (cold-test L13) ────────────
//
// The geographic analogue of derive.band: resolves a raw geographic
// value (state code) → a dim's territory grouping id (T1) so a
// territory-keyed lookup.direct table actually scores. The projector
// inserts this before lookup.direct whenever the bound dim is
// geographic AND has a non-empty `geo_territories` grouping. Runtime/
// projector-generated only — never persisted (same boundary as
// derive.band).
export { DeriveTerritoryKind } from "./derive-territory";
export type {
  DeriveTerritoryParams,
  DeriveTerritoryInputs,
  DeriveTerritoryOutputs,
} from "./derive-territory";

// ── ADR-0035 (Brief 51) — derive.class_attribute kind ───────────
//
// The class analogue of derive.band / derive.territory: resolves a raw
// class_code → a DERIVED structural attribute (rate number / class group
// / exposure base) so a factor table keyed by that derived value scores.
// The projector inserts this before lookup.direct whenever a structural
// dim declares `derived_from` a classification dim. Runtime/projector-
// generated only — never persisted (same boundary as derive.band).
export { DeriveClassAttributeKind } from "./derive-class-attribute";
export type {
  DeriveClassAttributeParams,
  DeriveClassAttributeInputs,
  DeriveClassAttributeOutputs,
} from "./derive-class-attribute";
export { DeriveComputedKind } from "./derive-computed";
export type {
  DeriveComputedParams,
  DeriveComputedInputs,
  DeriveComputedOutputs,
} from "./derive-computed";
export type {
  EndorsementTrigger,
  EndorsementFactorParams,
  EndorsementFactorInputs,
  EndorsementFactorOutputs,
  EndorsementAdditiveParams,
  EndorsementAdditiveInputs,
  EndorsementAdditiveOutputs,
  EndorsementSublimitParams,
  EndorsementSublimitInputs,
  EndorsementSublimitOutputs,
  EndorsementRateBranchParams,
  EndorsementRateBranchInputs,
  EndorsementRateBranchOutputs,
  BranchChain,
  BranchChainLcm,
} from "./endorsement";

import { ConstantKind } from "./constant";
import { MathOpKind } from "./math-op";
import { RoundKind } from "./round";
import { InterpolateKind } from "./interpolate";
import { InputKind } from "./input";
import { InputSourceKind } from "./input-source";
import { OutputKind } from "./output";
import { DirectLookupKind } from "./lookup-direct";
import { RangeLookupKind } from "./lookup-range";
import { ClassificationLookupKind } from "./lookup-classification";
import { MultiLookupKind } from "./lookup-multi";
import { TerritoryLookupKind } from "./lookup-territory";
import { ChainMultKind } from "./chain-mult";
import { ChainAddKind } from "./chain-add";
import { PredicateKind } from "./predicate";
import { RangeCheckKind } from "./range-check";
import { BranchKind } from "./branch";
import { GlmModelKind } from "./model-glm";
import { RatingModelKind } from "./model-rating";
import { SubplanKind } from "./subplan";
import { UnknownKind } from "./unknown";
import { InputClassExposureKind } from "./input-class-exposure";
import { ChainLobSumKind } from "./chain-lob-sum";
import { ChainDimSumKind } from "./chain-dim-sum";
import { EligibilityGateKind } from "./eligibility-gate";
import { ModifierScheduleKind } from "./modifier-schedule";
import { UwReportKind } from "./uw-report";
import { ChainFromReportKind } from "./chain-from-report";
import {
  EndorsementFactorKind,
  EndorsementAdditiveKind,
  EndorsementSublimitKind,
  EndorsementRateBranchKind,
} from "./endorsement";
import { ModifierModelKind } from "./modifier-model";
import { CoverageElectionKind } from "./coverage-election";
import { DeriveBandKind } from "./derive-band";
import { DeriveCompositeKind } from "./derive-composite";
import { DeriveTerritoryKind } from "./derive-territory";
import { DeriveClassAttributeKind } from "./derive-class-attribute";
import { DeriveComputedKind } from "./derive-computed";
import { registerBlockKind } from "../registry";

/**
 * Register the V1 built-in kinds. Call ONCE per process. Subsequent
 * calls throw (the registry refuses duplicates).
 *
 * Today registers the V1 v0 kinds (post Brief 34 PR 34.7 — Brief
 * 19's `curve.evaluate` was hard-removed; the count dropped to 19):
 *   · `constant`, `math.op` (PR 4)
 *   · `input`, `input.source`, `output` (PR 5 — declaration kinds)
 *   · `lookup.direct`, `lookup.range`, `lookup.classification`,
 *     `lookup.multi`, `lookup.territory` (PR 6 — lookup family)
 *   · `chain.mult`, `chain.add` (PR 7 — chains)
 *   · `predicate`, `range.check`, `branch` (PR 8 — conditional flow)
 *   · `model.glm`, `model.rating`, `subplan`, `unknown` (PR 9 — heavy +
 *     special; `model.*` are STUBS gated on Model Lab existing,
 *     `subplan` is special-cased by the runtime, `unknown` is the
 *     forward-compat placeholder)
 *
 * (The "18 canonical kinds" callout in VISION.md counted the
 * families with `model.*` as one entry; the actual registered count
 * post curve-removal is 19.)
 *
 * Production consumers that don't want the V1 kinds (e.g., a custom
 * integrator with their own kind set) just don't call this — the
 * registry remains empty + they call `registerBlockKind()` for their
 * own kinds.
 */
export function registerBuiltinKinds(): void {
  registerBlockKind(ConstantKind);
  registerBlockKind(MathOpKind);
  registerBlockKind(RoundKind);
  registerBlockKind(InterpolateKind);
  registerBlockKind(InputKind);
  registerBlockKind(InputSourceKind);
  registerBlockKind(OutputKind);
  registerBlockKind(DirectLookupKind);
  registerBlockKind(RangeLookupKind);
  registerBlockKind(ClassificationLookupKind);
  registerBlockKind(MultiLookupKind);
  registerBlockKind(TerritoryLookupKind);
  registerBlockKind(ChainMultKind);
  registerBlockKind(ChainAddKind);
  registerBlockKind(PredicateKind);
  registerBlockKind(RangeCheckKind);
  registerBlockKind(BranchKind);
  registerBlockKind(GlmModelKind);
  registerBlockKind(RatingModelKind);
  registerBlockKind(SubplanKind);
  registerBlockKind(UnknownKind);
  // ── M1.2 Phase B additions (Brief 16 + Brief 17) ──────────────
  registerBlockKind(InputClassExposureKind);
  registerBlockKind(ChainLobSumKind);
  // ── M1.3 Phase B additions (Brief 10 + Brief 15) ──────────────
  registerBlockKind(EligibilityGateKind);
  registerBlockKind(ModifierScheduleKind);
  // ── M1.4 Phase B additions (Brief 7) ──────────────────────────
  registerBlockKind(UwReportKind);
  registerBlockKind(ChainFromReportKind);
  // ── Brief 35 PR 35.1 — Assemble (dimensioned premium towers) ──
  registerBlockKind(ChainDimSumKind);
  // ── Brief 39 PR 39.1 — endorsement.* kinds ────────────────────
  registerBlockKind(EndorsementFactorKind);
  registerBlockKind(EndorsementAdditiveKind);
  registerBlockKind(EndorsementSublimitKind);
  // ── Phase H.4 (Brief 40 §−1 + Brief 42 §−1 Q5) ────────────────
  registerBlockKind(EndorsementRateBranchKind);
  // ── Phase H.7 (Brief 41 + Brief 42 §−1 Q6) ────────────────────
  registerBlockKind(ModifierModelKind);
  // ── PR D3.2 (Phase D) — derive.band kind ──────────────────────
  // Per ADR-0026. Inserted by stagesToRuntimePlan before
  // lookup.direct whenever the bound dim has shape: "banded".
  registerBlockKind(DeriveBandKind);
  // ── ADR-0025 / FCA #21 — derive.composite kind ────────────────
  // Inserted by stagesToRuntimePlan whenever a lookup axis binds a
  // shape:"composite" dim: each member axis resolves through its own
  // derivation, then this node joins the level ids with "·".
  registerBlockKind(DeriveCompositeKind);
  // ── ADR-0028 — derive.territory kind (cold-test L13) ──────────
  // Inserted by stagesToRuntimePlan before lookup.direct whenever the
  // bound dim is geographic AND has a non-empty `geo_territories`
  // grouping. Resolves a raw state code → territory id so a
  // territory-keyed factor table scores through the tier (not 1.0).
  registerBlockKind(DeriveTerritoryKind);
  // ── ADR-0035 (Brief 51) — derive.class_attribute kind ─────────
  // Inserted by the projector before lookup.direct whenever a
  // structural dim declares `derived_from` a classification dim.
  // Resolves a class code → its derived structural attribute (rate
  // number / class group / exposure base) so the factor table scores.
  registerBlockKind(DeriveClassAttributeKind);
  // ── E03 (location-rollup-and-policy-appetite brief D3) ────────
  // Derive a computed appetite field (tiv = building_limit + bpp_limit)
  // from a closed arithmetic AST over inputs; the gate reads it like any
  // input. The batch orchestrator (evaluatePolicyBook) surfaces the value
  // back into externalInputs before the per-row run.
  registerBlockKind(DeriveComputedKind);
  // ── Brief 95 C4 — coverage election (spec §4.1 `?` markers) ───
  // Emitted by the projector at the head of every exposure-rated
  // tower: an EXPLICIT 0 exposure elects an electable coverage out
  // (its nodes skip via the reserved `__guard__` port; the output
  // resolves $0) and REFUSES on a required one (zero is not an
  // elect-out — §12.4). Absence still withholds.
  registerBlockKind(CoverageElectionKind);
}
