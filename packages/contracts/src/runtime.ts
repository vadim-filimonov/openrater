/**
 * Plan runtime — compile + run.
 *
 * Pure functions. No React. No I/O. Given a Plan + external inputs
 * (a sample account), execute every node in topological order via
 * the BlockKind registry, gather output-node values, and return the
 * full trace.
 *
 * The runtime is intentionally simple. Optimization (vectorization,
 * memoization, JIT) is layered on top later.
 *
 * Ported verbatim from `<prototype>/plan-builder/src/canvas/
 * plan-runtime.ts` (Phase A.1 PR 2 of the original port plan). Renamed to
 * `runtime.ts` to match the port plan's destination mapping. The
 * registry import (`@/blocks` → `./registry`) is the only path change.
 *
 * Per node-design-principle P-N1: every block kind's `execute()`
 * called from here MUST be pure. The runtime enforces that
 * `ctx.as_of` is resolved ONCE per `runPlan` call so kinds reading
 * the temporal anchor see a single consistent date across a long-
 * running execution.
 */

import type {
  CompileError,
  CompiledPlan,
  ExecuteContext,
  Plan,
  PlanEdge,
  PlanNode,
  RunOptions,
  RunResult,
  TraceEntry,
} from "./plan-types";
import type { BlockKind } from "./block-types";
import type { RowIssue, RowIssueSeed } from "./plan-issues";
import { RowIssueError } from "./plan-issues";
import {
  exposureInputKey,
  pickExposureDeclaration,
} from "./exposure-types";
import { type KindRegistry, globalRegistry } from "./registry";
import {
  type EligibilityTier,
  ELIGIBILITY_TIERS,
  isEligibilityTier,
} from "./tier-types";

/** The kind id whose `tier` output `resolveEligibilityTier` reads. */
const ELIGIBILITY_GATE_KIND = "eligibility.gate";

/**
 * Brief 95 C4 — the reserved execution-guard port. An edge INTO this
 * port gates the destination node: when every gathered guard value is
 * falsy, the runtime SKIPS the node (no execute, no issues, outputs
 * `{}`, trace entry marked `skipped`). The name is reserved — no kind
 * declares it, so it never reaches a kind's `inputs`; the edge still
 * participates in the topological order like any other, which is what
 * sequences the guard's producer before its consumers. The projector
 * uses it to gate an elected-out coverage tower's own nodes on its
 * `coverage.election` verdict.
 */
export const GUARD_PORT = "__guard__";

/**
 * Brief 55 — resolve the run's single eligibility verdict from the trace.
 *
 * Pure + deterministic. Scans every executed `eligibility.gate` node's
 * `tier` + `matched_rule_id` outputs (including subplan-nested gates,
 * whose trace keys are `parent/inner`). The resolution honors two
 * facts at once:
 *
 *   1. **Most-restrictive wins.** Among the verdicts that count, the
 *      highest precedence tier wins — `decline > submit > standard >
 *      preferred` (Brief 42 Q10). `ELIGIBILITY_TIERS` is ordered MOST
 *      preferred → LEAST, so the highest index dominates. Order-
 *      independent (no topo order needed).
 *
 *   2. **A FIRED rule beats a default fallback.** A gate whose
 *      `matched_rule_id` is set produced a positive verdict; a gate
 *      that fell through to its `default_tier` did not. So when ANY
 *      gate fired a rule, default-fallbacks don't compete — which is
 *      what lets a matched `preferred` credit survive alongside another
 *      gate's `standard` default (Brief 55 §3.3 — the masking fix).
 *      Only when NO gate fired does the most-restrictive default stand.
 *
 * Returns:
 *   - 0 gates → `null` (the plan has no appetite gate; full back-compat)
 *   - ≥1 gate → the resolved tier per the rules above
 *
 * This is model-agnostic: it gives the correct verdict whether the
 * plan authors one ordered-rule gate (first-match resolved inside the
 * gate) or several single-rule gates (composed here).
 */
export function resolveEligibilityTier(
  trace: Record<string, TraceEntry>,
): EligibilityTier | null {
  let matchedIdx = -1; // best (highest-precedence) tier from a FIRED rule
  let defaultIdx = -1; // best tier among default-fallback gates
  let sawGate = false;
  for (const entry of Object.values(trace)) {
    if (entry.kindId !== ELIGIBILITY_GATE_KIND) continue;
    const tier = entry.outputs?.["tier"];
    if (!isEligibilityTier(tier)) continue;
    sawGate = true;
    const idx = ELIGIBILITY_TIERS.indexOf(tier);
    // matched_rule_id is `string` when a rule fired, `null` on default.
    const matched = entry.outputs?.["matched_rule_id"];
    if (matched != null) {
      if (idx > matchedIdx) matchedIdx = idx;
    } else if (idx > defaultIdx) {
      defaultIdx = idx;
    }
  }
  if (!sawGate) return null;
  const winner = matchedIdx >= 0 ? matchedIdx : defaultIdx;
  return winner === -1 ? null : (ELIGIBILITY_TIERS[winner] ?? null);
}

