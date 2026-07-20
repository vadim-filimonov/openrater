/**
 * stagesToRuntimePlan — PR D2a (Phase B "real scoring" closure).
 *
 * Pure module. Given a plan's authored stages + dim catalog + factor-
 * table catalog (with embedded cell values), returns a runtime `Plan`
 * (nodes + edges) ready for `compilePlan` + `executePlanBatch`.
 *
 * Closes the cold-test gap discovered while authoring the IRS-990
 * nonprofit D&O + GL plan: PR 11a (Score-all) executes a hand-built
 * echo plan that just passes inputs back as outputs. The real rating
 * chain never ran. This module is the missing converter: stage-level
 * `multiplicative_chain` config + client-side factor tables → runtime
 * nodes that actually compute premiums.
 *
 * SCOPE (v1):
 *
 *   ✓ multiplicative_chain stages with N chainSpecs
 *   ✓ factor_lookups with lookup_method="direct" + 1-D dim bindings
 *   ✓ LCM (chainSpec.lcm) as a constant factor (the lcm.input_path
 *     is honored as an input if present — or as a constant when it is
 *     a `literal:<n>` colon-binding, spec §4.6; the {lcmOverride}
 *     option short-circuits to a constant when the caller knows the
 *     value)
 *   ✓ Per-chain output node keyed by chainSpec.output_field
 *
 * NOT IN v1 (each documented inside the projector):
 *
 *   ◑ 2-D coverage-split tables (ADR-0039) — when one axis is the
 *     chain's `rating_dimension` and the chain is a coverage tower
 *     (carries a `coverage_value`), the table is SLICED to that
 *     tower's column and emitted as a 1-D lookup keyed on the other
 *     axis. Building tower → building column, BPP tower → bpp column.
 *   ✗ Dual-risk-input 2-D + N-D tables (neither axis is the tower
 *     split — both are live inputs) — needs lookup.multi; still
 *     deferred. The projector warns + falls back to 1.0 (never silent).
 *   ✗ lookup_method ∈ {interpolated, binned, bracketed} — each maps
 *     to lookup.range / lookup.multi / curve.evaluate kinds; v2 work.
 *   ✗ flat_factor / modifier_schedule / clamp / round / eligibility
 *     stages — load-bearing for the Meridian BOP plan but not for the
 *     nonprofit demo. Each lands in its own PR.
 *   ✓ Exposure ÷ unit_divisor (ADR-0044) — when a chainSpec carries a
 *     resolvable `exposure_input` + finite `exposure_unit_divisor`, the
 *     projector emits an exposure-rated tower: rate × (exposure ÷
 *     divisor) × LCM with filed-rate roundings (rate→3 dp, premium→nearest $),
 *     all as runtime nodes. A `literal:<n>` exposure_input (spec §4.6 —
 *     a filed fixed exposure base) is a constant numerator, not an
 *     input read. Chains WITHOUT an exposure base stay "per account"
 *     (LCM as a chain factor, no rounding) — byte-stable.
 *   ✗ chain.add (cross-chain plan totals) — when a stage has multiple
 *     chainSpecs we emit independent subtrees, one output per spec.
 *     The score CSV gets one column per output.
 *
 * Per node-design-principles P-N1 (pure execute) and P-N4 (typed I/O):
 * this projector is pure data-in / data-out. The resulting Plan goes
 * straight into `compilePlan(plan, registry)` which honors the kind
 * registry the consumer registered at boot.
 */

import type { Plan } from "@openrater/contracts";

import type {
  Dimension,
  OnMissPolicy,
  ProjectionIssue,
} from "@openrater/contracts";
// ADR-0038 — canonical geographic lookup domain (shared with the factor grid
// + the input validator). `geoValueToKeyMap` self-maps the ungrouped tail so
// the territory-keyed lookup.direct (keyed on geoLookupKeys) resolves it too.
import {
  activeGeoTerritories,
  geoValueToKeyMap,
  isGeographicLookupDim,
  // Brief 95 C4 — the reserved execution-guard port (election skips).
  GUARD_PORT,
} from "@openrater/contracts";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";
import { normalizePath } from "./deriveRequiredInputs";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * Cell sidecar shape — `Map<factorTableId, Map<cellKey, number>>`.
 *
 * For a 1-D table the cellKey is the row level id (e.g., "ntee_major"
 * → cellKey "religion" maps to factor 1.20). The PR A2 storage helper
 * (`storeFactorTableCells`) writes exactly this shape; consumers pass
 * `loadStoredFactorTableCells(planId)` straight through here.
 */
export type FactorTableCellsMap = ReadonlyMap<
  string,
  ReadonlyMap<string, number>
>;

export interface StagesToRuntimePlanOptions {
  /** Plan id for the runtime Plan record (defaults to "rate-lab.runtime-plan"). */
  readonly planId?: string;
  /** Display name for the Plan record (defaults to "Runtime plan (projected)"). */
  readonly planName?: string;
  /**
   * Override the LCM value when the chainSpec's `lcm.input_path` points
   * at an external field the CSV won't have (the IRS-990 plan hardcodes
   * LCM = 1.35 — no point making the user supply a column for it).
   * When set, every chain's LCM resolves to this constant instead of an
   * input lookup. Per-chain LCM overrides land in v2 if needed.
   */
  readonly lcmOverride?: number;
  /**
   * PR D2b — per-input-field defaultValues. When set, an emitted
   * `input` node whose `fieldName` matches a key here gets that
   * value as `defaultValue` — the runtime falls back to it when the
   * row's projected externalInputs don't supply the field.
   *
   * The IRS-990 use case is base rates (`do_base_rate` = 600,
   * `gl_base_rate` = 300) — per-plan constants that the actuary
   * shouldn't have to ship as CSV columns. The user can still
   * override by mapping a column to the same field name.
   */
  readonly defaults?: Readonly<Record<string, unknown>>;
  /**
   * P2 G9 (ADR-0056) — where the round stage's minimum-premium floor
   * applies:
   *
   *   · "row" (default) — per projected row, pre-rollup: correct for
   *     single-risk surfaces and ungrouped books (every row IS a
   *     quote), and the pre-G9 behavior everywhere.
   *   · "policy" — the per-row floor is OMITTED from the projection;
   *     the caller applies it ONCE per policy, post-IRPM, as a
   *     `minimum_premium` tail step (see `planMinimumPremium` +
   *     `evaluatePolicyBook`). Fixes the G9 over-charge: a 3-location
   *     policy floored per row paid 3× the filed minimum.
   *
   * The scope follows the COMPOSITION CONTEXT (grouped book ⇒
   * "policy"), so the same authored stage prices correctly in both.
   */
  readonly minPremiumScope?: "row" | "policy";
}

/**
 * The stage kinds this projector actually EXECUTES. Any stage whose
 * kind is not in this set is skipped — it contributes nothing to the
 * scored premium. Authoring surfaces consult this set so an affordance
 * never silently creates a stage the live scorer ignores (v4 audit G6:
 * a saved `clamp` floor and a `flat_factor` loading changed no premium).
 * If you teach the projector a new kind, add it here — the authoring-
 * parity tests pin the two lists together.
 *
 * (`eligibility.gate` with `scope: "policy"` is the one nuance: it is
 * routed to evaluatePolicyBook post-rollup rather than projected
 * per-row, but the authored stage IS priced.)
 */
export const PROJECTOR_EXECUTED_STAGE_KINDS: ReadonlySet<string> = new Set([
  "eligibility.gate",
  "multiplicative_chain",
  "modifier.schedule",
  "modifier.model",
  "endorsement.factor",
  "endorsement.additive",
  "endorsement.sublimit",
  "endorsement.rate_branch",
  "round",
  // G6-full (ADR-0056) — loadings + caps price: flat_factor multiplies
  // its target output's tip; clamp floors/caps it. A stage whose target
  // or config variant can't attach emits a structured `orphan_stage`
  // issue instead of a silent no-op.
  "flat_factor",
  "clamp",
]);

// ─────────────────────────────────────────────────────────────────
// Internal node/edge builders
// ─────────────────────────────────────────────────────────────────

interface PlanNode {
  id: string;
  kind: string;
  // The runtime is permissive with node params (each kind validates
  // them on its own). We use `unknown` here and let the runtime kind
  // registrations enforce shape at compile time.
  params: unknown;
}
interface PlanEdge {
  from: { node: string; port: string };
  to: { node: string; port: string };
}

/**
 * Sanitize a label into a safe node-id segment.
 *
 * Exported as the SINGLE source of truth for the runtime node-id scheme: any
 * consumer that aligns a run trace back to its source (Brief 48's scored
 * build-up resolver in `chainTraceValues.ts`) reconstructs ids with THIS exact
 * function, so the two never drift. The chainTraceValues integration test runs
 * a real projector→run→resolve round-trip and breaks if they diverge.
 */
export function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "x";
}

// ─────────────────────────────────────────────────────────────────
// Local typed views over the substrate (read-only access)
// ─────────────────────────────────────────────────────────────────

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asChainList(cfg: Record<string, unknown>): readonly unknown[] {
  const c = cfg["chains"];
  return Array.isArray(c) ? c : [];
}

interface BindingShape {
  readonly source?: string;
  readonly path?: string;
  readonly format?: string | null;
  /**
   * ADR-0044 D5 — a dual-input lookup axis may be DERIVED in-plan rather
   * than supplied raw:
   *   · source "computed", op "sum", fields [...] → chain.add over those
   *     input fields (e.g. property total limit = building + BPP), then
   *     the bound dim's banded resolution buckets it.
   *   · source "literal", value X → a constant key (e.g. KS building-limit
   *     group "group_c"), declared in data, never hardcoded.
   */
  readonly op?: string;
  readonly fields?: readonly string[];
  readonly value?: string | number | boolean;
}

interface FactorLookupShape {
  readonly name?: string;
  readonly factor_kind?: string;
  readonly lookup_method?: string;
  readonly dimensions?: Record<string, BindingShape>;
  readonly description_template?: string;
  /**
   * ADR-0044 D6 — optional gate {path, equals}: the factor applies only
   * when `externalInputs[path] === equals`, else it is the
   * multiplicative identity 1.0 (projected via a `branch`).
   */
  readonly predicate?: {
    readonly path?: string;
    readonly equals?: boolean | number | string;
  } | null;
  /**
   * ADR-0056 — the authored disposition for a lookup key that doesn't
   * resolve at score time: refuse the row (`error`), apply an authored
   * value (`default` + `value`), or rate 1.0 indicative and refer
   * (`refer`). ABSENT ⇒ `error` — Law 2's authoring default. The
   * projector stamps this onto the emitted lookup node's `onMiss`.
   */
  readonly unknown_key_policy?: {
    readonly mode?: string;
    readonly value?: number;
  } | null;
}

interface ChainSpecShape {
  readonly name?: string;
  readonly base_input?: string;
  /**
   * Cold-test L30 — the chain's authored literal base rate. When a
   * finite number, the projector emits a `constant` base node carrying
   * this value (no external-input resolution, no template_id default).
   * `base_input` is honored only as the back-compat fallback when this
   * is null/undefined.
   */
  readonly base_value?: number | null;
  readonly factor_lookups?: readonly FactorLookupShape[];
  readonly lcm?: {
    readonly value?: number | null;
    readonly input_path?: string | null;
    readonly overridable?: boolean;
  };
  readonly exposure_input?: string;
  /**
   * ADR-0044 — the per-unit exposure divisor (e.g. 100 for per-$100
   * limit rates, 1000 for per-$1k sales/payroll). When this + a real
   * `exposure_input` are present, the projector emits the exposure-rated
   * tower (rate × exposure ÷ divisor × LCM, with filed-rate roundings); absent,
   * the chain is treated as "per account" (the legacy behavior).
   */
  readonly exposure_unit_divisor?: number;
  /**
   * ADR-0044 — explicit opt-in for exposure-rated scoring. The Assemble
   * `towerPlanToStages` ALWAYS emits an `exposure_input` + divisor (the
   * 2nd submission field, else a `form_input.exposure` placeholder), so
   * presence alone can't tell a per-account base tower from a real
   * exposure tower. Scalar exposure scaling + filed-rate rounding apply ONLY
   * when this is true (or `exposure_options` is present, which the
   * Assemble default never emits). Default-false keeps every
   * per-account tower scoring base × factors × LCM, unrounded.
   */
  readonly apply_exposure?: boolean;
  /**
   * ADR-0044 D9 — class-conditional exposure. When the exposure base +
   * divisor vary by a derived key (liability: LOI→bpp_limit÷100,
   * sales→annual_gross_sales÷1000, payroll→annual_payroll÷1000), declare
   * one option per case. The projector computes
   *   exposure = Σ branch(when ? input ÷ divisor : 0)
   * over the options (exactly one `when` holds), so the right base ÷
   * divisor is selected in-plan. `when` is an equality on a (typically
   * class-derived) field. Takes precedence over the scalar
   * exposure_input/divisor above.
   */
  readonly exposure_options?: ReadonlyArray<{
    readonly when?: {
      readonly path?: string;
      readonly equals?: string | number | boolean;
    };
    readonly input?: string;
    readonly divisor?: number;
  }>;
  readonly output_field?: string;
  readonly coverage_value?: string;
  /**
   * Brief 95 C4 — the plan marked this coverage electable (spec §4.1
   * `building?`). The projector then heads the tower with a
   * `coverage.election` node: an EXPLICIT 0 exposure elects the tower
   * out (its own nodes skip via the reserved `__guard__` port and the
   * output resolves $0 through a branch); absence still withholds.
   * Omitted → required: an explicit 0 refuses (`zero_exposure_required`).
   */
  readonly elective?: boolean;
}

function readChainSpec(c: unknown): ChainSpecShape {
  if (!c || typeof c !== "object") return {};
  return c as ChainSpecShape;
}

// ─────────────────────────────────────────────────────────────────
// Factor-table → embedded-table Record builder
// ─────────────────────────────────────────────────────────────────

/**
 * Find the factor table that satisfies a given factor_lookup.
 *
 * Match priority (first wins):
 *   1. `factor_kind` ↔ `slug`     — convention enforced by the seeder
 *   2. `factor_kind` ↔ `id`       — id-based fallback for hand-author flows
 *   3. lookup.name ↔ slug         — last-resort label match
 *
 * Returns null when no match — the caller substitutes a default-1.0
 * lookup table so the chain still runs (just with neutral factors).
 */
function findFactorTable(
  lookup: FactorLookupShape,
  factorTables: readonly FactorTableLike[],
): FactorTableLike | null {
  const kind = lookup.factor_kind?.trim();
  if (kind) {
    // PR D2a — `FactorTableLike` doesn't currently expose `slug`, but
    // the in-repo `FactorTableSummary` does. Read it via an unknown
    // cast so the projector handles both with-and-without slug
    // catalogs gracefully.
    for (const ft of factorTables) {
      const slug = (ft as unknown as { slug?: string }).slug;
      if (slug && slug === kind) return ft;
    }
    for (const ft of factorTables) if (ft.id === kind) return ft;
  }
  const name = lookup.name?.trim();
  if (name) {
    for (const ft of factorTables) {
      const slug = (ft as unknown as { slug?: string }).slug;
      if (slug && slug === name) return ft;
    }
  }
  return null;
}

