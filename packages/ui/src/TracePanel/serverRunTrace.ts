/**
 * serverRunTrace — trace-panel brief §14 (audit A-2026-07-12 P4-01).
 *
 * Adapts a PERSISTED server run (the `result` of `POST /plans/{id}/runs`
 * kind:"sample", i.e. the scoring service's /score response stored
 * verbatim in `plan_runs.result_json`) into everything `<TracePanel>`
 * needs to render it grouped by the v4 plan anatomy:
 *
 *   Inputs → Derived values → one Build-up group per coverage chain →
 *   Appetite → Outputs → (Final adjustments render from `composed`).
 *
 * Design (§14.3):
 *   - ORDER comes from the persisted trace itself. The runtime inserts
 *     trace entries in execution order and the whole round trip
 *     preserves object key order (JS → scoring JSON → Python
 *     `json.dumps` with default sort_keys=False → result_json →
 *     response). The run's own record beats a reconstruction — it is
 *     the execution order even when the draft has moved on. Lex sort
 *     stays as `<TracePanel>`'s fallback for any re-serialized record.
 *   - GROUPING keys off entry `kindId` (input / derive.* / output /
 *     eligibility.gate — truthful at run time) plus the projector's
 *     stable chain-scope id scheme (`chain_${safe}`, `lk_${safe}_…`,
 *     `mlk_${safe}_…`, `const_lcm_${safe}` — identity, not order; the
 *     Brief 48 §9 gotcha `chainTraceValues` codified). Anything
 *     unclaimed is NOT dropped — `<TracePanel>` appends it as
 *     "Other steps".
 *   - LABELS are mined best-effort from the authored stages +
 *     dimensions (input display names, lookup names from chain specs,
 *     dimension names). Unmapped ids render as themselves — honest,
 *     never fabricated.
 *   - WITHHELD outputs (ADR-0056): on a refused run the declared
 *     output fields that did NOT resolve are listed so the panel can
 *     render them withheld ("—") and suppress the featured total —
 *     a partial chain value must never headline as THE premium.
 *
 * Decoupled from the API client on purpose: inputs are structural
 * wire shapes, so rate-lab, history drawers, and future Labs can all
 * feed it whatever their transport returned.
 */

import type { RunResult, TraceEntry } from "@openrater/contracts";
import { sanitize } from "../InputsWorkspace/stagesToRuntimePlan";

// ── Wire-shape inputs (structural, transport-agnostic) ─────────────

/** One applied Final-adjustments step (`AdjustmentStep` on the wire). */
export interface ServerAdjustmentStepLike {
  readonly id: string;
  readonly kind?: string;
  /** false = a visible no-op (a `when` guard did not match). */
  readonly applied?: boolean;
  readonly before?: number;
  readonly factor_or_delta?: number;
  readonly after?: number;
  /** Human explanation, e.g. "−7.0% (Σ 6 sections, cap ±25%)". */
  readonly detail?: string;
  readonly citation?: string;
}

/** The G4 build-up: rolled subtotal → tail steps → filed final. */
export interface ServerComposedLike {
  readonly subtotal: number;
  readonly final: number;
  readonly adjustments?: readonly ServerAdjustmentStepLike[];
}

/** The subset of a persisted sample-run `result` this module reads. */
export interface ServerRunResultLike {
  readonly outputs?: Readonly<Record<string, unknown>>;
  /** Summary or full trace — summary strips per-node inputs. */
  readonly trace?: Readonly<Record<string, TraceEntry>>;
  readonly as_of?: string;
  readonly durationMs?: number;
  readonly row_status?: string;
  readonly composed?: ServerComposedLike;
}

/** The subset of an authored stage this module mines for labels. */
export interface TraceStageLike {
  readonly stage_kind: string;
  readonly display_name?: string | null | undefined;
  readonly config_json?: unknown;
}

/** The subset of a plan dimension this module mines for labels. */
export interface TraceDimensionLike {
  readonly slug?: string | null | undefined;
  readonly display_name?: string | null | undefined;
}

// ── Output shapes ──────────────────────────────────────────────────

/** One titled section of the cascade (render order = array order). */
export interface TraceGroup {
  readonly id: string;
  readonly title: string;
  /** Node ids in render order (already execution-ordered). */
  readonly nodeIds: readonly string[];
}

/** Everything `<TracePanel>` needs to render a persisted server run. */
export interface ServerRunTraceView {
  readonly run: RunResult;
  /** Execution order — the persisted trace's own key order. */
  readonly nodeOrder: readonly string[];
  readonly nodeLabels: Readonly<Record<string, string>>;
  readonly groups: readonly TraceGroup[];
  /** Declared output fields a refusal withheld (empty on ok runs). */
  readonly withheldOutputs: readonly string[];
  readonly composed?: ServerComposedLike;
}

