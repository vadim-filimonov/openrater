/**
 * report-walk — Brief 93 §1.1.3: the reference risk, walked.
 *
 * Runs ONE risk (the representative pins) through the production
 * engine (ADR-0045 — the same compilePlan/runPlan every surface uses)
 * and projects the RunResult's trace into the report's build-up rows:
 *
 *   base → each chain factor (named, in wiring order) → each
 *   post-chain step (round / clamp / modifiers…) → premium.
 *
 * The walk follows the premium output BACKWARD through single-input
 * money steps until it reaches the plan's `chain.mult`, which expands
 * into its factor rows. A composite upstream (chain.add / lob_sum /
 * subplans) STOPS the descent honestly: its result renders as the
 * walk's base row, labeled as a composition, never invented as a fake
 * linear chain.
 *
 * ── The total-less multi-coverage plan (93.4) ──
 * A filing with ≥2 coverage towers and NO total row declares no
 * aggregate (Brief 92 — the ingest never invents one), so there is no
 * single output to anchor on: the risk's premium is the dec-page SUM
 * of its coverage premiums. Such a plan walks EVERY tower into ONE
 * ledger — each coverage's build-up closing on its own subtotal row —
 * and the headline is the sum (§1.1.3 amendment, CT-4). Anchoring on
 * one output instead headlined the LAST tower: the live repro read
 * "$72" for a risk costing $267.
 *
 * Classification reads the authored STAGES via the shared
 * `resolvePlanPremiumContext` — never the projected graph, where every
 * exposure-rated tower tip carries its own ISO `round` node.
 *
 * Refusals are first-class (ADR-0056): a reference risk the plan
 * declines to rate yields `refusal` (named), not a number. Law 2 / G8 —
 * an error row NEVER sums its surviving towers.
 */

import {
  compilePlan,
  runPlan,
  type CompiledPlan,
  type Plan,
  type PlanEdge,
  type RunResult,
} from "@openrater/contracts";
import { resolvePremiumColumn } from "./analytics-bridge";
import {
  COVERAGE_SUM_COLUMN,
  isTotalLessMultiCoverage,
  resolvePlanPremiumContext,
  sumMoneyFields,
  type PremiumStageLike,
} from "./premium-resolution";

export interface WalkRow {
  /** Trace node id this row derives from (unique per row via suffix). */
  readonly id: string;
  readonly label: string;
  /** `subtotal` closes one coverage tower's build-up on a total-less
   *  multi-coverage plan; the towers then ADD to the headline. */
  readonly kind: "base" | "factor" | "step" | "subtotal";
  /** Display operation ("× 1.32", "round", …). Null for the base. */
  readonly op: string | null;
  /** Running value AFTER this row, when finite. */
  readonly running: number | null;
}

export interface ReferenceWalk {
  readonly rows: readonly WalkRow[];
  /** The headline premium (finite) or null when withheld/refused. */
  readonly premium: number | null;
  readonly premiumColumn: string;
  /** True when `premium` is the dec-page SUM over coverage towers (the
   *  plan declares no total) — `premiumColumn` is then the synthesized
   *  `COVERAGE_SUM_COLUMN` and the copy must say so. */
  readonly coverageSum: boolean;
  /** Named refusal when the reference risk cannot be rated. */
  readonly refusal: string | null;
  /** The full run — the trace panel / debugging can reuse it. */
  readonly run: RunResult;
}

