/**
 * The 13-section Plan spine.
 *
 * Every rating plan in OpenRater — regardless of LOB — is organized into
 * these 13 sections in this order. Sections are the durable scaffolding
 * the actuary uses to find their work; what changes per LOB is which
 * block kinds each section accepts (e.g. BOP section 6 accepts
 * `entity.coverage-chain` shaped for BOP coverages; WC section 6
 * accepts WC-shaped coverage chains).
 *
 * This list is the single source of truth for the UI. When the backend
 * stores `plan.section_layout` it keys by `Section.id` here.
 *
 * Adding / removing / renaming a section is a Plan Format Spec change,
 * not a casual edit. Coordinate with `docs/specs/plan-format-v1.md`.
 *
 * **24.B update:** the sections fold into 4 user-facing **workspaces**
 * (DIMENSIONS / PARAMETRIZE / GATE / ASSEMBLE) plus a sibling VERIFY
 * surface for the test runner. The rail in `PlanDetailRoute` renders
 * workspaces — not the sections directly. Per Brief 24 v3 §2.
 *
 * Brief 34 PR 34.7: the legacy "Curves" section was removed (the
 * spine dropped from 14 to 13 sections). Brief 34's <FactorTableViz>
 * supersedes Brief 19 — 1-D banded factor tables render via
 * <LineChart> as the canonical curve visualization.
 *
 * The legacy 6-group `SectionGroup` system (and the superseded 5-phase
 * variant) are removed: sections now carry a single `workspace` field.
 */

export type SectionScope = "plan-wide" | "line-wide" | "per-coverage";

/**
 * The Brief-24-v3 authoring workspaces (24.F2: tab layout).
 *
 * - "inputs"      (§2.1) — what data flows in? (Risk Inputs binding layer)
 * - "dimensions"  (§2.2) — what variables and what data?
 * - "gate"        (§2.4) — what filters / modifiers / endorsements? (Brief 22 absorbed)
 * - "assemble"    (§2.5) — the RATING workspace: factor tables + the
 *                          build-up sheet in one surface (Brief 78 / v4
 *                          P5, D9). Absorbed the former "parametrize"
 *                          workspace — chains + tables + loadings +
 *                          final-adjustments + outputs.
 * - "verify"      (§2.6) — sibling, not authored — rate against a sample risk.
 *
 * Brief 78 (v4 P5.1): "parametrize" was REMOVED from the union — the
 * Factor Tables tab merged into the Rating workspace (internal id
 * `assemble`, precedent: `verify`→"Run"). Legacy
 * `workspace/parametrize` URLs redirect in the router; do not
 * reintroduce the id here.
 *
 * Order matches the canonical left-to-right tab order in the UI (24.F2).
 */
export type PlanBuilderWorkspace =
  | "inputs"
  | "dimensions"
  | "gate"
  | "assemble"
  | "analytics"
  | "verify"
  | "ship";

/**
 * Human-readable workspace labels for rail rendering. Display order
 * matches PlanBuilderWorkspace union order.
 */
export const WORKSPACE_LABELS: Readonly<Record<PlanBuilderWorkspace, string>> =
  Object.freeze({
    inputs: "Inputs",
    dimensions: "Dimensions",
    // Brief 70 §3 / Brief 68 §3.3 — the section is ELIGIBILITY only
    // (modifiers + endorsements are premium math; they join the
    // Algorithm's Final adjustments in Phase 3).
    gate: "Eligibility",
    // Brief 78 (v4 P5.1, D9) — the merged RATING workspace: factor
    // tables + the build-up sheet, one surface (catalog rail · sheet ·
    // inspector). Internal id/URL stays `assemble` (the `verify`→"Run"
    // precedent); the "Factor Tables" tab is gone.
    assemble: "Rating",
    analytics: "Analytics",
    // Brief 75 (v4 P3) — the Run zone: the tab where a plan RUNS
    // (sample rate today; book score next in the P3 stack) and every
    // run persists server-side. Internal id/URL stays `verify`.
    verify: "Run",
    // Brief 76 (v4 P4) — the Ship zone: versions (freeze → publish +
    // the divergence signal) and the API panel (endpoint + try-it).
    // Publish is the act that lights the API up.
    ship: "Ship",
  });

/**
 * One-liner descriptions surfaced in the rail card subtitle / tooltip.
 * Tone: actuary-language, plain-English, no jargon.
 */
