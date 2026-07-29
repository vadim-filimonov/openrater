/**
 * deriveRequiredInputs — Brief 38 §4.2 (PR 11h + PR 13.1).
 *
 * Pure module. Given a plan's stages + dim catalog + (optional)
 * factor-table catalog, returns the full list of "required inputs"
 * the plan needs to score a single row: the canonical set of
 * `column_map` keys the Inputs workspace must surface to the user
 * for mapping.
 *
 * Walks SIX sources in the plan + catalogs. The first four are
 * stage-driven (only fire when the user has wired a chain or
 * authored input/flat-factor stages). The last two are catalog-
 * driven — they let the workspace surface "expected inputs" even
 * before a chain exists, so a user who just made a Class dim sees
 * `class` show up as a required input the moment they open Inputs.
 *
 *   1. **`input_node` stages** — each one declares an explicit input
 *      field via `config_json.source_path` (or its stage_id as
 *      fallback). Surfaced under the "Inputs" category.
 *
 *   2. **`multiplicative_chain` factor lookups → dimensions** — each
 *      `factor_lookups[].dimensions[K]` binding contributes one
 *      required input, where `K` is the dim slug and `binding.path`
 *      is the user-facing field name. Surfaced under "Dimensions".
 *
 *   3. **`multiplicative_chain` raw paths** — the chain's
 *      `base_input`, `exposure_input`, and `lcm.input_path` each name
 *      a field the runtime needs. Surfaced under "Inputs".
 *
 *   4. **`flat_factor` input paths** — `input_path` (single) or
 *      `input_paths[]` (multi). Surfaced under "Inputs".
 *
 *   5. **Factor table keys** — every catalog factor table's
 *      `key_dimension` (1-D) and `key_dimensions[]` (N-D) is a
 *      slug the chain WILL need a CSV column for. Even before the
 *      chain is wired, the table's existence is a strong signal.
 *      Surfaced under "Dimensions".
 *
 *   6. **Catalog dimensions** — every dim in the catalog is an
 *      "expected" field. Lowest priority: anything stage-driven or
 *      FT-key-driven WINS, so this only fills in dims the user has
 *      authored but not yet referenced anywhere. Surfaced under
 *      "Dimensions".
 *
 * Path normalization handles the substrate's three encoding styles:
 *
 *     "form_input.tiv"         → field "tiv"
 *     "stages.rate_number.value" → field "rate_number"  (the leaf segment)
 *     "class_code"             → field "class_code"     (already raw)
 *
 * NON-INPUT NAMESPACES are skipped entirely — a binding that names an
 * authored constant (`literal.base_value`, the ingest builder's
 * colon-form `literal:<n>` per filing-transcription spec §4.6) or an
 * engine-context read (`context.lcm`) is never a book column, so it
 * must never surface as a declarable required input. (The `literal:1`
 * default exposure binding on freshly ingested plans used to ghost as
 * a "missing input" here — and one-click Declare then minted a junk
 * `literal:1` input onto the plan.)
 *
 * Dedup is keyed by the normalized field name. When two references
 * collide (e.g., a `class_code` dim ref AND an explicit `input_node`
 * with `source_path: "class_code"`), the FIRST wins per Brief 38
 * §4.2 lock — and downstream metadata (category, dimSlug, origin) is
 * taken from that first entry.
 *
 * NOT YET WALKED (deferred per §4.2 lock):
 *   - `model.*` node `inputs[]` — model substrate doesn't ship yet.
 *   - `rating_dimension` / `product_mode` values — multi-product is
 *     a follow-up; current consumers are single-product.
 *
 * Pure data in / pure data out — no React, no I/O, no runtime
 * imports. 100% testable.
 */

import type { Dimension } from "@openrater/contracts";
import type {
  ChainSpec,
  FactorLookup,
  FlatFactorConfig,
  MultiplicativeChainConfig,
} from "@openrater/contracts";