/**
 * Custom error class thrown by `compilePlan` when validation fails.
 * Preserves the human-readable message (used by existing tests +
 * integrators) AND attaches the structured `errors` array so the
 * unified-issue aggregator (Brief 13 — `collectIssues`) can lift
 * them into Issue records without re-parsing the message string.
 *
 * Brief 13 M1.6 — additive (non-breaking) — `instanceof Error` is
 * preserved.
 */
export class PlanCompileError extends Error {
  readonly errors: readonly CompileError[];
  constructor(message: string, errors: readonly CompileError[]) {
    super(message);
    this.name = "PlanCompileError";
    this.errors = errors;
  }
}

/**
 * Build a trace entry, dropping undefined optional fields so the
 * resulting object honors `exactOptionalPropertyTypes`. Keeps the
 * shape JSON-serializable (no `undefined` properties in the output).
 */
function makeTraceEntry(
  kindId: string,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
  citation: string | undefined,
  explanation: string | undefined,
  error: TraceEntry["error"] | undefined,
  issues?: readonly RowIssue[],
): TraceEntry {
  return {
    kindId,
    inputs,
    outputs,
    ...(citation !== undefined && { citation }),
    ...(explanation !== undefined && { explanation }),
    ...(error !== undefined && { error }),
    ...(issues !== undefined && issues.length > 0 && { issues }),
  };
}

/**
 * Resolve the citation for a node: per-instance `params.citation`
 * (when authored on the node) wins; otherwise the kind's default
 * `kind.citation` (when the kind itself documents a filed authority).
 *
 * Returns `undefined` when neither is set — the trace entry then has
 * no `citation` field.
 */
function resolveCitation(
  nodeParams: unknown,
  kind: BlockKind,
): string | undefined {
  const nodeCitation = (nodeParams as { citation?: string } | undefined)
    ?.citation;
  return nodeCitation ?? kind.citation;
}

/**
 * Call a kind's `explainStep` defensively. Per the contract: kinds
 * MUST NOT throw from explainStep, but if one does, the run keeps
 * going — we just drop the explanation rather than crashing.
 */
/**
 * FCA fca-2026-07-25 #34 — kinds interpolate raw doubles into prose,
 * so traces read "128 × 1.18 = 115.54560000000001" on every product
 * surface (the app drawer and chat both relay these lines). Rewrite
 * embedded float literals with 7+ decimal digits to their intended
 * reading (shortest form within 6 dp). The VALUES are untouched —
 * outputs carry them exactly; only the narration cleans up. Dotted
 * identifiers (v1.2.3, Rule 5.A) never match: the pattern requires a
 * single long fraction part.
 */
export function cleanExplanationNoise(text: string): string {
  return text.replace(/(^|[^\d.])(\d+\.\d{7,})(?![.\d])/g, (_m, pre: string, num: string) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return `${pre}${num}`;
    return `${pre}${parseFloat(n.toFixed(6))}`;
  });
}

function safeExplain(
  kind: BlockKind,
  inputs: Record<string, unknown>,
  params: unknown,
  outputs: Record<string, unknown>,
): string | undefined {
  if (!kind.explainStep) return undefined;
  try {
    const line = kind.explainStep(inputs, params, outputs);
    return line === undefined ? undefined : cleanExplanationNoise(line);
  } catch {
    return undefined;
  }
}

/**
 * Call a kind's `collectRowIssues` defensively — same contract as
 * `safeExplain`: a throwing hook drops its issues rather than
 * crashing the run (ADR-0056).
 */
function safeCollectRowIssues(
  kind: BlockKind,
  inputs: Record<string, unknown>,
  params: unknown,
  outputs: Record<string, unknown>,
): readonly RowIssueSeed[] | undefined {
  if (!kind.collectRowIssues) return undefined;
  try {
    const seeds = kind.collectRowIssues(inputs, params, outputs);
    return seeds && seeds.length > 0 ? seeds : undefined;
  } catch {
    return undefined;
  }
}

/**
 * ADR-0056 — most-restrictive-wins escalation for `refer`-policy
 * misses: a row that referred rates at least `submit`, even when the
 * plan has no eligibility gate (the referral IS an eligibility
 * signal). A gate's `decline` still dominates.
 */
function escalateTierForReferrals(
  tier: EligibilityTier | null,
  issues: readonly RowIssue[],
): EligibilityTier | null {
  if (!issues.some((i) => i.code === "unknown_key_referred")) return tier;
  if (tier === null) return "submit";
  const current = ELIGIBILITY_TIERS.indexOf(tier);
  const submit = ELIGIBILITY_TIERS.indexOf("submit");
  return current >= submit ? tier : "submit";
}

/**
 * Resolve a class-conditional exposure value at runtime.
 *
 * Per Brief 16 (input.class_exposure resolution rules). Reads the
 * bound class_code from externalInputs, looks up the class in the
 * library, picks the right declaration for the coverage scope, and
 * reads the resolved exposure value. Produces a rich explanation
 * sentence per Brief 16 §6 (for the trace's audit panel).
 *
 * Returns a discriminated union — `ok: true` with a value + sentence,
 * or `ok: false` with an actuary-language error string suitable for
 * the trace's error field.
 */
