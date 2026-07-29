/**
 * Plan JSON schema — v0.
 *
 * A Plan is a typed DAG of blocks. The canvas reads a Plan; the runtime
 * (lands in a follow-up port of `plan-runtime.ts`) compiles + executes
 * it. The format is the open-source artifact specified in
 * `docs/specs/plan-format-v1.md`.
 *
 * Pure types only. No React, no DOM, no I/O. Consumed by the runtime,
 * the validator, the conformance vectors, and (via the UI layer) the
 * canvas — all from opposite sides.
 *
 * Ported verbatim from `<prototype>/plan-builder/src/canvas/
 * plan-types.ts` in the original port plan (Phase A.1).
 */

import type { BlockSize } from "./block-types";
import type { ClassLibrary } from "./class-library-types";
import type { KindRegistry } from "./registry";
import type { EligibilityTier } from "./tier-types";
import type { PolicyAdjustment } from "./policy-adjustments";
import type { RowIssue } from "./plan-issues";

/** One node in a plan. References a registered BlockKind by id. */
export interface PlanNode {
  /** Unique within the plan (e.g., 'cls', 'hazard', 'cascade'). */
  id: string;
  /** Matches BlockKind.id in the registry (e.g., 'lookup.direct'). */
  kind: string;
  /** Kind-specific parameters. Shape is whatever the kind expects. */
  params: unknown;
  /** Optional visual hint. If absent, the auto-layout assigns one. */
  position?: { x: number; y: number };
  /** Optional size variant. Defaults to the kind's defaultSize. */
  size?: BlockSize;
  /** Optional human-readable label override (defaults to kind.label). */
  label?: string;
}

/** One typed wire from an output port to an input port. */
export interface PlanEdge {
  /** Source — a node's output port. */
  from: { node: string; port: string };
  /** Destination — a node's input port. */
  to: { node: string; port: string };
}

/**
 * A pinned test case used for the test bench. v0 is minimal; the
 * Plan can carry many.
 */
export interface PlanTestCase {
  id: string;
  name: string;
  /**
   * External inputs to feed to the plan's `input` nodes, by their
   * `params.fieldName`.
   */
  inputs: Record<string, unknown>;
  /** Expected outputs by their `params.fieldName`. */
  expected: Record<string, unknown>;
  /** Per-output tolerances (absolute). */
  tolerance?: Record<string, number>;
}

/** Citation reference (e.g., to an ISO filing PDF + page). */
export interface PlanCitation {
  id: string;
  ref: string;
  url?: string;
  fetchedAt?: string;
  contentHash?: string;
}

/** Top-level plan document. The JSON shape that flows between systems. */
export interface Plan {
  /** Globally unique id (typically reverse-domain). */
  id: string;
  /** Semver version. */
  version: string;
  /** Human-readable name. */
  name: string;
  /**
   * @deprecated Free-text metadata shim only. The product axis lives on
   * the persisted plan as `product: ProductCode` (ADR-0033); the engine
   * never reads this field. The multi-LOB `lines: LineCode[]` array was
   * removed in the axis cleanup (multi-product → Policy composition,
   * ADR-0034). Carried as an opaque label until the backend drops the
   * `line_of_business` shim.
   */
  line?: string;
  /** Optional jurisdiction. */
  jurisdiction?: { country: string; state?: string };
  /** ISO 8601 effective date (inclusive). */
  effective?: string;
  /** Topology. */
  nodes: PlanNode[];
  edges: PlanEdge[];
  /** Optional artifacts. */
  citations?: PlanCitation[];
  testBench?: PlanTestCase[];
  /**
   * Brief 62.3 / R1 — the plan's **Final adjustments** tail: the ordered
   * post-aggregation adjustments this single-product filing carries by
   * default (schedule rating / IRPM → package mods → policy-wide
   * endorsements → minimum-premium floor), reusing 62.1's `PolicyAdjustment`
   * union. These are FILED DATA, not a branch — the composer treats them
   * generically (genericity invariant). When this plan is composed into a
   * Policy (62.4), the Policy's own `adjustments[]` (62.1) takes precedence
   * if set; otherwise it INHERITS `policy_tail` (see `effectivePolicyTail`).
   * The runtime DAG (`nodes`/`edges`) is unchanged — the tail applies to the
   * aggregated total via `composePolicy`, not as per-coverage stages.
   */
  policy_tail?: readonly PolicyAdjustment[];
}

/** A compiled plan is the runtime-ready form. Built by `compilePlan`. */
export interface CompiledPlan {
  /** The source plan, unchanged. */
  plan: Plan;
  /** Nodes in topological execution order. */
  topoOrder: readonly string[];
  /** Edges grouped by destination node (so we can gather inputs). */
  incoming: ReadonlyMap<string, readonly PlanEdge[]>;
  /** Edges grouped by source node (so we can fan out). */
  outgoing: ReadonlyMap<string, readonly PlanEdge[]>;
  /** Lookup by node id. */
  nodesById: ReadonlyMap<string, PlanNode>;
  /**
   * The registry this plan was compiled against. `runPlan` resolves
   * every `node.kind` here, NOT against the global, so a compiled
   * plan stays bound to the kind set it was validated against — no
   * silent drift if the global registry mutates between compile +
   * run.
   *
   * Defaults to `globalRegistry` when `compilePlan(plan)` is called
   * with no explicit registry.
   */
  readonly registry: KindRegistry;
}