import { resolveInputDisplayName } from "../InputDictionary/resolveDisplayName";
import type { MatchDtype } from "./autoMatch";
// Pure module (not ColumnMappingTable.tsx) so this projector-feeding
// module carries NO React type dependency — see ADR-0045 / the
// requiredInputCategory.ts header.
import type { RequiredInputCategory } from "./requiredInputCategory";

// Re-export the existing RequiredInputCategory so consumers of the
// deriver have a single import surface. The type itself lives in
// ColumnMappingTable (introduced in Brief 38 PR 38.3 with the rail
// sectioning); the deriver maps every walk into one of those four
// buckets.
export type { RequiredInputCategory } from "./requiredInputCategory";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * One required input, derived from the plan. Keyed by the runtime
 * field name — the same string the user's CSV column will map TO.
 */
export interface DerivedRequiredInput {
  /** Stable id; equals the runtime `externalInputs` key. */
  readonly id: string;
  /** Display name — dim.display_name, input_node.display_name, or id. */
  readonly name: string;
  /** Group for the rail (Brief 38 §5). */
  readonly category: RequiredInputCategory;
  /** Used by the auto-match dtype filter. */
  readonly dtype: MatchDtype;
  /** When the input is a dim ref: slug enables alias resolution. */
  readonly dimSlug?: string;
  /**
   * Human-readable provenance — surfaced in the rail tooltip + the
   * unified error panel ("Required by: Class factor in Building chain").
   * Free-form string; layout layer decides truncation.
   */
  readonly origin: string;
  /**
   * Brief 89 R8 — the entry is a chain-owned SCALAR SLOT with no
   * authored value (a column-shaped carrier LCM). The engine truly
   * reads it, but it is an unset CONSTANT, not a risk input: the
   * dictionary must not offer it as a declarable ghost, and readiness
   * phrases it as "a step needs a value" (repair lives in Rating).
   * A deliberately DECLARED input with this id stays fully legitimate
   * (the E10e column-shaped-LCM plan) — consumers gate on
   * `constantSlot && !declared`, never on the flag alone.
   */
  readonly constantSlot?: true;
  /**
   * Brief 89 R8 — the slot HAS an authored fallback value and merely
   * exposes a per-risk override column (ADR-0047's overridable LCM).
   * The plan rates without it: it never blocks readiness and never
   * reads as "needs a value"; the ghost stays visible as an opt-in.
   */
  readonly optional?: true;
}

// ─────────────────────────────────────────────────────────────────
// Path normalization
// ─────────────────────────────────────────────────────────────────

/**
 * Strip the substrate's path prefixes to get the user-facing field
 * name. Three input shapes, one output shape:
 *
 *   "form_input.tiv"            → "tiv"
 *   "stages.rate_number.value"  → "rate_number"   (the stage id)
 *   "class_code"                → "class_code"    (already raw)
 *
 * For `stages.X.field` we return X — that's the stage id that owns
 * the path. The caller treats it as a field reference; if the user
 * has an explicit input_node with stage_id=X they already get a
 * required input from the input_node walk, so the dedup-by-id step
 * keeps the union clean.
 *
 * Empty / whitespace-only paths return the empty string so the
 * caller can skip them.
 *
 * Exported for testing — callers usually consume the higher-level
 * deriveRequiredInputs() instead.
 */
/**
 * Slug-safe field key. ONE function for every derived field name —
 * the projector's `schedule_app_${sanitize(id)}` and this deriver's
 * mappable entry must agree byte-for-byte (FCA #23), so the
 * implementation lives here and stagesToRuntimePlan re-exports it.
 */
export function sanitize(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "x"
  );
}

