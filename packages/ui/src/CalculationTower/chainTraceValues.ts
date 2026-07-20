/**
 * chainTraceValues — Brief 48 §3.4 / phase 3 (scored Verify mode).
 *
 * Aligns a scored run TRACE back to the ASSEMBLE tower's nodes so the build-up
 * gutter + node value chips can show resolved `×values` for a specific risk
 * (the Verify view). Turns a chain spec + a `RunResult` into a `ValueResolver`
 * — the per-node scalar the pure `computeTowerBuildUp` fold (and the node
 * chips) consume.
 *
 * Design:
 *   - IDENTITY, not order. A factor node resolves by matching its
 *     `ref.tableId` (the `factor_kind`) to the runtime lookup node id
 *     `lk_${safeSpec}_${sanitize(factor_kind)}` — NOT by chain position. The
 *     projector skips non-direct factors, so chain.mult's `factors[]` can be
 *     shorter than the tower's factor-node count; order alignment would
 *     silently mis-attribute values (Brief 48 §9 gotcha). Identity is immune.
 *   - DRY id scheme. Ids are rebuilt with the projector's own exported
 *     `sanitize` (one source of truth); the integration test runs a real
 *     `stagesToRuntimePlan` → `compilePlan` → `runPlan` → resolve round-trip,
 *     so any drift in the id scheme breaks it.
 *   - HONEST. Any value the trace doesn't carry resolves to `undefined`, which
 *     flows through the fold → the gutter shows its collapsed/unscored state
 *     rather than a fabricated number (§4).
 *
 * Verified against the real runtime kinds (packages/contracts/src/kinds):
 *   - lookup.direct → outputs.value  (the resolved factor)
 *   - chain.mult    → inputs.base    (the resolved base; the runtime records
 *                     resolved input-port values in the trace)
 *   - output        → runResult.outputs[fieldName]  (the premium)
 *
 * Scope (v1): multiplicative chains of direct lookups + a constant/​input LCM,
 * matching `stagesToRuntimePlan`'s v1.
 */

import { sanitize } from "../InputsWorkspace/stagesToRuntimePlan";
import type { Tower, TowerNode } from "./types";
import type { ValueResolver } from "./build-up";

/**
 * ADR-0056 — one structured row issue from the run (decoupled from
 * @openrater/contracts' `RowIssue`; same fields this module reads).
 */
export interface RunIssueLike {
  readonly severity: "error" | "warning";
  /** The RUNTIME node the issue fired on (projector id scheme). */
  readonly nodeId: string;
  readonly message: string;
}

/** The subset of a `RunResult` this module reads (decoupled from @openrater/contracts). */
export interface RunResultLike {
  /** Output-node values keyed by `fieldName` (e.g. `{ do_premium: 1561 }`). */
  readonly outputs: Readonly<Record<string, unknown>>;
  /** Per-node trace, keyed by runtime node id. */
  readonly trace: Readonly<
    Record<
      string,
      {
        readonly inputs?: Readonly<Record<string, unknown>>;
        readonly outputs?: Readonly<Record<string, unknown>>;
      }
    >
  >;
  /**
   * Brief 78 P5.3 (§3.3-1) — the run's structured issues, node ids
   * attached (ADR-0056). Optional: pre-ADR persisted results parse
   * identically.
   */
  readonly issues?: readonly RunIssueLike[];
}

/** The minimal chain-spec shape needed to reconstruct runtime node ids. */
export interface ChainSpecForScoring {
  /** Chain name — the projector's `safeSpec` is `sanitize(name)`. */
  readonly name?: string;
  /** Output field — keys the premium in `runResult.outputs`. */
  readonly output_field?: string;
}

/** Coerce a trace value to a finite number, or `undefined`. */
function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

/**
 * Build a `ValueResolver` for ONE tower, given its chain spec + a scored run.
 *
 * The caller (AssembleCanvas) finds the active tower's chain spec by matching
 * `output_field` to the tower's `outputField`, then passes the resolver to
 * `<CalculationTower resolveValue=…>`.
 *
 * Returns an always-`undefined` resolver when `name` is missing (the
 * projector's `safeSpec` would be non-deterministic) — the honest unscored
 * path.
 */