function resolveClassExposure(
  externalInputs: Record<string, unknown>,
  ctx: ExecuteContext,
  classCodeFieldName: string,
  coverage_scope: string | null,
):
  | { ok: true; value: number; explanation: string }
  | { ok: false; error: string } {
  if (!ctx.classLibrary) {
    return {
      ok: false,
      error:
        "Class library not bound on this run. Pass `classLibrary` via RunOptions to use input.class_exposure.",
    };
  }
  const rawCode = externalInputs[classCodeFieldName];
  if (typeof rawCode !== "string" || rawCode.trim() === "") {
    return {
      ok: false,
      error: `Missing or invalid class_code in inputs (expected externalInputs.${classCodeFieldName} to be a non-empty string).`,
    };
  }
  const classCode = rawCode.trim();
  const entry = ctx.classLibrary.lookup(classCode);
  if (!entry) {
    return {
      ok: false,
      error: `Class ${classCode} not found in the bound class library.`,
    };
  }
  if (entry.exposure_bases.length === 0) {
    return {
      ok: false,
      error: `Class ${classCode} (${entry.display_name}) has no declared exposure_bases. Declare one in Classification → Class ${classCode}.`,
    };
  }
  const decl = pickExposureDeclaration(entry.exposure_bases, coverage_scope);
  if (!decl) {
    return {
      ok: false,
      error: `Class ${classCode} (${entry.display_name}) has no exposure declaration matching coverage scope "${coverage_scope}" (and no primary declaration to fall back to).`,
    };
  }
  const inputKey = exposureInputKey(decl);
  const rawValue = externalInputs[inputKey];
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return {
      ok: false,
      error: `Missing ${inputKey} input for class ${classCode} (declared exposure: ${decl.code}). Add ${inputKey} to the per-risk inputs.`,
    };
  }
  // Brief 16 §6 explainStep sentence — verbatim into the trace.
  const role = decl.is_primary
    ? "primary exposure"
    : coverage_scope
      ? `exposure for coverage ${coverage_scope}`
      : "alternate exposure";
  const explanation = `Class ${classCode} (${entry.display_name}) declares ${decl.code} as ${role}; per-risk inputs supplied ${rawValue} ${decl.unit}.`;
  return { ok: true, value: rawValue, explanation };
}

/**
 * Resolve the temporal anchor for a run.
 *
 * Returns the caller-supplied `as_of` when present, else today's date
 * in UTC as `YYYY-MM-DD`. Per the engine-contract doc §7: as_of is
 * always set on the run — never undefined — so block kinds can rely
 * on `ctx.as_of` being a non-empty ISO date string.
 *
 * The runtime captures `as_of` ONCE per `runPlan` call (so a long-
 * running run that crosses a UTC midnight still sees a single,
 * consistent date for every node it executes — reproducibility
 * guarantee §6 depends on this).
 */
function resolveAsOf(options: RunOptions | undefined): string {
  if (options?.as_of !== undefined) return options.as_of;
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Brief 83.4 — coerce a wire value onto an input port's declared type.
 *
 * The port type is the contract; the wire is stringly (CSV rows, HTML
 * forms, integrators whose fact values are string|number). Only the
 * UNAMBIGUOUS coercions apply — a boolean port maps the canonical
 * true/false spellings, a numeric port parses clean numeric strings —
 * and everything else passes through untouched so the consuming node's
 * own policy (onMiss, predicates, banding) names the problem instead
 * of this helper guessing. Typed callers are byte-identical (a value
 * already matching the port type never changes).
 */
function coerceInputToFieldType(value: unknown, fieldType?: string): unknown {
  if (value === undefined || value === null) return value;
  if (fieldType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
      return value;
    }
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
      return value;
    }
    return value;
  }
  if (fieldType === "number" || fieldType === "money" || fieldType === "factor") {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const s = value.trim();
      if (s === "") return value;
      const n = Number(s);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }
  return value;
}

/**
 * Phase F finding (2026-07-17) — coerce a whole externalInputs record
 * onto the plan's declared input ports, ONCE, at the run seam.
 *
 * Before this, only the wire values FLOWING THROUGH input nodes were
 * coerced (Brief 83.4 above); readers of `ctx.externalInputs` itself —
 * the eligibility gate (row AND policy scope), the policy tail's `when`
 * guards — saw the raw wire value. So `"sprinklered": "true"` rated
 * correctly but silently missed an appetite rule's `eq true`, and the
 * same risk earned two verdicts depending on JSON typing — a Law 2
 * violation (engine-contract.md §5.4: refuse or resolve, never
 * improvise).
 *
 * The port type stays the ONE contract: each input / input.source
 * node's `fieldType` drives `coerceInputToFieldType` for its
 * `fieldName` key. Keys no port declares pass through untouched. Two
 * ports declaring the SAME field with DIFFERENT types cancel out
 * (conservative: the record value stays raw; each node still coerces
 * its own port value at execute). Typed callers are byte-identical —
 * a value already matching its port type never changes.
 *
 * Phase F residual (2026-07-17) — the PORT-LESS gate variable. Input
 * ports are created on demand by consumers, so a declared field that
 * ONLY the appetite gate reads gets no input node — and this helper
 * had no port to key from, so the boolean wire spelling "true"
 * strictly missed an `eq true` rule (numeric strings survive via the
 * comparator's E3 widening; booleans since gained the same widening
 * for their LITERAL spellings — FCA fca-2026-07-25, dead knock-out
 * gates). For a variable NO port declares, a row-scope gate rule's
 * RHS is the one type declaration the compiled plan still carries, so
 * it types the record here — at the same seam, under the same
 * conservatism: only the unambiguous case applies (EVERY reference
 * boolean-RHS — a typed boolean or its literal 'true'/'false' string,
 * the workbook spelling — ⇒ boolean; any other reference cancels), a
 * port of ANY kind — even untyped — always wins (an untyped port
 * rates the raw value, so the gate must read the raw value), and
 * policy-scope gates (their rules read rolled totals, not this
 * record) and model-sourced variables (Brief 87 P5 `variable_sources`
 * — resolved at the gate, not from the wire) don't participate.
 */