/**
 * Convert a 1-D factor table's cell map (Map<cellKey, number>) into
 * the `Record<string, number>` shape `lookup.direct` expects.
 *
 * For 1-D tables the cellKey IS the row level id, so this is a 1:1
 * conversion. The cellKey encoding for 2-D tables is "rowId::colId"
 * (FactorTableGrid2D.cellKey); the v2 PR that lights up 2-D handles
 * splitting + projecting to `lookup.multi`.
 */
function cellsToTable(
  cells: ReadonlyMap<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!cells) return out;
  for (const [key, value] of cells.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    // 1-D: cellKey is already the row level id.
    // 2-D: cellKey is "rowId::colId". A 2-D table that belongs to a
    // coverage tower is sliced upstream by `sliceCellsToCoverageColumn`
    // (ADR-0039) before this runs; anything composite that still
    // reaches here is a dual-risk-input matrix (deferred to
    // lookup.multi) — we skip it so the 1-D table stays clean.
    if (key.includes("::")) continue;
    out[key] = value;
  }
  return out;
}

/** True when any cell key is composite ("rowId::colId") — i.e. a 2-D table. */
function cellsAre2D(cells: ReadonlyMap<string, number> | undefined): boolean {
  if (!cells) return false;
  for (const key of cells.keys()) if (key.includes("::")) return true;
  return false;
}

/**
 * ADR-0039 — slice a 2-D factor table's cells to one coverage column.
 *
 * Cells are keyed "rowId::colId" (FactorTableGrid2D.cellKey). A coverage
 * rating tower (Brief 35) fixes one axis to `coverageValue` — a
 * COMPILE-TIME constant, because the tower IS that coverage (it is a
 * structural axis, never a per-risk input). We keep the cells on that
 * coverage column and re-key them by the OTHER axis, producing the 1-D
 * `Record<otherAxisId, factor>` that `lookup.direct` consumes. The
 * remaining axis keeps its normal resolution branch (geographic →
 * derive.territory, banded → derive.band, else direct).
 *
 * The coverage axis is detected data-driven: whichever side's id-set
 * contains `coverageValue` (column preferred — the BOP convention is
 * coverage-as-column, e.g. base_lc_property = territory × coverage).
 * Returns `{}` when `coverageValue` matches neither axis (the caller
 * warns + falls back to the neutral default).
 *
 * Pure. Genericity invariant (ADR-0033 §0): no coverage/product literal
 * — `coverageValue` is the opaque tower level handed in by the caller.
 */
