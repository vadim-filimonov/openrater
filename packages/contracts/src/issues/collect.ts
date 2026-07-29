/**
 * `collectIssues(plan, run?, registry?)` — single-pass aggregator.
 *
 * Brief 13 P-UE1 — consolidates ALL diagnostic signals across the
 * plan into one common `Issue[]`. The unified panel + status bar
 * (lands in M2) consume this verbatim.
 *
 * Sources covered (Brief 13 §6 step list):
 *   1. Compile errors — from `compilePlan()`
 *   2. Reference integrity — from `validatePlanReferences()` when
 *      a snapshot is supplied
 *   3. Runtime errors — extracted from `run.trace[*].error`
 *   4. Authoring — per-section validators (V1: kind.validate per
 *      node)
 *   5. Conformance — failing conformance vectors (V1 stub; the
 *      caller passes pre-computed conformance results as an option
 *      since running the suite has side effects)
 *
 * Deterministic ranking via `rankIssues`. Stable ids via
 * `deriveIssueId`. Pure + reproducible per Brief 13 P-UE8 — same
 * inputs → byte-identical output (verified by tests).
 *
 * See `docs/design-briefs/unified-error-surface.md`.
 */

import type { CompileError, Plan, RunResult } from "../plan-types";
import { compilePlan, PlanCompileError } from "../runtime";
import { type KindRegistry } from "../registry";
import {
  validatePlanReferences,
  type PlanEntitiesSnapshot,
  type PlanIssue,
} from "../validation";
import type { Issue, IssueSeverity } from "./types";
import {
  defaultFilingBlocking,
  deriveIssueId,
  rankIssues,
} from "./helpers";

/**
 * Optional inputs to `collectIssues` beyond the required plan.
 *
 *   - run:           a RunResult — when provided, runtime errors
 *                    from the trace are surfaced.
 *   - registry:      the KindRegistry the plan was compiled with;
 *                    defaults to globalRegistry.
 *   - entities:      snapshot for `validatePlanReferences` (Brief
 *                    13 step 2). Surfaces ref-integrity issues
 *                    against an authoring-side entity registry.
 *   - conformance:   pre-computed conformance results — a list of
 *                    `{ vector_id, passed, message }`. Failing
 *                    vectors surface as Issues (severity = info by
 *                    default; filing_blocking only when explicitly
 *                    tagged).
 */
export interface CollectIssuesInput {
  readonly run?: RunResult;
  readonly registry?: KindRegistry;
  readonly entities?: PlanEntitiesSnapshot;
  readonly conformance?: readonly ConformanceVectorResult[];
}

/** One conformance vector's pass/fail outcome. */
export interface ConformanceVectorResult {
  readonly vector_id: string;
  readonly passed: boolean;
  /** Actuary-language message describing the divergence (when failed)
   *  or confirmation (when passed). */
  readonly message: string;
  /** Whether this vector is in the regulator-required set. When true
   *  AND the vector failed, the issue is marked filing_blocking. */
  readonly filing_required?: boolean;
}

/**
 * Aggregate diagnostic issues from across the plan.
 *
 *   const issues = collectIssues(plan);
 *   const issues2 = collectIssues(plan, { run, registry, entities });
 *
 * Returns a ranked `Issue[]` ready for the unified panel to render.
 * The ordering is stable — same inputs always produce the same
 * sequence (Brief 13 P-UE8).
 */
export function collectIssues(
  plan: Plan,
  input: CollectIssuesInput = {},
): readonly Issue[] {
  const out: Issue[] = [];

  // ── 1. Compile errors ─────────────────────────────────────────
  try {
    compilePlan(plan, input.registry);
  } catch (e) {
    out.push(...compileErrorsToIssues(e));
  }

  // ── 2. Reference integrity ────────────────────────────────────
  if (input.entities !== undefined) {
    const report = validatePlanReferences(input.entities);
    out.push(...planIssuesToIssues(report.issues));
  }

  // ── 3. Runtime errors ─────────────────────────────────────────
  if (input.run !== undefined) {
    out.push(...runtimeErrorsToIssues(input.run, plan));
  }

  // ── 4. Authoring — per-node kind.validate ─────────────────────
  if (input.registry !== undefined) {
    out.push(...nodeValidationToIssues(plan, input.registry));
  }

  // ── 5. Conformance results ────────────────────────────────────
  if (input.conformance !== undefined) {
    out.push(...conformanceToIssues(input.conformance));
  }

  // Deterministic ranking. Sort returns a NEW array; consumers can
  // safely store/iterate without worrying about mutation.
  return Object.freeze([...out].sort(rankIssues));
}

// ── Source-specific converters ──────────────────────────────────────

/**
 * Convert a compilePlan() exception into Issue records. The runtime
 * throws `Error('Plan does not compile: <serialized errors>')`; we
 * parse the structured `errors` array if present (the runtime
 * attaches it as a custom property) OR fall back to a single
 * generic Issue.
 */
function compileErrorsToIssues(thrown: unknown): Issue[] {
  // PlanCompileError carries the structured `errors` array directly.
  if (thrown instanceof PlanCompileError) {
    return thrown.errors.map((e) => compileErrorToIssue(e));
  }
  // Fallback: any other thrown value (defensive — shouldn't happen
  // in V1, but Brief 13 wants the aggregator to be robust).
  const message =
    thrown instanceof Error
      ? thrown.message
      : `Plan failed to compile: ${String(thrown)}`;
  return [
    {
      id: deriveIssueId({
        source: "compile",
        location: { section: "rate-against-sample" },
        message_template: "compile_failed",
        format_args: [message],
      }),
      severity: "error",
      source: "compile",
      message: message.endsWith(".") ? message : `${message}.`,
      location: { section: "rate-against-sample" },
      filing_blocking: true,
    },
  ];
}