// ── Chain-spec mining ──────────────────────────────────────────────

interface MinedChain {
  /** FCA #30 (finding 5) — true when the chain AUTHORED an LCM
   *  (lcm.value or an input binding); false means any const_lcm node
   *  in the trace is the caller's identity scaffold, not filed. */
  readonly lcmAuthored: boolean;
  readonly name: string;
  readonly safe: string;
  readonly outputField: string | null;
  /** factor_kind → authored lookup display name. */
  readonly lookupNames: ReadonlyMap<string, string>;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Mine every multiplicative_chain stage's chain specs + total fields. */
function mineChains(stages: readonly TraceStageLike[]): {
  chains: readonly MinedChain[];
  declaredOutputFields: readonly string[];
} {
  const chains: MinedChain[] = [];
  const declared: string[] = [];
  for (const stage of stages) {
    if (stage.stage_kind !== "multiplicative_chain") continue;
    const cfg = asRecord(stage.config_json);
    if (!cfg) continue;
    const totalField = str(cfg["output_total_field"]);
    if (totalField) declared.push(totalField);
    const rawChains = Array.isArray(cfg["chains"]) ? cfg["chains"] : [];
    for (const raw of rawChains) {
      const c = asRecord(raw);
      const name = c ? str(c["name"]) : null;
      if (!c || !name) continue;
      const outputField = str(c["output_field"]);
      if (outputField) declared.push(outputField);
      const lookupNames = new Map<string, string>();
      const lookups = Array.isArray(c["factor_lookups"])
        ? c["factor_lookups"]
        : [];
      for (const rawLookup of lookups) {
        const l = asRecord(rawLookup);
        const factorKind = l ? str(l["factor_kind"]) : null;
        const lookupName = l ? str(l["name"]) : null;
        if (factorKind && lookupName) lookupNames.set(factorKind, lookupName);
      }
      const lcm = asRecord(c["lcm"]);
      const lcmAuthored =
        lcm !== null &&
        (typeof lcm["value"] === "number" ||
          (typeof lcm["input_path"] === "string" &&
            lcm["input_path"] !== ""));
      chains.push({
        name,
        safe: sanitize(name),
        outputField,
        lookupNames,
        lcmAuthored,
      });
    }
  }
  return { chains, declaredOutputFields: declared };
}

// ── Label mining ───────────────────────────────────────────────────

function mineLabels(
  stages: readonly TraceStageLike[],
  dimensions: readonly TraceDimensionLike[],
  chains: readonly MinedChain[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  // Dimensions first (stage display names win below by overwriting).
  for (const d of dimensions) {
    const slug = str(d.slug);
    const name = str(d.display_name);
    if (slug && name) labels[`in_${sanitize(slug)}`] = name;
  }
  // Declared inputs — the actuary's own field names.
  for (const stage of stages) {
    if (stage.stage_kind !== "input_node") continue;
    const cfg = asRecord(stage.config_json);
    const field = cfg
      ? (str(cfg["field_name"]) ?? str(cfg["source_path"]))
      : null;
    const name = str(stage.display_name);
    if (field && name) labels[`in_${sanitize(field)}`] = name;
  }
  // Chain scopes — the authored lookup names + the build-up node.
  for (const chain of chains) {
    labels[`chain_${chain.safe}`] = `${chain.name} — build-up`;
    // FCA #30 (findings 5/48) — an unauthored LCM node is the
    // platform's identity scaffold; the label says so instead of
    // presenting "× 1 (LCM)" as filed content.
    labels[`const_lcm_${chain.safe}`] = chain.lcmAuthored
      ? "LCM"
      : "LCM — platform default, not filed";
    for (const [factorKind, lookupName] of chain.lookupNames) {
      labels[`lk_${chain.safe}_${sanitize(factorKind)}`] = lookupName;
      labels[`mlk_${chain.safe}_${sanitize(factorKind)}`] = lookupName;
    }
  }
  return labels;
}

// ── Grouping ───────────────────────────────────────────────────────

/** True when the node id belongs to this chain's runtime scope.
 *
 * The projector stamps a chain's sanitized name into EVERY node it
 * emits for that chain, always underscore-delimited: the spine
 * (`chain_x`, `lk_x_*`, `mlk_x_*`, `const_lcm_x`) AND the arithmetic
 * plumbing (`rate3_x`, `mulexp_x`, `mullcm_x`, `prem_x`,
 * `gate_x_*`, `divisor_x_*`, `sum_x_*`, `litkey_x_*`, …). Token
 * matching on the delimited name claims all of it — identity, not
 * order. kindId classes (input / derive.* / output / gate) are
 * claimed BEFORE this runs, so `out_building_premium` can never be
 * pulled into the `building` chain by its token. */
function inChainScope(nodeId: string, safe: string): boolean {
  return (
    nodeId === `chain_${safe}` ||
    nodeId === `const_lcm_${safe}` ||
    nodeId.startsWith(`lk_${safe}_`) ||
    nodeId.startsWith(`mlk_${safe}_`) ||
    nodeId.endsWith(`_${safe}`) ||
    nodeId.includes(`_${safe}_`)
  );
}

function buildGroups(
  nodeOrder: readonly string[],
  trace: Readonly<Record<string, TraceEntry>>,
  chains: readonly MinedChain[],
): TraceGroup[] {
  const inputs: string[] = [];
  const derived: string[] = [];
  const perChain = new Map<string, string[]>(
    chains.map((c) => [c.safe, []]),
  );
  const gates: string[] = [];
  const outputs: string[] = [];

  for (const nodeId of nodeOrder) {
    const entry = trace[nodeId];
    if (!entry) continue;
    // kindId classes FIRST — an output/derive/input node stays in its
    // section even when its id carries a chain's name token.
    const kindId = entry.kindId ?? "";
    if (kindId === "input") {
      inputs.push(nodeId);
      continue;
    }
    if (kindId.startsWith("derive.")) {
      derived.push(nodeId);
      continue;
    }
    if (kindId === "eligibility.gate") {
      gates.push(nodeId);
      continue;
    }
    if (kindId === "output") {
      outputs.push(nodeId);
      continue;
    }
    const chain = chains.find((c) => inChainScope(nodeId, c.safe));
    if (chain) {
      perChain.get(chain.safe)!.push(nodeId);
      continue;
    }
    // Everything else stays unclaimed — <TracePanel> appends it as
    // "Other steps" so nothing is ever silently dropped.
  }

  const groups: TraceGroup[] = [];
  if (inputs.length > 0) {
    groups.push({ id: "inputs", title: "Inputs", nodeIds: inputs });
  }
  if (derived.length > 0) {
    groups.push({ id: "derived", title: "Derived values", nodeIds: derived });
  }
  const multiChain = chains.length > 1;
  for (const chain of chains) {
    const ids = perChain.get(chain.safe)!;
    if (ids.length === 0) continue;
    groups.push({
      id: `chain-${chain.safe}`,
      title: multiChain ? `Build-up — ${chain.name}` : "Build-up",
      nodeIds: ids,
    });
  }
  if (gates.length > 0) {
    groups.push({ id: "gates", title: "Appetite", nodeIds: gates });
  }
  if (outputs.length > 0) {
    groups.push({ id: "outputs", title: "Outputs", nodeIds: outputs });
  }
  return groups;
}

// ── The adapter ────────────────────────────────────────────────────

export function buildServerRunTraceView(args: {
  readonly result: ServerRunResultLike;
  readonly stages?: readonly TraceStageLike[];
  readonly dimensions?: readonly TraceDimensionLike[];
}): ServerRunTraceView {
  const { result } = args;
  const stages = args.stages ?? [];
  const dimensions = args.dimensions ?? [];

  const trace = result.trace ?? {};
  const outputs = result.outputs ?? {};
  const nodeOrder = Object.keys(trace);
  const { chains, declaredOutputFields } = mineChains(stages);

  const refused = result.row_status === "error";
  // ADR-0056 — a refusal WITHHOLDS unresolved outputs; name them so the
  // panel renders "—" instead of pretending they don't exist. Dedup
  // preserves declaration order.
  const withheldOutputs = refused
    ? Array.from(new Set(declaredOutputFields)).filter(
        (field) => !(field in outputs),
      )
    : [];

  // A structural RunResult for <TracePanel>: the persisted record's own
  // fields, with the two timing fields the wire may not carry defaulted
  // (the panel hides a 0 duration rather than showing a fake one).
  const run = {
    outputs: outputs as Record<string, unknown>,
    trace: trace as Record<string, TraceEntry>,
    startedAt: 0,
    durationMs:
      typeof result.durationMs === "number" && Number.isFinite(result.durationMs)
        ? result.durationMs
        : 0,
    as_of: result.as_of ?? "",
    row_status: refused ? "error" : "ok",
  } as RunResult;

  return {
    run,
    nodeOrder,
    nodeLabels: mineLabels(stages, dimensions, chains),
    groups: buildGroups(nodeOrder, trace, chains),
    withheldOutputs,
    ...(result.composed ? { composed: result.composed } : {}),
  };
}
