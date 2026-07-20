/**
 * stagesToTowerPlan — load converter from substrate stages to the
 * TowerPlan UI projection.
 *
 * Per Brief 25 §8.1. Read the plan's stages + supporting catalogs
 * (constants, models) and produce one Tower per rating-dimension
 * value, plus a Total tower at the end.
 *
 * V1 (25.A) scope: single-coverage plans are projected as ONE
 * tower (the rating dimension defaults to "coverage" but if the
 * plan has no `coverage` dimension we project a single unnamed
 * tower). Multi-coverage projection lights up when the rating-dim's
 * enumerated values can be inferred from the chain set.
 *
 * Round-trip with `towerPlanToStages` (the save path) is covered
 * by conformance vector V-CT25 (parallel work; not gated on 25.A).
 */

import { fixAcronymCase } from "../format/acronyms";
import type {
  AxisSource,
  ConstantDef,
  InventoryItem,
  ModelDef,
  NodeCategory,
  NodeSubtype,
  Operator,
  Tower,
  TowerEntry,
  TowerGroup,
  TowerMode,
  TowerNode,
  TowerPlan,
  TowerProjectionOptions,
  ValueChip,
} from "./types";

// ── Loose stage shape ─────────────────────────────────────────

/**
 * The shape the converter reads. Compatible with `StageSummary` from
 * `@openrater/api-client` but loose enough to avoid the package-dep
 * cycle.
 */
export interface StageInput {
  readonly stage_id: string;
  readonly sequence: number;
  readonly stage_kind: string;
  readonly display_name: string;
  readonly config_json: Record<string, unknown> | null;
}

// ── Helpers ────────────────────────────────────────────────────

function nextNodeId(prefix: string, used: Set<string>): string {
  let n = 1;
  let candidate = `${prefix}_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${prefix}_${n}`;
  }
  used.add(candidate);
  return candidate;
}

function cleanConfig(stage: StageInput): Record<string, unknown> {
  return (stage.config_json ?? {}) as Record<string, unknown>;
}

/** Capitalize first letter, then restore allowlisted acronyms
 *  ("bpp premium" → "BPP premium", never "Bpp premium"). */
function titleCase(s: string): string {
  if (!s) return s;
  return fixAcronymCase(s.charAt(0).toUpperCase() + s.slice(1));
}

/**
 * Cold-test L30 — format a chain's literal base rate for the
 * `chain-base` node's value chip. Renders as a compact currency
 * amount ("$600", "$1,250", "$12.50"). No-decimals for whole
 * dollars; 2-decimal for fractional bases (rate-per-unit chains).
 */
function formatBaseValue(value: number): string {
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

// ── Dimension lookup → node ────────────────────────────────────

interface ChainFactorRaw {
  readonly name?: string;
  readonly factor_kind?: string;
  readonly lookup_method?: string;
  readonly dimensions?: Record<string, unknown>;
  readonly description_template?: string;
  readonly citation_rule?: string;
  readonly predicate?: unknown;
}

/**
 * ADR-0047 — narrow a raw `factor_lookups[].predicate` (unknown on the
 * wire) to the typed gate the factor-table ref carries, or null when
 * absent/malformed. Mirrors the contract `FactorPredicate` shape.
 */
function readPredicate(
  raw: unknown,
): { path: string; equals: boolean | number | string } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { path?: unknown; equals?: unknown };
  if (typeof p.path !== "string" || p.path.length === 0) return null;
  const eq = p.equals;
  if (
    typeof eq !== "boolean" &&
    typeof eq !== "number" &&
    typeof eq !== "string"
  ) {
    return null;
  }
  return { path: p.path, equals: eq };
}

/**
 * ADR-0047 — narrow one raw `factor_lookups[].dimensions[axis]` binding to
 * the typed AxisSource the factor-table ref carries, or null if malformed.
 */
function readAxisSource(raw: unknown): AxisSource | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as {
    source?: unknown;
    path?: unknown;
    value?: unknown;
    op?: unknown;
    fields?: unknown;
  };
  if (b.source === "literal") {
    if (
      typeof b.value !== "string" &&
      typeof b.value !== "number" &&
      typeof b.value !== "boolean"
    ) {
      return null;
    }
    return { source: "literal", value: b.value };
  }
  if (b.source === "computed") {
    if (b.op !== "sum" || !Array.isArray(b.fields)) return null;
    const fields = b.fields.filter((f): f is string => typeof f === "string");
    if (fields.length === 0) return null;
    return { source: "computed", op: "sum", fields };
  }
  if (b.source === "derived" || b.source === "form_input") {
    if (typeof b.path !== "string" || b.path.length === 0) return null;
    return { source: b.source, path: b.path };
  }
  return null;
}