export const WORKSPACE_DESCRIPTIONS: Readonly<
  Record<PlanBuilderWorkspace, string>
> = Object.freeze({
  inputs:
    "Map the policy-data fields the plan reads — ACORD form values, API enrichment, derivations, constants.",
  dimensions:
    "Define the risk variables — standard, geographic, or classification.",
  gate: "Filter, modify, endorse — eligibility, schedule mods, endorsements.",
  assemble:
    "The rating workspace — factor tables and the build-up sheet, side by side; chains, loadings, final adjustments, outputs combine into premium.",
  analytics:
    "Compare versions side-by-side — slice the scored book by any rating variable.",
  verify: "Test the plan — author a sample risk and run it end-to-end.",
  ship: "Ship it — publish a version of record and turn on the quote API.",
});

/**
 * Display order for the top tab strip (V2_INTERFACE_SPEC §2.1).
 * Build then run: the algorithm precedes its gates in the strip (you
 * build the premium math, then bound it), and Test precedes Analytics
 * on the run side (you test a risk, then analyze the book).
 */
export const WORKSPACE_ORDER: readonly PlanBuilderWorkspace[] = Object.freeze([
  "inputs",
  "dimensions",
  "assemble",
  "gate",
  "verify",
  "analytics",
  "ship",
] as const);

/**
 * The 4 authoring workspaces — the user-authored substrate surfaces
 * (Brief 78 folded parametrize into assemble; was 5). Excludes the
 * non-authoring workspaces: "analytics" (consumer of scored data,
 * Brief 43), "verify" (executor of the plan, Brief 24), and "ship"
 * (publisher, Brief 76). Use this when counting "how many workspaces
 * are active?" for the progress chip.
 */
export const AUTHORING_WORKSPACES: readonly PlanBuilderWorkspace[] =
  Object.freeze([
    "inputs",
    "dimensions",
    "gate",
    "assemble",
  ] as const);

/**
 * Default tab when the route URL has no workspace segment. Inputs is
 * the natural starting point — it's the first authoring surface in the
 * cascade ("what data flows in").
 */
export const DEFAULT_WORKSPACE: PlanBuilderWorkspace = "inputs";

/**
 * Returns true when the given string is a valid PlanBuilderWorkspace.
 * Used by the route to validate URL segments before mounting a tab.
 */
export function isPlanBuilderWorkspace(
  value: string,
): value is PlanBuilderWorkspace {
  return (WORKSPACE_ORDER as readonly string[]).includes(value);
}

export interface Section {
  /** 1-based ordinal. Stable across LOBs. */
  readonly num: number;
  /** kebab-case stable id. Used as the key in `plan.section_layout`. */
  readonly id: string;
  /** Human-readable name shown in the UI. */
  readonly name: string;
  /** Scope of the entities this section holds. */
  readonly scope: SectionScope;
  /** True if the plan can't validate without at least one stage here. */
  readonly required: boolean;
  /** One-liner shown in the empty-state body of the section card. */
  readonly emptyHint: string;
  /**
   * Which Brief-24-v3 workspace this section folds into. The rail uses
   * this to bucket the 14 sections into the 4 user-facing workspace
   * cards (+ verify). See PlanBuilderWorkspace jsdoc.
   */
  readonly workspace: PlanBuilderWorkspace;
}