export function normalizePath(path: string | undefined | null): string {
  if (!path) return "";
  const s = String(path).trim();
  if (s === "") return "";
  if (s.startsWith("form_input.")) return s.slice("form_input.".length);
  if (s.startsWith("stages.")) {
    // "stages.X.value" → "X". Tolerates deeper paths by returning
    // the second segment (which is the stage id) regardless of what
    // follows.
    const parts = s.split(".");
    return parts[1] ?? s;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Stage shape from `@openrater/api-client.StageSummary` — narrowed to
 * the two fields this module reads. We avoid the full StageSummary
 * import to keep this module type-isolated (the runtime substrate
 * + the api-client shape have grown apart over Brief 35 / 38).
 */
export interface StageLike {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly display_name?: string;
  readonly config_json?: unknown;
}

/**
 * Factor-table catalog entry — narrowed to the fields this module
 * reads. PR 13.1: the FT catalog feeds the catalog-driven derivation
 * passes (#5 in the JSDoc above). 1-D tables expose `key_dimension`;
 * 2-D and N-D tables expose `key_dimensions[]`. We honor whichever
 * is set (and accept both).
 */
export interface FactorTableLike {
  readonly id: string;
  readonly display_name?: string;
  readonly key_dimension?: string;
  readonly key_dimensions?: readonly string[];
  /**
   * ADR-0063 — when a numeric axis of this table should be read by
   * linear interpolation between breakpoints rather than stepped at
   * band lower bounds (the F14 gap). `axis` names the banded dim slug
   * to interpolate; omitted/`"step"` (the default) leaves every plan
   * byte-identical. The projector reads this to emit the interpolating
   * lookup form.
   */
  readonly interpolation?: {
    readonly mode: "linear";
    readonly axis: string;
  } | null | undefined;
}

/**
 * PR 13.1 — Optional inputs to the deriver. v1 added factorTables;
 * future expansions (eligibility gate fields, modifier triggers,
 * curve breakpoints) land here so callers keep one stable signature.
 */
export interface DeriveRequiredInputsOptions {
  readonly factorTables?: readonly FactorTableLike[];
}

/**
 * Build the canonical required-inputs list for a plan.
 *
 * Stages are visited IN ORDER. First-seen wins per dedup id. The
 * output is sorted by category (dim → input → model → product) and
 * within-category by display name, so the rail renders stably across
 * re-derivations.
 *
 * PR 13.1 — added catalog-driven passes (FT keys + catalog dims).
 * They run AFTER the stage passes so anything the chain references
 * keeps its richer origin string; the catalog passes only fill in
 * dims the user has authored but not yet wired into a stage.
 */
export function deriveRequiredInputs(
  stages: readonly StageLike[],
  dimensions: readonly Dimension[],
  options?: DeriveRequiredInputsOptions,
): readonly DerivedRequiredInput[] {
  const out = new Map<string, DerivedRequiredInput>();
  const dimsBySlug = new Map<string, Dimension>();
  for (const d of dimensions) dimsBySlug.set(d.slug, d);

  // Finding E10 — ids of every NON-input_node stage. A `stages.X.*`
  // path whose X is in this set references a plan stage's OUTPUT
  // (e.g. a loading's `stages.multiplicative_chain_main.value`), not
  // a declarable risk input.
  const planOutputStageIds = new Set(
    stages
      .filter((s) => s.stage_kind !== "input_node")
      .map((s) => s.stage_id),
  );

  // Walk in TWO passes so dim refs (highest-priority metadata) lock
  // the entry before the input_node + raw-path walks fill in the
  // rest. Without this, an input_node stage that happens to share a
  // path with a dim ref (e.g., the ISO BOP fixture's
  // `input_class_code` stage shares `class_code` with the
  // BUILDING_CHAIN class factor) would register first as
  // category="input" with no dimSlug — losing the alias-resolution
  // hook + the correct rail grouping.
  //
  // Pass 1 — dim refs win. Walk every chain's factor_lookups for
  // their dim bindings. Computed bindings (Brief 95 C2) collect here:
  // their dim is satisfied INSIDE the graph, their operands are the
  // row-supplied fields.
  const computed = {
    dims: new Set<string>(),
    operands: new Map<string, string>(),
  };
  for (const stage of stages) {
    if (stage.stage_kind !== "multiplicative_chain") continue;
    const cfg = readObject(stage.config_json);
    for (const chain of readChainList(cfg)) {
      for (const lookup of chain.factor_lookups ?? []) {
        addDimRefsFromLookup(out, lookup, dimsBySlug, chain.name, computed);
      }
    }
  }

  // Pass 2 — everything else. input_node + chain raw paths +
  // flat_factor input_paths. Each addX call no-ops when the
  // normalized id is already in the map.
  for (const stage of stages) {
    switch (stage.stage_kind) {
      case "input_node": {
        const cfg = readObject(stage.config_json);
        const path = stringField(cfg, "source_path") ?? stage.stage_id;
        const id = normalizePath(path) || stage.stage_id;
        if (out.has(id)) continue;
        // MVP-012 — `config_json.name` is the display name only when
        // the editor authored one (it differs from the field key); the
        // workbook builder writes the slug there and puts the label on
        // stage.display_name. One rule, shared with the dictionary.
        const cfgName = stringField(cfg, "name");
        const name = resolveInputDisplayName({
          fieldKey: id,
          configName: cfgName,
          stageDisplayName: stage.display_name,
        });
        out.set(id, {
          id,
          name,
          category: "inputs",
          dtype: configDtype(cfg),
          origin: `Input · ${name}`,
        });
        break;
      }

      case "multiplicative_chain": {
        const cfg = readObject(stage.config_json);
        for (const chain of readChainList(cfg)) {
          addRawIfMissing(
            out,
            chain.base_input,
            `Chain · ${chain.name} base`,
            planOutputStageIds,
          );
          addRawIfMissing(
            out,
            chain.exposure_input,
            `Chain · ${chain.name} exposure`,
            planOutputStageIds,
          );
          // ADR-0047 — an authored carrier LCM (`lcm.value`, not overridable)
          // is a constant on the chain, not a mappable column; don't surface
          // it as a required input. An overridable value still exposes the
          // column (the per-risk escape hatch).
          const lcm = chain.lcm;
          const lcmIsAuthoredConstant =
            typeof lcm?.value === "number" &&
            Number.isFinite(lcm.value) &&
            lcm.overridable !== true;
          if (!lcmIsAuthoredConstant) {
            const lcmHasValue =
              typeof lcm?.value === "number" && Number.isFinite(lcm.value);
            addRawIfMissing(
              out,
              lcm?.input_path,
              `Chain · ${chain.name} LCM`,
              planOutputStageIds,
              // Brief 89 R8 — a VALUELESS LCM is an unset chain
              // constant (constantSlot: repair = set a value in
              // Rating; never a declarable ghost). An overridable
              // AUTHORED value is the ADR-0047 escape hatch — an
              // optional override column that never blocks readiness.
              lcmHasValue ? { optional: true } : { constantSlot: true },
            );
          }
        }
        break;
      }

      case "flat_factor": {
        const cfg = readObject(stage.config_json) as
          | Partial<FlatFactorConfig>
          | undefined;
        if (!cfg) break;
        const origin = `Flat factor · ${stage.display_name ?? stage.stage_id}`;
        addRawIfMissing(out, cfg.input_path ?? undefined, origin, planOutputStageIds);
        for (const p of cfg.input_paths ?? []) {
          addRawIfMissing(out, p, origin, planOutputStageIds);
        }
        break;
      }

      case "modifier.schedule": {
        // FCA #23 (finding 13) — the per-risk schedule application
        // (IRPM credits/debits) reads `schedule_app_{schedule_id}`
        // from the row, exactly as the projector wires it — but this
        // deriver never listed it, so the Match columns screen
        // offered an extract's IRPM_PCT no destination and six rows'
        // filed schedule modifiers were silently unapplied. OPTIONAL:
        // an absent application is neutral (1.0), never a missing-
        // input nag; a mapped bare percentage applies through the
        // kind's single-category promotion.
        const cfg = readObject(stage.config_json);
        const schedule = readObject(cfg?.["schedule"]) ?? cfg;
        const scheduleId =
          (typeof schedule?.["schedule_id"] === "string" &&
            schedule["schedule_id"]) ||
          stage.stage_id;
        const id = `schedule_app_${sanitize(scheduleId)}`;
        if (out.has(id)) break;
        const label =
          stage.display_name?.trim() || `Schedule ${scheduleId}`;
        out.set(id, {
          id,
          name: `${label} — schedule application`,
          category: "inputs",
          dtype: "number",
          origin: `Schedule · ${label}`,
          optional: true,
        });
        break;
      }

      default:
        // model.* + future stage kinds — see §4.2 deferred list.
        break;
    }
  }

  // Brief 95 C2 — computed-axis OPERANDS are the row-supplied fields.
  // A declared operand already carries its input_node entry (Pass 2's
  // richer name + dtype win); an undeclared one still surfaces here so
  // the readiness nag points at what a row must actually carry.
  for (const [id, origin] of computed.operands) {
    if (out.has(id)) continue;
    out.set(id, { id, name: id, category: "inputs", dtype: "number", origin });
  }

  // Passes 3 + 4 dedupe by DIM SLUG, not by path id. The chain may
  // bind a dim (slug `class`) to a non-slug path (e.g. `class_code`);
  // we don't want to re-emit the same dim from the catalog passes
  // under its bare slug. Build the seen-slug set from the two
  // stage-driven passes before continuing. A computed-bound dim is
  // seen too — the graph computes its key; it is never a column.
  const seenDimSlugs = new Set<string>(computed.dims);
  for (const entry of out.values()) {
    if (entry.dimSlug) seenDimSlugs.add(entry.dimSlug);
  }

  // Pass 3 — Factor-table keys (catalog-driven). PR 13.1.
  // Every FT in the catalog implies the chain WILL need a CSV
  // column for each key dim. Surfacing these as required inputs
  // even before a chain is wired means the workspace works as soon
  // as the user finishes parametrizing — they don't need to also
  // build a chain to see what columns to map. Chain-driven entries
  // (Pass 1) keep their richer "Class factor · Building chain"
  // provenance — we skip the FT pass when the same dim slug was
  // already bound.
  for (const ft of options?.factorTables ?? []) {
    const keys: string[] = [];
    if (ft.key_dimension) keys.push(ft.key_dimension);
    for (const k of ft.key_dimensions ?? []) keys.push(k);
    for (const slug of keys) {
      if (!slug) continue;
      if (seenDimSlugs.has(slug)) continue;
      if (out.has(slug)) continue;
      const d = dimsBySlug.get(slug);
      // ADR-0025 / FCA #21 — a composite dim's key is derived in-graph
      // from its members (each a catalog dim that surfaces itself);
      // the composite is never a CSV column.
      if ((d as { shape?: string } | undefined)?.shape === "composite") {
        continue;
      }
      out.set(slug, {
        id: slug,
        name: d?.display_name?.trim() || slug,
        category: "dimensions",
        dtype: dimDtype(d),
        dimSlug: slug,
        origin: `${ft.display_name || ft.id} (key)`,
      });
      seenDimSlugs.add(slug);
    }
  }

  // Pass 4 — Catalog dims (last-resort fallback). PR 13.1.
  // A dim authored in the catalog is the user's declaration of an
  // expected field, even if no stage or FT references it yet. We
  // emit AFTER the FT pass so an FT-keyed dim keeps the more
  // specific "<FT name> (key)" attribution instead of a generic
  // "Dim · X". Same dim-slug guard so we don't shadow earlier
  // passes that bound this slug to a different path.
  for (const d of dimensions) {
    if (!d.slug) continue;
    if (seenDimSlugs.has(d.slug)) continue;
    if (out.has(d.slug)) continue;
    // Composite dims derive in-graph — see the Pass 3 guard.
    if ((d as { shape?: string }).shape === "composite") continue;
    out.set(d.slug, {
      id: d.slug,
      name: d.display_name?.trim() || d.slug,
      category: "dimensions",
      dtype: dimDtype(d),
      dimSlug: d.slug,
      origin: `Dim · ${d.display_name ?? d.slug}`,
    });
    seenDimSlugs.add(d.slug);
  }

  return Array.from(out.values()).sort(compareRequiredInputs);
}

// ─────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function stringField(
  cfg: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!cfg) return undefined;
  const v = cfg[key];
  return typeof v === "string" ? v : undefined;
}