/**
 * ADR-0047 — capture the non-default per-axis sources from a factor's
 * `dimensions` map. The trivial default (form_input with path === axis) is
 * skipped — it round-trips as "no override" (the save side re-emits it).
 * Returns undefined when there are no overrides.
 */
function readAxisSources(
  dimensions: Record<string, unknown> | undefined,
): Record<string, AxisSource> | undefined {
  if (!dimensions) return undefined;
  const out: Record<string, AxisSource> = {};
  for (const [axis, raw] of Object.entries(dimensions)) {
    const src = readAxisSource(raw);
    if (!src) continue;
    if (src.source === "form_input" && src.path === axis) continue;
    out[axis] = src;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Pick the icon name for a chain factor by inspecting its
 * factor_kind / dimensions. The renderer maps icon names → lucide
 * components in 25.B.
 */
function iconForFactor(factor: ChainFactorRaw): string {
  const kind = factor.factor_kind ?? "";
  if (kind.includes("class")) return "Tag";
  if (kind.includes("terr")) return "MapPin";
  if (kind.includes("constr")) return "Building";
  if (kind.includes("protect")) return "Shield";
  if (kind.includes("sprink")) return "Droplets";
  if (kind.includes("lcm")) return "Target";
  if (kind.includes("ded")) return "Gauge";
  if (kind.includes("curve")) return "LineChart";
  return "Search";
}

/**
 * Pick the icon for an input-node stage by inspecting its data_type
 * + field_name.
 */
function iconForInput(fieldName: string, dataType?: string): string {
  if (dataType?.includes("currency") || /tiv|limit|premium|cost|value/i.test(fieldName)) {
    return "DollarSign";
  }
  if (dataType?.includes("date")) return "Calendar";
  if (dataType?.includes("bool")) return "ToggleRight";
  if (/zip|state|territory|address/i.test(fieldName)) return "MapPin";
  if (/class|code|tag/i.test(fieldName)) return "Tag";
  return "FormInput";
}

/**
 * Map a chain factor to a category + subtype. A chain factor is always
 * a LOOKUP (amber) — you look a factor up by a key — so it reads the
 * same category as its factor-table item in the rail (Brief 48: the
 * rail tile matches the node it spawns), and a tower scans cleanly as
 * one column of amber lookups instead of mixed violet/amber. The lucide
 * GLYPH still differentiates (geographic → map-pin, etc.) via
 * iconForFactor; only the cross-category color hue-shift is dropped.
 */
function categorizeFactor(
  factor: ChainFactorRaw,
): { category: NodeCategory; subtype?: NodeSubtype } {
  // Interpolated factors keep the `curve` subtype — its hue-shift is to
  // lookup-amber (same family), so it stays consistent.
  if (factor.lookup_method === "interpolated") {
    return { category: "lookup", subtype: "curve" };
  }
  return { category: "lookup" };
}

/** Human label for a lookup method (Brief 48 §3.2 — generic, no product
 *  branch). Drives the node subtitle ("how it looks up"). */
const METHOD_LABELS: Record<string, string> = {
  direct: "Direct lookup",
  range: "Range band",
  interpolated: "Curve",
  multi: "Multi-key lookup",
};
function humanizeMethod(method?: string): string {
  if (!method) return "Factor lookup";
  return (
    METHOD_LABELS[method] ??
    `${method.charAt(0).toUpperCase()}${method.slice(1)} lookup`
  );
}

/** A human title for a factor node. Prefer the head of the authored
 *  description (before a colon / middot / dash) — the actuary's own
 *  label (e.g. "NTEE (D&O)") — falling back to a titleized field name.
 *  Generic: just splits the authored string; never branches on product. */
function factorTitle(factor: ChainFactorRaw): string {
  const desc = (factor.description_template ?? "").trim();
  const head = desc.split(/[:·—|]/)[0]?.trim();
  if (head && head.length > 0 && head.length <= 40) return head;
  const name = factor.name ?? factor.factor_kind ?? "Factor";
  // Titleize is a last resort for identifier-like names (snake_case →
  // "Class Factor"); an already-human label ("Class factor") passes
  // through untouched. Re-casing clean labels mangles, not humanizes.
  if (!name.includes("_")) return name;
  return fixAcronymCase(
    name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  );
}

function valueChipForFactor(factor: ChainFactorRaw): ValueChip {
  // Without a scored run we don't have the realized ×value (that arrives
  // with the build-up ledger, Brief 48 phase 4). Show the table's SHAPE
  // — a count hint when the description carries one — never the field
  // name (which is redundant with the title). Brief 48 §3.2.
  const desc = factor.description_template ?? "";
  const countMatch = desc.match(/(\d+)\s*(?:values|zones|categories|levels)/i);
  if (countMatch) {
    // A genuinely useful right-side fact: the table's size ("51 zones").
    return {
      primary: `${countMatch[1]} ${countMatch[2]?.toLowerCase() ?? "values"}`,
    };
  }
  // No scored ×value yet (that arrives with the build-up ledger) and no
  // size hint — keep the right side a single quiet token, not the old
  // "× factor / TABLE" debug stack. Brief 48 §3.2.
  return { primary: "× factor" };
}

// ── Input node projection ──────────────────────────────────────

function projectInputStage(stage: StageInput, nodeIds: Set<string>): TowerNode {
  const cfg = cleanConfig(stage);
  const fieldName = typeof cfg["field_name"] === "string"
    ? (cfg["field_name"] as string)
    : stage.stage_id;
  const dtype = typeof cfg["data_type"] === "string"
    ? (cfg["data_type"] as string)
    : "string";
  const isCurrency = dtype.includes("currency");
  const valueChip: ValueChip = isCurrency
    ? { primary: "currency", secondary: "USD" }
    : { primary: dtype };
  return {
    id: nextNodeId(`inp_${fieldName}`, nodeIds),
    category: "input",
    title: stage.display_name || fieldName,
    subtitle: `Submission input · from policy form`,
    valueChip,
    icon: iconForInput(fieldName, dtype),
    ref: { kind: "submission-field", field: fieldName },
  };
}

// ── Chain projection ───────────────────────────────────────────

interface ProjectedChain {
  readonly tower: Tower;
  readonly nodes: readonly TowerNode[];
  readonly groups: readonly TowerGroup[];
}

function projectChain(
  stage: StageInput,
  chainIndex: number,
  chainSpec: Record<string, unknown>,
  nodeIds: Set<string>,
  inputNodesByField: ReadonlyMap<string, TowerNode>,
): ProjectedChain {
  const factorLookups = Array.isArray(chainSpec["factor_lookups"])
    ? (chainSpec["factor_lookups"] as ChainFactorRaw[])
    : [];
  const baseInput = typeof chainSpec["base_input"] === "string"
    ? (chainSpec["base_input"] as string)
    : "";
  // Cold-test L30 — the chain's authored literal base rate. When set,
  // it's the first-class editable base (a `chain-base` node), NOT a
  // submission-field reference.
  const baseValue =
    typeof chainSpec["base_value"] === "number" &&
    Number.isFinite(chainSpec["base_value"])
      ? (chainSpec["base_value"] as number)
      : null;
  const outputField = typeof chainSpec["output_field"] === "string"
    ? (chainSpec["output_field"] as string)
    : `chain_output_${chainIndex}`;
  const chainName = typeof chainSpec["name"] === "string"
    ? (chainSpec["name"] as string)
    : `Chain ${chainIndex + 1}`;

  const entries: TowerEntry[] = [];
  const entryOps: Operator[] = [];
  const nodes: TowerNode[] = [];

  // Base rate (cold-test L30).
  //
  // Two projections, by substrate shape:
  //
  //   1. Literal base (`base_value` is a number) → a `chain-base`
  //      node. It's an editable scalar the actuary owns directly:
  //      the chip shows "$600 · base rate", and the inspector renders
  //      a number field. This is the path a from-scratch plan takes —
  //      no template_id, no submission column required.
  //
  //   2. No literal (legacy / column-driven) → the existing
  //      submission-field node ("Submission input · from policy
  //      form"). Preserved verbatim so plans authored before
  //      `base_value` round-trip unchanged.
  let baseNode: TowerNode;
  if (baseValue !== null || baseInput === "") {
    // Literal base (or a brand-new chain with no base_input yet — we
    // default new chains to the editable literal affordance, starting
    // unset so the chip prompts the user to author a value).
    baseNode = {
      id: nextNodeId(`base_${chainName || "rate"}`, nodeIds),
      category: "math",
      subtype: "constant",
      title: "Base rate",
      subtitle: "Base rate · authored constant",
      valueChip:
        baseValue !== null
          ? { primary: formatBaseValue(baseValue), secondary: "base rate" }
          : { primary: "Set base rate", secondary: "tap to edit" },
      icon: "DollarSign",
      ref: { kind: "chain-base", baseValue },
    };
    nodes.push(baseNode);
  } else {
    // Legacy column-driven base — look up the input node by field (if
    // it was already created as an input_node stage above) or create
    // an ad-hoc submission-field node.
    const existing = inputNodesByField.get(baseInput);
    if (existing) {
      baseNode = existing;
    } else {
      baseNode = {
        id: nextNodeId(`inp_${baseInput || "base"}`, nodeIds),
        category: "input",
        title: baseInput || "Base input",
        subtitle: "Submission input · from policy form",
        valueChip: { primary: "currency", secondary: "USD" },
        icon: iconForInput(baseInput),
        ref: { kind: "submission-field", field: baseInput },
      };
      nodes.push(baseNode);
    }
  }
  entries.push({ kind: "node", nodeId: baseNode.id });

  // Each factor lookup → a transform/lookup node, with × between.
  for (const factor of factorLookups) {
    const { category, subtype } = categorizeFactor(factor);
    const id = nextNodeId(`fac_${factor.name ?? "f"}`, nodeIds);
    // PR 12.1 — preserve the factor_kind on the node ref so the
    // save-direction converter (`towerPlanToStages`) can reverse-
    // project the factor lookup. Without this, round-trips drop
    // the factor entirely because no node carries the factor_kind
    // identifier.
    const factorPredicate = readPredicate(factor.predicate);
    const axisSources = readAxisSources(factor.dimensions);
    const node: TowerNode = {
      id,
      category,
      ...(subtype !== undefined ? { subtype } : {}),
      // Brief 48 §3.2 — a human title (the actuary's label) + a "how it
      // looks up" subtitle, instead of the raw field name in both title
      // and value.
      title: factorTitle(factor),
      subtitle: humanizeMethod(factor.lookup_method),
      valueChip: valueChipForFactor(factor),
      icon: iconForFactor(factor),
      ...(factor.factor_kind
        ? {
            ref: {
              kind: "factor-table" as const,
              tableId: factor.factor_kind,
              // ADR-0047 — round-trip the gate + per-axis sources so a
              // load → save cycle preserves them (and editors can show/edit).
              ...(factorPredicate ? { predicate: factorPredicate } : {}),
              ...(axisSources ? { axisSources } : {}),
            },
          }
        : {}),
    };
    nodes.push(node);
    entryOps.push("multiply");
    entries.push({ kind: "node", nodeId: id });
  }

  // LCM tail (carrier-set) — surface as an emerald constant node.
  const lcm = chainSpec["lcm"];
  if (lcm && typeof lcm === "object") {
    // ADR-0047 — an authored carrier LCM (`lcm.value`) round-trips onto the
    // constant ref so a load → edit → save cycle preserves it (and the chip
    // shows the real number instead of "scalar").
    const lcmObj = lcm as { value?: unknown; overridable?: unknown };
    const lcmValue =
      typeof lcmObj.value === "number" && Number.isFinite(lcmObj.value)
        ? lcmObj.value
        : null;
    const lcmOverridable = lcmObj.overridable === true;
    const lcmNode: TowerNode = {
      id: nextNodeId("const_lcm", nodeIds),
      category: "math",
      subtype: "constant",
      title: "LCM",
      subtitle: "Constant · carrier-set",
      valueChip:
        lcmValue !== null
          ? { primary: `× ${lcmValue}`, secondary: "carrier-set" }
          : { primary: "scalar", secondary: "carrier-set" },
      icon: "Target",
      ref: {
        kind: "constant",
        constantId: "LCM",
        role: "lcm",
        value: lcmValue,
        ...(lcmOverridable ? { overridable: true } : {}),
      },
    };
    nodes.push(lcmNode);
    entryOps.push("multiply");
    entries.push({ kind: "node", nodeId: lcmNode.id });
  }

  // Output cap node — bottom of the column.
  const outputNode: TowerNode = {
    id: nextNodeId(`out_${outputField}`, nodeIds),
    category: "output",
    title: outputField,
    subtitle: "Output · result of this chain",
    valueChip: { primary: "currency", secondary: "USD" },
    icon: "Circle",
    ref: { kind: "output", outputField },
  };
  nodes.push(outputNode);
  // No op between the last factor and the output — visually, the
  // result flows into the output. We represent this with a passthrough
  // (multiply by implicit 1). The save path treats this as the chain's
  // output assignment.
  entryOps.push("multiply");
  entries.push({ kind: "node", nodeId: outputNode.id });

  // ADR-0047 — surface the exposure base on the tower for the inspector's
  // Tower editor (skip the dead "form_input.exposure" placeholder).
  const exposureRaw =
    typeof chainSpec["exposure_input"] === "string"
      ? (chainSpec["exposure_input"] as string).replace(/^form_input\./, "")
      : "";
  const exposureDivisor = chainSpec["exposure_unit_divisor"];
  const applyExposure = chainSpec["apply_exposure"];
  // Brief 78 P5.3c — count the class-conditional exposure options
  // (ADR-0044 D9). NON-EMPTY only: the fixture era wrote empty
  // `exposure_options: []` keys on plain chains, which must not read
  // as "varies by class".
  const exposureOptions = chainSpec["exposure_options"];
  const exposureOptionCount =
    Array.isArray(exposureOptions) && exposureOptions.length > 0
      ? exposureOptions.length
      : 0;

  const tower: Tower = {
    id: `tower_${stage.stage_id}_${chainIndex}`,
    name: titleCase(chainName),
    outputField,
    entries,
    entryOps,
    ...(typeof chainSpec["coverage_value"] === "string"
      ? { ratingDimensionValue: chainSpec["coverage_value"] as string }
      : {}),
    ...(exposureRaw && exposureRaw !== "exposure"
      ? { exposureInput: exposureRaw }
      : {}),
    ...(typeof exposureDivisor === "number" && Number.isFinite(exposureDivisor)
      ? { exposureUnitDivisor: exposureDivisor }
      : {}),
    ...(typeof applyExposure === "boolean" ? { applyExposure } : {}),
    // Brief 78 P5.3c — the byte-stable base the save path patches
    // over (see Tower.chainVerbatim). Carried for EVERY loaded chain.
    chainVerbatim: chainSpec as Readonly<Record<string, unknown>>,
    ...(exposureOptionCount > 0 ? { exposureOptionCount } : {}),
  };

  return { tower, nodes, groups: [] };
}

// ── Sidecar projection (loading + modifier + clamp/round) ──────

/**
 * Find the tower whose outputField matches the consumer's input
 * reference, then append the loading/modifier/final node onto it.
 *
 * The input reference is read from `input_field` (the flat_factor /
 * modifier_schedule convention) with a fallback to `input_path` (the
 * ClampConfig / RoundConfig convention: "chain.premium" or
 * "stages.<id>.<field>"). The v4 G6 "+ Minimum premium" affordance
 * authors a `round` whose config carries only `input_path`; without
 * this fallback the floor is silently dropped from the tower preview.
 */
function appendSidecarToTower(
  consumer: StageInput,
  towers: Tower[],
  nodes: Map<string, TowerNode>,
  nodeIds: Set<string>,
): void {
  const cfg = cleanConfig(consumer);
  let inputField = typeof cfg["input_field"] === "string"
    ? (cfg["input_field"] as string)
    : undefined;
  if (!inputField) {
    const inputPath = typeof cfg["input_path"] === "string"
      ? (cfg["input_path"] as string)
      : undefined;
    if (inputPath) {
      // "chain.total_premium" / "stages.ch.premium_usd" → the trailing
      // segment is the predecessor tower's outputField.
      const parts = inputPath.split(".");
      inputField = parts[parts.length - 1];
    }
  }
  if (!inputField) return;

  // Find the tower whose output matches.
  const idx = towers.findIndex((t) => t.outputField === inputField);
  if (idx === -1) return;
  const tower = towers[idx]!;

  // What kind of sidecar is this?
  let category: NodeCategory = "loading";
  let subtype: NodeSubtype | undefined = "loading";
  let op: Operator = "multiply";
  let icon = "TrendingUp";

  switch (consumer.stage_kind) {
    case "modifier_schedule": {
      category = "loading";
      subtype = "modifier";
      op = "multiply";
      icon = "Sliders";
      break;
    }
    case "flat_factor": {
      const value = cfg["value"];
      // Heuristic: < 1.5 and > 0.5 → multiply; otherwise +
      if (typeof value === "number" && value > 1.5) {
        op = "plus";
      } else {
        op = "multiply";
      }
      icon = "TrendingUp";
      break;
    }
    case "clamp":
    case "round": {
      // Final-op: attach as finalOp on the tower instead of a node.
      const newTower: Tower = {
        ...tower,
        finalOp: consumer.stage_kind === "clamp" ? "min" : "round",
      };
      towers[idx] = newTower;
      return;
    }
    default:
      return;
  }

  // Build the sidecar node + append.
  const newId = nextNodeId(`mod_${consumer.stage_id}`, nodeIds);
  const newNode: TowerNode = {
    id: newId,
    category,
    ...(subtype !== undefined ? { subtype } : {}),
    title: consumer.display_name,
    subtitle:
      consumer.stage_kind === "modifier_schedule"
        ? "Modifier schedule"
        : "Loading / adjustment",
    valueChip: {
      primary:
        consumer.stage_kind === "modifier_schedule"
          ? "schedule"
          : op === "plus"
            ? `+ ${cfg["value"]}`
            : `× ${cfg["value"]}`,
      secondary: consumer.stage_kind === "modifier_schedule" ? "± cap" : "value",
    },
    icon,
    ref: { kind: "modifier", modifierStageId: consumer.stage_id },
  };
  nodes.set(newId, newNode);

  // The new node goes BEFORE the output (last entry).
  const beforeOutputIdx = tower.entries.length - 1;
  const newEntries = [
    ...tower.entries.slice(0, beforeOutputIdx),
    { kind: "node", nodeId: newId } as TowerEntry,
    ...tower.entries.slice(beforeOutputIdx),
  ];
  const newEntryOps = [
    ...tower.entryOps.slice(0, beforeOutputIdx - 1),
    op,
    ...tower.entryOps.slice(beforeOutputIdx - 1),
  ];

  towers[idx] = {
    ...tower,
    entries: newEntries,
    entryOps: newEntryOps,
  };
}

// ── Main converter ────────────────────────────────────────────

export interface StagesToTowerPlanInput {
  readonly stages: readonly StageInput[];
  readonly constants?: readonly ConstantDef[];
  readonly models?: readonly ModelDef[];
}

/**
 * Project the plan's stages into a TowerPlan.
 *
 * The converter is conservative: stage kinds it doesn't recognize
 * are silently skipped. The save path (`towerPlanToStages`) is the
 * inverse projection — round-trip stability is enforced by the
 * V-CT25 conformance vector.
 */
export function stagesToTowerPlan(
  input: StagesToTowerPlanInput,
  opts: TowerProjectionOptions = {},
): TowerPlan {
  // 25.B.2 — `rating_dimension` on the multiplicative_chain config
  // is the authoritative source. opts.ratingDimension is the override
  // for callers who want to force a specific value; the default
  // ("coverage") is the conventional rating dimension for the BOP +
  // most P&C lines.
  let ratingDimension = opts.ratingDimension ?? "coverage";
  for (const stage of input.stages) {
    if (stage.stage_kind !== "multiplicative_chain") continue;
    const cfg = stage.config_json ?? {};
    const declared = cfg["rating_dimension"];
    if (typeof declared === "string" && declared.length > 0) {
      ratingDimension = declared;
      break;
    }
  }
  const constants = new Map<string, ConstantDef>(
    (input.constants ?? []).map((c) => [c.id, c]),
  );
  const models = new Map<string, ModelDef>(
    (input.models ?? []).map((m) => [m.id, m]),
  );

  const nodes = new Map<string, TowerNode>();
  const groups = new Map<string, TowerGroup>();
  const nodeIds = new Set<string>();

  // ── 1. Project input_node stages first → input nodes
  //       (shared across all towers via the inputNodesByField map).
  const inputNodesByField = new Map<string, TowerNode>();
  for (const stage of input.stages) {
    if (stage.stage_kind !== "input_node") continue;
    const node = projectInputStage(stage, nodeIds);
    nodes.set(node.id, node);
    const cfg = cleanConfig(stage);
    const field = typeof cfg["field_name"] === "string"
      ? (cfg["field_name"] as string)
      : null;
    if (field) inputNodesByField.set(field, node);
  }

  // ── 2. Project multiplicative_chain stages → one tower per
  //       ChainSpec.
  const towers: Tower[] = [];
  for (const stage of input.stages) {
    if (stage.stage_kind !== "multiplicative_chain") continue;
    const cfg = cleanConfig(stage);
    const chains = Array.isArray(cfg["chains"])
      ? (cfg["chains"] as Record<string, unknown>[])
      : [];
    chains.forEach((chainSpec, idx) => {
      const projected = projectChain(
        stage,
        idx,
        chainSpec,
        nodeIds,
        inputNodesByField,
      );
      towers.push(projected.tower);
      for (const n of projected.nodes) nodes.set(n.id, n);
      for (const g of projected.groups) groups.set(g.id, g);
    });
  }

  // ── 3. Append sidecar stages (loading / modifier / final) onto
  //       the towers whose output field they consume.
  for (const stage of input.stages) {
    const sidecarKinds = [
      "flat_factor",
      "modifier_schedule",
      "clamp",
      "round",
    ];
    if (!sidecarKinds.includes(stage.stage_kind)) continue;
    appendSidecarToTower(stage, towers, nodes, nodeIds);
  }

  // ── 4. Derive rating-dim values + Total tower if applicable.
  const seenValues = new Set<string>();
  const ratingDimensionValues: string[] = [];
  for (const t of towers) {
    if (t.ratingDimensionValue && !seenValues.has(t.ratingDimensionValue)) {
      seenValues.add(t.ratingDimensionValue);
      ratingDimensionValues.push(t.ratingDimensionValue);
    }
  }

  return {
    ratingDimension,
    ratingDimensionValues,
    towers,
    nodes,
    groups,
    constants,
    models,
  };
}

// ── Icon heuristics ──────────────────────────────────────────

/**
 * Pick a lucide icon name for an inventory dimension item based on
 * its title + metadata. Falls back to category-appropriate defaults
 * so different dimensions don't all look identical in the rail.
 */
function pickDimensionIcon(
  title: string,
  meta: string | undefined,
  subtype: NodeSubtype | undefined,
): string {
  const lower = title.toLowerCase();
  // Explicit subtypes win
  if (subtype === "geographic") return "MapPin";
  if (subtype === "classification") return "Tag";
  // Currency-shaped
  if (meta === "currency_usd" || meta === "USD" || meta === "number" ||
      /tiv|premium|cost|value|limit|bpp/i.test(lower)) {
    return "DollarSign";
  }
  // Boolean
  if (meta === "boolean" || meta === "bool" || /^(is|has)_/.test(lower)) {
    return "ToggleRight";
  }
  // Date
  if (meta === "date" || /date|year|month/i.test(lower)) return "Calendar";
  // Categorical / enum dimensions — order matters; more-specific
  // first because "construction class" / "protection class" should
  // pick the structural icon, not the generic class-tag icon.
  if (/constr|build|structur/i.test(lower)) return "Building";
  if (/protect|safety|alarm|fire/i.test(lower)) return "Shield";
  if (/sprink|water|wet|dry/i.test(lower)) return "Droplets";
  if (/territ|zip|state|geo|region|county/i.test(lower)) return "MapPin";
  if (/coverage|cov\b/i.test(lower)) return "Boxes";
  if (/peril/i.test(lower)) return "Sparkles";
  // Last among the named: a bare "class" / NAICS / SIC label.
  if (/class\b|naics|sic|industr/i.test(lower)) return "Tag";
  // Default: generic dimension
  return "Variable";
}

// ── Inventory projection ──────────────────────────────────────

/**
 * Build a flat list of inventory items from the plan's dimensions,
 * gates, math operators (closed vocabulary), constants, models,
 * and tower outputs. The UI groups these into sections.
 */
export interface InventoryProjectionInput {
  /** Dimensions catalog (from the Dimensions workspace). */
  readonly dimensions?: readonly { readonly id: string; readonly title: string; readonly subtype?: NodeSubtype; readonly meta?: string }[];
  /** Gates catalog (modifier_schedule / eligibility / endorsement stages). */
  readonly gates?: readonly { readonly id: string; readonly title: string; readonly meta?: string; readonly icon?: string }[];
  readonly constants?: readonly ConstantDef[];
  readonly models?: readonly ModelDef[];
  /**
   * Brief 35 PR 35.2 — Saved factor tables (from the Parametrize
   * workspace). Each table contributes a draggable `factor-table`
   * chip to the inventory rail's top section. The `shapeBadge` is
   * surfaced inline on the chip ("1-D · 8", "2-D · 5×8"); the
   * hover-preview popover (renderItemPreview callback on the rail)
   * fetches the underlying cells + axes from the caller's table store.
   */
  readonly factorTables?: readonly {
    readonly id: string;
    readonly title: string;
    readonly meta?: string;
    readonly shapeBadge?: string;
  }[];
  /**
   * Brief 35 PR 35.2 — Submission-field inputs (`form_input.*`). Each
   * input contributes a draggable `input` chip — used to kick off a
   * tower (the "exposure" at the bottom). dtype drives the icon pick
   * + the manifest-binding compatibility check in PR 35.3.
   */
  readonly inputs?: readonly {
    readonly id: string;
    readonly title: string;
    /** `submission.tiv`, `submission.year_built`, etc. */
    readonly fieldPath?: string;
    readonly dtype?: "number" | "string" | "boolean" | "date";
  }[];
  /** Other towers' outputs in the same plan (for cross-tower refs). */
  readonly towerOutputs?: readonly { readonly key: string; readonly label?: string }[];
}

export function buildInventory(input: InventoryProjectionInput): InventoryItem[] {
  const items: InventoryItem[] = [];

  // FACTOR TABLES (Brief 35 §5 — top section)
  for (const ft of input.factorTables ?? []) {
    items.push({
      id: `ft:${ft.id}`,
      kind: "factor-table",
      category: "lookup",
      subtype: "table",
      title: ft.title,
      ...(ft.meta !== undefined ? { meta: ft.meta } : {}),
      ...(ft.shapeBadge !== undefined ? { shapeBadge: ft.shapeBadge } : {}),
      icon: "Table",
    });
  }

  // DIMENSIONS
  for (const d of input.dimensions ?? []) {
    const category: NodeCategory =
      d.subtype === "geographic" || d.subtype === "classification"
        ? "transform"
        : "input";
    items.push({
      id: `dim:${d.id}`,
      kind: "dimension",
      category,
      ...(d.subtype !== undefined ? { subtype: d.subtype } : {}),
      title: d.title,
      ...(d.meta !== undefined ? { meta: d.meta } : {}),
      icon: pickDimensionIcon(d.title, d.meta, d.subtype),
    });
  }

  // GATES
  for (const g of input.gates ?? []) {
    items.push({
      id: `gate:${g.id}`,
      kind: "gate",
      category: "loading",
      subtype: "modifier",
      title: g.title,
      ...(g.meta !== undefined ? { meta: g.meta } : {}),
      icon: g.icon ?? "Sliders",
    });
  }

  // MATH — closed vocabulary, 8 operators.
  const MATH_OPS: { op: Operator; title: string; meta?: string }[] = [
    { op: "multiply", title: "Multiply" },
    { op: "divide", title: "Divide" },
    { op: "plus", title: "Plus" },
    { op: "minus", title: "Minus" },
    { op: "round", title: "Round" },
    { op: "max", title: "Max" },
    { op: "min", title: "Min" },
    { op: "pair", title: "Pair" },
  ];
  for (const m of MATH_OPS) {
    items.push({
      id: `math:${m.op}`,
      kind: "math",
      category: "math",
      subtype: "math-op",
      title: m.title,
      icon: "Calculator",
    });
  }

  // MODELS
  for (const model of input.models ?? []) {
    items.push({
      id: `model:${model.id}`,
      kind: "model",
      category: "lookup",
      subtype: "model",
      title: model.name,
      meta: model.version,
      icon: "Brain",
    });
  }

  // CONSTANTS
  for (const c of input.constants ?? []) {
    items.push({
      id: `const:${c.id}`,
      kind: "constant",
      category: "math",
      subtype: "constant",
      title: c.name,
      meta: String(c.value),
      icon: "Target",
    });
  }

  // INPUTS (Brief 35 §5 — submission-field inputs)
  for (const inp of input.inputs ?? []) {
    items.push({
      id: `input:${inp.id}`,
      kind: "input",
      category: "input",
      subtype: "key",
      title: inp.title,
      ...(inp.fieldPath !== undefined ? { meta: inp.fieldPath } : {}),
      icon: pickInputIcon(inp.dtype),
    });
  }

  // TOWER OUTPUTS (cross-coverage refs)
  for (const o of input.towerOutputs ?? []) {
    items.push({
      id: `out:${o.key}`,
      kind: "tower-output",
      category: "output",
      title: o.label ?? o.key,
      icon: "Circle",
    });
  }

  return items;
}

/** Pick a Lucide icon name for a submission-field input by dtype. */
function pickInputIcon(
  dtype: "number" | "string" | "boolean" | "date" | undefined,
): string {
  switch (dtype) {
    case "number":
      return "Hash";
    case "string":
      return "Type";
    case "boolean":
      return "ToggleRight";
    case "date":
      return "Calendar";
    default:
      return "Variable";
  }
}

// ── Re-export the mode union for downstream consumers ─────────

export type { TowerMode };
