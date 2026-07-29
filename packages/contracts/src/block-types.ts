/**
 * Block contract — pure types only.
 *
 * Ported verbatim from `<prototype>/plan-builder/src/blocks/types.ts`
 * (Phase A.1 of the original port plan). React-dependent fields (`renderBody`,
 * `renderInspector`, `BlockProps`, `BlockAction.run`) are split out;
 * they live in the rate-lab frontend (where React is a dep), NOT
 * here in `@openrater/contracts` (which has zero runtime dependencies on
 * any UI framework).
 *
 * Per node-design-principle P-N1 (pure execute) + P-N2 (typed I/O):
 * the `BlockKind.execute()` function is the canonical "what does
 * this block compute?" contract. The React renderer is a different
 * file with a different lifetime.
 *
 * See: `docs/specs/plan-format-v1.md` for the normative spec.
 */

// ── Type vocabulary ──────────────────────────────────────────
// The closed set of primitive types that flow through ports.
// Composite types (optional, list, record) wrap primitives.

export type PrimitiveType =
  | "money"
  | "factor"
  | "pct"
  | "class_code"
  | "string"
  | "date"
  | "bool"
  | "int"
  | "float"
  | "model_output"
  | "record";

export type TypeRef =
  | PrimitiveType
  | { kind: "optional"; of: TypeRef }
  | { kind: "list"; of: TypeRef }
  | { kind: "record"; fields: Record<string, TypeRef> };

// ── Ports — the studs ───────────────────────────────────────

export interface PortSpec {
  /** Stable name within the block, e.g., 'class_code', 'value' */
  name: string;
  /** What flows through this port */
  type: TypeRef;
  /** If true, the port may be left unwired (uses `default`) */
  optional?: boolean;
  /** Used when port is unwired */
  default?: unknown;
  /** Most ports are 1; math.sum and similar are 'N' (fan-in) */
  cardinality?: 1 | "N";
  /** Human-readable description, shown in tooltip + inspector */
  description?: string;
}

// ── Block categories — the family tree ──────────────────────

export type BlockCategory =
  | "input" // declare an external input port for the plan
  | "output" // declare an external output port for the plan
  | "constant" // a literal value
  | "lookup" // table-based factor retrieval
  | "transform" // a single-output function
  | "math" // arithmetic operations
  | "branch" // conditional flow
  | "chain" // ordered composition
  | "model" // imported predictive model
  | "api" // external HTTP call
  | "custom" // user-defined sandboxed function
  | "subplan"; // group of nodes wrapped as one brick

// ── Block state — the 8 visual states ───────────────────────
// (Ported here even though it's UI-flavored — small, useful in
// run-result shapes, no React dep.)

export type BlockState =
  | "idle"
  | "hover"
  | "selected"
  | "edited"
  | "error"
  | "running"
  | "ok"
  | "ghost";

// ── Density — semantic resolution ───────────────────────────
// Determines which body renderer the UI invokes. Stays in
// contracts so kinds' defaults are typed without a UI import.

export type BlockSize = "compact" | "regular" | "large";

// ── Validation ──────────────────────────────────────────────

export interface ValidationIssue {
  severity: "info" | "warning" | "error";
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly ValidationIssue[];
}

// ── Jacobian — for inverse cascade ──────────────────────────
// Maps (output_port, input_port) → partial derivative.
// Optional; kinds that don't supply one opt out of differentiable
// composition for plans that use them.

export type Jacobian = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

// ── The pure block kind contract ────────────────────────────
//
// The RUNTIME parts of the block kind. Implementing this is what
// makes a function callable from the engine. The UI-rendering
// extension (`renderBody`, `renderInspector`, `BlockProps`) lives
// in the frontend where React is in scope.
//
// Type parameters:
//   P = params shape (kind-specific configuration)
//   I = inputs shape (what flows in from upstream wires)
//   O = outputs shape (what flows out to downstream wires)

export interface BlockKind<P = unknown, I = unknown, O = unknown> {
  /** Stable identifier, e.g., 'lookup.range' */
  id: string;
  /** Family — for tray grouping + library navigation */
  category: BlockCategory;
  /** Human-readable name, shown in header + tray */
  label: string;
  /** One-line description, shown in tray + library */
  description: string;

  // ── Schema ──
  /** Declared input ports */
  inputs: readonly PortSpec[];
  /** Declared output ports */
  outputs: readonly PortSpec[];
  /** Default params when a new instance is created */
  defaultParams: P;
  /**
   * Optional · derive ports per instance from its params (e.g. a
   * subplan whose ports mirror the inner Plan's input/output nodes).
   * When omitted, the static `inputs`/`outputs` arrays above are
   * authoritative.
   */
  derivedPorts?: (params: P) => {
    inputs: readonly PortSpec[];
    outputs: readonly PortSpec[];
  };
  /** Optional citation reference for the math (e.g., 'ISO BP-2024-RLC pp.47'). */
  citation?: string;
  /** Optional · where this kind came from (core | template | imported | ai-authored | custom). */
  provenance?: string;
  /** Optional · trust level (filed | approved | draft | experimental). */
  certainty?: string;
  /** Optional · replay guarantee (strict | probabilistic | nondeterministic). */
  determinism?: string;
  /** Optional · sandbox boundary (none | reads | writes | external). */
  sideEffects?: string;

  /** Default size when a new instance is placed. */
  defaultSize: BlockSize;

  // ── Execution — pure function on the data ──
  /**
   * Compute outputs from one input record. MUST be deterministic.
   *
   * Per node-design-principle P-N1: no side effects, no wall clock
   * reads outside `ctx.as_of`, no network calls. Same inputs +
   * params + ctx produce byte-identical outputs forever.
   *
   * The runtime calls this once per record in single-mode; once per
   * record in batch-mode unless `executeBatch` is provided.
   */
  execute: (inputs: I, params: P, ctx?: ExecuteContext) => O;