export function coercePlanExternalInputs(
  compiled: CompiledPlan,
  externalInputs: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const types = new Map<string, string | null>();
  // Every field ANY input port declares — typed or not. The port-less
  // fallback below may only type fields OUTSIDE this set: wherever a
  // port exists, the port (not a gate rule) is the contract.
  const ported = new Set<string>();
  for (const node of compiled.plan.nodes) {
    if (node.kind !== "input" && node.kind !== "input.source") continue;
    const params = node.params as
      | { fieldName?: unknown; fieldType?: unknown }
      | undefined;
    const fieldName = params?.fieldName;
    if (typeof fieldName !== "string" || fieldName === "") continue;
    ported.add(fieldName);
    const fieldType =
      typeof params?.fieldType === "string" ? params.fieldType : undefined;
    if (fieldType === undefined) continue;
    const seen = types.get(fieldName);
    if (seen === undefined) types.set(fieldName, fieldType);
    else if (seen !== fieldType) types.set(fieldName, null);
  }
  // Port-less gate variables (see the docstring): a variable no port
  // declares, referenced by row-scope gate rules whose RHS is boolean
  // in EVERY reference, types as boolean. Mixed evidence cancels
  // (null), exactly like conflicting ports.
  const gateTypes = new Map<string, "boolean" | null>();
  for (const node of compiled.plan.nodes) {
    if (node.kind !== ELIGIBILITY_GATE_KIND) continue;
    const params = node.params as
      | { scope?: unknown; rules?: unknown; variable_sources?: unknown }
      | undefined;
    if (params?.scope === "policy") continue;
    const rules = params?.rules;
    if (!Array.isArray(rules)) continue;
    const sourced =
      params?.variable_sources && typeof params.variable_sources === "object"
        ? (params.variable_sources as Record<string, unknown>)
        : {};
    for (const rule of rules) {
      const r = rule as {
        variable?: unknown;
        op?: unknown;
        value?: unknown;
        conditions?: unknown;
      };
      // Both rule shapes (Brief 81 D-B): the V1 inline triple reads as
      // a single-element condition list, like `ruleConditions` does.
      const conditions: readonly {
        variable?: unknown;
        op?: unknown;
        value?: unknown;
      }[] = Array.isArray(r.conditions) ? r.conditions : [r];
      for (const c of conditions) {
        if (typeof c.variable !== "string" || c.variable === "") continue;
        if (ported.has(c.variable)) continue;
        if (c.variable in sourced) continue;
        // FCA fca-2026-07-25 — a boolean-LITERAL string RHS ('true' /
        // 'false', the workbook gates-sheet spelling; spec §2.1 makes
        // it a legal boolean form) is the same boolean evidence a
        // typed RHS is. Without this, a workbook-built plan's gate
        // never typed its variable, so wire spellings ('yes', 'Y')
        // reached the walk raw — while the identical rule re-saved in
        // the app (boolean RHS) coerced them. Same rule, two verdicts.
        const isBoolEvidence = (v: unknown): boolean => {
          if (typeof v === "boolean") return true;
          if (typeof v !== "string") return false;
          const s = v.trim().toLowerCase();
          return s === "true" || s === "false";
        };
        const boolRhs =
          c.op === "eq" || c.op === "ne"
            ? isBoolEvidence(c.value)
            : (c.op === "in" || c.op === "nin") &&
              Array.isArray(c.value) &&
              c.value.length > 0 &&
              c.value.every(isBoolEvidence);
        if (!boolRhs) gateTypes.set(c.variable, null);
        else if (!gateTypes.has(c.variable)) gateTypes.set(c.variable, "boolean");
      }
    }
  }
  for (const [fieldName, fieldType] of gateTypes) {
    if (fieldType === null) continue;
    types.set(fieldName, fieldType);
  }
  const out: Record<string, unknown> = { ...externalInputs };
  for (const [fieldName, fieldType] of types) {
    if (fieldType === null) continue;
    if (!(fieldName in out)) continue;
    out[fieldName] = coerceInputToFieldType(out[fieldName], fieldType);
  }
  return out;
}

