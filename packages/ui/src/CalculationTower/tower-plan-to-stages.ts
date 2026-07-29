/**
 * towerPlanToStages — Brief 25 §8.2 save converter (PR 12.1).
 *
 * The inverse of `stagesToTowerPlan`. Walks the editable `TowerPlan`
 * the user mutated via AssembleCanvas and emits the substrate
 * `StageSummary[]` an `addStage` / `patchStageConfig` mutation can
 * push to the backend.
 *
 * Pure data in / pure data out. No React, no I/O. Consumed by the
 * AssembleCanvas save path (PR 12.2) which diffs the emitted stages
 * against the current server stages + fires per-stage mutations.
 *
 * ────────────────────────────────────────────────────────────────
 * Scope (v1):
 *
 *   ✓ Chain projection — N+1 towers (per coverage value + Total)
 *     reverse-projected into one `multiplicative_chain` stage with
 *     `chains[]` of `ChainSpec`. Reads `submission-field`,
 *     `factor-table`, `constant`, and `output` `NodeRef` variants.
 *
 *   ✓ Standalone `input_node` stages — the plan's full declared input
 *     dictionary is preserved verbatim (Brief 59), plus one minted for
 *     any chain base/exposure field not already declared (deduped). The
 *     runtime resolves `chain.base_input = "stages.<id>.value"` against
 *     these. NOTE: emitting only chain-referenced inputs (the pre-Brief-59
 *     behavior) caused the caller's diff to DELETE every other declared
 *     input on save — the input dictionary must always round-trip whole.
 *
 *   ✓ Round-trip preservation — when the caller passes the original
 *     server stages via `preservedStages`, every input_node is preserved
 *     (above) and sidecar stage kinds the converter doesn't reverse-
 *     project (modifier_schedule, flat_factor, clamp, round,
 *     eligibility.gate, …) flow through unchanged. This keeps the save
 *     path lossless while we implement the missing reverse paths one at
 *     a time.
 *
 *   ✗ Modifier-schedule reverse — placeholder. Loadings + final
 *     adjustments + clamp/round are flow-through only in v1.
 *
 *   ✗ Group reverse — TowerGroup's inner ops are not yet flattened
 *     into the chain's factor order. v1 expects each tower's
 *     `entries` to be a flat sequence of `kind: "node"` entries.
 *     Groups are flattened in encounter order with their innerOps
 *     applied between consecutive factors.
 *
 * The factor-table catalog argument supplies the dim-key mapping
 * the projector needs to reconstruct
 * `chain.factor_lookups[].dimensions[k].path`. Each catalog entry
 * carries either `key_dimension` (the typical 1-D table) or
 * `key_dimensions` (composite/2-D). Catalog missing → the converter
 * falls back to `{ class: { source: "form_input", path: table.id } }`
 * which preserves round-trip on the sample-bop fixture but is brittle
 * for user-authored tables; PR 12.2 wires the real catalog so this
 * fallback is rarely hit.
 *
 * Round-trip property:
 *
 *     towerPlanToStages(stagesToTowerPlan(stages), { factorTablesCatalog })
 *       ≈ stages   // semantic equivalence; ids may regenerate
 *
 * Tested in tower-plan-to-stages.test.ts against the sample-bop
 * sample plan's chain stages.
 */