  /**
   * Optional batch hook for vectorization optimizations.
   *
   * When present, the runtime calls this once for an entire batch
   * (e.g., a portfolio CSV) instead of N calls to `execute`. Useful
   * for model nodes, matrix math, and lookup tables backed by
   * Parquet — anywhere per-record overhead matters.
   *
   * If not present, the runtime falls back to
   *   inputsArr.map((inputs) => execute(inputs, params, ctx))
   */
  executeBatch?: (
    inputsArr: readonly I[],
    params: P,
    ctx?: ExecuteContext,
  ) => readonly O[];

  // ── Differentiability (optional) ──
  jacobian?: (inputs: I, params: P, outputs: O) => Jacobian;

  // ── Validation (optional) ──
  validate?: (params: P) => ValidationResult;

  // ── Explanation (optional) ──
  /**
   * Author a human-readable one-line explanation of what this node
   * DID at runtime. Called once per executed node, with the actual
   * inputs + params + outputs. The returned string is stored on the
   * trace entry and surfaces in the audit / trace UI as-is.
   *
   * Audience: actuary or underwriter, not engineer. No code, no
   * variable names, no jargon. "Classified 73912 → 1.32" beats
   * "table[key]=1.32".
   *
   * Per node-design-principle P-N5 (trace contract): the trace must
   * be self-describing without consulting external metadata. This is
   * how a kind contributes its share of that contract.
   *
   * If omitted, the trace entry has no `explanation` field; the UI
   * falls back to showing raw inputs/outputs.
   *
   * MUST NOT throw — the runtime wraps the call in a try/catch and
   * silently drops the explanation if it does, but a misbehaving
   * `explainStep` masks itself from view. Keep this pure.
   */
  explainStep?: (inputs: I, params: P, outputs: O) => string;

  // ── Structured row issues (optional) — ADR-0056 ──
  /**
   * Report NON-FATAL structured issues about what this node did with
   * one row: an authored `default(x)` resolution applied, an unmapped
   * territory, an out-of-range band clamp. Called once per executed
   * node after a SUCCESSFUL `execute` (a fatal refusal throws
   * `RowIssueError` from `execute` instead — that's the error
   * channel). The runtime attaches the node id, stores the issues on
   * the trace entry, and aggregates them onto `RunResult.issues`.
   *
   * Like `explainStep`: pure, MUST NOT throw (the runtime wraps it
   * and drops the result if it does), audience is the actuary. Named
   * `collectRowIssues` to stay clear of the Brief-13 plan-level
   * `collectIssues` aggregator.
   */
  collectRowIssues?: (
    inputs: I,
    params: P,
    outputs: O,
  ) => readonly RowIssueSeed[] | undefined;
}

// ── ExecuteContext — V.22.S3 follow-up + Phase B M1.2 additions ─────
// Re-exported here so block kinds can import it without a circular
// dependency on `plan-types.ts`. (The same type is exported from
// plan-types.ts for runtime consumers; both point at this one.)

import type { ClassLibrary } from "./class-library-types";
import type { RowIssueSeed } from "./plan-issues";

export interface ExecuteContext {
  /**
   * Resolved temporal anchor for this run. Always set — defaults
   * to today (UTC, `YYYY-MM-DD`) when the caller didn't pin one.
   */
  readonly as_of: string;

  /**
   * The full external inputs map for this run, passed verbatim from
   * `runPlan(compiled, externalInputs, ...)`. Available so kinds that
   * resolve their value dynamically (e.g., `input.class_exposure`
   * which picks the right exposure key after a class lookup) can read
   * from the same source as the runtime's `input` special-case.
   *
   * Per Brief 16 (M1.2). Optional for backward compat; callers using
   * the bundled runtime always get this populated, but third-party
   * runtimes that don't pass it through gracefully degrade.
   */
  readonly externalInputs?: Readonly<Record<string, unknown>>;

  /**
   * Class library handle — used by `input.class_exposure` to resolve
   * a bound class's declared exposure(s) at execution time.
   *
   * Per Brief 16 (M1.2). Optional — when omitted, kinds requiring it
   * surface a clear error via the trace.
   */
  readonly classLibrary?: ClassLibrary;
}

// ── Type guards ─────────────────────────────────────────────

export function isPrimitiveType(t: TypeRef): t is PrimitiveType {
  return typeof t === "string";
}

export function primitiveOf(t: TypeRef): PrimitiveType | null {
  if (isPrimitiveType(t)) return t;
  if (t.kind === "optional" || t.kind === "list") return primitiveOf(t.of);
  return null;
}

/**
 * Two types are compatible if they're identity-equal, or one is the
 * optional wrapper of the other (in the direction T → optional(T)),
 * or they share the same underlying primitive after stripping wrappers.
 *
 * Special case: pct ↔ factor coercion is allowed (recorded on the edge).
 */
export function isCompatible(from: TypeRef, to: TypeRef): boolean {
  // Identity
  if (JSON.stringify(from) === JSON.stringify(to)) return true;

  // T → optional(T)
  if (typeof to === "object" && to.kind === "optional") {
    return isCompatible(from, to.of);
  }

  // Same underlying primitive
  const f = primitiveOf(from);
  const g = primitiveOf(to);
  if (f && g && f === g) return true;

  // pct ↔ factor: allowed coercion (recorded on the edge)
  if (f && g && ((f === "pct" && g === "factor") || (f === "factor" && g === "pct"))) {
    return true;
  }

  return false;
}