export function sliceCellsToCoverageColumn(
  cells: ReadonlyMap<string, number> | undefined,
  coverageValue: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!cells) return out;
  const rowIds = new Set<string>();
  const colIds = new Set<string>();
  for (const key of cells.keys()) {
    const i = key.indexOf("::");
    if (i < 0) continue;
    rowIds.add(key.slice(0, i));
    colIds.add(key.slice(i + 2));
  }
  const coverageIsCol = colIds.has(coverageValue);
  const coverageIsRow = !coverageIsCol && rowIds.has(coverageValue);
  if (!coverageIsCol && !coverageIsRow) return out;
  for (const [key, value] of cells.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const i = key.indexOf("::");
    if (i < 0) continue;
    const rowId = key.slice(0, i);
    const colId = key.slice(i + 2);
    if (coverageIsCol) {
      if (colId === coverageValue) out[rowId] = value;
    } else if (rowId === coverageValue) {
      out[colId] = value;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// ADR-0028 — geographic territory grouping → value→territory map
// ─────────────────────────────────────────────────────────────────

/** One `geo_territories` entry (mirrors the canonical Dimension shape). */
interface GeoTerritoryShape {
  readonly id: string;
  readonly label?: string;
  readonly members?: readonly string[];
}

/**
 * A geographic dim's territory grouping is "active" when it's a geographic
 * dim AND it carries at least one territory with at least one member level id.
 * An empty / missing grouping means "rate directly on the levels" (the V21
 * path) — no `derive.territory`.
 *
 * ADR-0038 — the member filter is the canonical `activeGeoTerritories`, so the
 * projector, the factor grid (`levelsForKeying`), and the validator share ONE
 * definition of "active" (the pre-ADR mismatch — grid kept empty buckets, this
 * filtered them — was the hidden third disagreement). `dimension_type ===
 * "geographic"` is the primary signal; `shape === "geographic"` is also
 * accepted for dims that set the v2 shape without the legacy subtype.
 */
function geoTerritoriesOf(
  dim: Dimension | undefined,
): readonly GeoTerritoryShape[] {
  if (!dim) return [];
  if (!isGeographicLookupDim(dim)) return [];
  return activeGeoTerritories(dim);
}

/**
 * The RAW input field a factor-lookup axis reads from.
 *
 * Normally this is the axis binding's `path` (else the dim slug). But a
 * GEOGRAPHIC dim resolves its lookup key (a territory id) FROM a raw
 * submission field (e.g. `territory` ← `zip`) via `derive.territory`. The
 * Assemble auto-binding sets the axis path to the dim slug — a DERIVED
 * output (`territory`), not a real input column — so the derive would read
 * a non-existent `territory` field and every base-loss-cost lookup would
 * fall to its 1.0 default. When a geographic dim declares `source_field`
 * (the zip column), prefer it so the territory derive reads the real input.
 * Cold-test fix #2 / ADR-0028 + ADR-0038.
 */
function rawInputFieldFor(
  dimSlug: string,
  binding: BindingShape | undefined,
  boundDim: Dimension | undefined,
): string {
  const sf = (boundDim as { source_field?: unknown } | undefined)?.source_field;
  if (
    isGeographicLookupDim(boundDim ?? ({} as Dimension)) &&
    typeof sf === "string" &&
    sf.trim() !== ""
  ) {
    return normalizePath(sf) || sf;
  }
  return normalizePath(binding?.path) || dimSlug;
}

/**
 * A COLON-form literal binding (`literal:<number>`) in a path position
 * — the filing-transcription grammar (spec §4.6 `input_binding`) and
 * the ingest builder's canonical form (`exposure_input: "literal:1"`).
 * Returns the number, or null when the path is anything else. Distinct
 * from `parseLiteralNum` (the round-drawer parser): a PATH is never a
 * bare number, so only the explicit `literal:` prefix qualifies —
 * a field genuinely named "250" must stay an input read.
 */
function parseColonLiteral(path: string): number | null {
  const m = path.trim().match(/^literal:(-?\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]!) : null;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * ADR-0056 — what a projection produces: the runnable plan AND every
 * structured degradation the projection had to take. `issues` is the
 * authoring-boundary half of Law 2 ("refuse or resolve, never
 * improvise"): a factor table that didn't resolve, a predicate the
 * projector can't gate yet, a stage kind that doesn't execute — each
 * is a visible, machine-stable record, not a console.warn.
 *
 * There is deliberately NO wrapper that returns the bare plan — a
 * caller that discards `issues` is the silent path this contract
 * exists to kill.
 */
export interface ProjectionResult {
  readonly plan: Plan;
  readonly issues: readonly ProjectionIssue[];
}

/**
 * Project authored stages + reference data into a runtime Plan.
 *
 * The returned `plan` is shaped for `compilePlan(plan)` →
 * `executePlanBatch(compiled, rows)`. External inputs (the rows) are
 * keyed by the SAME normalized field names that `deriveRequiredInputs`
 * produces, so the consumer's `projectRowsToExternalInputs` output
 * lines up 1:1 without extra translation.
 *
 * Empty / unsupported stages produce no nodes; an empty plan is a
 * valid output and renders an empty Score-all CSV — but every
 * premium-affecting stage the projection SKIPPED is named in
 * `issues` (ADR-0056).
 */
export function stagesToRuntimePlan(
  stages: readonly StageLike[],
  dimensions: readonly Dimension[],
  factorTables: readonly FactorTableLike[],
  factorTableCells: FactorTableCellsMap,
  options?: StagesToRuntimePlanOptions,
): ProjectionResult {
  const nodes: PlanNode[] = [];
  const edges: PlanEdge[] = [];
  // ADR-0056 — structured projection issues, in stage order. Every
  // degradation site below pushes here; the legacy console.warn calls
  // stay for dev ergonomics but are no longer the only signal.
  const issues: ProjectionIssue[] = [];

  // ADR-0056 — translate the authored per-lookup unknown-key policy
  // into the engine's `onMiss` param. ABSENT (or malformed) ⇒ error:
  // Law 2's authoring default. Only FACTOR lookups get stamped — the
  // projector's structural selectors (`expmatch_*` when-matching,
  // predicate gates) keep their explicit defaultValues, where a
  // non-match is the normal case, not a miss.
  const onMissFor = (lookup: FactorLookupShape): OnMissPolicy => {
    const p = lookup.unknown_key_policy;
    if (
      p &&
      p.mode === "default" &&
      typeof p.value === "number" &&
      Number.isFinite(p.value)
    ) {
      return { mode: "default", value: p.value };
    }
    if (p && p.mode === "refer") return { mode: "refer" };
    return { mode: "error" };
  };
  // Shared `derive.class_attribute` node ids (dedup). A chain can carry more
  // than one factor lookup keyed on the SAME class-derived dim — e.g. Meridian BOP's
  // rate_number_rel AND sprinkler_rel both key `prop_rate_number`. They must
  // share ONE derive node (+ one class-code edge); emitting it per lookup makes
  // the plan carry duplicate node ids + a spurious cycle, and it won't compile.
  const clsattrNodeIds = new Set<string>();

  // ── Brief 83.2 — level aliases ─────────────────────────────────────
  // A categorical level may author `aliases` — the integrator-facing raw
  // vocabulary for the same level ("1" ⟂ q1, "1500" ⟂ ded_1500,
  // "300000" ⟂ the default 300_600_600 limit trio). Aliases resolve at
  // PROJECTION time by widening lookup tables (1-D keys + 2-D composite
  // keys): no wire transform (contract §11), no engine change — the
  // authored dim data is the vocabulary. A level id always wins over a
  // colliding alias from another level (first-authored id order).
  const aliasesOf = (
    dim: Dimension | undefined,
  ): Map<string, readonly string[]> => {
    const m = new Map<string, readonly string[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const levels = ((dim as any)?.levels ?? []) as readonly Record<
      string,
      unknown
    >[];
    for (const l of levels) {
      const id = l?.["id"];
      const al = l?.["aliases"];
      if (typeof id === "string" && Array.isArray(al)) {
        const list = al.filter(
          (a): a is string => typeof a === "string" && a !== "" && a !== id,
        );
        if (list.length > 0) m.set(id, list);
      }
    }
    return m;
  };
  const widenTableWithAliases = (
    table: Record<string, number>,
    dim: Dimension | undefined,
  ): Record<string, number> => {
    const aliases = aliasesOf(dim);
    if (aliases.size === 0) return table;
    const out = { ...table };
    for (const [id, list] of aliases) {
      const v = table[id];
      if (typeof v !== "number") continue;
      for (const a of list) if (!(a in out)) out[a] = v;
    }
    return out;
  };

  // PR D3.3 — Dim catalog by slug for the resolution branches. A
  // factor lookup's bound dim decides how its raw input reaches the
  // lookup key:
  //   • banded + raw column   → insert `derive.band`     (ADR-0026)
  //   • geographic + territory grouping → insert `derive.territory`
  //                              (ADR-0028 — cold-test L13): the raw
  //                              state code resolves through the
  //                              dim's `geo_territories` onto a
  //                              territory id before the lookup.
  //   • everything else        → direct per-value lookup (unchanged)
  const dimsBySlug = new Map<string, Dimension>();
  for (const d of dimensions) {
    if (d.slug) dimsBySlug.set(d.slug, d);
  }

  // Track which input nodes we've already created so multiple chains
  // sharing a dim (e.g., NTEE feeds both D&O + GL) don't duplicate the
  // `in_ntee_major` node — they connect to the same one.
  const inputNodes = new Map<string, string>(); // fieldName -> node id

  // Phase F (2026-07-17) — the DECLARED input dictionary types its
  // port. Consumers infer a port type from how they read the field (a
  // lookup key infers "string", an exposure infers "money"), and the
  // first creator won the dedupe — so a field the actuary declared
  // `bool` could ship as a "string" port when its first consumer was a
  // lookup dim, and the wire spelling "true" then flowed RAW to every
  // `ctx.externalInputs` reader (the appetite gate's `eq true` silently
  // no-matched; the endorsement trigger saw a truthy "false"). The
  // declaration wins over a "string" INFERENCE only — a consumer that
  // computes on the port (number/money/factor/boolean) keeps its
  // stronger type, so a mis-declared dictionary can never break
  // working arithmetic.
  const declaredInputTypes = new Map<
    string,
    "number" | "money" | "factor" | "boolean" | "date"
  >();
  for (const s of stages) {
    if (s.stage_kind !== "input_node") continue;
    const cfg = asObject(s.config_json);
    const fieldName =
      (typeof cfg.source_path === "string" && cfg.source_path) ||
      (typeof cfg.name === "string" && cfg.name) ||
      s.stage_id;
    const t = typeof cfg.data_type === "string" ? cfg.data_type : "";
    // The widened InputNodeConfig vocabulary (Brief 52) onto the port
    // types the runtime coerces by. string/enum/class_code stay
    // undeclared here — "string" is already the weakest inference.
    const declared =
      t === "boolean" || t === "bool"
        ? ("boolean" as const)
        : t === "money" || t === "currency"
          ? ("money" as const)
          : t === "factor"
            ? ("factor" as const)
            : t === "number" || t === "int" || t === "float" || t === "pct"
              ? ("number" as const)
              : t === "date"
                ? ("date" as const)
                : undefined;
    if (declared && !declaredInputTypes.has(fieldName)) {
      declaredInputTypes.set(fieldName, declared);
    }
  }

  const defaults = options?.defaults ?? {};
  // Brief 83.2 — params by field, so a later caller can FLIP `optional`
  // off (required wins over optional across all creators of one field).
  const inputNodeParams = new Map<string, Record<string, unknown>>();
  const ensureInputNode = (
    fieldName: string,
    inferredType: "string" | "number" | "money" | "factor" | "boolean" | "date",
    opts?: { readonly optional?: boolean },
  ): string => {
    // Declared dictionary type upgrades a "string" inference (Phase F,
    // above). Applied at create time, so the port is order-independent
    // of WHICH consumer reaches the field first.
    const fieldType =
      inferredType === "string"
        ? (declaredInputTypes.get(fieldName) ?? inferredType)
        : inferredType;
    const existing = inputNodes.get(fieldName);
    if (existing) {
      // Required wins: any non-optional consumer strips the flag.
      if (!opts?.optional) {
        const p = inputNodeParams.get(fieldName);
        if (p && p.optional === true) delete p.optional;
      }
      return existing;
    }
    const id = `in_${sanitize(fieldName)}`;
    // PR D2b — when the caller supplied a defaultValue for this
    // field, attach it so the runtime falls back to the constant when
    // the row doesn't supply the field. Per-plan constants (base
    // rates, LCM) shouldn't require CSV columns.
    const hasDefault = Object.prototype.hasOwnProperty.call(
      defaults,
      fieldName,
    );
    const params: Record<string, unknown> = { fieldName, fieldType };
    if (hasDefault) params.defaultValue = defaults[fieldName];
    // Brief 83.2 — structurally-optional inputs (a declared override, an
    // exposure-option branch input, the IRPM schedule application): the
    // plan rates honestly without them, so the quote preflight must not
    // list them as missing. Metadata only — the runtime ignores it.
    if (opts?.optional) params.optional = true;
    nodes.push({ id, kind: "input", params });
    inputNodes.set(fieldName, id);
    inputNodeParams.set(fieldName, params);
    return id;
  };

  // ── ADR-0044 D5 — resolve ONE lookup axis to a key-producing port ───
  // Used by the dual-input lookup.multi path. Returns the {node, port}
  // that yields the axis's lookup KEY, applying (in order): a literal
  // constant, a computed sum (chain.add), then the bound dim's
  // derivation — class-derived (derive.class_attribute), geographic
  // (derive.territory), or banded (derive.band) — else the raw input.
  // Pure structural projection; mirrors the 1-D key-resolution branches.
  const resolveAxisKeyRef = (
    dimSlug: string,
    binding: BindingShape | undefined,
    idTag: string,
  ): { node: string; port: string } => {
    const boundDim = dimsBySlug.get(dimSlug);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dimShape = (boundDim as any)?.shape;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dimLevels = ((boundDim as any)?.levels ?? []) as readonly unknown[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const derivedFrom = (boundDim as any)?.derived_from as
      | { source_dim?: string; attribute?: string; override_field?: string }
      | undefined;

    // 1. Literal axis → constant key (e.g. fixed building-limit group).
    if (binding?.source === "literal" && binding.value !== undefined) {
      const cid = `litkey_${idTag}`;
      nodes.push({
        id: cid,
        kind: "constant",
        params: { value: binding.value, type: "string" },
      });
      return { node: cid, port: "value" };
    }

    // 2. Class-derived axis FIRST — it consumes ONLY the source dim's
    // input (class_code, + the optional override), never the raw slug
    // field. Building the raw producer anyway (the pre-83.2 order)
    // leaked an orphan `in_<derived-slug>` input node into the plan,
    // which the quote preflight then demanded as a missing input.
    if (derivedFrom?.source_dim && derivedFrom.attribute) {
      const attribute = derivedFrom.attribute;
      const sourceDim = dimsBySlug.get(derivedFrom.source_dim);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sourceLevels = ((sourceDim as any)?.levels ??
        []) as readonly Record<string, unknown>[];
      const attrTable: Record<string, string> = {};
      for (const lvl of sourceLevels) {
        const code = lvl?.["id"];
        const attrs = lvl?.["attributes"];
        if (typeof code === "string" && attrs && typeof attrs === "object") {
          const v = (attrs as Record<string, unknown>)[attribute];
          if (typeof v === "string" && v !== "") attrTable[code] = v;
        }
      }
      const classInputId = ensureInputNode(derivedFrom.source_dim, "string");
      const dId = `clsattr_${idTag}`;
      // Dedup (see the lookup-loop site): reuse one class-attribute derive node
      // + its class-code edge when several consumers key the same derived dim.
      if (!clsattrNodeIds.has(dId)) {
        clsattrNodeIds.add(dId);
        nodes.push({
          id: dId,
          kind: "derive.class_attribute",
          params: {
            attributeKey: attribute,
            table: attrTable,
            tableName: `${derivedFrom.source_dim} → ${attribute}`,
          },
        });
        edges.push({
          from: { node: classInputId, port: "value" },
          to: { node: dId, port: "class_code" },
        });
        // Brief 83 / TV-19 — a dim may author a DECLARED override field
        // (`derived_from.override_field`, e.g. liab_exposure_basis_override):
        // wire it onto the derive's `override` port; a non-empty row value
        // supersedes the class derivation. Absent config = unwired port =
        // byte-identical legacy graphs.
        if (
          typeof derivedFrom.override_field === "string" &&
          derivedFrom.override_field !== ""
        ) {
          const ovId = ensureInputNode(derivedFrom.override_field, "string", {
            optional: true,
          });
          edges.push({
            from: { node: ovId, port: "value" },
            to: { node: dId, port: "override" },
          });
        }
      }
      return { node: dId, port: "value" };
    }

    // 3. Raw value producer: a computed sum (chain.add) or an input field.
    let rawRef: { node: string; port: string };
    if (
      binding?.source === "computed" &&
      binding.op === "sum" &&
      Array.isArray(binding.fields) &&
      binding.fields.length > 0
    ) {
      const addId = `sum_${idTag}`;
      nodes.push({
        id: addId,
        kind: "chain.add",
        params: { addendNames: [...binding.fields] },
      });
      for (const f of binding.fields) {
        const inId = ensureInputNode(normalizePath(f) || f, "number");
        edges.push({
          from: { node: inId, port: "value" },
          to: { node: addId, port: "addends" },
        });
      }
      rawRef = { node: addId, port: "result" };
    } else {
      const field = rawInputFieldFor(dimSlug, binding, boundDim);
      rawRef = { node: ensureInputNode(field, "string"), port: "value" };
    }

    const territories = geoTerritoriesOf(boundDim);
    if (territories.length > 0) {
      const territoryMap = geoValueToKeyMap(
        boundDim ?? { geo_territories: [], levels: [] },
      );
      const territoryLabels: Record<string, string> = {};
      for (const t of territories) {
        if (t.label) territoryLabels[t.id] = t.label;
      }
      const tId = `terr_${idTag}`;
      nodes.push({
        id: tId,
        kind: "derive.territory",
        params: { dimSlug, territoryMap, territoryLabels },
      });
      edges.push({ from: rawRef, to: { node: tId, port: "value" } });
      return { node: tId, port: "territory_id" };
    }
    if (dimShape === "banded") {
      const bId = `band_${idTag}`;
      nodes.push({
        id: bId,
        kind: "derive.band",
        params: { dimSlug, levels: dimLevels, clampToNearest: true },
      });
      edges.push({ from: rawRef, to: { node: bId, port: "value" } });
      return { node: bId, port: "level_id" };
    }
    return rawRef;
  };

  // ── G7-full — ONE predicate resolver for every gate site ───────────
  // Returns the {node, port} producing the predicate's truth value plus
  // whether the factor applies on TRUE. Handles all three equals types:
  //   · boolean → the input IS the predicate
  //   · number  → `predicate` eq node
  //   · string  → 1/0 membership lookup (the expmatch pattern): the
  //     value keys {equals: 1} with default 0, feeding branch.predicate.
  // Node ids keep the pre-G7 scheme for bool/number (predeq_*) so
  // existing plans/traces are byte-stable; string adds predeqs_*.
  const buildPredicateRef = (
    pred: { readonly path?: string; readonly equals?: boolean | number | string },
    idTag: string,
  ): { ref: { node: string; port: string }; factorOnTrue: boolean } | null => {
    if (typeof pred.path !== "string" || pred.path.length === 0) return null;
    const predField = normalizePath(pred.path) || pred.path;
    const equals = pred.equals;
    if (typeof equals === "boolean") {
      const inId = ensureInputNode(predField, "boolean");
      return {
        ref: { node: inId, port: "value" },
        factorOnTrue: equals === true,
      };
    }
    if (typeof equals === "number") {
      const inId = ensureInputNode(predField, "number");
      const predId = `predeq_${idTag}`;
      nodes.push({
        id: predId,
        kind: "predicate",
        params: { op: "eq", threshold: equals },
      });
      edges.push({
        from: { node: inId, port: "value" },
        to: { node: predId, port: "x" },
      });
      return { ref: { node: predId, port: "value" }, factorOnTrue: true };
    }
    if (typeof equals === "string") {
      const inId = ensureInputNode(predField, "string");
      const eqId = `predeqs_${idTag}`;
      nodes.push({
        id: eqId,
        kind: "lookup.direct",
        params: {
          table: { [equals]: 1 },
          defaultValue: 0,
          tableName: `when ${predField} = ${equals}`,
        },
      });
      edges.push({
        from: { node: inId, port: "value" },
        to: { node: eqId, port: "key" },
      });
      return { ref: { node: eqId, port: "value" }, factorOnTrue: true };
    }
    return null;
  };

  // Wrap a factor producer in branch(predicate ? factor : 1.0) — the
  // multiplicative-identity gate every predicate site shares.
  const gateFactorRef = (
    factorRef: { node: string; port: string },
    predRef: { node: string; port: string },
    factorOnTrue: boolean,
    idTag: string,
  ): { node: string; port: string } => {
    const oneId = `gate1_${idTag}`;
    nodes.push({
      id: oneId,
      kind: "constant",
      params: { value: 1.0, type: "factor" },
    });
    const gateId = `gate_${idTag}`;
    nodes.push({ id: gateId, kind: "branch", params: {} });
    edges.push({ from: predRef, to: { node: gateId, port: "predicate" } });
    const thenRef = factorOnTrue ? factorRef : { node: oneId, port: "value" };
    const elseRef = factorOnTrue ? { node: oneId, port: "value" } : factorRef;
    edges.push({ from: thenRef, to: { node: gateId, port: "then" } });
    edges.push({ from: elseRef, to: { node: gateId, port: "else" } });
    return { node: gateId, port: "result" };
  };

  for (const stage of stages) {
    // Phase G G3 — eligibility.gate stages emit a runtime node so the
    // ScoringPreviewPane can show a tier verdict per row. Pre-G3 the
    // runtime never saw the user's authored filters (they were dropped
    // by the `!== multiplicative_chain` skip below), so a "state == NJ
    // → decline" rule did nothing visible at score time.
    //
    // The kind takes no wire inputs (it reads ctx.externalInputs
    // directly), so we don't need to wire it into the chain. The
    // runtime walks all nodes and the trace captures the verdict for
    // every row.
    //
    // modifier.schedule + endorsement.* are still skipped here —
    // they need wire inputs (premium, schedule application) which
    // require composing into the chain. A G3 follow-up handles those.
    if (stage.stage_kind === "eligibility.gate") {
      const cfg = asObject(stage.config_json) ?? {};
      // Brief 70.1 / ADR-016 — policy-scope gates run POST-ROLLUP via
      // evaluatePolicyBook (policyBookConfig routes them there). They
      // used to ALSO emit a per-row node here, evaluating policy rules
      // against same-named per-row fields — and, sorting first, could
      // wire their tier into per-row modifiers (gateNodes[0]). Per-row
      // projection now carries row-scope gates only.
      if (cfg.scope === "policy") continue;
      const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
      if (rules.length === 0) continue;
      const id = `gate_${sanitize(stage.stage_id)}`;
      nodes.push({
        id,
        kind: "eligibility.gate",
        params: {
          rules,
          default_tier: (cfg.default_tier as string) ?? "preferred",
          default_reasoning:
            (cfg.default_reasoning as string) ?? "No filter rule matched.",
        } as unknown as Record<string, unknown>,
      });
      continue;
    }
    if (stage.stage_kind !== "multiplicative_chain") {
      // modifier.schedule / modifier.model / endorsement.* / round are
      // handled by their own passes below. Anything else premium-
      // affecting is NOT executed — ADR-0056 makes that a structured
      // error instead of a silent skip (`input_node` is exempt: it is
      // an input-dictionary declaration, not a priced step).
      if (
        !PROJECTOR_EXECUTED_STAGE_KINDS.has(stage.stage_kind) &&
        stage.stage_kind !== "input_node"
      ) {
        issues.push({
          severity: "error",
          code: "stage_not_executed",
          message: `Stage \`${stage.stage_id}\` (${stage.stage_kind}) is authored on this plan but the projector does not execute its kind — it contributes NOTHING to the premium.`,
          stageId: stage.stage_id,
          ref: { stageKind: stage.stage_kind },
        });
      }
      continue;
    }
    const cfg = asObject(stage.config_json);
    for (const rawSpec of asChainList(cfg)) {
      const spec = readChainSpec(rawSpec);
      const specName = spec.name?.trim() || `chain_${nodes.length}`;
      const safeSpec = sanitize(specName);
      // Brief 95 C4 — everything minted from here to the end of this
      // iteration is THIS tower's subgraph (ids embed safeSpec); the
      // election guard walks this slice.
      const towerNodesStart = nodes.length;

      // ── 1. Base rate ────────────────────────────────────────────
      //
      // Cold-test L30 — the base rate is a first-class, editable
      // property of the chain (`base_value`). When the actuary has
      // authored a literal (set in the ASSEMBLE base node), we emit a
      // `constant` node carrying that scalar straight into chain.mult's
      // `base` port — no external-input resolution, no template_id-keyed
      // default. This is what lets a from-scratch plan (template_id =
      // null) score a non-zero premium: base 600 × factors × LCM.
      //
      // `base_input` is the BACK-COMPAT fallback: when no literal is
      // authored, the chain resolves its base from an `input` node
      // (column-driven, optionally backed by an `options.defaults`
      // constant). Plans authored before `base_value` existed keep
      // working unchanged.
      const literalBase = spec.base_value;
      const hasLiteralBase =
        typeof literalBase === "number" && Number.isFinite(literalBase);

      let baseNodeId: string;
      if (hasLiteralBase) {
        baseNodeId = `const_base_${safeSpec}`;
        nodes.push({
          id: baseNodeId,
          kind: "constant",
          params: { value: literalBase, type: "money" },
        });
      } else {
        const basePathRaw = spec.base_input;
        const baseField = basePathRaw ? normalizePath(basePathRaw) : "";
        if (!baseField) {
          // Malformed chain — no authored base rate AND no base input.
          // ADR-0056: the whole chain is skipped, so say so; a silent
          // `continue` here made an entire coverage vanish unremarked.
          issues.push({
            severity: "error",
            code: "chain_missing_base",
            message: `Chain \`${specName}\` on stage \`${stage.stage_id}\` has no base rate (neither an authored base_value nor a base_input) — the whole chain is skipped and prices nothing.`,
            stageId: stage.stage_id,
            ref: {
              ...(spec.coverage_value !== undefined
                ? { coverage: spec.coverage_value }
                : {}),
            },
          });
          continue;
        }
        baseNodeId = ensureInputNode(baseField, "money");
      }

      // Each factor_lookup contributes one factor producer (node + output
      // port) wired into the chain.mult. We collect them in order so the
      // chain mirrors the authored sequence (audit-stable). The port is
      // tracked because a factor can be produced by a `lookup.direct`
      // (`value`), a `lookup.range` (`value`), or a predicate `branch`
      // (`result`) — ADR-0044 D4/D6.
      const factorOutNodes: Array<{ node: string; port: string }> = [];
      const factorNames: string[] = [];

      // ── 2. Factor lookups ───────────────────────────────────────
      for (const lookup of spec.factor_lookups ?? []) {
        // ADR-0044 D4 — `direct` → lookup.direct (categorical / coverage-
        // sliced / class-derived / banded-via-derive.band). `binned` /
        // `bracketed` / `interpolated` on a banded dim → lookup.range.
        const method = lookup.lookup_method ?? "direct";
        const isRange =
          method === "binned" ||
          method === "bracketed" ||
          method === "interpolated";

        const dimsMap = lookup.dimensions ?? {};
        const dimSlugs = Object.keys(dimsMap);
        if (dimSlugs.length === 0) {
          // ADR-0056 — a factor lookup with no dimension binding can't
          // be keyed; it was silently dropped (premium too LOW).
          issues.push({
            severity: "error",
            code: "lookup_unkeyed",
            message: `Factor \`${lookup.name ?? lookup.factor_kind ?? "?"}\` on stage \`${stage.stage_id}\` declares no dimension binding — it cannot be keyed and is skipped entirely.`,
            stageId: stage.stage_id,
            ref: { table: lookup.factor_kind ?? lookup.name ?? "?" },
          });
          continue;
        }

        // Resolve the factor table + its cells first — we inspect the
        // cell-key shape to decide 1-D vs 2-D before picking the key dim.
        const ft = findFactorTable(lookup, factorTables);
        const cells = ft ? factorTableCells.get(ft.id) : undefined;

        // Brief 80.3 (found replaying E7) — the 2-D AXIS ORDER is a
        // contract, not the dimensions map's JSON key order. Cell keys
        // are `row::col` in the table's `key_dimensions` order; a
        // sort_keys JSON round-trip (e.g. the plan-duplicate endpoint)
        // alphabetized the map and silently flipped every 2-D key
        // (`loi::t2` looked up against `t2::loi` cells → the whole
        // book errored). When the catalog declares key_dimensions and
        // every declared dim is bound, the DECLARED order wins; unbound
        // extras keep their tail position.
        const ftKeyDims = ft?.key_dimensions;
        if (
          ftKeyDims &&
          ftKeyDims.length >= 2 &&
          dimSlugs.length >= 2 &&
          ftKeyDims.every((k) => dimSlugs.includes(k))
        ) {
          dimSlugs.sort((a, b) => {
            const ia = ftKeyDims.indexOf(a);
            const ib = ftKeyDims.indexOf(b);
            return (ia < 0 ? ftKeyDims.length : ia) -
              (ib < 0 ? ftKeyDims.length : ib);
          });
        }
        const lookupLabel =
          lookup.name ?? lookup.factor_kind ?? dimSlugs[0] ?? "factor";
        if (!ft) {
          // ADR-0056 — no table resolved for this factor lookup. The
          // node is still emitted (with an empty table), so every row
          // hits its onMiss policy; this names the authoring cause.
          issues.push({
            severity: "error",
            code: "factor_table_missing",
            message: `Factor \`${lookupLabel}\` on stage \`${stage.stage_id}\` matched no factor table (looked for slug/id \`${lookup.factor_kind ?? lookup.name ?? "?"}\`) — no key can resolve.`,
            stageId: stage.stage_id,
            ref: {
              table: lookup.factor_kind ?? lookup.name ?? "?",
              ...(dimSlugs[0] !== undefined ? { dim: dimSlugs[0] } : {}),
            },
          });
        }

        // ── ADR-0039: 2-D factor table sliced per coverage tower ──────
        // A 2-D table encodes cells as "rowId::colId". When THIS chain is
        // one tower of a coverage split — it carries a `coverage_value`
        // and the table is split on the config's `rating_dimension` — we
        // SLICE the table to the tower's column and emit a normal 1-D
        // lookup keyed on the remaining (risk-input) axis. The coverage
        // axis is a compile-time constant of the tower, not a runtime
        // input. Genericity (ADR-0033 §0): keyed off the generic
        // rating_dimension + coverage_value, never a coverage literal.
        const coverageValue = spec.coverage_value;
        const ratingDim = (cfg as { rating_dimension?: string })
          .rating_dimension;
        const is2D = cellsAre2D(cells);
        const isCoverageSlice =
          is2D &&
          !!coverageValue &&
          !!ratingDim &&
          dimSlugs.includes(ratingDim);

        // ── ADR-0044 D5 — dual-risk-input 2-D table → lookup.multi ────
        // Both axes are LIVE (neither is the coverage-tower constant) —
        // e.g. property_deductible (deductible × total-limit band) and
        // base_lc_liability (territory × exposure base). We emit a
        // lookup.multi keyed on both axes; each axis is resolved in-plan
        // via resolveAxisKeyRef (direct / banded / class-derived / geo /
        // literal / computed-sum), wired to lookup.multi's per-key port
        // (PR2 derivedPorts). Cell "rowId::colId" → row {keys:[row,col]}.
        if (is2D && !isCoverageSlice && dimSlugs.length >= 2 && cells) {
          const axis0 = dimSlugs[0]!;
          const axis1 = dimSlugs[1]!;
          // Brief 83.2 — widen composite keys with each axis's aliases:
          // every (id|alias)×(id|alias) combination keys the same factor.
          const a0 = aliasesOf(dimsBySlug.get(axis0));
          const a1 = aliasesOf(dimsBySlug.get(axis1));
          const variants = (
            key: string,
            m: Map<string, readonly string[]>,
          ): readonly string[] => [key, ...(m.get(key) ?? [])];
          const rows: Array<{ keys: [string, string]; factor: number }> = [];
          const seen = new Set<string>();
          for (const [k, v] of cells.entries()) {
            const i = k.indexOf("::");
            if (i < 0 || typeof v !== "number" || !Number.isFinite(v)) continue;
            const row = k.slice(0, i);
            const col = k.slice(i + 2);
            for (const r of variants(row, a0)) {
              for (const c of variants(col, a1)) {
                const composite = `${r}::${c}`;
                if (seen.has(composite)) continue;
                seen.add(composite);
                rows.push({ keys: [r, c], factor: v });
              }
            }
          }
          const lkTag = lookup.factor_kind ?? lookup.name ?? `${axis0}_${axis1}`;
          const multiId = `mlk_${safeSpec}_${sanitize(lkTag)}`;

          // ADR-0063 — 2-D-axis interpolation. When the table flags a
          // banded numeric axis `linear` (the F14 gap), lookup.multi
          // reads that axis by interpolating between breakpoints instead
          // of stepping: it receives the RAW value (not the band id), and
          // `interpolateOn.breakpoints` maps each band id → its LOWER
          // bound (the x the band's factor sits at). Absent flag → the
          // existing step behavior, byte-for-byte.
          const interpAxisSlug =
            ft?.interpolation?.mode === "linear" &&
            (ft.interpolation.axis === axis0 || ft.interpolation.axis === axis1)
              ? ft.interpolation.axis
              : undefined;
          let interpolateOn:
            | { key: string; breakpoints: Record<string, number> }
            | undefined;
          if (interpAxisSlug) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const iLevels = ((dimsBySlug.get(interpAxisSlug) as any)?.levels ??
              []) as ReadonlyArray<{ id?: string; lo?: number | null }>;
            const breakpoints: Record<string, number> = {};
            for (const lvl of iLevels) {
              if (
                typeof lvl?.id === "string" &&
                typeof lvl.lo === "number" &&
                Number.isFinite(lvl.lo)
              ) {
                breakpoints[lvl.id] = lvl.lo;
              }
            }
            if (Object.keys(breakpoints).length > 0) {
              interpolateOn = { key: interpAxisSlug, breakpoints };
            }
          }

          nodes.push({
            id: multiId,
            kind: "lookup.multi",
            params: {
              keyNames: [axis0, axis1],
              rows,
              defaultValue: 1.0,
              tableName: ft?.display_name ?? lookup.name ?? lkTag,
              citation: lookup.description_template ?? "",
              // ADR-0056 — authored unknown-key policy (error default).
              onMiss: onMissFor(lookup),
              keySource: `${axis0}, ${axis1}`,
              ...(interpolateOn ? { interpolateOn } : {}),
            },
          });
          // The interpolation axis is fed the RAW numeric value (the kind
          // interpolates it); every other axis keys discretely as before.
          const wireAxis = (
            axisSlug: string,
            binding: BindingShape | undefined,
            tag: string,
          ): { node: string; port: string } => {
            if (interpAxisSlug === axisSlug) {
              const boundDim = dimsBySlug.get(axisSlug);
              const field = rawInputFieldFor(axisSlug, binding, boundDim);
              return { node: ensureInputNode(field, "number"), port: "value" };
            }
            return resolveAxisKeyRef(axisSlug, binding, tag);
          };
          const k0 = wireAxis(
            axis0,
            dimsMap[axis0],
            `${safeSpec}_${sanitize(lkTag)}_a0`,
          );
          const k1 = wireAxis(
            axis1,
            dimsMap[axis1],
            `${safeSpec}_${sanitize(lkTag)}_a1`,
          );
          edges.push({ from: k0, to: { node: multiId, port: axis0 } });
          edges.push({ from: k1, to: { node: multiId, port: axis1 } });
          // G7-full — a dual-input lookup's predicate gates exactly like
          // a 1-D lookup's: branch(predicate ? factor : 1.0). The pre-G7
          // unconditional drop (a silent overcharge on every exempted
          // row) is gone.
          let multiRef: { node: string; port: string } = {
            node: multiId,
            port: "value",
          };
          if (
            lookup.predicate &&
            typeof lookup.predicate.path === "string" &&
            lookup.predicate.path.length > 0
          ) {
            const built = buildPredicateRef(
              lookup.predicate,
              `${safeSpec}_${sanitize(lkTag)}`,
            );
            if (built) {
              multiRef = gateFactorRef(
                multiRef,
                built.ref,
                built.factorOnTrue,
                `${safeSpec}_${sanitize(lkTag)}`,
              );
            }
          }
          factorOutNodes.push(multiRef);
          factorNames.push(lookup.name ?? lookup.factor_kind ?? lkTag);
          continue;
        }

        let dimSlug: string;
        let table: Record<string, number>;
        if (isCoverageSlice) {
          dimSlug = dimSlugs.find((s) => s !== ratingDim) ?? dimSlugs[0]!;
          table = sliceCellsToCoverageColumn(cells, coverageValue!);
          if (Object.keys(table).length === 0) {
            // ADR-0056 — the tower's column doesn't exist in the table:
            // every key will miss and hit the onMiss policy.
            issues.push({
              severity: "error",
              code: "coverage_slice_empty",
              message: `Coverage tower \`${coverageValue}\` matched no column in 2-D table \`${ft?.id ?? lookup.factor_kind ?? "?"}\` — factor \`${lookupLabel}\` has no cells for this tower. Check the table's coverage levels against the tower.`,
              stageId: stage.stage_id,
              ref: {
                table: ft?.id ?? lookup.factor_kind ?? "?",
                coverage: coverageValue!,
                dim: dimSlug,
              },
            });
            // eslint-disable-next-line no-console
            console.warn(
              `[stagesToRuntimePlan] coverage tower "${coverageValue}" matched no column in 2-D table "${ft?.id ?? lookup.factor_kind ?? "?"}"; this factor falls back to 1.0. Check the table's coverage levels against the tower.`,
            );
          }
        } else {
          if (is2D) {
            // A 2-D table that is neither a coverage slice nor a 2-axis
            // dual-input lookup (only one axis declared) can't be keyed.
            issues.push({
              severity: "error",
              code: "table_unkeyable_2d",
              message: `2-D factor table \`${ft?.id ?? lookup.factor_kind ?? "?"}\` on stage \`${stage.stage_id}\` has neither a coverage tower nor two declared axes — it cannot be keyed, so factor \`${lookupLabel}\` has no cells.`,
              stageId: stage.stage_id,
              ref: { table: ft?.id ?? lookup.factor_kind ?? "?" },
            });
            // eslint-disable-next-line no-console
            console.warn(
              `[stagesToRuntimePlan] 2-D factor table "${ft?.id ?? lookup.factor_kind ?? "?"}" has neither a coverage tower nor two declared axes; can't key it. This factor falls back to 1.0.`,
            );
          }
          dimSlug = dimSlugs[0]!;
          table = cellsToTable(cells);
          if (ft && !is2D && Object.keys(table).length === 0) {
            // ADR-0056 — the table resolved but carries no usable 1-D
            // cells (still being authored, or every value non-finite).
            issues.push({
              severity: "error",
              code: "factor_table_empty",
              message: `Factor table \`${ft.id}\` resolved for \`${lookupLabel}\` on stage \`${stage.stage_id}\` but has no usable cells — no key can resolve.`,
              stageId: stage.stage_id,
              ref: { table: ft.id, dim: dimSlug },
            });
          }
        }
        const binding = dimsMap[dimSlug];

        // Resolve the bound dim up front — it decides the lookup kind
        // (range vs direct) AND the key-resolution path.
        const boundDim = dimsBySlug.get(dimSlug);
        // A geographic axis reads its raw input from the dim's source_field
        // (zip), not the dim slug (`territory`, a derived output). P2.
        const dimField = rawInputFieldFor(dimSlug, binding, boundDim);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dimShape = (boundDim as any)?.shape;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dimLevels = ((boundDim as any)?.levels ?? []) as readonly unknown[];
        const territories = geoTerritoriesOf(boundDim);
        const isGeoGrouped = territories.length > 0;
        const isBanded = dimShape === "banded";
        // Platform-test finding E4 — band whenever the bound dim IS
        // banded. The old extra condition (`dimField !== dimSlug`)
        // skipped derive.band for a banded dim fed by its own field —
        // the DEFAULT authoring outcome — so the raw number ("50000")
        // hit lookup.direct as the key and missed every band id. A
        // truly prebinned column still works: derive.band passes
        // through values that already match a level id (idempotent).
        const isRawBandPath = isBanded;
        // ADR-0035 (Brief 51) — class-derived structural dim. When the
        // bound dim declares `derived_from`, its value is COMPUTED from a
        // class code, not supplied raw:
        //   input(class_code:string) → derive.class_attribute → lookup.direct(key)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const derivedFrom = (boundDim as any)?.derived_from as
          | { source_dim?: string; attribute?: string; override_field?: string }
          | undefined;

        // Brief 83.2 — level ALIASES widen the lookup table: every alias
        // keys the same factor as its level id, so an integrator's raw
        // vocabulary ("1" for q1, "1500" for ded_1500) resolves with
        // zero wire transforms. Authored plan data, applied at projection.
        table = widenTableWithAliases(table, boundDim);

        const tableName =
          ft?.display_name ?? lookup.name ?? lookup.factor_kind ?? "factor";
        const citation = lookup.description_template ?? "";
        const lookupTag = lookup.factor_kind ?? lookup.name ?? dimSlug;

        // The producer of this factor's value (node + output port).
        // Predicate gating (below) may wrap it in a `branch`.
        let factorRef: { node: string; port: string };

        // ── ADR-0044 D4 — banded limit relativity → lookup.range ──────
        // A binned/bracketed/interpolated lookup on a banded dim projects
        // to lookup.range: buckets join the dim's banded levels
        // ({id,lo,hi}) with the per-band factors (the 1-D `table`, keyed
        // by level id). The range keys on the RAW numeric input — it does
        // its own banding, so no derive.band is needed. A 2-D table
        // (band×group, e.g. building_limit_rel) yields an empty 1-D
        // `table` here; that dual-input case is deferred to lookup.multi
        // (PR5), so we fall through to the neutral lookup.direct.
        const bandedLevels = dimLevels as ReadonlyArray<{
          id?: string;
          lo?: number | null;
          hi?: number | null;
        }>;
        const canRange =
          isRange &&
          isBanded &&
          bandedLevels.length > 0 &&
          Object.keys(table).length > 0;

        // ── ADR-0063 / Brief 95 C5 — 1-D banded curve interpolation ───
        // The remaining half of engine gap F14: a 1-D table flagged
        // `interpolation=linear` on its banded row dim reads the RAW
        // numeric value and interpolates between breakpoints = band
        // LOWER bounds — the same anchor convention the 2-D
        // `interpolateOn` uses, clamped at the ends. Bands without a
        // finite factor contribute no point (never fabricate a 1.0 on
        // a CURVE — it would bend the line). Absent flag → the stepped
        // lookup.range / derive.band paths below, byte-stable.
        const interp1D =
          !is2D &&
          isBanded &&
          ft?.interpolation?.mode === "linear" &&
          (ft.interpolation.axis === dimSlug || !ft.interpolation.axis) &&
          bandedLevels.length > 0 &&
          Object.keys(table).length > 0;

        if (interp1D) {
          const points = bandedLevels
            .filter(
              (l) =>
                typeof l?.id === "string" &&
                typeof l.lo === "number" &&
                Number.isFinite(l.lo) &&
                typeof table[l.id] === "number" &&
                Number.isFinite(table[l.id]!),
            )
            .map((l) => ({ x: l.lo as number, y: table[l.id as string]! }))
            .sort((a, b) => a.x - b.x);
          const interpId = `interp_${safeSpec}_${sanitize(lookupTag)}`;
          nodes.push({
            id: interpId,
            kind: "interpolate",
            params: {
              points,
              mode: "linear",
              clamp: true,
              axisLabel: `${tableName} · ${dimSlug}`,
              citation,
            },
          });
          const dimInputId = ensureInputNode(dimField, "number");
          edges.push({
            from: { node: dimInputId, port: "value" },
            to: { node: interpId, port: "x" },
          });
          factorRef = { node: interpId, port: "y" };
        } else if (canRange) {
          // Finding E5 — a null/absent bound is a JSON-safe open end
          // (levels_json can't carry ±Infinity). The old filter DROPPED
          // open-ended bands entirely, so values past the last bounded
          // band clamped onto it instead of hitting the no-cap band.
          const boundOk = (b: number | null | undefined) =>
            b == null || typeof b === "number";
          const buckets = bandedLevels
            .filter(
              (l) => typeof l?.id === "string" && boundOk(l.lo) && boundOk(l.hi),
            )
            .map((l) => ({
              lo: l.lo ?? null,
              hi: l.hi ?? null,
              factor: table[l.id as string] ?? 1.0,
            }));
          const rangeId = `rng_${safeSpec}_${sanitize(lookupTag)}`;
          nodes.push({
            id: rangeId,
            kind: "lookup.range",
            params: {
              buckets,
              defaultValue: 1.0,
              tableName,
              citation,
              // ADR-0056 — authored unknown-key policy (error default).
              onMiss: onMissFor(lookup),
              keySource: dimField,
            },
          });
          const dimInputId = ensureInputNode(dimField, "number");
          edges.push({
            from: { node: dimInputId, port: "value" },
            to: { node: rangeId, port: "value" },
          });
          factorRef = { node: rangeId, port: "value" };
        } else {
          if (isRange) {
            // A banded method whose dim is NOT a usable 1-D banded table
            // (typically a dual-input 2-D matrix) — fall through to the
            // direct lookup. ADR-0056: structured, since the resulting
            // table is typically empty (every key hits onMiss).
            issues.push({
              severity: "error",
              code: "range_levels_unusable",
              message: `Factor \`${lookupTag}\` on stage \`${stage.stage_id}\` uses banded method \`${method}\` but dim \`${dimSlug}\` has no usable 1-D banded levels — the banded lookup cannot be built.`,
              stageId: stage.stage_id,
              ref: { table: lookupTag, dim: dimSlug, field: dimField },
            });
            // eslint-disable-next-line no-console
            console.warn(
              `[stagesToRuntimePlan] lookup "${lookupTag}" uses method "${method}" but dim "${dimSlug}" has no usable 1-D banded levels (likely a dual-input 2-D table); deferring to lookup.multi (ADR-0044 PR5). Falls back to 1.0.`,
            );
          }

          // ── lookup.direct + key-resolution branch ──────────────────
          //    1. class-derived  → derive.class_attribute → lookup.direct
          //    2. geo + grouping → derive.territory      → lookup.direct
          //    3. banded raw col → derive.band           → lookup.direct
          //    4. direct (legacy / prebinned / geo-w/o-territories)
          const lookupId = `lk_${safeSpec}_${sanitize(lookupTag)}`;
          nodes.push({
            id: lookupId,
            kind: "lookup.direct",
            params: {
              table,
              defaultValue: 1.0,
              tableName,
              citation,
              // ADR-0056 — the authored unknown-key policy governs a
              // miss (error default); `defaultValue` above only backs
              // the raw-engine legacy path, which authored plans never
              // take once onMiss is stamped. keySource names the RAW
              // submission field for the whole key-resolution chain
              // (class code for class-derived dims, the zip/state
              // source for geo, else the bound column).
              onMiss: onMissFor(lookup),
              keySource:
                derivedFrom?.source_dim && derivedFrom.attribute
                  ? derivedFrom.source_dim
                  : dimField,
            },
          });
          factorRef = { node: lookupId, port: "value" };

          if (derivedFrom?.source_dim && derivedFrom.attribute) {
          const attribute = derivedFrom.attribute;
          const sourceDim = dimsBySlug.get(derivedFrom.source_dim);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sourceLevels = ((sourceDim as any)?.levels ??
            []) as readonly Record<string, unknown>[];
          const attrTable: Record<string, string> = {};
          for (const lvl of sourceLevels) {
            const code = lvl?.["id"];
            const attrs = lvl?.["attributes"];
            if (typeof code === "string" && attrs && typeof attrs === "object") {
              const v = (attrs as Record<string, unknown>)[attribute];
              if (typeof v === "string" && v !== "") attrTable[code] = v;
            }
          }
          // The class code reaches us as the source dim's input field.
          const classInputId = ensureInputNode(derivedFrom.source_dim, "string");
          const deriveId = `clsattr_${safeSpec}_${sanitize(dimSlug)}`;
          // Emit the derive node + its class-code edge ONCE; every lookup that
          // keys this derived dim consumes the same node (see clsattrNodeIds).
          if (!clsattrNodeIds.has(deriveId)) {
            clsattrNodeIds.add(deriveId);
            nodes.push({
              id: deriveId,
              kind: "derive.class_attribute",
              params: {
                attributeKey: attribute,
                table: attrTable,
                tableName: `${derivedFrom.source_dim} → ${attribute}`,
              },
            });
            edges.push({
              from: { node: classInputId, port: "value" },
              to: { node: deriveId, port: "class_code" },
            });
            // Brief 83 / TV-19 — authored override field supersedes the
            // class derivation (see resolveAxisKeyRef's twin wiring).
            if (
              typeof derivedFrom.override_field === "string" &&
              derivedFrom.override_field !== ""
            ) {
              const ovId = ensureInputNode(
                derivedFrom.override_field,
                "string",
                { optional: true },
              );
              edges.push({
                from: { node: ovId, port: "value" },
                to: { node: deriveId, port: "override" },
              });
            }
          }
          edges.push({
            from: { node: deriveId, port: "value" },
            to: { node: lookupId, port: "key" },
          });
        } else if (isGeoGrouped) {
          // ADR-0028 + ADR-0038 — geographic territory grouping path.
          // input(state:string) → derive.territory → lookup.direct(key=territory_id)
          // The map self-maps the ungrouped tail (member→territory ∪
          // ungrouped→itself) so the territory-keyed lookup.direct (keyed on
          // geoLookupKeys) also resolves any ungrouped level. Labels ride from
          // the active territories for the audit trace.
          const territoryMap = geoValueToKeyMap(
            boundDim ?? { geo_territories: [], levels: [] },
          );
          const territoryLabels: Record<string, string> = {};
          for (const t of territories) {
            if (t.label) territoryLabels[t.id] = t.label;
          }
          const dimInputId = ensureInputNode(dimField, "string");
          const terrId = `terr_${safeSpec}_${sanitize(dimSlug)}`;
          nodes.push({
            id: terrId,
            kind: "derive.territory",
            params: {
              dimSlug,
              territoryMap,
              territoryLabels,
              // No fallback id: an unmapped state surfaces via the
              // node's `unmapped` output (left unwired but in the
              // trace) and resolves to lookup.direct's defaultValue.
              // Plans that carry an explicit "all other" territory can
              // set unmappedTerritoryId here in a future authoring pass.
            },
          });
          edges.push({
            from: { node: dimInputId, port: "value" },
            to: { node: terrId, port: "value" },
          });
          edges.push({
            from: { node: terrId, port: "territory_id" },
            to: { node: lookupId, port: "key" },
          });
        } else if (isRawBandPath) {
          // Raw value path: input(float) → derive.band → lookup.direct
          const dimInputId = ensureInputNode(dimField, "number");
          const bandId = `band_${safeSpec}_${sanitize(dimSlug)}`;
          nodes.push({
            id: bandId,
            kind: "derive.band",
            params: {
              dimSlug,
              levels: dimLevels,
              // Cold-test L22 — clamp out-of-range values onto the
              // nearest tail band so a revenue above the top band's `hi`
              // (or below the bottom's `lo`) never silently resolves to
              // lookup.direct's neutral 1.0 default (under-pricing). The
              // node still flags `out_of_range` for every clamped row so
              // the score-time preview can count + warn (no silent fix).
              clampToNearest: true,
            },
          });
          edges.push({
            from: { node: dimInputId, port: "value" },
            to: { node: bandId, port: "value" },
          });
          edges.push({
            from: { node: bandId, port: "level_id" },
            to: { node: lookupId, port: "key" },
          });
          } else {
            // Legacy / prebinned / geo-without-territories path:
            // input(string) → lookup.direct
            const dimInputId = ensureInputNode(dimField, "string");
            edges.push({
              from: { node: dimInputId, port: "value" },
              to: { node: lookupId, port: "key" },
            });
          }
        }

        // ── ADR-0044 D6 + G7-full — predicate-gated factor ────────────
        // When the lookup carries a predicate {path, equals}, the factor
        // applies only when it holds, else it is the multiplicative
        // identity 1.0: branch(predicate ? factor : 1.0). All three
        // equals types gate (boolean input, numeric `predicate` eq,
        // string 1/0 membership lookup) — the pre-G7 string drop is gone.
        const pred = lookup.predicate;
        if (pred && typeof pred.path === "string" && pred.path.length > 0) {
          const built = buildPredicateRef(
            pred,
            `${safeSpec}_${sanitize(lookupTag)}`,
          );
          if (built) {
            factorRef = gateFactorRef(
              factorRef,
              built.ref,
              built.factorOnTrue,
              `${safeSpec}_${sanitize(lookupTag)}`,
            );
          }
        }

        factorOutNodes.push(factorRef);
        factorNames.push(lookup.name ?? lookup.factor_kind ?? dimSlug);
      }

      // ── 3. LCM resolution ──────────────────────────────────────
      // Resolve a node that OUTPUTS the LCM value. WHETHER it applies as
      // a chain factor (per-account mode) or as the terminal scalar
      // (exposure-rated mode, §5) is decided below — never both, so the
      // LCM is applied exactly once (ADR-0044 D3 "don't double-apply").
      //   · spec.lcm.value (authored carrier constant) → a `constant` node [ADR-0047]
      //   · {lcmOverride} option (template default)     → a `constant` node
      //   · lcm.input_path (per-risk column)            → an `input` node
      let lcmNodeId: string | null = null;
      const lcmValue = spec.lcm?.value;
      const lcmOverride = options?.lcmOverride;
      const lcmPath = spec.lcm?.input_path;
      // An authored per-chain carrier LCM (`lcm.value`, Brief 54 / ADR-0047) is
      // the MOST specific source → it wins over the generic per-template
      // {lcmOverride} default and the per-risk input column. This preserves the
      // Filed rate → round(3 dp) → × LCM order; folding the LCM into base_value
      // rounds at the wrong point (KS-10 → 1216 vs the 1210 oracle). A chain
      // with no `lcm.value` is unchanged: {lcmOverride} then `lcm.input_path`.
      const lcmConst =
        typeof lcmValue === "number" && Number.isFinite(lcmValue)
          ? lcmValue
          : typeof lcmOverride === "number" && Number.isFinite(lcmOverride)
            ? lcmOverride
            : null;
      if (lcmConst !== null) {
        lcmNodeId = `const_lcm_${safeSpec}`;
        nodes.push({
          id: lcmNodeId,
          kind: "constant",
          params: { value: lcmConst, type: "factor" },
        });
      } else if (lcmPath) {
        // A colon-literal path (`literal:1.10`, spec §4.6) IS the LCM —
        // a constant, never an input read. Anything else (form_input.*)
        // resolves as a per-risk input column. `context.lcm` never
        // reaches a built plan (the ingest builder resolves it to
        // `lcm.value` at build time); if a hand-authored plan carries
        // it, the input node below keeps the refusal loud and named.
        const lcmLiteral = parseColonLiteral(lcmPath);
        if (lcmLiteral !== null) {
          lcmNodeId = `const_lcm_${safeSpec}`;
          nodes.push({
            id: lcmNodeId,
            kind: "constant",
            params: { value: lcmLiteral, type: "factor" },
          });
        } else {
          const lcmField = normalizePath(lcmPath);
          if (lcmField) lcmNodeId = ensureInputNode(lcmField, "factor");
        }
      }

      // ── 4. Exposure-rated tower detection (ADR-0044 D3) ─────────
      // A coverage tower's premium is rate × (exposure ÷ divisor) × LCM
      // with filed-rate roundings (rate→3 dp, premium→nearest $). Activate this
      // mode ONLY when the chainSpec carries a real, resolvable exposure
      // base + a finite divisor > 0. Per-account chains (the IRS-990
      // nonprofit demo — no `exposure_input`) keep the legacy behavior:
      // LCM is a chain factor, no exposure, no rounding. The gate is
      // data-driven + opt-in so every pre-existing plan is byte-stable.
      const rawExposure = spec.exposure_input ?? "";
      let exposureField = normalizePath(rawExposure);
      const divisor = spec.exposure_unit_divisor;
      const exposureOptions = Array.isArray(spec.exposure_options)
        ? spec.exposure_options
        : [];
      // Cold-test (UI-authored Meridian BOP) — a COVERAGE tower (one that carries
      // a `coverage_value`, e.g. building / bpp) is exposure-rated by
      // construction: its premium scales with that coverage's limit ÷ unit.
      // The Assemble tower-builder leaves `exposure_input` as the dead
      // `form_input.exposure` placeholder (there is no `exposure` submission
      // field) and doesn't set `apply_exposure`, so a from-scratch coverage
      // tower silently scored base × factors (~$1) instead of rate × exposure
      // × LCM. Repoint that placeholder to the per-coverage limit input
      // (`<coverage>_limit`) and treat the coverage tower as exposure-rated.
      // Per-account towers (no `coverage_value` — the IRS-990 nonprofit) are
      // untouched: they still require an explicit `apply_exposure`, so every
      // pre-existing per-account plan stays byte-stable.
      const coverageTower =
        typeof spec.coverage_value === "string" && spec.coverage_value !== "";
      if (
        coverageTower &&
        (exposureField === "" || exposureField === "exposure")
      ) {
        exposureField = `${spec.coverage_value}_limit`;
      }
      const hasScalarExposure =
        exposureField !== "" &&
        !rawExposure.startsWith("literal.") &&
        typeof divisor === "number" &&
        Number.isFinite(divisor) &&
        divisor > 0;
      // Scalar exposure applies when explicitly opted in (`apply_exposure`)
      // OR for a coverage tower (exposure-rated by construction, above).
      // `exposure_options` is self-signalling (the Assemble default never
      // emits it), so it triggers exposure mode on its own.
      // A coverage tower is exposure-rated by construction — UNLESS it
      // explicitly opts out with `apply_exposure: false` (e.g. an Meridian BOP
      // LIABILITY tower whose exposure is baked into its base loss-cost table,
      // keyed by exposure base, not scaled by a limit ÷ unit). Without the
      // opt-out, P1 would wrongly scale liability by its (categorical) limit.
      const exposureMode =
        exposureOptions.length > 0 ||
        ((spec.apply_exposure === true ||
          (coverageTower && spec.apply_exposure !== false)) &&
          hasScalarExposure);

      // ── 5. chain.mult (relativities) ───────────────────────────
      // `base` + N `factors` (cardinality N). In per-account mode the
      // LCM rides as the last factor; in exposure mode it is held back
      // for the terminal × LCM (§6) so the rate rounding sees the
      // relativity product alone.
      const chainFactorNodes = [...factorOutNodes];
      const chainFactorNames = [...factorNames];
      if (!exposureMode && lcmNodeId) {
        chainFactorNodes.push({ node: lcmNodeId, port: "value" });
        chainFactorNames.push("LCM");
      }
      const chainId = `chain_${safeSpec}`;
      nodes.push({
        id: chainId,
        kind: "chain.mult",
        params: { factorNames: chainFactorNames, stopOnZero: false },
      });
      edges.push({
        from: { node: baseNodeId, port: "value" },
        to: { node: chainId, port: "base" },
      });
      for (const factorRef of chainFactorNodes) {
        edges.push({
          from: { node: factorRef.node, port: factorRef.port },
          to: { node: chainId, port: "factors" },
        });
      }

      // ── 6. Output (+ exposure / LCM / rounding tail) ────────────
      // The output node's fieldName is exposed in RunResult.outputs
      // keyed by this string. ScoringPreviewPane's pickFirstOutputField
      // walks the plan nodes; using `output_field` (the same string the
      // server-side chain config uses) keeps both surfaces consistent.
      const outField = spec.output_field?.trim() || `${specName}_premium`;
      const outId = `out_${sanitize(outField)}`;
      nodes.push({
        id: outId,
        kind: "output",
        params: { fieldName: outField, fieldType: "money" },
      });

      if (!exposureMode) {
        // Per-account: the chain product IS the premium.
        edges.push({
          from: { node: chainId, port: "result" },
          to: { node: outId, port: "value" },
        });
      } else {
        // Exposure-rated Meridian example, every step a runtime node
        // so the score needs no harness math:
        //   rate3    = round(rate, 3)
        //   exposure = exposure_input ÷ divisor            (math.op div)
        //   premium  = round(rate3 × exposure × LCM, 0)
        const rate3Id = `rate3_${safeSpec}`;
        nodes.push({ id: rate3Id, kind: "round", params: { decimals: 3 } });
        edges.push({
          from: { node: chainId, port: "result" },
          to: { node: rate3Id, port: "value" },
        });

        // exposure value — either a single `exposure_input ÷ divisor`, or
        // (ADR-0044 D9) a class-conditional select over `exposure_options`:
        //   exposure = Σ branch(when ? input ÷ divisor : 0)
        // where exactly one `when` equality holds (e.g. the class's
        // liability exposure base), so the right base÷divisor wins.
        const buildDiv = (
          field: string,
          div: number,
          tag: string,
        ): { node: string; port: string } => {
          // A colon-literal exposure (`literal:250`, spec §4.6 — a fixed
          // exposure base filed as a number, e.g. per-establishment
          // units) is a constant, never an input read: minting an
          // `externalInputs["literal:250"]` node made the engine refuse
          // every risk. The ÷ divisor step stays a runtime node either
          // way, so the trace shows exposure = 250 ÷ 100, not a magic 2.5.
          const literalExposure = parseColonLiteral(field);
          let numeratorId: string;
          if (literalExposure !== null) {
            numeratorId = `expconst_${safeSpec}_${tag}`;
            nodes.push({
              id: numeratorId,
              kind: "constant",
              params: { value: literalExposure, type: "number" },
            });
          } else {
            // An exposure-option branch input is structurally optional: the
            // unselected branch contributes 0, and a MATCHED branch with a
            // missing input still refuses at the engine (NaN → withheld).
            numeratorId = ensureInputNode(field, "number", { optional: true });
          }
          const dConstId = `divisor_${safeSpec}_${tag}`;
          nodes.push({
            id: dConstId,
            kind: "constant",
            params: { value: div, type: "number" },
          });
          const dId = `expdiv_${safeSpec}_${tag}`;
          nodes.push({ id: dId, kind: "math.op", params: { op: "div" } });
          edges.push({ from: { node: numeratorId, port: "value" }, to: { node: dId, port: "x" } });
          edges.push({ from: { node: dConstId, port: "value" }, to: { node: dId, port: "y" } });
          return { node: dId, port: "result" };
        };

        let exposureRef: { node: string; port: string };
        if (exposureOptions.length > 0) {
          const addId = `expsum_${safeSpec}`;
          nodes.push({ id: addId, kind: "chain.add", params: { addendNames: [] } });
          exposureOptions.forEach((opt, oi) => {
            const field = normalizePath(opt.input ?? "") || opt.input || "";
            const div = typeof opt.divisor === "number" && opt.divisor > 0 ? opt.divisor : 1;
            if (!field) return;
            const divRef = buildDiv(field, div, `o${oi}`);
            // match = lookup.direct(when.path, { [when.equals]: 1 }, 0) → 1/0.
            const whenPath = normalizePath(opt.when?.path ?? "") || opt.when?.path || "";
            const equalsKey =
              opt.when?.equals === undefined ? "" : String(opt.when.equals);
            // The `when` axis is often a DERIVED dim (Meridian BOP's liab_exposure_base
            // is derived from class_code) — resolve it through the SAME key
            // resolver the lookups use, so the class-conditional exposure
            // (loi/sales/payroll) selects correctly from the RAW submission
            // (class_code) without pre-injecting the derived value. A plain input
            // is absent on the raw-CSV flow → no option matched → the chain
            // scored with NO exposure (e.g. liability → 0). Bug #4 close-out.
            const matchRef = resolveAxisKeyRef(
              whenPath || `opt_${oi}`,
              undefined,
              `expwhen_${safeSpec}_o${oi}`,
            );
            const matchId = `expmatch_${safeSpec}_o${oi}`;
            nodes.push({
              id: matchId,
              kind: "lookup.direct",
              params: { table: { [equalsKey]: 1 }, defaultValue: 0, tableName: `exposure when ${whenPath}=${equalsKey}` },
            });
            edges.push({ from: matchRef, to: { node: matchId, port: "key" } });
            // term = branch(match ? input÷divisor : 0).
            const zeroId = `expzero_${safeSpec}_o${oi}`;
            nodes.push({ id: zeroId, kind: "constant", params: { value: 0, type: "number" } });
            const brId = `expbranch_${safeSpec}_o${oi}`;
            nodes.push({ id: brId, kind: "branch", params: {} });
            edges.push({ from: { node: matchId, port: "value" }, to: { node: brId, port: "predicate" } });
            edges.push({ from: divRef, to: { node: brId, port: "then" } });
            edges.push({ from: { node: zeroId, port: "value" }, to: { node: brId, port: "else" } });
            edges.push({ from: { node: brId, port: "result" }, to: { node: addId, port: "addends" } });
          });
          exposureRef = { node: addId, port: "result" };
        } else {
          exposureRef = buildDiv(exposureField, divisor as number, "x");
        }

        // s1 = rate3 × exposure
        const mulExpId = `mulexp_${safeSpec}`;
        nodes.push({ id: mulExpId, kind: "math.op", params: { op: "mul" } });
        edges.push({
          from: { node: rate3Id, port: "value" },
          to: { node: mulExpId, port: "x" },
        });
        edges.push({
          from: exposureRef,
          to: { node: mulExpId, port: "y" },
        });

        // s2 = s1 × LCM (when an LCM source exists)
        let scaledTip: { node: string; port: string } = {
          node: mulExpId,
          port: "result",
        };
        if (lcmNodeId) {
          const mulLcmId = `mullcm_${safeSpec}`;
          nodes.push({ id: mulLcmId, kind: "math.op", params: { op: "mul" } });
          edges.push({ from: scaledTip, to: { node: mulLcmId, port: "x" } });
          edges.push({
            from: { node: lcmNodeId, port: "value" },
            to: { node: mulLcmId, port: "y" },
          });
          scaledTip = { node: mulLcmId, port: "result" };
        }

        // premium = round(s2, 0)
        const premId = `prem_${safeSpec}`;
        nodes.push({ id: premId, kind: "round", params: { decimals: 0 } });
        edges.push({ from: scaledTip, to: { node: premId, port: "value" } });

        // ── 7. Coverage election (Brief 95 C4, spec §4.1 `?`) ──────
        // Every exposure-rated tower gets the election head, wired
        // from the RESOLVED exposure (post ÷/Σ — 0 stays 0, absence
        // stays NaN): an EXPLICIT 0 elects an electable tower out and
        // REFUSES on a required one (`zero_exposure_required` — zero
        // is not an elect-out, §12.4). Absence is never an election:
        // the node passes it through and the tower withholds as ever.
        const electId = `elect_${safeSpec}`;
        nodes.push({
          id: electId,
          kind: "coverage.election",
          params: {
            coverage: spec.coverage_value || specName,
            elective: spec.elective === true,
          },
        });
        edges.push({
          from: exposureRef,
          to: { node: electId, port: "exposure" },
        });

        if (spec.elective === true) {
          // Gate the tower's OWN nodes on the election so an
          // elected-out tower's lookups never execute (a tenant risk
          // legitimately omits the building axis inputs — the lookups
          // would refuse). Never gate: shared `input` nodes, the
          // election's own upstream (the exposure subgraph — a guard
          // there would cycle), or the output that must resolve $0.
          const electAncestors = new Set<string>();
          {
            const queue = [electId];
            while (queue.length) {
              const id = queue.pop()!;
              for (const e of edges) {
                if (e.to.node !== id) continue;
                if (!electAncestors.has(e.from.node)) {
                  electAncestors.add(e.from.node);
                  queue.push(e.from.node);
                }
              }
            }
          }
          for (const n of nodes.slice(towerNodesStart)) {
            if (n.id === electId) continue;
            if (n.kind === "input" || n.kind === "output") continue;
            if (electAncestors.has(n.id)) continue;
            edges.push({
              from: { node: electId, port: "elected" },
              to: { node: n.id, port: GUARD_PORT },
            });
          }
          // premium = branch(elected_out ? $0 : prem) — the $0 is a
          // REAL resolved number, so the tower total sums instead of
          // withholding; the election node's trace line says why.
          const elZeroId = `elzero_${safeSpec}`;
          nodes.push({
            id: elZeroId,
            kind: "constant",
            params: { value: 0, type: "money" },
          });
          const elBranchId = `elbranch_${safeSpec}`;
          nodes.push({ id: elBranchId, kind: "branch", params: {} });
          edges.push({
            from: { node: electId, port: "elected_out" },
            to: { node: elBranchId, port: "predicate" },
          });
          edges.push({
            from: { node: elZeroId, port: "value" },
            to: { node: elBranchId, port: "then" },
          });
          edges.push({
            from: { node: premId, port: "value" },
            to: { node: elBranchId, port: "else" },
          });
          edges.push({
            from: { node: elBranchId, port: "result" },
            to: { node: outId, port: "value" },
          });
        } else {
          edges.push({
            from: { node: premId, port: "value" },
            to: { node: outId, port: "value" },
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase H.3.1 — modifier.schedule layering (Brief 42 §−1 Q1 + Q2 + Q7)
  // ═══════════════════════════════════════════════════════════════════
  //
  // After every chain has wired its output, walk the modifier.schedule
  // stages in their authored sequence and insert each one as a layer
  // between the chain's premium tip and the output node.
  //
  // Per Brief 42 §−1 Q1, the cascade is FIXED:
  //   eligibility.gate → multiplicative_chain → modifier.schedule →
  //   modifier.model → endorsement.* → endorsement.rate_branch → out
  //
  // The chain emission above has already wired `chainId.result →
  // outNode.value`. Each modifier insert rewrites this so the cascade
  // runs through chain.mult between the current premium tip + the
  // modifier's `factor` output.
  //
  // For multi-coverage plans (the nonprofit_990 case with D&O + GL),
  // `scope: "per_coverage"` (Brief 42 §−1 Q7 default) applies the
  // modifier INDEPENDENTLY to each coverage's tip. `scope: "package"`
  // applies to the SUM — which, for the kind's purely multiplicative
  // factor, is byte-identical to the per-tip application (finding E9:
  // distributivity makes per-tip THE exact pro-rata projection of one
  // package application; see the scope note at the tip loop below).
  //
  // The per-risk application data arrives via `ctx.externalInputs[
  // "schedule_app_{schedule_id}"]`. The user's CSV/webhook must
  // include that column. Per Brief 42 §−1 Q2 a future migration may
  // promote this to a nested `schedule_applications` map.
  //
  // The optional `tier` port on modifier.schedule is left UNWIRED in
  // v1. When unwired, no tier filtering applies (all categories
  // evaluate). Wiring the eligibility.gate's tier output to every
  // modifier's tier port is Phase H.3.3 work.
  for (const stage of stages) {
    if (stage.stage_kind !== "modifier.schedule") continue;
    const cfg = asObject(stage.config_json) ?? {};
    const schedule = (cfg as { schedule?: Record<string, unknown> }).schedule;
    if (!schedule || typeof schedule !== "object") continue;
    const scheduleId =
      ((schedule as Record<string, unknown>).schedule_id as string) ??
      stage.stage_id;
    const scope =
      ((schedule as Record<string, unknown>).scope as string) ??
      "per_coverage";

    // Emit the modifier.schedule node carrying the filed structure.
    const modId = `mod_${sanitize(stage.stage_id)}`;
    nodes.push({
      id: modId,
      kind: "modifier.schedule",
      params: { schedule } as unknown as Record<string, unknown>,
    });

    // Wire the per-risk application input. The fieldName mirrors the
    // schedule_id so each modifier reads its own column from the
    // externalInputs envelope.
    const appField = `schedule_app_${sanitize(scheduleId)}`;
    // D-F (Brief 83) — an absent schedule application is NEUTRAL (1.0),
    // so quotes without IRPM rate honestly; never a "missing input".
    const appInputId = ensureInputNode(appField, "money", { optional: true });
    edges.push({
      from: { node: appInputId, port: "value" },
      to: { node: modId, port: "application" },
    });

    // ── Phase H.3.3 — tier wiring ──────────────────────────────────
    //
    // When an eligibility.gate stage exists upstream, wire its `tier`
    // port to this modifier's optional `tier` input so tier-conditional
    // categories can filter (Brief 15 P-M9). Multi-gate plans are
    // out-of-scope for v1 — we wire the first gate's tier and log a
    // warning when more than one gate exists. Brief 42 §−1 Q9 lays out
    // most-severe-wins for tier resolution; v2 work introduces a
    // dedicated tier-merger node that this modifier wiring would read
    // from instead.
    const gateNodes = nodes.filter((n) => n.kind === "eligibility.gate");
    const firstGate = gateNodes[0];
    if (firstGate !== undefined) {
      if (gateNodes.length > 1) {
        issues.push({
          severity: "warning",
          code: "multi_gate_tier_first_wins",
          message: `Stage \`${stage.stage_id}\` filters by tier, but ${gateNodes.length} eligibility gates exist — only the FIRST gate's tier (\`${firstGate.id}\`) feeds the schedule's tier filter.`,
          stageId: stage.stage_id,
          nodeId: firstGate.id,
        });
        // eslint-disable-next-line no-console
        console.warn(
          `[stagesToRuntimePlan] ${gateNodes.length} eligibility.gate nodes exist; wiring tier from the first one ("${firstGate.id}"). Multi-gate tier merging is pending Brief 42 §−1 Q9 follow-up.`,
        );
      }
      edges.push({
        from: { node: firstGate.id, port: "tier" },
        to: { node: modId, port: "tier" },
      });
    }

    // Find every tip edge — the edges currently wiring into an output
    // node's `value` port. Each tip becomes the base of a fresh
    // chain.mult that multiplies the existing premium by the
    // modifier's factor.
    const outputIds = new Set(
      nodes.filter((n) => n.kind === "output").map((n) => n.id),
    );
    const tipEdges = edges.filter(
      (e) => outputIds.has(e.to.node) && e.to.port === "value",
    );

    // Platform-test finding E9 (Brief 42 §−1 Q7 resolved) — `scope:
    // "package"` on a multi-coverage plan projects EXACTLY via the
    // per-tip application: `modifier.schedule`'s ONLY output is a
    // single multiplicative `factor` (the kind's contract — factor =
    // 1 + Σpct/100, no additive mode), so
    //   (Σ coverageᵢ) × factor  ≡  Σ (coverageᵢ × factor)
    // — multiplying each coverage tip IS the pro-rata split of one
    // package application, to the byte. The old `package_scope_
    // fallback` warning claimed a degradation ("isn't projected yet")
    // where none exists; it is gone. The application nodes carry the
    // scope in their trace label so the audit reads the FILED
    // application ("package · pro-rata"), and the identity is pinned
    // by a projector test. If the kind ever grows a non-multiplicative
    // mode, the identity breaks and package needs a real sum→apply
    // graph — the pinning test is the tripwire.
    const applicationLabel =
      scope === "package" && tipEdges.length > 1
        ? "mod_factor (package · pro-rata)"
        : "mod_factor";

    for (const tip of tipEdges) {
      const outNodeId = tip.to.node;
      const multId = `mod_apply_${sanitize(stage.stage_id)}_${sanitize(outNodeId)}`;
      nodes.push({
        id: multId,
        kind: "chain.mult",
        params: { factorNames: [applicationLabel], stopOnZero: false },
      });
      // Original tip source becomes the chain.mult's base.
      edges.push({
        from: tip.from,
        to: { node: multId, port: "base" },
      });
      // Modifier's factor wires in as the single factor input.
      edges.push({
        from: { node: modId, port: "factor" },
        to: { node: multId, port: "factors" },
      });
      // Rewrite the tip's source to point at the new chain.mult result.
      // (In-place mutation is intentional — `tip` is a reference into
      // the `edges` array.)
      tip.from = { node: multId, port: "result" };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase H.7 — modifier.model layering (Brief 42 §−1 Q1 + Q6)
  // ═══════════════════════════════════════════════════════════════════
  //
  // Per Brief 42 §−1 Q1, modifier.model runs AFTER modifier.schedule
  // and BEFORE endorsement.*. Like endorsement.factor it's an inline
  // transformer with `premium` → `premium_out` ports — the kind's
  // execute applies `factor_used` internally (clamped model output OR
  // fallback factor, per Brief 41 §−1 Q4-Q7).
  //
  // The projector also emits 3 ancillary output nodes — factor_used /
  // fallback_fired / fallback_reason — so the actuary sees the 3-line
  // trace contract in the score CSV.
  for (const stage of stages) {
    if (stage.stage_kind !== "modifier.model") continue;
    const cfg = asObject(stage.config_json) ?? {};

    const modelId =
      ((cfg.model_id as string) ?? "").toString() || "untitled_model";
    const version = ((cfg.version as string) ?? "").toString() || "0.0.1";
    const declared = Array.isArray(cfg.declared_inputs)
      ? cfg.declared_inputs
      : [];
    const clampObj =
      (cfg.clamp && typeof cfg.clamp === "object"
        ? (cfg.clamp as Record<string, unknown>)
        : null) ?? { min_factor: 0.85, max_factor: 1.25 };
    const fallback =
      typeof cfg.fallback_factor === "number" &&
      Number.isFinite(cfg.fallback_factor)
        ? cfg.fallback_factor
        : 1.0;
    const rationale = ((cfg.rationale as string) ?? "").toString();

    const modelParams = {
      model_id: modelId,
      version,
      declared_inputs: declared,
      clamp: clampObj,
      rationale: rationale || "Filed cap pending.",
      fallback_factor: fallback,
    };

    // Find tip edges + reroute through the model. Same in-place
    // mutation pattern as modifier.schedule / endorsement.*.
    const outputIdsModel = new Set(
      nodes.filter((n) => n.kind === "output").map((n) => n.id),
    );
    const tipEdgesModel = edges.filter(
      (e) => outputIdsModel.has(e.to.node) && e.to.port === "value",
    );

    if (tipEdgesModel.length === 0) {
      issues.push({
        severity: "warning",
        code: "orphan_stage",
        message: `Model modifier \`${modelId}\` (stage \`${stage.stage_id}\`) has no rating chain to attach to — it is skipped and prices nothing.`,
        stageId: stage.stage_id,
        ref: { stageKind: stage.stage_kind },
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[stagesToRuntimePlan] modifier.model "${modelId}" has no chain tip to attach to; skipping.`,
      );
      continue;
    }

    // 92.5 live finding — one shared node across N tips fed every tip
    // from a single `premium` port. The model factor is multiplicative
    // (clamped factor_used), so per-tip INSTANCES are the exact
    // package application — same shape as modifier.schedule.
    let modId = "";
    for (const tip of tipEdgesModel) {
      const instanceId =
        tipEdgesModel.length === 1
          ? `mod_model_${sanitize(stage.stage_id)}`
          : `mod_model_${sanitize(stage.stage_id)}_${sanitize(tip.to.node)}`;
      nodes.push({ id: instanceId, kind: "modifier.model", params: modelParams });
      if (modId === "") modId = instanceId;
      edges.push({
        from: tip.from,
        to: { node: instanceId, port: "premium" },
      });
      tip.from = { node: instanceId, port: "premium_out" };
    }

    // Surface the 3-line trace contract as score CSV columns.
    const factorOutId = `out_${sanitize(stage.stage_id)}_factor_used`;
    nodes.push({
      id: factorOutId,
      kind: "output",
      params: { fieldName: `${sanitize(modelId)}_factor_used`, fieldType: "number" },
    });
    edges.push({
      from: { node: modId, port: "factor_used" },
      to: { node: factorOutId, port: "value" },
    });

    const firedOutId = `out_${sanitize(stage.stage_id)}_fallback_fired`;
    nodes.push({
      id: firedOutId,
      kind: "output",
      params: { fieldName: `${sanitize(modelId)}_fallback_fired`, fieldType: "boolean" },
    });
    edges.push({
      from: { node: modId, port: "fallback_fired" },
      to: { node: firedOutId, port: "value" },
    });

    const reasonOutId = `out_${sanitize(stage.stage_id)}_fallback_reason`;
    nodes.push({
      id: reasonOutId,
      kind: "output",
      params: { fieldName: `${sanitize(modelId)}_fallback_reason`, fieldType: "string" },
    });
    edges.push({
      from: { node: modId, port: "fallback_reason" },
      to: { node: reasonOutId, port: "value" },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase H.3.2 — endorsement.{factor,additive,sublimit} layering
  // (Brief 42 §−1 Q1 + Q3)
  // ═══════════════════════════════════════════════════════════════════
  //
  // After modifier.schedule, endorsements run in AUTHORED ORDER (Brief
  // 42 §−1 Q3). Each endorsement is an inline transformer with a
  // `premium` input + `premium_out` output. The pattern:
  //
  //   chain_tip → endorsement.premium → endorsement.premium_out → ...
  //
  // For multi-coverage plans, each endorsement applies INDEPENDENTLY
  // to every coverage's tip (mirrors modifier.schedule's per_coverage
  // default — Brief 42 §−1 Q7). Targeted per-coverage endorsement
  // scope is a v2 concern; for now an authored endorsement is
  // assumed to apply to the whole policy's chain tips.
  //
  // endorsement.sublimit is a SIDE-EFFECT kind: premium passes through
  // unchanged, but it emits a `sublimit_out` record onto a fresh
  // output node so the Inputs preview can surface the metadata. The
  // sublimit output is keyed by the configured `coverage` so multiple
  // sublimits don't collide.
  //
  // endorsement.rate_branch (the additive-branch kind from Brief 40)
  // is ALSO handled here as of Phase H.4. The runtime BlockKind lives
  // in @openrater/contracts; the projector wires it inline like the other
  // three endorsement kinds (premium → premium_out cascade) but with
  // an extra `contribution` output that surfaces the branch's
  // additive contribution as a separate column in the score CSV.
  for (const stage of stages) {
    const kind = stage.stage_kind;
    const isEndorsement =
      kind === "endorsement.factor" ||
      kind === "endorsement.additive" ||
      kind === "endorsement.sublimit" ||
      kind === "endorsement.rate_branch";
    if (!isEndorsement) continue;

    const cfg = asObject(stage.config_json) ?? {};
    const formNumber = ((cfg.form_number as string) ?? "").toString();
    const displayName =
      ((cfg.display_name as string) ?? formNumber).toString() || "Endorsement";
    // The trigger is passed through unchanged — the endorsement kinds
    // re-validate. When the authoring layer omitted a trigger, treat
    // it as "always attach" (null per the EndorsementTrigger contract).
    const trigger =
      cfg.trigger && typeof cfg.trigger === "object" ? cfg.trigger : null;

    // Build kind-specific params. Each endorsement kind's contract
    // is enforced at runtime; here we project the authored shape
    // verbatim plus sensible defaults for missing values.
    let params: Record<string, unknown>;
    if (kind === "endorsement.factor") {
      const factor =
        typeof cfg.factor === "number" && Number.isFinite(cfg.factor)
          ? cfg.factor
          : 1;
      params = {
        form_number: formNumber,
        display_name: displayName,
        trigger,
        factor,
      };
    } else if (kind === "endorsement.additive") {
      const amount =
        typeof cfg.amount === "number" && Number.isFinite(cfg.amount)
          ? cfg.amount
          : 0;
      params = {
        form_number: formNumber,
        display_name: displayName,
        trigger,
        amount,
      };
    } else if (kind === "endorsement.sublimit") {
      const coverage = ((cfg.coverage as string) ?? "").toString();
      const sublimit =
        typeof cfg.sublimit === "number" && Number.isFinite(cfg.sublimit)
          ? cfg.sublimit
          : 0;
      params = {
        form_number: formNumber,
        display_name: displayName,
        trigger,
        coverage,
        sublimit,
      };
    } else {
      // endorsement.rate_branch — branch_chain is passed through verbatim;
      // the runtime kind validates the shape. Defensive defaults keep a
      // partially-authored stage from crashing the projector.
      const rawBranch = (cfg as { branch_chain?: unknown }).branch_chain;
      const branchChain =
        rawBranch && typeof rawBranch === "object"
          ? rawBranch
          : {
              name: "untitled_branch",
              base_input: "",
              factor_lookups: [],
              lcm: { factor_kind: "lcm", input_path: "" },
              exposure_input: "",
              exposure_unit_divisor: 1,
              output_field: "branch_premium",
            };
      params = {
        form_number: formNumber,
        display_name: displayName,
        trigger,
        branch_chain: branchChain,
      };
    }

    // Find every tip edge — same pattern as modifier.schedule.
    const outputIds = new Set(
      nodes.filter((n) => n.kind === "output").map((n) => n.id),
    );
    const tipEdges = edges.filter(
      (e) => outputIds.has(e.to.node) && e.to.port === "value",
    );

    if (tipEdges.length === 0) {
      // Defensive: no tip means no chain emitted upstream. ADR-0056 —
      // the skip is structured, not quiet.
      issues.push({
        severity: "warning",
        code: "orphan_stage",
        message: `Endorsement \`${stage.stage_id}\` (${kind}) has no rating chain to attach to — it is skipped and prices nothing.`,
        stageId: stage.stage_id,
        ref: { stageKind: kind },
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[stagesToRuntimePlan] endorsement "${stage.stage_id}" (${kind}) has no chain tip to attach to; skipping.`,
      );
      continue;
    }

    // 92.5 live finding — ONE endorsement node wired across N tips fed
    // every tip from a single shared `premium` port (the first tower's
    // premium replaced every coverage's). Per-tip application (what the
    // header comment always promised, and what modifier.schedule does):
    //   · factor / sublimit — one endorsement-node INSTANCE per tip;
    //     the multiplicative factor is distributive, so per-tip IS the
    //     exact package application; sublimit passes premium through.
    //   · additive / rate_branch — the filed amount applies ONCE PER
    //     POLICY; on a multi-tower plan there is no honest single tip
    //     to attach it to, so wiring is SKIPPED with a structured error
    //     (never a silent N× application, never the shared-node
    //     corruption). Package-level endorsement layering is the fix's
    //     follow-up home.
    const addsOncePerPolicy =
      kind === "endorsement.additive" || kind === "endorsement.rate_branch";
    if (addsOncePerPolicy && tipEdges.length > 1) {
      issues.push({
        severity: "error",
        code: "endorsement_additive_multi_tower",
        message: `Endorsement \`${stage.stage_id}\` (${kind}) adds a once-per-policy amount, but this plan has ${tipEdges.length} coverage towers — there is no single tip to attach it to, so it is NOT applied. Author it per coverage, or wait for package-level endorsement layering.`,
        stageId: stage.stage_id,
        ref: { stageKind: kind },
      });
      continue;
    }

    let firstEndId: string | null = null;
    for (const tip of tipEdges) {
      const endId =
        tipEdges.length === 1
          ? `end_${sanitize(stage.stage_id)}`
          : `end_${sanitize(stage.stage_id)}_${sanitize(tip.to.node)}`;
      nodes.push({ id: endId, kind, params });
      if (firstEndId === null) firstEndId = endId;
      // Original source → endorsement.premium
      edges.push({
        from: tip.from,
        to: { node: endId, port: "premium" },
      });
      // Rewrite tip: endorsement.premium_out → output.value
      tip.from = { node: endId, port: "premium_out" };
    }
    const endId = firstEndId!;

    // endorsement.sublimit emits an extra output for the sublimit
    // metadata. Keyed by coverage so multiple sublimits don't collide.
    // Note: when multiple tips exist, we wire from ONE endorsement
    // node (each tip's coverage gets the same sublimit metadata,
    // mirroring the V20 contract). Per-coverage targeted sublimits
    // are an authoring-side concern (the user would author multiple
    // endorsement.sublimit stages with different triggers).
    if (kind === "endorsement.sublimit") {
      const coverage = ((cfg.coverage as string) ?? "unknown").toString();
      const fieldName = `sublimit_${sanitize(coverage)}`;
      const sublimitOutId = `out_${sanitize(stage.stage_id)}_sublimit`;
      nodes.push({
        id: sublimitOutId,
        kind: "output",
        params: { fieldName, fieldType: "record" },
      });
      edges.push({
        from: { node: endId, port: "sublimit_out" },
        to: { node: sublimitOutId, port: "value" },
      });
    }

    // endorsement.rate_branch surfaces its `contribution` output so the
    // score CSV has a separate column for the branch's additive
    // contribution. Brief 40 §−1 Q3 — the user wants to see "how much
    // did this endorsement add" without doing column math.
    if (kind === "endorsement.rate_branch") {
      const branchName =
        (cfg as { branch_chain?: { name?: string } }).branch_chain?.name ??
        stage.stage_id;
      const fieldName = `${sanitize(branchName)}_contribution`;
      const contribOutId = `out_${sanitize(stage.stage_id)}_contribution`;
      nodes.push({
        id: contribOutId,
        kind: "output",
        params: { fieldName, fieldType: "number" },
      });
      edges.push({
        from: { node: endId, port: "contribution" },
        to: { node: contribOutId, port: "value" },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // G6-full — flat_factor (loadings) + clamp (caps/floors) PRICE
  // ═══════════════════════════════════════════════════════════════════
  //
  // Both kinds are authorable from the live UI and were silently
  // dropped (v4 G6: a ×2.0 loading and a $1M cap changed no premium,
  // proven). Each stage's `input_path` references a chain output
  // ("chain.<field>" — the fixture convention; a bare field name also
  // resolves). The pass rewires that output's tip:
  //
  //   flat_factor → tip × factor      (predicate-gated like any factor)
  //   clamp       → min(max, max(min, tip))
  //
  // TWO sweeps: per-coverage targets apply BEFORE the round pass so
  // the plan total sums LOADED/CLAMPED tips; a stage targeting the
  // round's own aggregate output can only resolve AFTER it exists —
  // the post-round sweep below catches those. Anything still
  // unresolved is a structured issue (ADR-0056), never a silent no-op.
  // Both authored path shapes resolve: `chain.<field>` (the round
  // stage's convention) and `stages.<stage_id>.<output_field>` (the
  // drawer-predecessor convention) — outputs are keyed by field, so
  // the terminal segment is the join key either way.
  const outputFieldOfPath = (p: unknown): string => {
    if (typeof p !== "string") return "";
    const t = p.trim();
    if (t.startsWith("chain.")) return t.slice("chain.".length);
    if (t.startsWith("stages.")) {
      const segs = t.split(".");
      return segs[segs.length - 1] ?? "";
    }
    return t;
  };
  const moneyTipOf = (field: string): PlanEdge | null => {
    const out = nodes.find(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldName?: string })?.fieldName === field,
    );
    if (!out) return null;
    return (
      edges.find((e) => e.to.node === out.id && e.to.port === "value") ?? null
    );
  };
  type SidecarOutcome = "applied" | "unresolved" | "unsupported";
  const applySidecarStage = (stage: StageLike): SidecarOutcome => {
    const cfg = asObject(stage.config_json) ?? {};
    if (stage.stage_kind === "flat_factor") {
      const factor =
        typeof cfg.factor === "number" && Number.isFinite(cfg.factor)
          ? cfg.factor
          : null;
      if (factor === null) return "unsupported";
      const unit = (cfg.factor_unit as string) ?? "multiplier";
      if (unit !== "multiplier") return "unsupported";
      const rawPaths = Array.isArray(cfg.input_paths)
        ? cfg.input_paths
        : [cfg.input_path];
      const fields = rawPaths
        .map(outputFieldOfPath)
        .filter((f): f is string => f !== "");
      if (fields.length === 0) return "unsupported";
      const tips = fields.map(moneyTipOf);
      // All-or-nothing per stage: applying to a subset would price the
      // loading differently than authored.
      if (tips.some((t) => t === null)) return "unresolved";
      tips.forEach((tip, i) => {
        const tag = `${sanitize(stage.stage_id)}_${sanitize(fields[i]!)}`;
        const constId = `flatv_${tag}`;
        nodes.push({
          id: constId,
          kind: "constant",
          params: { value: factor, type: "factor" },
        });
        let facRef: { node: string; port: string } = {
          node: constId,
          port: "value",
        };
        const p = cfg.predicate as
          | { path?: string; equals?: boolean | number | string }
          | null
          | undefined;
        if (p && typeof p.path === "string" && p.path.length > 0) {
          const built = buildPredicateRef(p, `flat_${tag}`);
          if (built) {
            facRef = gateFactorRef(
              facRef,
              built.ref,
              built.factorOnTrue,
              `flat_${tag}`,
            );
          }
        }
        const multId = `flat_${tag}`;
        nodes.push({
          id: multId,
          kind: "chain.mult",
          params: {
            factorNames: [String(cfg.factor_kind ?? "loading")],
            stopOnZero: false,
          },
        });
        edges.push({ from: tip!.from, to: { node: multId, port: "base" } });
        edges.push({ from: facRef, to: { node: multId, port: "factors" } });
        tip!.from = { node: multId, port: "result" };
      });
      return "applied";
    }
    // clamp — the simple min/max form projects; the legacy variants
    // (max_pct_of_input / apply_as_multiplier / subtotal_input) stay
    // un-priced and surface as issues.
    const min =
      typeof cfg.min_value === "number" && Number.isFinite(cfg.min_value)
        ? cfg.min_value
        : null;
    const max =
      typeof cfg.max_value === "number" && Number.isFinite(cfg.max_value)
        ? cfg.max_value
        : null;
    const unsupported =
      (typeof cfg.max_pct_of_input === "string" &&
        cfg.max_pct_of_input !== "") ||
      cfg.apply_as_multiplier === true ||
      (typeof cfg.subtotal_input === "string" && cfg.subtotal_input !== "");
    if (unsupported || (min === null && max === null)) return "unsupported";
    const field = outputFieldOfPath(cfg.input_path);
    if (field === "") return "unsupported";
    const tip = moneyTipOf(field);
    if (!tip) return "unresolved";
    const tag = sanitize(stage.stage_id);
    let src = tip.from;
    if (min !== null) {
      const cId = `clampminv_${tag}`;
      nodes.push({
        id: cId,
        kind: "constant",
        params: { value: min, type: "money" },
      });
      const mId = `clampmin_${tag}`;
      nodes.push({ id: mId, kind: "math.op", params: { op: "max" } });
      edges.push({ from: src, to: { node: mId, port: "x" } });
      edges.push({
        from: { node: cId, port: "value" },
        to: { node: mId, port: "y" },
      });
      src = { node: mId, port: "result" };
    }
    if (max !== null) {
      const cId = `clampmaxv_${tag}`;
      nodes.push({
        id: cId,
        kind: "constant",
        params: { value: max, type: "money" },
      });
      const mId = `clampmax_${tag}`;
      nodes.push({ id: mId, kind: "math.op", params: { op: "min" } });
      edges.push({ from: src, to: { node: mId, port: "x" } });
      edges.push({
        from: { node: cId, port: "value" },
        to: { node: mId, port: "y" },
      });
      src = { node: mId, port: "result" };
    }
    tip.from = src;
    return "applied";
  };
  const sidecarOutcomes = new Map<string, SidecarOutcome>();
  for (const stage of stages) {
    if (stage.stage_kind !== "flat_factor" && stage.stage_kind !== "clamp") {
      continue;
    }
    sidecarOutcomes.set(stage.stage_id, applySidecarStage(stage));
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADR-0044 D8 — `round` plan-tail stage (final_adjustments)
  // ═══════════════════════════════════════════════════════════════════
  //
  // The filed tail sums the per-coverage premiums, floors the total at
  // the minimum premium ($500 KS), then rounds to the nearest dollar.
  // The backend persists this as a `round` stage:
  //   { input_path: "chain.total_premium",
  //     min_value_input: "literal:500", increment_input: "literal:1" }
  // We sum the money-typed coverage outputs (their producers), apply
  // max(total, min) and round, and emit a `total_premium` output —
  // every step a runtime node so a single-risk plan total is exact.
  //
  // POLICY-level schedule rating / first-term credit / cross-line
  // minimum-premium are NOT
  // applied here — those live in composePolicy (Brief 62). This is the
  // PLAN total only; for a single plan it is the score, and as one line
  // of a multi-line policy composePolicy's floor governs above it.
  const parseLiteralNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      // "literal:500" (canonical, what the Sample BOP fixture ships)
      // or a bare "500" (what an actuary types into the round drawer).
      // form_input.* paths stay null — the projector has no form-input
      // channel yet, so the floor honestly doesn't apply.
      const m = v.trim().match(/^(?:literal:)?(-?\d+(?:\.\d+)?)$/);
      if (m) return parseFloat(m[1]!);
    }
    return null;
  };
  for (const stage of stages) {
    if (stage.stage_kind !== "round") continue;
    const cfg = asObject(stage.config_json) ?? {};
    const minValue = parseLiteralNum(cfg.min_value_input);
    const increment = parseLiteralNum(cfg.increment_input) ?? 1;
    const decimals =
      increment >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(increment)));

    // Sum the producers of every money-typed coverage premium output.
    const moneyOutputs = nodes.filter(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldType?: string })?.fieldType === "money",
    );
    const sources: Array<{ node: string; port: string }> = [];
    for (const o of moneyOutputs) {
      const tip = edges.find(
        (e) => e.to.node === o.id && e.to.port === "value",
      );
      if (tip) sources.push(tip.from);
    }
    if (sources.length === 0) continue;

    const sumId = `total_sum_${sanitize(stage.stage_id)}`;
    nodes.push({ id: sumId, kind: "chain.add", params: { addendNames: [] } });
    for (const s of sources) {
      edges.push({ from: s, to: { node: sumId, port: "addends" } });
    }
    let tip: { node: string; port: string } = { node: sumId, port: "result" };

    // literal:0 (or a negative) is the persisted "no floor" — the
    // authoring layer writes it because RoundConfig requires the field.
    // G9 — under policy scope the floor is NOT applied per row: the
    // caller floors ONCE per policy, post-IRPM (a per-row floor made a
    // 3-location policy pay 3× the filed minimum).
    if (
      minValue !== null &&
      minValue > 0 &&
      options?.minPremiumScope !== "policy"
    ) {
      const minConstId = `total_min_${sanitize(stage.stage_id)}`;
      nodes.push({
        id: minConstId,
        kind: "constant",
        params: { value: minValue, type: "money" },
      });
      const maxId = `total_max_${sanitize(stage.stage_id)}`;
      nodes.push({ id: maxId, kind: "math.op", params: { op: "max" } });
      edges.push({ from: tip, to: { node: maxId, port: "x" } });
      edges.push({
        from: { node: minConstId, port: "value" },
        to: { node: maxId, port: "y" },
      });
      tip = { node: maxId, port: "result" };
    }

    const roundId = `total_round_${sanitize(stage.stage_id)}`;
    nodes.push({ id: roundId, kind: "round", params: { decimals } });
    edges.push({ from: tip, to: { node: roundId, port: "value" } });

    const totalField =
      ((cfg.output_field as string) ?? "").trim() || "total_premium";
    const totalOutId = `out_${sanitize(totalField)}`;
    nodes.push({
      id: totalOutId,
      kind: "output",
      params: { fieldName: totalField, fieldType: "money" },
    });
    edges.push({
      from: { node: roundId, port: "value" },
      to: { node: totalOutId, port: "value" },
    });
  }

  // G6-full — post-round sweep: a flat_factor/clamp targeting the
  // round's aggregate output (e.g. "chain.total_premium") can only
  // attach now that the total exists. Anything STILL unapplied is a
  // structured issue (ADR-0056) — the pre-G6 silent no-op is dead.
  for (const stage of stages) {
    if (stage.stage_kind !== "flat_factor" && stage.stage_kind !== "clamp") {
      continue;
    }
    let outcome = sidecarOutcomes.get(stage.stage_id) ?? "unresolved";
    if (outcome === "unresolved") {
      outcome = applySidecarStage(stage);
      sidecarOutcomes.set(stage.stage_id, outcome);
    }
    if (outcome === "applied") continue;
    const cfg = asObject(stage.config_json) ?? {};
    issues.push({
      severity: "error",
      code: "orphan_stage",
      message:
        outcome === "unresolved"
          ? `Stage \`${stage.stage_id}\` (${stage.stage_kind}) targets \`${String(cfg.input_path ?? (Array.isArray(cfg.input_paths) ? cfg.input_paths.join(", ") : "?"))}\`, which matches no priced output — it prices nothing.`
          : `Stage \`${stage.stage_id}\` (${stage.stage_kind}) uses a configuration variant the projector does not price (pct-of-input / multiplier-mode / subtotal clamp, or no finite value) — it prices nothing.`,
      stageId: stage.stage_id,
      ref: { stageKind: stage.stage_kind },
    });
  }

  const plan = {
    id: options?.planId ?? "rate-lab.runtime-plan",
    version: "0.1.0",
    name: options?.planName ?? "Runtime plan (projected)",
    // No `line` metadata — the product axis lives on the persisted plan
    // (`product: ProductCode`, ADR-0033), never on the projected runtime
    // Plan, and the engine never reads it. Emitting a "bop" default here
    // would be a product literal in the projector (Genericity §0).
    effective: "2026-01-01",
    nodes,
    edges,
  } as unknown as Plan;
  return { plan, issues };
}