import { isTotalTower } from "./plan-mutations";
import type { StageInput } from "./stages-to-tower-plan";
import type {
  AxisSource,
  Operator,
  Tower,
  TowerEntry,
  TowerNode,
  TowerPlan,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * Minimal factor-table catalog shape the projector consults to
 * reconstruct `factor_lookups[].dimensions[k].path`. Matches the
 * shape `AssembleCanvas` already accepts (see
 * `AssembleCanvasProps.factorTablesCatalog`).
 */
export interface FactorTableCatalogEntry {
  readonly id: string;
  readonly display_name?: string;
  readonly key_dimension?: string;
  readonly key_dimensions?: readonly string[];
}

export interface TowerPlanToStagesOptions {
  /** Per-table key-dim mapping — needed to fill in chain dim refs. */
  readonly factorTablesCatalog?: readonly FactorTableCatalogEntry[];
  /**
   * Original server stages. Stage kinds this converter doesn't
   * reverse-project yet (modifier_schedule, flat_factor, clamp,
   * round, eligibility.gate, …) flow through unchanged. Without
   * `preservedStages`, the converter only emits the chain +
   * input_node stages it knows how to construct — round-trip would
   * lose every sidecar stage.
   */
  readonly preservedStages?: readonly StageInput[];
  /**
   * Per-input dtype hints. When the projector emits an `input_node`
   * stage for a submission-field reference, it consults this map to
   * fill in `config_json.data_type` — without a hint we default to
   * `"string"`. Keyed by submission field name (e.g., "tiv" →
   * "number").
   */
  readonly inputDtypeHints?: Readonly<Record<string, string>>;
  /**
   * Default exposure_unit_divisor when the converter can't infer
   * one. ISO BOP uses 100 (rate per $100); other LOBs use 1.
   * Defaults to 100.
   */
  readonly defaultExposureUnitDivisor?: number;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * `submission-field` ref ids are bare field names ("tiv",
 * "class_code"). The runtime resolves `form_input.X` to that field.
 * The converter writes `form_input.<field>` for non-base inputs and
 * `stages.<stageId>.value` for the chain's base_input (because the
 * base typically goes through an input_node first).
 */
function formInputPath(field: string): string {
  return `form_input.${field}`;
}

/**
 * FCA fca-2026-07-25 #16 (the phantom edit) — a binding that already
 * names its namespace stays VERBATIM. The exposure writer used to
 * prefix `form_input.` unconditionally, so a workbook's `literal:1`
 * round-tripped to the malformed `form_input.literal:1`: a VIEW
 * session then persisted a hash-moving edit no user made, tripping
 * the edited-since-build banner with a change the differ could not
 * describe. Reader (strip `form_input.`) and writer are now inverses
 * for every binding grammar form (R-127).
 */
function bindingPath(field: string): string {
  if (
    field.startsWith("form_input.") ||
    field.startsWith("literal:") ||
    field.startsWith("literal.") ||
    field.startsWith("context.") ||
    field.startsWith("stages.")
  ) {
    return field;
  }
  return formInputPath(field);
}

function stagePath(stageId: string): string {
  return `stages.${stageId}.value`;
}

/**
 * Build the canonical input_node stage id for a submission field.
 * Matches the convention `stagesToTowerPlan` produces on the load
 * side ("inp_<field>_N"). When the field already has a non-default
 * stage id (e.g., "input_class_code" from a hand-authored plan),
 * the caller is expected to pass it via `preservedStages` so the
 * converter's emit is a no-op for that field.
 */
function makeInputNodeId(field: string): string {
  // Sanitize for stage_id (lowercase alphanumeric + underscore).
  const safe = field.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  return `input_${safe}`;
}

/**
 * Strip path prefixes the substrate uses on chain field paths.
 *
 *   "form_input.tiv"            → "tiv"
 *   "stages.rate_number.value"  → "rate_number"   (the stage id)
 *   "rate_number"               → "rate_number"   (already raw)
 *
 * Used to normalize the `field` value the load converter writes
 * verbatim onto a submission-field node's ref when no matching
 * input_node stage was found. Without this normalization, the save
 * direction would mint stage ids like `input_stages_rate_number_value`
 * (underscoring the full path).
 *
 * Matches the heuristic in `@openrater/ui/InputsWorkspace/
 * deriveRequiredInputs.ts:normalizePath` — single source of truth
 * for substrate path conventions.
 */
function normalizeFieldPath(field: string): string {
  if (field.startsWith("form_input.")) return field.slice("form_input.".length);
  if (field.startsWith("stages.")) {
    const parts = field.split(".");
    return parts[1] ?? field;
  }
  return field;
}

/**
 * Resolve the input_node stage id for a given source field. Prefers
 * a preserved stage's id over a freshly-minted one so fixtures
 * (whose stage ids are stable across sessions) round-trip.
 */
function resolveInputNodeStageId(
  field: string,
  preservedStages: readonly StageInput[],
): string {
  const existing = preservedStages.find((s) => {
    if (s.stage_kind !== "input_node") return false;
    const cfg = (s.config_json ?? {}) as Record<string, unknown>;
    const sp = cfg["source_path"];
    if (typeof sp === "string" && sp === field) return true;
    return s.stage_id === field || s.stage_id === makeInputNodeId(field);
  });
  return existing?.stage_id ?? makeInputNodeId(field);
}

/**
 * Resolve a `TowerNode` from a `TowerEntry`. Returns `null` when the
 * entry is a drop-slot (UI-only marker) or a group that's been
 * flattened (handled upstream).
 */
function nodeFromEntry(
  entry: TowerEntry,
  nodes: ReadonlyMap<string, TowerNode>,
): TowerNode | null {
  if (entry.kind === "drop-slot") return null;
  if (entry.kind === "group") return null; // caller flattens
  return nodes.get(entry.nodeId) ?? null;
}

/**
 * Flatten the tower's entries into a single sequence of nodes +
 * operators. Groups are expanded in-place; their `innerOps` slot
 * in between the group's nodes; the surrounding `entryOp` is
 * preserved at the group boundary.
 *
 * Returns a parallel `(nodes, ops)` pair where `ops[i]` sits between
 * `nodes[i]` and `nodes[i+1]`.
 */
function flattenTower(
  tower: Tower,
  plan: TowerPlan,
): { nodes: readonly TowerNode[]; ops: readonly Operator[] } {
  const out: TowerNode[] = [];
  const opsOut: Operator[] = [];
  for (let i = 0; i < tower.entries.length; i++) {
    const entry = tower.entries[i]!;
    const opBefore = i > 0 ? tower.entryOps[i - 1] : undefined;
    if (entry.kind === "group") {
      const group = plan.groups.get(entry.groupId);
      if (!group) continue;
      for (let j = 0; j < group.nodeIds.length; j++) {
        const node = plan.nodes.get(group.nodeIds[j]!);
        if (!node) continue;
        if (out.length > 0) {
          opsOut.push(j === 0 ? (opBefore ?? "multiply") : group.innerOps[j - 1] ?? "multiply");
        }
        out.push(node);
      }
      continue;
    }
    const node = nodeFromEntry(entry, plan.nodes);
    if (!node) continue;
    if (out.length > 0 && opBefore) opsOut.push(opBefore);
    out.push(node);
  }
  return { nodes: out, ops: opsOut };
}

/**
 * Construct the `factor_lookups[].dimensions` map for a factor-table
 * node by consulting the catalog. Each `key_dimension` becomes one
 * binding entry with `path = key`. The catalog provides the link;
 * without it we fall back to `{ <tableId>: { path: <tableId> } }`
 * which preserves round-trip for the sample-bop fixture.
 */
function buildDimensionsForTable(
  tableId: string,
  catalog: readonly FactorTableCatalogEntry[] | undefined,
  axisSources?: Readonly<Record<string, AxisSource>>,
): Record<string, AxisSource> {
  const entry = catalog?.find((t) => t.id === tableId);
  const catalogKeys: readonly string[] =
    entry?.key_dimensions ??
    (entry?.key_dimension ? [entry.key_dimension] : [tableId]);
  // ADR-0047 — union the catalog's axes with any authored axis sources, so an
  // authored secondary-axis source (literal / computed / derived) persists
  // even when the factor-table catalog is absent or lags the table's keys.
  const keys = new Set<string>([
    ...catalogKeys,
    ...Object.keys(axisSources ?? {}),
  ]);
  const out: Record<string, AxisSource> = {};
  for (const k of keys) {
    // An authored per-axis source overrides the default form_input binding
    // on the axis slug; absent axes keep the default.
    out[k] = axisSources?.[k] ?? { source: "form_input", path: k };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Chain reverse projection
// ─────────────────────────────────────────────────────────────────

interface ChainSpec {
  name: string;
  base_input: string;
  /**
   * Cold-test L30 — the chain's authored literal base rate. Set when
   * the tower's base node is a `chain-base` ref with a non-null value.
   * Omitted (undefined) for legacy column-driven bases so those plans
   * round-trip without gaining a spurious literal.
   */
  base_value?: number;
  factor_lookups: Array<{
    name: string;
    factor_kind: string;
    table: "rate_factors";
    lookup_method: "direct";
    dimensions: Record<string, AxisSource>;
    citation_rule: string;
    citation_page: string;
    description_template: string;
    // ADR-0047 — optional gate round-tripped from the factor-table ref.
    predicate?: { path: string; equals: boolean | number | string };
  }>;
  lcm: {
    factor_kind: string;
    // ADR-0047 — an authored carrier LCM scalar (preferred) OR a column path.
    value?: number;
    input_path?: string;
    overridable?: boolean;
    citation_rule: string;
    citation_page: string;
    description_template: string;
  };
  exposure_input: string;
  exposure_unit_divisor: number;
  // ADR-0047 — explicit opt-in to exposure-rated scoring for a per-account
  // tower (coverage towers auto-apply in the projector).
  apply_exposure?: boolean;
  output_field: string;
  coverage_value?: string;
}

/**
 * Project one Tower → one ChainSpec. The tower's flattened entries
 * are split into:
 *
 *   - input nodes (submission-field) → contribute to base_input /
 *     exposure_input. By convention, the FIRST submission-field is
 *     the base_input; subsequent ones become exposure_input.
 *   - factor-table nodes → factor_lookups[].
 *   - constant nodes named "LCM" / id "LCM" → the chain's LCM tail.
 *   - the trailing output node → output_field.
 *
 * Returns null when the tower has no factor-table nodes (an empty
 * shell — not yet a real chain). Callers should drop empties.
 */
function projectTowerToChain(
  tower: Tower,
  plan: TowerPlan,
  opts: TowerPlanToStagesOptions,
): {
  spec: ChainSpec | null;
  baseInputField: string | null;
  exposureInputField: string | null;
} {
  const { nodes: flatNodes } = flattenTower(tower, plan);
  const factorLookups: ChainSpec["factor_lookups"] = [];
  let baseInputField: string | null = null;
  let exposureInputField: string | null = null;
  let lcm: ChainSpec["lcm"] | null = null;
  let outputField = tower.outputField || "chain_output";
  // Cold-test L30 — the authored literal base rate (from a
  // `chain-base` node). `undefined` ⇒ no literal (legacy column base).
  let baseValue: number | undefined;

  for (const node of flatNodes) {
    if (node.ref?.kind === "chain-base") {
      // Cold-test L30 — the editable literal base. A non-null value
      // becomes the chain's `base_value`; a null one (the user opened
      // a fresh base node but didn't author a number) leaves the
      // chain literal-less so validation can flag "base rate unset".
      if (node.ref.baseValue !== null) baseValue = node.ref.baseValue;
      continue;
    }
    if (node.ref?.kind === "submission-field") {
      // PR 12.1 — normalize the field name; the load converter
      // writes the chain's `base_input` verbatim onto the node's
      // ref.field, including `stages.X.value` / `form_input.X`
      // prefixes. Stripping them here keeps the save side from
      // emitting nested-stage-id paths.
      const field = normalizeFieldPath(node.ref.field);
      if (!baseInputField) {
        baseInputField = field;
      } else if (!exposureInputField) {
        exposureInputField = field;
      }
      continue;
    }
    if (node.ref?.kind === "factor-table") {
      factorLookups.push({
        name: node.title,
        factor_kind: node.ref.tableId,
        table: "rate_factors",
        lookup_method: "direct",
        dimensions: buildDimensionsForTable(
          node.ref.tableId,
          opts.factorTablesCatalog,
          node.ref.axisSources,
        ),
        citation_rule: "",
        citation_page: "",
        description_template: `${node.title}: ×{value}`,
        // ADR-0047 — reverse-project the gate onto FactorLookup.predicate.
        ...(node.ref.predicate ? { predicate: node.ref.predicate } : {}),
      });
      continue;
    }
    if (
      node.ref?.kind === "constant" &&
      (node.ref.role === "lcm" ||
        (node.ref.role === undefined && /lcm/i.test(node.ref.constantId)))
    ) {
      // ADR-0047 — prefer the authored scalar (`lcm.value`); the projector
      // applies it AFTER the 3-dp rate round (folding it into base_value
      // rounds at the wrong point). Fall back to the legacy column path when
      // no value is authored. An overridable value keeps the column exposed
      // (the per-risk escape hatch).
      const v = node.ref.value;
      const column = formInputPath(node.ref.constantId.toLowerCase());
      if (typeof v === "number" && Number.isFinite(v)) {
        lcm = {
          factor_kind: "lcm",
          value: v,
          ...(node.ref.overridable === true
            ? { input_path: column, overridable: true }
            : {}),
          citation_rule: "(carrier-set)",
          citation_page: "(carrier-set)",
          description_template: "Loss Cost Multiplier (carrier): {value}",
        };
      } else {
        lcm = {
          factor_kind: "lcm",
          input_path: column,
          citation_rule: "(carrier-set)",
          citation_page: "(carrier-set)",
          description_template: "Loss Cost Multiplier (carrier): {value}",
        };
      }
      continue;
    }
    if (node.ref?.kind === "output") {
      outputField = node.ref.outputField;
      continue;
    }
  }

  // A tower is a "real" chain once it has at least one factor lookup
  // OR an authored literal base rate. Cold-test L30: a from-scratch
  // chain whose only authored content is "base 600 × LCM" must save +
  // score — pre-L30 this returned null (no factor tables) and the
  // chain silently dropped.
  if (factorLookups.length === 0 && baseValue === undefined) {
    return { spec: null, baseInputField, exposureInputField };
  }

  // Resolve the base_input stage id: prefer the preserved input_node
  // stage's id when one exists for this field (so a fixture's
  // `stage_id: "rate_number"` stays as-is and isn't regenerated to
  // `input_rate_number`). PR 12.2 will diff this against the server
  // stages — but inside this pure module, we just need the chain
  // path to be deterministic against the input_node we'll emit.
  const baseInputStageId = baseInputField
    ? resolveInputNodeStageId(baseInputField, opts.preservedStages ?? [])
    : null;

  // `base_input` is required non-empty by the substrate schema. For a
  // literal-base chain with no submission field we write a descriptive
  // sentinel path; the runtime projector ignores `base_input` entirely
  // when `base_value` is present, so this is metadata-only.
  const baseInputPath = baseInputStageId
    ? stagePath(baseInputStageId)
    : baseValue !== undefined
      ? "literal.base_value"
      : "";

  // F01 — never emit a chain with an empty `base_input`. The substrate rejects
  // it (min_length≥1) and, because every tower's chain is batched into ONE
  // `multiplicative_chain` stage, a single base-unset tower 422s the whole save
  // and the client drops valid sibling towers too. A tower with factor lookups
  // but no resolvable base (no submission-field base, no authored literal) is
  // not yet priceable — drop it from the projection so its siblings persist.
  // Towers created via spawnTowersFromDim / addEmptyTower now seed an identity
  // base (1.0), so this only fires when an author explicitly clears a base.
  if (baseInputPath === "") {
    return { spec: null, baseInputField, exposureInputField };
  }

  const spec: ChainSpec = {
    name: tower.name,
    base_input: baseInputPath,
    ...(baseValue !== undefined ? { base_value: baseValue } : {}),
    factor_lookups: factorLookups,
    lcm: lcm ?? {
      factor_kind: "lcm",
      input_path: formInputPath("lcm"),
      citation_rule: "(carrier-set)",
      citation_page: "(carrier-set)",
      description_template: "Loss Cost Multiplier (carrier): {value}",
    },
    // ADR-0047 — prefer the tower's explicitly-authored exposure base over
    // the submission-field convention; fall back to the dead placeholder.
    exposure_input: tower.exposureInput
      ? bindingPath(tower.exposureInput)
      : exposureInputField
        ? formInputPath(exposureInputField)
        : formInputPath("exposure"),
    exposure_unit_divisor:
      tower.exposureUnitDivisor ?? opts.defaultExposureUnitDivisor ?? 100,
    ...(tower.applyExposure !== undefined
      ? { apply_exposure: tower.applyExposure }
      : {}),
    output_field: outputField,
    ...(tower.ratingDimensionValue
      ? { coverage_value: tower.ratingDimensionValue }
      : {}),
  };

  return { spec, baseInputField, exposureInputField };
}

// ─────────────────────────────────────────────────────────────────
// Input-node reverse projection
// ─────────────────────────────────────────────────────────────────

/**
 * Build the `input_node` stage for a submission field referenced by
 * some tower. Reuses a `preservedStages` entry when one exists for
 * the same field (so user-authored plans don't get duplicate stages
 * with regenerated ids on save).
 */
function buildInputNodeStage(
  field: string,
  preservedStages: readonly StageInput[],
  inputDtypeHints: Readonly<Record<string, string>> | undefined,
  sequence: number,
): StageInput {
  // Look for an existing input_node stage that already targets this
  // field — match on `source_path` OR `stage_id` ending with the field
  // name (the convention `makeInputNodeId` produces).
  const existing = preservedStages.find((s) => {
    if (s.stage_kind !== "input_node") return false;
    const cfg = (s.config_json ?? {}) as Record<string, unknown>;
    const sp = cfg["source_path"];
    if (typeof sp === "string" && sp === field) return true;
    return s.stage_id === makeInputNodeId(field);
  });
  if (existing) return existing;

  const dtype = inputDtypeHints?.[field] ?? "string";
  return {
    stage_id: makeInputNodeId(field),
    sequence,
    stage_kind: "input_node",
    display_name: field,
    config_json: {
      name: field,
      data_type: dtype,
      source: "form_input",
      source_path: field,
      required: true,
      output_field: "value",
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Main converter
// ─────────────────────────────────────────────────────────────────

/**
 * Convert a TowerPlan into the substrate stage list the backend
 * stores. The diff against the current server stages happens at
 * the caller (PR 12.2) — this module just produces the desired
 * end-state shape.
 *
 * Stage emit order:
 *   1. input_node stages (one per unique submission-field referenced)
 *   2. ONE multiplicative_chain stage carrying every tower's chain
 *   3. preserved sidecar stages (modifier_schedule, flat_factor,
 *      clamp, round, eligibility.gate, …) in their original order
 */
/**
 * Brief 78 P5.3c — patch the sheet-editable fields over a clone of
 * the ORIGINAL chain spec (key order preserved), so everything the
 * tower model doesn't carry — class-conditional `exposure_options`
 * (ADR-0044 D9), citations, description templates, unknown future
 * fields — survives verbatim, and an untouched chain re-emits its
 * exact original bytes.
 *
 * Patched (what the sheet can author):
 *   · base_value            (the inline base edit)
 *   · factor_lookups        (add / remove / reorder; per-element the
 *                            ORIGINAL object is kept verbatim unless
 *                            its sheet-editable predicate changed)
 *   · lcm.value             (the inline LCM edit — value-shaped only)
 *   · exposure_input / exposure_unit_divisor / apply_exposure — for
 *     PLAIN chains only; a chain with non-empty exposure_options
 *     keeps its exposure family frozen (the class-conditional editor
 *     is its own brief).
 */
function patchChainOverOriginal(
  original: Readonly<Record<string, unknown>>,
  rebuilt: ChainSpec,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original };

  // Base value — the sheet's inline chain-base edit.
  if (
    rebuilt.base_value !== undefined &&
    !Object.is(out["base_value"], rebuilt.base_value)
  ) {
    out["base_value"] = rebuilt.base_value;
  }

  // Factor lookups — identity-match by factor_kind; keep the original
  // element verbatim unless its predicate changed.
  const origLookups = Array.isArray(original["factor_lookups"])
    ? (original["factor_lookups"] as ReadonlyArray<Record<string, unknown>>)
    : [];
  const origByKind = new Map(
    origLookups.map((l) => [String(l["factor_kind"] ?? ""), l]),
  );
  // Predicate equality is SEMANTIC ({path, equals} fields), never a
  // stringify: the fixture's authored predicates carry a different
  // key order than the sheet's rebuilt shape, and an order-sensitive
  // compare would rewrite (and byte-shift) every predicate on load.
  const predEq = (a: unknown, b: unknown): boolean => {
    const aEmpty = a === undefined || a === null;
    const bEmpty = b === undefined || b === null;
    if (aEmpty || bEmpty) return aEmpty === bEmpty;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    return (
      Object.is(ao["path"], bo["path"]) &&
      Object.is(ao["equals"], bo["equals"])
    );
  };
  const merged = (rebuilt.factor_lookups ?? []).map((rlRaw) => {
    const rl = rlRaw as unknown as Record<string, unknown>;
    const orig = origByKind.get(String(rl["factor_kind"] ?? ""));
    if (!orig) return rl; // a factor added in the sheet
    const rPred = rl["predicate"];
    if (predEq(orig["predicate"], rPred)) {
      return orig; // untouched — original bytes, original key order
    }
    const clone: Record<string, unknown> = { ...orig };
    if (rPred === undefined || rPred === null) delete clone["predicate"];
    else clone["predicate"] = rPred;
    return clone;
  });
  const lookupsUntouched =
    merged.length === origLookups.length &&
    merged.every((el, i) => el === origLookups[i]);
  out["factor_lookups"] = lookupsUntouched
    ? original["factor_lookups"]
    : merged;

  // LCM — patch the value only, onto the original envelope.
  //
  // Platform-test finding E10e — the original may be COLUMN-shaped
  // (`input_path` only, no `value`): the sheet's "set a value" must
  // still persist. The old guard required the ORIGINAL to already
  // carry a numeric value, so setting one on a column-shaped chain
  // saved a no-op while the pill said "Saved" (the 1.401 constant
  // had to ride every book row as an `lcm` column). The value patches
  // onto the original envelope; the projector prefers an authored
  // `value` over the column (ADR-0047), so a stale input_path in the
  // envelope is inert.
  const oLcm = original["lcm"];
  const rLcmVal = (rebuilt.lcm as Record<string, unknown> | undefined)?.[
    "value"
  ];
  if (typeof rLcmVal === "number" && Number.isFinite(rLcmVal)) {
    if (
      oLcm !== null &&
      typeof oLcm === "object" &&
      !Object.is((oLcm as Record<string, unknown>)["value"], rLcmVal)
    ) {
      out["lcm"] = { ...(oLcm as Record<string, unknown>), value: rLcmVal };
    } else if (oLcm === undefined || oLcm === null) {
      // No original LCM at all — take the rebuilt ADR-0047 shape
      // wholesale so an authored constant isn't dropped.
      out["lcm"] = rebuilt.lcm as unknown as Record<string, unknown>;
    }
  }

  // Exposure family — the pill's edits flow for plain chains; frozen
  // verbatim when class-conditional options exist.
  const eo = original["exposure_options"];
  const hasOptions = Array.isArray(eo) && eo.length > 0;
  if (!hasOptions) {
    if (
      rebuilt.exposure_input !== undefined &&
      !Object.is(out["exposure_input"], rebuilt.exposure_input)
    ) {
      out["exposure_input"] = rebuilt.exposure_input;
    }
    if (
      rebuilt.exposure_unit_divisor !== undefined &&
      !Object.is(out["exposure_unit_divisor"], rebuilt.exposure_unit_divisor)
    ) {
      out["exposure_unit_divisor"] = rebuilt.exposure_unit_divisor;
    }
    if (
      rebuilt.apply_exposure !== undefined &&
      !Object.is(out["apply_exposure"], rebuilt.apply_exposure)
    ) {
      out["apply_exposure"] = rebuilt.apply_exposure;
    }
  }

  return out;
}

export function towerPlanToStages(
  plan: TowerPlan,
  opts: TowerPlanToStagesOptions = {},
): readonly StageInput[] {
  const preserved = opts.preservedStages ?? [];

  // Brief 78 P5.3c — PATCH-OVER-ORIGINAL replaces the old whole-stage
  // verbatim guard. Each loaded tower carries its ORIGINAL chain spec
  // (`Tower.chainVerbatim`); the save path clones it and applies only
  // the sheet-editable fields (base value · factor-lookup set +
  // predicates · LCM value · the exposure family for plain chains).
  // Untouched chains therefore round-trip byte-identically (the
  // route's dirty signal is a raw JSON.stringify — key order
  // included), while class-conditional `exposure_options`
  // (ADR-0044 D9), citations, and description templates survive every
  // edit. The old guard emitted the WHOLE stage verbatim whenever ANY
  // chain carried an `exposure_options` key (even an empty `[]`),
  // which silently discarded every tower edit on such plans — the
  // reason the sheet had to render them read-only.
  const preservedChainStage = preserved.find(
    (s) => s.stage_kind === "multiplicative_chain",
  );

  // Track input fields referenced by the chain, in encounter order.
  const inputFields = new Set<string>();

  // Reverse-project every tower → ChainSpec. Skip the "Total" tower
  // (which is read-only per Brief 25 §10) — it's a sum projection
  // computed from sibling towers, not its own chain.
  const chains: ChainSpec[] = [];
  const chainEmits: Array<{
    rebuilt: ChainSpec;
    verbatim?: Readonly<Record<string, unknown>>;
  }> = [];
  for (const tower of plan.towers) {
    // Skip ONLY the real Total tower — identified by its stable id
    // (`isTotalTower` / TOTAL_TOWER_ID), never by position. The old
    // positional heuristic ("last tower without ratingDimensionValue")
    // misclassified ordinary user coverages: any chain authored without
    // a `coverage_value` (every "+ Add coverage" chain pre-2026-07-10)
    // projected to a tower with ratingDimensionValue undefined, and the
    // LAST one was silently DROPPED on every save — a 3-coverage plan
    // decayed to 1 across routine autosaves (Sample BOP platform test,
    // finding E1; docs/stress-tests/sample-bop-platform/rating-errors.md).
    if (isTotalTower(tower)) continue;

    const { spec, baseInputField, exposureInputField } = projectTowerToChain(
      tower,
      plan,
      opts,
    );
    if (!spec) continue;
    chains.push(spec);
    chainEmits.push({
      rebuilt: spec,
      ...(tower.chainVerbatim ? { verbatim: tower.chainVerbatim } : {}),
    });
    if (baseInputField) inputFields.add(baseInputField);
    if (exposureInputField) inputFields.add(exposureInputField);
  }

  // Emit input_node stages first.
  //
  // CRITICAL (Brief 59) — the Assemble save MUST NOT delete the plan's
  // declared input dictionary. The caller diffs this `desired` list
  // against the server stages and *removes* anything absent, so every
  // preserved `input_node` has to appear here — not only the handful a
  // chain references as base/exposure. Factor-table dimension inputs
  // (class_code, territory, …) are referenced solely inside
  // `factor_lookups[].dimensions[].path`, never as base/exposure, so the
  // old "emit only `inputFields`" rule dropped them and the caller then
  // deleted them (spawning one tower took a 29-stage plan to 1). We:
  //   (a) carry over every preserved input_node verbatim (keeps its
  //       dtype / source_path / citation / declaration order), then
  //   (b) mint one for each chain base/exposure field the dictionary
  //       doesn't already declare. Deduped by stage_id.
  let sequence = 0;
  const inputStages: StageInput[] = [];
  const emittedInputIds = new Set<string>();

  // (a) Preserve the full declared input dictionary.
  for (const s of preserved) {
    if (s.stage_kind !== "input_node") continue;
    if (emittedInputIds.has(s.stage_id)) continue;
    emittedInputIds.add(s.stage_id);
    inputStages.push({ ...s, sequence: sequence++ });
  }

  // (b) Ensure a stage exists for each chain-referenced base/exposure
  //     field — reusing a preserved stage when one matches, only minting
  //     for a field the dictionary doesn't already declare.
  for (const field of inputFields) {
    const stage = buildInputNodeStage(
      field,
      preserved,
      opts.inputDtypeHints,
      sequence,
    );
    if (emittedInputIds.has(stage.stage_id)) continue;
    emittedInputIds.add(stage.stage_id);
    inputStages.push({ ...stage, sequence: sequence++ });
  }

  // Emit the chain stage (if any chains). With a preserved original,
  // keep its stage identity + config envelope and patch each chain
  // over its verbatim spec (Brief 78 P5.3c — byte-stable untouched,
  // edits flow, exposure_options survive). Born-in-the-sheet plans
  // (no preserved chain stage) emit the canonical rebuilt stage.
  const chainStage: StageInput | null = preservedChainStage
    ? chainEmits.length > 0
      ? {
          stage_id: preservedChainStage.stage_id,
          sequence: sequence++,
          stage_kind: "multiplicative_chain",
          display_name:
            preservedChainStage.display_name ?? "Multiplicative chain",
          config_json: {
            ...((preservedChainStage.config_json ?? {}) as Record<
              string,
              unknown
            >),
            chains: chainEmits.map(({ rebuilt, verbatim }) =>
              verbatim
                ? patchChainOverOriginal(verbatim, rebuilt)
                : (rebuilt as unknown as Record<string, unknown>),
            ),
          },
        }
      : null
    : chains.length > 0
      ? {
          stage_id: "multiplicative_chain_main",
          sequence: sequence++,
          stage_kind: "multiplicative_chain",
          display_name: "Multiplicative chain",
          config_json: {
            chains,
            output_total_field: "subtotal_after_chain_usd",
            ...(plan.ratingDimension &&
            plan.ratingDimension !== "coverage"
              ? { rating_dimension: plan.ratingDimension }
              : { rating_dimension: plan.ratingDimension || "coverage" }),
          },
        }
      : null;

  // Emit preserved sidecar stages in their original order. `input_node`
  // is already handled above (preserve-or-re-emit, §a/§b) and the old
  // `multiplicative_chain` is replaced by the re-emitted
  // `multiplicative_chain_main` — so both are skipped here; everything
  // else (modifier_schedule, flat_factor, clamp, round, eligibility.gate,
  // …) flows through unchanged.
  const reverseProjectedKinds = new Set<string>([
    "input_node",
    "multiplicative_chain",
  ]);
  const sidecarStages: StageInput[] = [];
  for (const s of preserved) {
    if (reverseProjectedKinds.has(s.stage_kind)) continue;
    sidecarStages.push({
      ...s,
      sequence: sequence++,
    });
  }

  const out: StageInput[] = [...inputStages];
  if (chainStage) out.push(chainStage);
  out.push(...sidecarStages);
  return out;
}