/** First finite numeric among a trace entry's outputs. */
function firstFiniteOutput(
  outputs: Record<string, unknown> | undefined,
): number | null {
  if (!outputs) return null;
  for (const v of Object.values(outputs)) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function fmtFactor(f: number): string {
  // 1.32 → "1.32", 0.9 → "0.90", 1.3333333 → "1.333" — enough digits
  // to reproduce the arithmetic by hand without mono-column noise.
  const abs = Math.abs(f);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return f
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** Display op for a post-chain step node. Humble: named kinds get a
 *  verb; anything else states its factor when one is visible, else a
 *  neutral arrow. */
function opForStep(
  kind: string,
  params: unknown,
  entryInputs: Record<string, unknown> | undefined,
): string {
  if (kind === "round") return "round";
  if (kind === "clamp") {
    const p = (params ?? {}) as { min?: unknown; max?: unknown };
    if (typeof p.min === "number" && p.max == null) return `min ${p.min}`;
    if (typeof p.max === "number" && p.min == null) return `max ${p.max}`;
    return "clamp";
  }
  if (kind === "math.op") {
    const p = (params ?? {}) as { op?: unknown };
    if (typeof p.op === "string") return p.op;
  }
  // A step that consumed exactly one finite factor input reads as a
  // multiplication (modifier.schedule, endorsement.factor, …).
  if (entryInputs) {
    const nums = Object.entries(entryInputs).filter(
      ([k, v]) =>
        k !== "base" &&
        k !== "value" &&
        typeof v === "number" &&
        Number.isFinite(v),
    );
    if (nums.length === 1) return `× ${fmtFactor(nums[0]![1] as number)}`;
  }
  return "→";
}

function labelOf(
  compiled: CompiledPlan,
  nodeId: string,
  fallback: string,
): string {
  const node = compiled.nodesById.get(nodeId);
  if (node?.label) return node.label;
  const kind = node ? compiled.registry.get(node.kind) : undefined;
  return kind?.label ?? fallback;
}

/** Incoming edges to `nodeId`, optionally filtered to one port, in
 *  plan wiring order (the runtime gathers fan-ins the same way). */
function incomingTo(
  compiled: CompiledPlan,
  nodeId: string,
  port?: string,
): readonly PlanEdge[] {
  const edges = compiled.incoming.get(nodeId) ?? [];
  return port ? edges.filter((e) => e.to.port === port) : edges;
}

const COMPOSITE_KINDS = new Set([
  "chain.add",
  "chain.lob_sum",
  "chain.dim_sum",
  "chain.from_report",
  "branch",
  "subplan",
]);

/** Names the refusal from the run's structured issues (ADR-0056). */
function refusalOf(run: RunResult): string | null {
  if (run.row_status !== "error") return null;
  const issues = run.issues ?? [];
  for (const issue of issues) {
    const msg = (issue as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return "The reference risk can't be rated — a required value didn't resolve.";
}

/**
 * Walk ONE money output backward into its build-up rows (front-to-back).
 * `coverage` names the tower on a multi-coverage ledger — it qualifies
 * an otherwise-anonymous "Base rate" row so each group says which
 * coverage it opens. Returns [] when the field has no output node.
 */
function walkOutputField(
  compiled: CompiledPlan,
  run: RunResult,
  plan: Plan,
  fieldName: string,
  coverage?: string,
): WalkRow[] {
  const outputNode = plan.nodes.find(
    (n) =>
      n.kind === "output" &&
      (n.params as { fieldName?: unknown } | undefined)?.fieldName ===
        fieldName,
  );
  if (!outputNode) return [];

  // Walk backward from the output through single-input steps until a
  // chain.mult (expand) or a composite (stop). Collected back-to-front.
  const backward: WalkRow[] = [];
  let edges = incomingTo(compiled, outputNode.id);
  let guard = 0;
  while (edges.length === 1 && guard < 200) {
    guard += 1;
    const sourceId = edges[0]!.from.node;
    const node = compiled.nodesById.get(sourceId);
    const entry = run.trace[sourceId];
    if (!node) break;

    if (node.kind === "chain.mult") {
      // Expand: factor rows (reverse order — we're walking backward)…
      const params = (node.params ?? {}) as {
        factorNames?: readonly string[];
      };
      const factorEdges = incomingTo(compiled, sourceId, "factors");
      const factors = (entry?.inputs["factors"] ?? []) as readonly unknown[];
      const base = entry?.inputs["base"];
      const baseNum =
        typeof base === "number" && Number.isFinite(base) ? base : null;
      // Running totals accumulate forward; build then reverse-push.
      const factorRows: WalkRow[] = [];
      let acc = baseNum;
      for (let i = 0; i < factors.length; i++) {
        const f = factors[i];
        const fNum = typeof f === "number" && Number.isFinite(f) ? f : null;
        acc = acc !== null && fNum !== null ? acc * fNum : null;
        const named = params.factorNames?.[i];
        const viaEdge = factorEdges[i]
          ? labelOf(compiled, factorEdges[i]!.from.node, `Factor ${i + 1}`)
          : `Factor ${i + 1}`;
        factorRows.push({
          id: `${sourceId}:factor:${i}`,
          label: named ?? viaEdge,
          kind: "factor",
          op: fNum !== null ? `× ${fmtFactor(fNum)}` : "×",
          running: acc,
        });
      }
      for (let i = factorRows.length - 1; i >= 0; i--)
        backward.push(factorRows[i]!);
      // …then the base row, labeled by its source when wired. An
      // unlabeled source falls back to the walk's own domain term
      // ("Base rate" — it feeds the chain's base port), never the
      // kind's generic label ("Constant" reads as debugger output).
      // On a multi-coverage ledger that fallback carries the coverage,
      // so the group names itself from its first row (the projector
      // labels neither the chain nor its base node).
      const baseEdge = incomingTo(compiled, sourceId, "base")[0];
      const baseSource = baseEdge
        ? compiled.nodesById.get(baseEdge.from.node)
        : undefined;
      backward.push({
        id: `${sourceId}:base`,
        label:
          baseSource?.label ??
          (coverage ? `${coverage} — base rate` : "Base rate"),
        kind: "base",
        op: null,
        running: baseNum,
      });
      break;
    }

    if (COMPOSITE_KINDS.has(node.kind)) {
      // Multi-tower composition — state it, never fake a linear chain.
      backward.push({
        id: sourceId,
        label: `${labelOf(compiled, sourceId, node.kind)} (${
          incomingTo(compiled, sourceId).length
        } components)`,
        kind: "base",
        op: null,
        running: firstFiniteOutput(entry?.outputs),
      });
      break;
    }

    // A pass-through step (round / clamp / modifier / endorsement…).
    backward.push({
      id: sourceId,
      label: labelOf(compiled, sourceId, node.kind),
      kind: "step",
      op: opForStep(node.kind, node.params, entry?.inputs),
      running: firstFiniteOutput(entry?.outputs),
    });
    edges = incomingTo(compiled, sourceId);
  }

  return backward.reverse();
}

/** `building_premium` → "Building premium" — the coverage's name for
 *  the ledger. The projector labels neither the chain node nor its
 *  output (`params.fieldName` only), so the field name IS the citable
 *  source (P-N4) and the only per-tower name available. */
function humanizeField(field: string): string {
  const spaced = field.replace(/_/g, " ").trim();
  if (spaced === "") return field;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function computeReferenceWalk(args: {
  readonly plan: Plan;
  readonly pins: Record<string, unknown>;
  /** The authored stages — the total-less classification authority
   *  (only a `round` STAGE is a plan total; tower tips carry round
   *  NODES). Omit and only the output-name convention can find a
   *  declared total, so a custom-named total would look total-less —
   *  callers that HAVE stages must pass them. */
  readonly stages?: readonly PremiumStageLike[] | null;
  /** Anchor the walk on this output field explicitly. A contract, not
   *  a hint: it resolves alone and never falls through to the
   *  coverage-sum ledger (mirrors `views.premiumField` in deriveViews). */
  readonly premiumColumn?: string;
}): ReferenceWalk | null {
  const { plan, pins, stages, premiumColumn: explicitColumn } = args;
  let compiled: CompiledPlan;
  let run: RunResult;
  try {
    compiled = compilePlan(plan);
    run = runPlan(compiled, pins);
  } catch {
    return null;
  }

  const refusal = refusalOf(run);
  const ctx = resolvePlanPremiumContext(plan, stages);

  // ── The total-less multi-coverage ledger (93.4) ──
  if (explicitColumn === undefined && isTotalLessMultiCoverage(ctx)) {
    const rows: WalkRow[] = [];
    for (const field of ctx.moneyFields) {
      const coverage = humanizeField(field);
      rows.push(...walkOutputField(compiled, run, plan, field, coverage));
      const raw = run.outputs[field];
      rows.push({
        id: `${field}:subtotal`,
        label: coverage,
        kind: "subtotal",
        op: null,
        running: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
      });
    }
    return {
      rows,
      // Law 2 / G8 — an error row derives NO money. Summing the towers
      // that DID resolve would rebuild the exact silently-wrong number
      // the engine's refusal withheld.
      premium:
        run.row_status === "error"
          ? null
          : sumMoneyFields(run.outputs, ctx.moneyFields),
      premiumColumn: COVERAGE_SUM_COLUMN,
      coverageSum: true,
      refusal,
      run,
    };
  }

  // ── One declared premium: the single-column walk (unchanged) ──
  // `resolvePremiumColumn` still resolves this leg: its aggregate and
  // first-output legs carry shapes the typed context can't see (plans
  // whose outputs declare no `fieldType`). Its last-money leg is the
  // one that lies, and the total-less branch above has already claimed
  // every plan that leg would answer wrongly.
  const premiumColumn = explicitColumn ?? resolvePremiumColumn(plan);
  if (premiumColumn === null) return null;

  const premiumRaw = run.outputs[premiumColumn];
  const premium =
    typeof premiumRaw === "number" && Number.isFinite(premiumRaw)
      ? premiumRaw
      : null;

  return {
    rows: walkOutputField(compiled, run, plan, premiumColumn),
    premium,
    premiumColumn,
    coverageSum: false,
    refusal,
    run,
  };
}