export function buildTowerValueResolver(
  chainSpec: ChainSpecForScoring,
  runResult: RunResultLike,
): ValueResolver {
  const name = chainSpec.name?.trim();
  if (!name) {
    return () => undefined;
  }
  const safeSpec = sanitize(name);
  const chainEntry = runResult.trace[`chain_${safeSpec}`];

  return (node: TowerNode): number | undefined => {
    const ref = node.ref;

    // The base seeds the chain — read the chain.mult's own `base` input
    // (robust whether the base was a literal constant or an input column).
    if (ref?.kind === "chain-base" || node.category === "input") {
      return asFiniteNumber(chainEntry?.inputs?.base);
    }

    // A factor table resolves by IDENTITY: its tableId is the factor_kind the
    // projector used as the lookup node's id suffix.
    if (ref?.kind === "factor-table") {
      const entry = runResult.trace[`lk_${safeSpec}_${sanitize(ref.tableId)}`];
      return asFiniteNumber(entry?.outputs?.value);
    }

    // The LCM / a named constant. The projector emits `const_lcm_${safeSpec}`
    // for the override path; fall back to an `in_<constantId>` input node.
    if (ref?.kind === "constant") {
      const constEntry =
        runResult.trace[`const_lcm_${safeSpec}`] ??
        runResult.trace[`in_${sanitize(ref.constantId)}`];
      return asFiniteNumber(constEntry?.outputs?.value);
    }

    // The output cap is the answer, not a line item — the fold carries the
    // premium (see `premiumForTower`); the cap's own "value" is undefined.
    return undefined;
  };
}

/**
 * The scored premium for a tower (the output-cap's display value), read from
 * `runResult.outputs[output_field]`. `undefined` when unscored / missing.
 */
export function premiumForTower(
  chainSpec: ChainSpecForScoring,
  runResult: RunResultLike,
): number | undefined {
  const field = chainSpec.output_field?.trim();
  if (!field) return undefined;
  return asFiniteNumber(runResult.outputs[field]);
}

/* ============================================================
 * Brief 78 P5.3 (§3.3-1) — the honest sample column
 * ============================================================ */

/** Named refusals aligned to the sheet's tower anatomy. */
export interface TowerIssueMap {
  /** Tower-NODE id → the first named refusal that fired on that step. */
  readonly stepIssues: ReadonlyMap<string, string>;
  /** Tower id → chain-level / projector-only-factor messages that
   *  don't map to a single sheet step (qualify the header total). */
  readonly towerIssues: ReadonlyMap<string, readonly string[]>;
}

/**
 * Align the ambient run's structured issues (ADR-0056, runtime node
 * ids) back onto the sheet's tower steps — the SAME identity scheme
 * `buildTowerValueResolver` reads values with, so a step's refusal
 * chip and its "—" column can never disagree.
 *
 *   · `lk_${safe}_${sanitize(tableId)}`  → that factor step
 *   · `in_${sanitize(constantId)}` / `const_lcm_${safe}` → that
 *     constant step
 *   · `chain_${safe}` or an `lk_${safe}_…` with no tower node
 *     (projector-only factor) → the tower's header list
 *   · anything else (derive_*, gates, other chains' nodes) is NOT
 *     this tower's story — dropped here; the Run tab owns run-level
 *     reporting.
 *
 * First message per step wins (execution order = root cause first).
 */
export function mapRunIssuesToTowerSteps(args: {
  readonly towers: readonly Tower[];
  readonly nodes: ReadonlyMap<string, TowerNode>;
  readonly chainSpecForOutputField: (
    outputField: string,
  ) => ChainSpecForScoring | undefined;
  readonly run: RunResultLike;
}): TowerIssueMap {
  const stepIssues = new Map<string, string>();
  const towerIssues = new Map<string, string[]>();
  const issues = args.run.issues;
  if (!issues || issues.length === 0) return { stepIssues, towerIssues };

  // Reverse index: runtime node id → the tower step it renders as.
  const stepByRuntimeId = new Map<string, string>();
  // Chain-scope prefixes: `chain_${safe}`/`lk_${safe}_…` → tower id.
  const towerBySafeSpec = new Map<string, string>();
  for (const tower of args.towers) {
    const name = args
      .chainSpecForOutputField(tower.outputField)
      ?.name?.trim();
    if (!name) continue;
    const safe = sanitize(name);
    towerBySafeSpec.set(safe, tower.id);
    for (const entry of tower.entries) {
      if (entry.kind !== "node") continue;
      const node = args.nodes.get(entry.nodeId);
      const ref = node?.ref;
      if (!node || !ref) continue;
      if (ref.kind === "factor-table") {
        stepByRuntimeId.set(
          `lk_${safe}_${sanitize(ref.tableId)}`,
          node.id,
        );
      } else if (ref.kind === "constant") {
        stepByRuntimeId.set(`in_${sanitize(ref.constantId)}`, node.id);
        stepByRuntimeId.set(`const_lcm_${safe}`, node.id);
      }
    }
  }

  for (const issue of issues) {
    const stepNodeId = stepByRuntimeId.get(issue.nodeId);
    if (stepNodeId !== undefined) {
      if (!stepIssues.has(stepNodeId)) {
        stepIssues.set(stepNodeId, issue.message);
      }
      continue;
    }
    // Chain-scope fallback: attribute to the owning tower's header.
    for (const [safe, towerId] of towerBySafeSpec) {
      if (
        issue.nodeId === `chain_${safe}` ||
        issue.nodeId.startsWith(`lk_${safe}_`)
      ) {
        const list = towerIssues.get(towerId) ?? [];
        list.push(issue.message);
        towerIssues.set(towerId, list);
        break;
      }
    }
  }
  return { stepIssues, towerIssues };
}