function configDtype(cfg: Record<string, unknown> | undefined): MatchDtype {
  const t = stringField(cfg, "data_type");
  // Brief 52 — map the widened InputNodeConfig vocabulary (the
  // @openrater/contracts PrimitiveType set the dictionary editor writes)
  // plus the legacy values onto the auto-match dtype.
  if (
    t === "number" ||
    t === "currency" ||
    t === "money" ||
    t === "int" ||
    t === "float" ||
    t === "pct" ||
    t === "factor"
  )
    return "number";
  if (t === "boolean" || t === "bool") return "boolean";
  if (t === "date") return "date";
  return "string"; // string, class_code, enum
}

function readChainList(
  cfg: Record<string, unknown> | undefined,
): readonly ChainSpec[] {
  if (!cfg) return [];
  const chains = (cfg as Partial<MultiplicativeChainConfig>).chains;
  if (!Array.isArray(chains)) return [];
  return chains;
}

/**
 * Add a raw `path` (chain base/exposure/lcm, or flat-factor input)
 * as an "input" required-input. No-ops on empty paths + when the
 * normalized id is already in the map (first-seen wins).
 *
 * Platform-test finding E10 — `planOutputStageIds` holds the ids of
 * every NON-input_node stage. A `stages.X.*` path normalizes to X on
 * the assumption that X is a declared input_node (Brief 52's typed-
 * input shape); when X is instead a plan stage (a flat_factor loading
 * targeting `stages.multiplicative_chain_main.value`), the reference
 * is a PLAN OUTPUT, not a risk input — surfacing it made "Declare N
 * missing" mint junk input declarations. Same for `chain.<field>`
 * paths (chain output references, E6's multi-coverage targets).
 */