// ── Compile ─────────────────────────────────────────────────

/**
 * Validate the plan and produce an execution-ready compiled form.
 * Throws `Error('Plan does not compile: ...')` on validation failure.
 *
 * `registry` defaults to the shared `globalRegistry` for backwards
 * compatibility — callers wanting an isolated kind set (multi-tenant,
 * sandboxed, per-test) pass a `new KindRegistry()` instance instead.
 * The chosen registry is stored on `CompiledPlan.registry` so the
 * subsequent `runPlan` resolves kinds against the same set the plan
 * was validated against (no silent drift if the global mutates).
 */
export function compilePlan(
  plan: Plan,
  registry: KindRegistry = globalRegistry,
): CompiledPlan {
  const errors: CompileError[] = [];

  // 1. Index nodes; check for duplicate ids
  const nodesById = new Map<string, PlanNode>();
  for (const node of plan.nodes) {
    if (nodesById.has(node.id)) {
      errors.push({
        kind: "duplicate-node",
        message: `Duplicate node id "${node.id}"`,
        nodeId: node.id,
      });
    }
    nodesById.set(node.id, node);
  }

  // 2. Verify every node's kind is registered IN THE SUPPLIED REGISTRY
  for (const node of plan.nodes) {
    if (!registry.get(node.kind)) {
      errors.push({
        kind: "unknown-kind",
        message: `Unknown block kind "${node.kind}" on node "${node.id}"`,
        nodeId: node.id,
      });
    }
  }

  // 3. Verify every edge endpoint exists
  for (const edge of plan.edges) {
    const fromNode = nodesById.get(edge.from.node);
    if (!fromNode) {
      errors.push({
        kind: "missing-edge-target",
        message: `Edge source node "${edge.from.node}" not found`,
        nodeId: edge.from.node,
      });
    }
    const toNode = nodesById.get(edge.to.node);
    if (!toNode) {
      errors.push({
        kind: "missing-edge-target",
        message: `Edge destination node "${edge.to.node}" not found`,
        nodeId: edge.to.node,
      });
    }
  }

  // 4. Build adjacency
  const incoming = new Map<string, PlanEdge[]>();
  const outgoing = new Map<string, PlanEdge[]>();
  for (const node of plan.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of plan.edges) {
    incoming.get(edge.to.node)?.push(edge);
    outgoing.get(edge.from.node)?.push(edge);
  }

  // 5. Topological sort (Kahn). Detects cycles.
  const inDegree = new Map<string, number>();
  for (const node of plan.nodes) {
    inDegree.set(node.id, incoming.get(node.id)?.length ?? 0);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const topoOrder: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topoOrder.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const next = edge.to.node;
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (topoOrder.length !== plan.nodes.length) {
    errors.push({ kind: "cycle", message: "Plan contains at least one cycle" });
  }

  if (errors.length > 0) {
    const summary = errors.map((e) => `  · ${e.message}`).join("\n");
    throw new PlanCompileError(`Plan does not compile:\n${summary}`, errors);
  }

  return {
    plan,
    topoOrder: topoOrder as readonly string[],
    incoming: incoming as ReadonlyMap<string, readonly PlanEdge[]>,
    outgoing: outgoing as ReadonlyMap<string, readonly PlanEdge[]>,
    nodesById: nodesById as ReadonlyMap<string, PlanNode>,
    registry,
  };
}

// ── Run ──────────────────────────────────────────────────────

/**
 * Execute the compiled plan with external inputs.
 *
 * External inputs are keyed by the `input` node's `params.fieldName`.
 * The runtime substitutes those values when an `input` kind executes.
 *
 * Output nodes' input values are collected into `result.outputs`,
 * keyed by their `params.fieldName`.
 */
export function runPlan(
  compiled: CompiledPlan,
  externalInputs: Record<string, unknown>,
  options?: RunOptions,
): RunResult {
  const startedAt = Date.now();
  const as_of = resolveAsOf(options);
  // Phase F (2026-07-17) — wire-string values are coerced onto their
  // declared input ports ONCE, here, so every reader sees the same
  // typed value: the input-node substitution below AND the kinds that
  // read `ctx.externalInputs` directly (eligibility.gate, tail guards).
  // A gate-ONLY variable no port declares types from its rules'
  // boolean RHS (the port-less residual, same day). Idempotent for
  // typed callers; see `coercePlanExternalInputs`.
  const coercedInputs = coercePlanExternalInputs(compiled, externalInputs);
  // Build the ExecuteContext. externalInputs is exposed read-only so
  // kinds that resolve values dynamically (e.g., input.class_exposure)
  // can read from the same source as the runtime's special-cases. The
  // classLibrary handle (Brief 16) is opt-in via RunOptions; kinds that
  // need it but didn't get it fail with a clear runtime error.
  const ctx: ExecuteContext = {
    as_of,
    externalInputs: Object.freeze({ ...coercedInputs }),
    ...(options?.classLibrary ? { classLibrary: options.classLibrary } : {}),
  };
  const nodeOutputs = new Map<string, Record<string, unknown>>();
  const trace: Record<string, TraceEntry> = {};
  const collected: Record<string, unknown> = {};
  // ADR-0056 — structured row issues, aggregated across nodes in
  // execution order. Fatal seeds arrive via RowIssueError from a
  // kind's execute; non-fatal ones via its collectRowIssues hook.
  const rowIssues: RowIssue[] = [];
  const attachIssues = (
    nodeId: string,
    seeds: readonly RowIssueSeed[] | undefined,
  ): RowIssue[] | undefined => {
    if (!seeds || seeds.length === 0) return undefined;
    const withId = seeds.map((s) => ({ ...s, nodeId }));
    rowIssues.push(...withId);
    return withId;
  };

  for (const nodeId of compiled.topoOrder) {
    const node = compiled.nodesById.get(nodeId);
    if (!node) continue;
    // Use the registry the plan was compiled against (not the global)
    // so a run can never silently drift from compile-time validation.
    const kind = compiled.registry.get(node.kind);
    if (!kind) continue;

    // Gather inputs by walking incoming edges
    const inputs: Record<string, unknown> = {};
    const edges = compiled.incoming.get(nodeId) ?? [];

    // Group edges by destination port name — multiple inputs on the
    // same port indicate cardinality 'N' (fan-in).
    const byPort = new Map<string, unknown[]>();
    for (const edge of edges) {
      const srcOutputs = nodeOutputs.get(edge.from.node);
      if (!srcOutputs) continue;
      const value = srcOutputs[edge.from.port];
      const list = byPort.get(edge.to.port) ?? [];
      list.push(value);
      byPort.set(edge.to.port, list);
    }

    // Brief 95 C4 — the reserved `__guard__` port: when every gathered
    // guard value is falsy, the node is SKIPPED — no execute, no
    // issues, outputs `{}` (the projector routes any gated tower's
    // output through an election branch, so the emptiness never leaks
    // into a premium). Multiple guards mean "run if ANY is truthy" —
    // a node two towers share runs while either is elected.
    const guardValues = byPort.get(GUARD_PORT);
    if (guardValues && guardValues.length > 0 && guardValues.every((v) => !v)) {
      const guardEdge = edges.find((e) => e.to.port === GUARD_PORT);
      nodeOutputs.set(nodeId, {});
      trace[nodeId] = {
        ...makeTraceEntry(
          node.kind,
          {},
          {},
          undefined,
          `Skipped — gated off by \`${guardEdge?.from.node ?? "guard"}\` (coverage not elected)`,
          undefined,
        ),
        skipped: true,
      };
      continue;
    }

    // Kinds with `derivedPorts(params)` (e.g., subplan, input.source)
    // expose ports that depend on the node's params; otherwise fall
    // back to the static `kind.inputs` array.
    const effectiveInputPorts = kind.derivedPorts
      ? kind.derivedPorts(node.params).inputs
      : kind.inputs;
    for (const portSpec of effectiveInputPorts) {
      const gathered = byPort.get(portSpec.name) ?? [];
      if (portSpec.cardinality === "N") {
        inputs[portSpec.name] = gathered;
      } else if (gathered.length > 0) {
        inputs[portSpec.name] = gathered[0];
      } else if (portSpec.default !== undefined) {
        inputs[portSpec.name] = portSpec.default;
      }
    }

    const citation = resolveCitation(node.params, kind);

    // Special case: input + input.source kinds substitute external
    // values, with the kind's `params.defaultValue` as a fallback when
    // no external value is supplied. `input.source` is the v4 V.3
    // entity-compiled flavor — it carries the same fieldName contract
    // plus a defaultValue that the InputSource entity authored.
    if (node.kind === "input" || node.kind === "input.source") {
      const params = node.params as
        | { fieldName: string; fieldType?: string; defaultValue?: unknown }
        | undefined;
      const fieldName = params?.fieldName;
      const externalValue =
        fieldName !== undefined ? coercedInputs[fieldName] : undefined;
      const raw =
        externalValue !== undefined ? externalValue : params?.defaultValue;
      // Brief 83.4 — the port TYPE is the contract: wire values arrive
      // as strings from CSV rows, HTML forms, and integrators whose
      // fact values are string|number. A BOOLEAN port must not treat
      // "false" as truthy (a string-"false" sprinkler flag silently
      // APPLIED the discount), and a numeric port coerces numeric
      // strings. Non-coercible values pass through untouched — the
      // consuming node's own policy (onMiss, predicates) names them.
      const value = coerceInputToFieldType(raw, params?.fieldType);
      const outputs = { value };
      nodeOutputs.set(nodeId, outputs);
      const explanation = safeExplain(kind, {}, node.params, outputs);
      trace[nodeId] = makeTraceEntry(
        node.kind,
        {},
        outputs,
        citation,
        explanation,
        undefined,
      );
      continue;
    }

    // Special case: input.class_exposure — Brief 16 class-conditional
    // exposure resolution. Reads the bound class_code from
    // externalInputs, looks up the class in ctx.classLibrary, picks
    // the right exposure declaration for the configured coverage
    // scope, and reads the resolved exposure value from
    // externalInputs.
    //
    // Failure modes (each produces an `error` trace entry; downstream
    // nodes see {} outputs but the run continues):
    //   - no class library bound on the run
    //   - class_code missing or non-string in externalInputs
    //   - class not found in library
    //   - class has no exposure_bases declared
    //   - resolved exposure value missing or non-numeric
    //
    // Per Brief 16 §6 (resolution rules) + P-CE6 (missing value
    // blocks submission with clear pointer).
    if (node.kind === "input.class_exposure") {
      const params = (node.params ?? {}) as {
        coverage_scope?: string | null;
        classCodeFieldName?: string;
      };
      const classCodeFieldName = params.classCodeFieldName ?? "class_code";
      const resolution = resolveClassExposure(
        coercedInputs,
        ctx,
        classCodeFieldName,
        params.coverage_scope ?? null,
      );
      if (resolution.ok) {
        const outputs = { value: resolution.value };
        nodeOutputs.set(nodeId, outputs);
        trace[nodeId] = makeTraceEntry(
          node.kind,
          {},
          outputs,
          citation,
          resolution.explanation,
          undefined,
        );
      } else {
        // Brief 16 P-CE6: surface a clear pointer in the trace; the
        // downstream cascade sees {} but doesn't crash. The unified
        // error panel (Brief 13) will surface this from the trace.
        nodeOutputs.set(nodeId, {});
        trace[nodeId] = makeTraceEntry(
          node.kind,
          {},
          {},
          citation,
          undefined,
          { message: resolution.error, at: "execute" },
        );
      }
      continue;
    }

    // Special case: subplan kind recursively compiles + runs an
    // embedded Plan (Plan Format Spec v1 §5.5). The outer node's
    // gathered `inputs` become the inner plan's externalInputs; the
    // inner plan's collected `outputs` become this subplan node's
    // outputs. Inner trace entries are namespaced under
    // `${parentId}/${innerId}` so audits can drill in.
    //
    // Cycle protection: spec §5.5 mandates that recursive subplans
    // be caught at compile time as a `cycle` error. The compile step
    // is responsible; the runtime here recurses freely.
    if (node.kind === "subplan") {
      const params = node.params as { plan?: Plan } | undefined;
      if (!params?.plan) {
        // Invalid subplan params; produce empty outputs and continue.
        nodeOutputs.set(nodeId, {});
        trace[nodeId] = makeTraceEntry(
          node.kind,
          inputs,
          {},
          citation,
          undefined,
          undefined,
        );
        continue;
      }
      // Subplan inherits the outer plan's REGISTRY so the inner plan
      // resolves kinds against the same set its caller validated
      // against. Without this, the inner plan would compile against
      // globalRegistry even when the outer was scoped to an isolated
      // registry — a silent capability leak in multi-tenant scopes.
      const innerCompiled = compilePlan(params.plan, compiled.registry);
      // Subplan inherits the outer run's temporal anchor so nested
      // time-aware kinds resolve against the same as_of as the parent.
      const innerResult = runPlan(innerCompiled, inputs, { as_of });
      nodeOutputs.set(nodeId, innerResult.outputs);
      trace[nodeId] = makeTraceEntry(
        node.kind,
        inputs,
        innerResult.outputs,
        citation,
        undefined,
        undefined,
      );
      // Nest inner trace under the parent node id for audit drilling.
      for (const [innerId, innerEntry] of Object.entries(innerResult.trace)) {
        trace[`${nodeId}/${innerId}`] = innerEntry;
      }
      continue;
    }

    // Execute through the registry — pass the run's temporal context
    // so time-aware kinds can read ctx.as_of. Wrap in try/catch so a
    // throwing kind produces a partial trace (with the error captured
    // on the failing entry) rather than aborting the run. Downstream
    // nodes still execute; they see the failed node's outputs as `{}`
    // which typically resolves to `undefined` per-port and propagates
    // forward.
    let outputs: Record<string, unknown>;
    let error: TraceEntry["error"] | undefined;
    let issueSeeds: readonly RowIssueSeed[] | undefined;
    try {
      outputs = kind.execute(inputs, node.params, ctx) as Record<
        string,
        unknown
      >;
    } catch (e) {
      outputs = {};
      error = {
        message: e instanceof Error ? e.message : String(e),
        at: "execute",
      };
      // ADR-0056 — a typed Law-2 refusal carries its structured seed
      // through the throw; preserve it instead of only the message.
      if (e instanceof RowIssueError) issueSeeds = [e.seed];
    }
    nodeOutputs.set(nodeId, outputs);

    // Only ask the kind for an explanation when execute succeeded.
    // A failed node has no meaningful outputs to explain.
    const explanation =
      error === undefined
        ? safeExplain(kind, inputs, node.params, outputs)
        : undefined;

    // Non-fatal structured issues (authored default applied, territory
    // unmapped, band clamped, …) — only meaningful on success.
    if (error === undefined) {
      issueSeeds = safeCollectRowIssues(kind, inputs, node.params, outputs);
    }

    trace[nodeId] = makeTraceEntry(
      node.kind,
      inputs,
      outputs,
      citation,
      explanation,
      error,
      attachIssues(nodeId, issueSeeds),
    );

    // If this is an output kind, collect its `value` input into the result
    if (node.kind === "output") {
      const params = node.params as
        | { fieldName: string; fieldType?: string }
        | undefined;
      const fieldName = params?.fieldName;
      if (fieldName !== undefined) {
        const value = inputs.value;
        // ADR-0056 backstop — a NUMERIC-typed output that failed to
        // resolve (undefined from a poisoned upstream, NaN/±Infinity
        // from broken arithmetic) is WITHHELD from `outputs` and
        // recorded as an `unresolved_output` error: whatever failed
        // upstream, a non-number never leaves the engine looking like
        // a premium. Non-numeric output types pass through untouched.
        const numericType =
          params?.fieldType === "money" ||
          params?.fieldType === "number" ||
          params?.fieldType === "factor";
        const unresolved =
          numericType &&
          (value === undefined ||
            (typeof value === "number" && !Number.isFinite(value)));
        if (unresolved) {
          const withId = attachIssues(nodeId, [
            {
              severity: "error",
              code: "unresolved_output",
              message: `Output \`${fieldName}\` did not resolve to a number — an upstream step failed, so this row has no rateable ${params?.fieldType ?? "value"}.`,
              detail: { field: fieldName },
            },
          ]);
          // Fold onto the output node's just-written trace entry so the
          // audit trace stays self-describing (P-N5).
          const prev = trace[nodeId];
          if (withId && prev) {
            trace[nodeId] = {
              ...prev,
              issues: [...(prev.issues ?? []), ...withId],
            };
          }
        } else {
          collected[fieldName] = value;
        }
      }
    }
  }

  // ADR-0056 — a `refer`-policy miss escalates the eligibility verdict
  // to at least `submit` (most-restrictive-wins, gates still dominate).
  const eligibility_tier = escalateTierForReferrals(
    resolveEligibilityTier(trace),
    rowIssues,
  );

  return {
    outputs: collected,
    trace,
    startedAt,
    durationMs: Date.now() - startedAt,
    as_of,
    eligibility_tier,
    ...(rowIssues.length > 0 ? { issues: rowIssues } : {}),
    // error ⇔ any severity-"error" issue: the row cannot be rated.
    // Distinct from a decline (an authored verdict from SUCCESSFUL
    // rating). Display precedence: error > decline > ok.
    row_status: rowIssues.some((i) => i.severity === "error")
      ? ("error" as const)
      : ("ok" as const),
  };
}

/**
 * Convenience helper: compile and run a single record.
 *
 * `registry` is forwarded to `compilePlan` — pass an isolated
 * `KindRegistry` instance to scope the run away from the global
 * (multi-tenant, sandbox, test). Defaults to `globalRegistry`.
 */
export function executePlan(
  plan: Plan,
  externalInputs: Record<string, unknown>,
  options?: RunOptions,
  registry?: KindRegistry,
): RunResult {
  return runPlan(compilePlan(plan, registry), externalInputs, options);
}

/**
 * Run a compiled plan against a BATCH of input records.
 *
 * Returns one `RunResult` per input record, in the same order.
 *
 * For each node in topological order:
 *   · if its kind defines `executeBatch`, the runtime calls it ONCE
 *     with the full vector of inputs (useful for ML model nodes,
 *     vectorized math, Parquet-backed lookups)
 *   · otherwise it falls back to N calls to `execute` (one per record)
 *
 * Plans don't need to know they're running in batch mode. They get
 * the same trace and the same outputs — just multiplied.
 */
export function runPlanBatch(
  compiled: CompiledPlan,
  externalInputsArr: readonly Record<string, unknown>[],
  options?: RunOptions,
): readonly RunResult[] {
  // v0: trivial implementation — call runPlan once per record. The
  // vectorized fast path (single call to executeBatch per node) will
  // ship in the engine refactor; the runtime API is set so plans
  // don't change when it does.
  //
  // Resolve as_of ONCE for the whole batch (caller's value, or today
  // captured at batch start). Each row sees the same temporal anchor
  // — without this the per-row default resolution could drift across
  // a midnight crossing during a long-running batch.
  //
  // Every OTHER option threads through untouched (FCA review 2026-07-26:
  // `{ as_of }` alone silently dropped `classLibrary`, so any batch-path
  // re-run — evaluatePolicyBook's composition included — rated class-
  // exposure rows against an unbound library while the single-risk path
  // rated them correctly).
  const as_of = resolveAsOf(options);
  return externalInputsArr.map((record) =>
    runPlan(compiled, record, { ...options, as_of }),
  );
}

/**
 * Compile + run a batch in one shot.
 *
 * `registry` is forwarded to `compilePlan` — same semantics as
 * `executePlan`. Defaults to `globalRegistry`.
 */
export function executePlanBatch(
  plan: Plan,
  externalInputsArr: readonly Record<string, unknown>[],
  options?: RunOptions,
  registry?: KindRegistry,
): readonly RunResult[] {
  return runPlanBatch(compilePlan(plan, registry), externalInputsArr, options);
}