export const PLAN_SECTIONS: readonly Section[] = Object.freeze([
  {
    num: 1,
    id: "risk-inputs",
    name: "Risk Inputs",
    scope: "plan-wide",
    required: true,
    workspace: "inputs",
    emptyHint:
      "Bind the ACORD form fields and any API-derived inputs the plan needs.",
  },
  {
    num: 2,
    id: "eligibility",
    name: "Eligibility & Appetite",
    scope: "plan-wide",
    required: false,
    workspace: "gate",
    emptyHint:
      "Optional · add decline / refer / pass rules to filter risks before rating.",
  },
  {
    num: 3,
    id: "dimensions",
    name: "Dimensions",
    scope: "line-wide",
    required: true,
    workspace: "dimensions",
    emptyHint:
      "Typed risk attributes (construction, territory, class). Pre-populated by template.",
  },
  {
    num: 4,
    id: "territories",
    name: "Territories",
    scope: "plan-wide",
    required: false,
    workspace: "dimensions",
    emptyHint: "Optional · jurisdiction-specific territory entities.",
  },
  {
    num: 5,
    id: "classification",
    name: "Classification",
    scope: "line-wide",
    required: true,
    workspace: "dimensions",
    emptyHint:
      "Class plans that map risk attributes to class codes for rating.",
  },
  {
    num: 6,
    id: "rating-chains",
    name: "Rating Chains",
    scope: "per-coverage",
    required: true,
    workspace: "assemble",
    emptyHint: "The multiplicative chain that produces each coverage premium.",
  },
  {
    num: 7,
    id: "factor-tables",
    name: "Factor Tables",
    scope: "plan-wide",
    required: false,
    // Brief 78 (v4 P5.1, D9) — folded into the Rating workspace: the
    // table catalog is the workspace rail, the editor is its
    // inspector/takeover. The section id stays stable (it keys
    // section_layout + stage bucketing).
    workspace: "assemble",
    emptyHint:
      "Lookup tables (e.g. construction × territory → factor) referenced by chains. 1-D banded tables render as line charts (Brief 34's curve viz).",
  },
  // Brief 34 PR 34.7: the legacy `curves` section (formerly num 8)
  // was removed. Brief 34's <FactorTableViz> supersedes it: a 1-D
  // banded factor table renders via <LineChart> and that IS the
  // curve visualization. Sections 9-14 shifted to 8-13.
  {
    num: 8,
    id: "modifiers",
    name: "Modifiers",
    scope: "per-coverage",
    required: false,
    workspace: "gate",
    emptyHint: "Schedule mods, experience mods, IRPM — applied to chains.",
  },
  {
    num: 9,
    id: "endorsements",
    name: "Endorsements",
    scope: "per-coverage",
    required: false,
    workspace: "gate",
    emptyHint:
      "Coverage modifications priced as additive premium or rate factors.",
  },
  {
    num: 10,
    id: "loadings",
    name: "Loadings",
    scope: "per-coverage",
    required: true,
    workspace: "assemble",
    emptyHint:
      "Expense, profit, contingency loadings applied to base premium.",
  },
  {
    num: 11,
    id: "final-adjustments",
    name: "Final Adjustments",
    scope: "plan-wide",
    required: true,
    workspace: "assemble",
    emptyHint:
      "Tax, fees, minimum premium, rounding — the last touch before the quote.",
  },
  {
    num: 12,
    id: "outputs",
    name: "Outputs",
    scope: "plan-wide",
    required: true,
    workspace: "assemble",
    emptyHint: "Declared output fields the plan returns at the top level.",
  },
  {
    num: 13,
    id: "rate-against-sample",
    name: "Rate Against Sample",
    scope: "plan-wide",
    required: false,
    workspace: "verify",
    emptyHint:
      "Execution panel · author a sample risk and run the plan end-to-end.",
  },
]);

/**
 * Sections bucketed by workspace, preserving canonical order within each
 * workspace. Frozen at module load. The 24.B rail iterates
 * WORKSPACE_ORDER and reads from this map.
 */
export const PLAN_SECTIONS_BY_WORKSPACE: Readonly<
  Record<PlanBuilderWorkspace, readonly Section[]>
> = Object.freeze(
  WORKSPACE_ORDER.reduce(
    (acc, workspace) => {
      acc[workspace] = Object.freeze(
        PLAN_SECTIONS.filter((s) => s.workspace === workspace),
      );
      return acc;
    },
    {} as Record<PlanBuilderWorkspace, readonly Section[]>,
  ),
);

/** Total number of sections. Asserts at module load that the array is well-formed. */
export const PLAN_SECTION_COUNT = PLAN_SECTIONS.length;

if (PLAN_SECTION_COUNT !== 13) {
  // Self-check: if this throws, someone removed or added a section without
  // updating the count. Fail loud rather than silently changing the contract.
  throw new Error(
    `PLAN_SECTIONS expected 13 entries, found ${PLAN_SECTION_COUNT}`,
  );
}

/** Quick lookup by section id (kebab-case). Frozen at module load. */
export const PLAN_SECTIONS_BY_ID: Readonly<Record<string, Section>> =
  Object.freeze(
    Object.fromEntries(PLAN_SECTIONS.map((s) => [s.id, s])) as Record<
      string,
      Section
    >,
  );