/**
 * One entry in the per-run trace — what one node DID during execution.
 *
 * Self-describing: every entry carries enough context for a Phase B
 * audit panel (or a regulator reading the export) to interpret it
 * without joining back to the source Plan.
 *
 * - `kindId` echoes the node's `kind` field so the consumer doesn't
 *   have to look up the Plan by node id to know what ran.
 * - `citation` is propagated from `node.params.citation ?? kind.citation`
 *   when either is set. Lets a single trace entry stand alone as
 *   evidence of which filed authority backs the value.
 * - `explanation` is the kind's actuary-language one-liner from
 *   `kind.explainStep()`, captured at run time so the trace stays
 *   replayable without re-running.
 * - `error` is populated when `kind.execute()` threw. Downstream
 *   nodes still execute but see the failed node's outputs as `{}`.
 */
export interface TraceEntry {
  readonly kindId: string;
  readonly inputs: Record<string, unknown>;
  readonly outputs: Record<string, unknown>;
  readonly citation?: string;
  readonly explanation?: string;
  readonly error?: { readonly message: string; readonly at: "execute" };
  /**
   * ADR-0056 — structured row issues this node reported (node id
   * attached by the runtime). Fatal refusals (`RowIssueError` from
   * execute) land here alongside `error`; non-fatal resolutions
   * (authored default applied, territory unmapped, band clamped)
   * come from the kind's `collectRowIssues` hook. Absent when none.
   */
  readonly issues?: readonly RowIssue[];
  /**
   * Brief 95 C4 — the runtime never executed this node: its reserved
   * `__guard__` port resolved falsy (e.g. the tower's coverage is not
   * elected on this risk). Outputs are `{}`; no issues are collected.
   * Absent (never `false`) on executed nodes.
   */
  readonly skipped?: boolean;
}

/** Result of a single plan run. */
export interface RunResult {
  /** Outputs collected from `output` kind nodes (keyed by fieldName). */
  outputs: Record<string, unknown>;
  /** Per-node trace, keyed by node id. */
  trace: Record<string, TraceEntry>;
  /** When the run started. */
  startedAt: number;
  /** Duration in ms. */
  durationMs: number;
  /**
   * The temporal anchor used for this run — either the value the
   * caller supplied via `RunOptions.as_of`, or today's date (UTC,
   * `YYYY-MM-DD`) when omitted. Echoing it back lets caching layers
   * and audit trails capture exactly which date the run was anchored
   * to. Always present.
   */
  as_of: string;
  /**
   * Brief 55 — the resolved eligibility verdict for this run.
   *
   * A convenience projection of the trace: `resolveEligibilityTier`
   * reads every executed `eligibility.gate` node's `tier` output and
   * resolves a single verdict (one gate → its tier; multiple gates →
   * the Brief-42 precedence `decline > submit > standard > preferred`).
   *
   * `null` when the plan has no `eligibility.gate` node — so plans
   * without an appetite gate run byte-identically to before this field
   * existed. Additive + optional (engine-contract §9 minor). `decline`
   * does NOT abort the run (Brief 42 Q4): premium still computes; the
   * consumer presents a declined risk as out-of-appetite.
   *
   * ADR-0056: a `refer`-policy lookup miss escalates this to at least
   * `submit` (most-restrictive-wins), even on plans with no gate —
   * the referral IS an eligibility signal.
   */
  eligibility_tier?: EligibilityTier | null;
  /**
   * ADR-0056 — every structured row issue this run produced, node ids
   * attached, in node execution order. The aggregate of the per-node
   * `TraceEntry.issues`. Absent (not empty) when the run was clean,
   * so pre-ADR persisted results parse identically.
   */
  issues?: readonly RowIssue[];
  /**
   * ADR-0056 — the row's rating verdict: `"error"` ⇔ at least one
   * severity-"error" issue fired (the row CANNOT be rated — numeric
   * outputs that failed to resolve are withheld, and consumers must
   * render a status, never a number). Distinct from a decline
   * (`eligibility_tier`), which is an authored verdict from
   * SUCCESSFUL rating. Precedence for display: error > decline > ok.
   */
  row_status: "ok" | "error";
}

/**
 * V.22.S3 follow-up — optional run-time configuration passed to
 * `runPlan` / `executePlan` / their batch variants. Today's only
 * field is `as_of`; future fields (e.g. `randomSeed` for sampling
 * blocks, `precision` for fp control) land here additively.
 */
export interface RunOptions {
  /**
   * ISO 8601 date (YYYY-MM-DD) pinning which version of a time-
   * varying resource (filed rate, factor table, curve) the run
   * consults. When omitted, defaults to today (UTC).
   *
   * No bundled block kind consumes `as_of` yet — this parameter is
   * shipped as forward-compat for V.23+ time-aware kinds so
   * integrators don't have to change their call site later. The
   * runtime threads it through the per-node execute context and
   * through subplan recursion regardless.
   */
  readonly as_of?: string;

  /**
   * Class library handle for `input.class_exposure` resolution
   * (Brief 16, M1.2). The runtime forwards this through
   * `ExecuteContext.classLibrary` so kinds can call `lookup(class_code)`
   * at execute time.
   *
   * Optional — plans that don't use `input.class_exposure` don't need
   * to pass one. Plans that do but omit the library surface a clear
   * runtime error via the trace.
   */
  readonly classLibrary?: ClassLibrary;
}

/**
 * Re-exported from `block-types.ts` so both the BlockKind's
 * `execute()` signature AND the runtime that calls it share the
 * same anchoring type.
 */
export type { ExecuteContext } from "./block-types";

/** Compile-time error (validation). */
export interface CompileError {
  kind:
    | "unknown-kind"
    | "cycle"
    | "missing-edge-target"
    | "duplicate-node"
    | "unwired-input";
  message: string;
  nodeId?: string;
  port?: string;
}