function addRawIfMissing(
  out: Map<string, DerivedRequiredInput>,
  path: string | undefined | null,
  origin: string,
  planOutputStageIds?: ReadonlySet<string>,
  opts?: { readonly constantSlot?: boolean; readonly optional?: boolean },
): void {
  const raw = typeof path === "string" ? path.trim() : "";
  // `chain.<output_field>` references a chain's published output —
  // never a book column (finding E10).
  if (raw.startsWith("chain.")) return;
  const id = normalizePath(path);
  if (!id) return;
  if (isNonInputNamespaceId(id)) return;
  // `stages.X.*` where X is a plan stage (not an input_node) is an
  // upstream-output reference — never a book column (finding E10).
  if (raw.startsWith("stages.") && planOutputStageIds?.has(id)) return;
  if (out.has(id)) return;
  out.set(id, {
    id,
    name: id,
    category: "inputs",
    // Raw chain paths lose their dtype provenance — we mark them
    // "number" by default because chains feed multipliers + sums.
    // The user can override via the column-mapping dtype hint.
    dtype: "number",
    origin,
    ...(opts?.constantSlot ? { constantSlot: true as const } : {}),
    ...(opts?.optional ? { optional: true as const } : {}),
  });
}

/**
 * Namespace-tagged ids that are NEVER declarable book columns:
 *
 *   · `literal.*` — authored constants (Brief 65 §3.2: the literal
 *     node IS the value).
 *   · any `:`-form binding — the filing-transcription grammar's
 *     `literal:<number>` (spec §4.6, what the ingest builder emits as
 *     the default exposure binding and for round literals). A `:` can
 *     never appear in an input slug (ingest lint R-006), so the colon
 *     alone marks a namespace, not a field.
 *   · `context.*` — engine-context reads (`context.lcm`): plan-level
 *     values, never per-risk columns.
 */