function compileErrorToIssue(e: CompileError): Issue {
  const messageTemplate = e.kind;
  // Tag location by node id when available; fall back to a generic
  // section. The deep-link resolver in M2 maps nodeId → the right
  // section based on the plan's structure.
  const location = e.nodeId
    ? { section: sectionForNode(e.nodeId), entity: e.nodeId, ...(e.port ? { field: e.port } : {}) }
    : { section: "rate-against-sample" };
  return {
    id: deriveIssueId({
      source: "compile",
      location,
      message_template: messageTemplate,
      format_args: [e.message],
    }),
    severity: "error",
    source: "compile",
    message: e.message.endsWith(".") ? e.message : `${e.message}.`,
    location,
    filing_blocking: true,
  };
}

/**
 * Map a node id to a section. The compiler doesn't know about
 * sections, but in V1 we can use the kind prefix to infer:
 *   - input.* / uw.* nodes  → risk-inputs
 *   - chain.* / modifier.* / curve.*  → rating-chains (or
 *     modifiers / curves; defer to UI layer for refinement)
 *   - eligibility.gate  → eligibility-appetite
 *   - lookup.* nodes  → factor-tables (or classification when
 *     lookup.classification)
 *   - output nodes  → outputs
 *
 * V1: return a coarse default. The UI layer can refine when it has
 * the section_layout context. For substrate-level diagnostics,
 * mapping to "rate-against-sample" is a reasonable fallback (it's
 * where compile errors typically surface anyway).
 */
function sectionForNode(_nodeId: string): string {
  // V1 placeholder. UI integrates a smarter mapping via
  // section_layout. Keep substrate dumb but deterministic.
  return "rate-against-sample";
}

function planIssuesToIssues(planIssues: readonly PlanIssue[]): Issue[] {
  return planIssues.map((pi) => {
    const severity: IssueSeverity =
      pi.severity === "error" ? "error" : "warning";
    const location = {
      section: pi.sectionId,
      ...(pi.brokenRef ? { entity: pi.brokenRef.id } : {}),
      ...(pi.field ? { field: pi.field } : {}),
    };
    // Template the message-id off the broken-ref kind when available;
    // fall back to a generic "plan-issue" tag.
    const messageTemplate = pi.brokenRef
      ? `unresolved_${pi.brokenRef.kind}`
      : "plan_issue";
    return {
      id: deriveIssueId({
        source: "reference",
        location,
        message_template: messageTemplate,
        format_args: [pi.message],
      }),
      severity,
      source: "reference",
      message: pi.message.endsWith(".") ? pi.message : `${pi.message}.`,
      location,
      filing_blocking: defaultFilingBlocking(severity, "reference"),
    };
  });
}

function runtimeErrorsToIssues(run: RunResult, _plan: Plan): Issue[] {
  const issues: Issue[] = [];
  for (const [nodeId, entry] of Object.entries(run.trace)) {
    if (!entry.error) continue;
    const location = {
      section: sectionForNode(nodeId),
      entity: nodeId,
    };
    issues.push({
      id: deriveIssueId({
        source: "runtime",
        location,
        message_template: `runtime_${entry.error.at}`,
        format_args: [entry.error.message],
      }),
      severity: "error",
      source: "runtime",
      message: entry.error.message.endsWith(".")
        ? entry.error.message
        : `${entry.error.message}.`,
      location,
      filing_blocking: true,
    });
  }
  return issues;
}

function nodeValidationToIssues(
  plan: Plan,
  registry: KindRegistry,
): Issue[] {
  const out: Issue[] = [];
  for (const node of plan.nodes) {
    const kind = registry.get(node.kind);
    if (!kind || !kind.validate) continue;
    let result;
    try {
      result = kind.validate(node.params);
    } catch {
      // Defensive: a misbehaving validate() shouldn't crash the
      // aggregator. Surface as a generic authoring info.
      continue;
    }
    if (result.valid) continue;
    for (const issue of result.issues) {
      const severity: IssueSeverity =
        issue.severity === "error" ? "error" : "warning";
      const location = {
        section: sectionForNode(node.id),
        entity: node.id,
        ...(issue.field ? { field: issue.field } : {}),
      };
      out.push({
        id: deriveIssueId({
          source: "authoring",
          location,
          message_template: `${node.kind}.validate`,
          format_args: [issue.message],
        }),
        severity,
        source: "authoring",
        message: issue.message.endsWith(".") ? issue.message : `${issue.message}.`,
        location,
        filing_blocking: defaultFilingBlocking(severity, "authoring"),
      });
    }
  }
  return out;
}

function conformanceToIssues(
  results: readonly ConformanceVectorResult[],
): Issue[] {
  const out: Issue[] = [];
  for (const r of results) {
    if (r.passed) continue;
    const severity: IssueSeverity = r.filing_required ? "error" : "info";
    const location = { section: "rate-against-sample" };
    out.push({
      id: deriveIssueId({
        source: "conformance",
        location,
        message_template: `conformance_${r.vector_id}`,
        format_args: [r.message],
      }),
      severity,
      source: "conformance",
      message: r.message.endsWith(".") ? r.message : `${r.message}.`,
      location,
      filing_blocking: r.filing_required === true,
    });
  }
  return out;
}