export function isNonInputNamespaceId(id: string): boolean {
  if (id === "literal" || id.startsWith("literal.")) return true;
  if (id === "context" || id.startsWith("context.")) return true;
  return id.includes(":");
}

/**
 * For each `dimensions[K]` binding inside a factor lookup, register
 * a dim-ref required input. The key K is the dim slug; the
 * binding.path is the runtime field name.
 *
 * When the dim is in the catalog we promote display_name + bias
 * dtype to "string" (categorical) or "number" (banded). Without
 * the dim in the catalog we still surface the requirement — the
 * binding alone is enough to know the user has to provide a value.
 */
function addDimRefsFromLookup(
  out: Map<string, DerivedRequiredInput>,
  lookup: FactorLookup,
  dimsBySlug: Map<string, Dimension>,
  chainName: string,
  computed: { dims: Set<string>; operands: Map<string, string> },
): void {
  for (const [dimSlug, binding] of Object.entries(lookup.dimensions ?? {})) {
    // Brief 95 C2 / ADR-0047 — a computed binding's dim key is built
    // INSIDE the graph (chain.add over the operands, then the dim's
    // band resolution). Collect: the dim is satisfied, the operands
    // are the actual row fields.
    if (
      binding?.source === "computed" &&
      Array.isArray(binding.fields) &&
      binding.fields.length > 0
    ) {
      computed.dims.add(dimSlug);
      for (const field of binding.fields) {
        const id = normalizePath(String(field));
        if (!id || isNonInputNamespaceId(id)) continue;
        if (!computed.operands.has(id)) {
          computed.operands.set(
            id,
            `${lookup.name || lookup.factor_kind || "Factor"} · ${chainName} (computes ${dimSlug})`,
          );
        }
      }
      continue;
    }
    // ADR-0025 / FCA #21 — a composite axis consumes its MEMBERS'
    // fields; the composite slug itself is derived in-graph (never a
    // required input — the audit's plan demanded a 13th input the
    // schema didn't list). Mark it computed so the catalog passes
    // don't resurrect it as a phantom column.
    if (
      binding?.source === "composite" &&
      binding.axes &&
      typeof binding.axes === "object"
    ) {
      computed.dims.add(dimSlug);
      for (const [memberSlug, member] of Object.entries(binding.axes)) {
        if (!member?.path) continue;
        const mid = normalizePath(member.path);
        if (!mid || isNonInputNamespaceId(mid) || out.has(mid)) continue;
        const mdim = dimsBySlug.get(memberSlug);
        out.set(mid, {
          id: mid,
          name: mdim?.display_name?.trim() || memberSlug,
          category: "dimensions",
          dtype: dimDtype(mdim),
          dimSlug: memberSlug,
          origin: `${lookup.name || lookup.factor_kind || "Factor"} · ${chainName} (member of ${dimSlug})`,
        });
      }
      continue;
    }
    if (!binding?.path) continue;
    const id = normalizePath(binding.path);
    if (!id) continue;
    if (isNonInputNamespaceId(id)) continue;
    if (out.has(id)) continue;
    const dim = dimsBySlug.get(dimSlug);
    const dtype = dimDtype(dim);
    out.set(id, {
      id,
      name: dim?.display_name?.trim() || dimSlug,
      category: "dimensions",
      dtype,
      dimSlug,
      origin: `${lookup.name || lookup.factor_kind || "Factor"} · ${chainName}`,
    });
  }
}

function dimDtype(dim: Dimension | undefined): MatchDtype {
  if (!dim) return "string";
  // Banded + composite dims are numeric resolutions; categorical +
  // classification + geographic dims are string-keyed.
  const shape = (dim as { shape?: string }).shape;
  if (shape === "banded") return "number";
  return "string";
}

/**
 * Stable sort: category first (dimensions → inputs → models →
 * factors), then by display name. Within a category, alpha sort
 * makes the rail predictable across re-derivations on plan edits.
 *
 * Order matches the existing <ColumnMappingTable> SECTION_ORDER
 * so the rail + the table render their categories in the same
 * sequence.
 */
function compareRequiredInputs(
  a: DerivedRequiredInput,
  b: DerivedRequiredInput,
): number {
  const ca = CATEGORY_ORDER[a.category];
  const cb = CATEGORY_ORDER[b.category];
  if (ca !== cb) return ca - cb;
  return a.name.localeCompare(b.name);
}

const CATEGORY_ORDER: Record<RequiredInputCategory, number> = {
  dimensions: 0,
  inputs: 1,
  models: 2,
  factors: 3,
};
