/**
 * Brief 44 PR 44.2 — authoritative-table seeds for the geo dim wizard.
 *
 * Per Brief 44 Q7 lock: when the user picks granularity + scope, the
 * wizard auto-populates the dim's level list from canonical reference
 * data (no manual typing of 51 USPS codes). PR 44.4's `<GeoMapEditor>`
 * loads the matching GeoJSON polygons; the seeds here are the level-
 * list source of truth (the "list view" data; map polygons live
 * separately).
 *
 * v1 scope:
 *   · STATE_SEED — 51 entries (50 states + DC). Fully populated; the
 *     wizard ships state-granularity for any US plan.
 *   · COUNTY_SEED — keyed by state USPS code. v1 ships Wisconsin's 72
 *     FIPS-5 codes (Brief 44 cold-test CT-2). Other states return
 *     [] from getLevelsForScope() — the user adds custom levels via
 *     the "Add custom level" escape hatch (Q7). PR 44.3+ expands.
 *   · ZIP_SEED — not bundled. ZIP polygons + names lazy-load in
 *     PR 44.4 (per-state ~250KB). v1 wizard returns [] for ZIP and
 *     the user adds custom or imports CSV.
 *
 * Data is intentionally inline (not fetched) so the wizard works
 * offline + the level list is byte-stable across reproducible builds.
 */

// Brief 44 §3.1 types — mirror the canonical shapes in
// @openrater/contracts/dimension-types + @openrater/api-client/schemas/dimensions.
// Inlined here so this module has zero HTTP-layer dependency (labs-ui
// does not import from @openrater/api-client per its package contract).
export type GeoGranularity = "state" | "county" | "zip";
export type GeoScope =
  | { readonly kind: "national" }
  | { readonly kind: "subset"; readonly states: readonly string[] };

/** Categorical-shape level (mirrors @openrater/contracts `DimensionLevel`). */
export interface SeedLevel {
  readonly kind: "categorical";
  readonly id: string;
  readonly label: string;
}

// ────────────────────────────────────────────────────────────────────
// STATE_SEED — 51 entries (50 states + DC). USPS 2-letter codes.
// Order: alphabetical, with DC inserted between DE and FL by code.
// ────────────────────────────────────────────────────────────────────

export const STATE_SEED: readonly SeedLevel[] = [
  { kind: "categorical", id: "AL", label: "Alabama" },
  { kind: "categorical", id: "AK", label: "Alaska" },
  { kind: "categorical", id: "AZ", label: "Arizona" },
  { kind: "categorical", id: "AR", label: "Arkansas" },
  { kind: "categorical", id: "CA", label: "California" },
  { kind: "categorical", id: "CO", label: "Colorado" },
  { kind: "categorical", id: "CT", label: "Connecticut" },
  { kind: "categorical", id: "DE", label: "Delaware" },
  { kind: "categorical", id: "DC", label: "District of Columbia" },
  { kind: "categorical", id: "FL", label: "Florida" },
  { kind: "categorical", id: "GA", label: "Georgia" },
  { kind: "categorical", id: "HI", label: "Hawaii" },
  { kind: "categorical", id: "ID", label: "Idaho" },
  { kind: "categorical", id: "IL", label: "Illinois" },
  { kind: "categorical", id: "IN", label: "Indiana" },
  { kind: "categorical", id: "IA", label: "Iowa" },
  { kind: "categorical", id: "KS", label: "Kansas" },
  { kind: "categorical", id: "KY", label: "Kentucky" },
  { kind: "categorical", id: "LA", label: "Louisiana" },
  { kind: "categorical", id: "ME", label: "Maine" },
  { kind: "categorical", id: "MD", label: "Maryland" },
  { kind: "categorical", id: "MA", label: "Massachusetts" },
  { kind: "categorical", id: "MI", label: "Michigan" },
  { kind: "categorical", id: "MN", label: "Minnesota" },
  { kind: "categorical", id: "MS", label: "Mississippi" },
  { kind: "categorical", id: "MO", label: "Missouri" },
  { kind: "categorical", id: "MT", label: "Montana" },
  { kind: "categorical", id: "NE", label: "Nebraska" },
  { kind: "categorical", id: "NV", label: "Nevada" },
  { kind: "categorical", id: "NH", label: "New Hampshire" },
  { kind: "categorical", id: "NJ", label: "New Jersey" },
  { kind: "categorical", id: "NM", label: "New Mexico" },
  { kind: "categorical", id: "NY", label: "New York" },
  { kind: "categorical", id: "NC", label: "North Carolina" },
  { kind: "categorical", id: "ND", label: "North Dakota" },
  { kind: "categorical", id: "OH", label: "Ohio" },
  { kind: "categorical", id: "OK", label: "Oklahoma" },
  { kind: "categorical", id: "OR", label: "Oregon" },
  { kind: "categorical", id: "PA", label: "Pennsylvania" },
  { kind: "categorical", id: "RI", label: "Rhode Island" },
  { kind: "categorical", id: "SC", label: "South Carolina" },
  { kind: "categorical", id: "SD", label: "South Dakota" },
  { kind: "categorical", id: "TN", label: "Tennessee" },
  { kind: "categorical", id: "TX", label: "Texas" },
  { kind: "categorical", id: "UT", label: "Utah" },
  { kind: "categorical", id: "VT", label: "Vermont" },
  { kind: "categorical", id: "VA", label: "Virginia" },
  { kind: "categorical", id: "WA", label: "Washington" },
  { kind: "categorical", id: "WV", label: "West Virginia" },
  { kind: "categorical", id: "WI", label: "Wisconsin" },
  { kind: "categorical", id: "WY", label: "Wyoming" },
];

/** Lookup: USPS code → display label. O(1) for the state picker. */
export const STATE_LABEL_BY_CODE: Readonly<Record<string, string>> =
  Object.fromEntries(STATE_SEED.map((s) => [s.id, s.label]));

/** USPS codes sorted alphabetically (for the picker's stable order). */
export const STATE_CODES: readonly string[] = STATE_SEED.map((s) => s.id);

// ────────────────────────────────────────────────────────────────────
// COUNTY_SEED — Wisconsin's 72 FIPS-5 codes. Other states empty in v1.
// (Brief 44 cold-test CT-2 + the IRS-990 walkthrough use WI; widening
//  is incremental.)
// ────────────────────────────────────────────────────────────────────

const WI_COUNTIES: readonly SeedLevel[] = [
  { kind: "categorical", id: "55001", label: "Adams County" },
  { kind: "categorical", id: "55003", label: "Ashland County" },
  { kind: "categorical", id: "55005", label: "Barron County" },
  { kind: "categorical", id: "55007", label: "Bayfield County" },
  { kind: "categorical", id: "55009", label: "Brown County" },
  { kind: "categorical", id: "55011", label: "Buffalo County" },
  { kind: "categorical", id: "55013", label: "Burnett County" },
  { kind: "categorical", id: "55015", label: "Calumet County" },
  { kind: "categorical", id: "55017", label: "Chippewa County" },
  { kind: "categorical", id: "55019", label: "Clark County" },
  { kind: "categorical", id: "55021", label: "Columbia County" },
  { kind: "categorical", id: "55023", label: "Crawford County" },
  { kind: "categorical", id: "55025", label: "Dane County" },
  { kind: "categorical", id: "55027", label: "Dodge County" },
  { kind: "categorical", id: "55029", label: "Door County" },
  { kind: "categorical", id: "55031", label: "Douglas County" },
  { kind: "categorical", id: "55033", label: "Dunn County" },
  { kind: "categorical", id: "55035", label: "Eau Claire County" },
  { kind: "categorical", id: "55037", label: "Florence County" },
  { kind: "categorical", id: "55039", label: "Fond du Lac County" },
  { kind: "categorical", id: "55041", label: "Forest County" },
  { kind: "categorical", id: "55043", label: "Grant County" },
  { kind: "categorical", id: "55045", label: "Green County" },
  { kind: "categorical", id: "55047", label: "Green Lake County" },
  { kind: "categorical", id: "55049", label: "Iowa County" },
  { kind: "categorical", id: "55051", label: "Iron County" },
  { kind: "categorical", id: "55053", label: "Jackson County" },
  { kind: "categorical", id: "55055", label: "Jefferson County" },
  { kind: "categorical", id: "55057", label: "Juneau County" },
  { kind: "categorical", id: "55059", label: "Kenosha County" },
  { kind: "categorical", id: "55061", label: "Kewaunee County" },
  { kind: "categorical", id: "55063", label: "La Crosse County" },
  { kind: "categorical", id: "55065", label: "Lafayette County" },
  { kind: "categorical", id: "55067", label: "Langlade County" },
  { kind: "categorical", id: "55069", label: "Lincoln County" },
  { kind: "categorical", id: "55071", label: "Manitowoc County" },
  { kind: "categorical", id: "55073", label: "Marathon County" },
  { kind: "categorical", id: "55075", label: "Marinette County" },
  { kind: "categorical", id: "55077", label: "Marquette County" },
  { kind: "categorical", id: "55078", label: "Menominee County" },
  { kind: "categorical", id: "55079", label: "Milwaukee County" },
  { kind: "categorical", id: "55081", label: "Monroe County" },
  { kind: "categorical", id: "55083", label: "Oconto County" },
  { kind: "categorical", id: "55085", label: "Oneida County" },
  { kind: "categorical", id: "55087", label: "Outagamie County" },
  { kind: "categorical", id: "55089", label: "Ozaukee County" },
  { kind: "categorical", id: "55091", label: "Pepin County" },
  { kind: "categorical", id: "55093", label: "Pierce County" },
  { kind: "categorical", id: "55095", label: "Polk County" },
  { kind: "categorical", id: "55097", label: "Portage County" },
  { kind: "categorical", id: "55099", label: "Price County" },
  { kind: "categorical", id: "55101", label: "Racine County" },
  { kind: "categorical", id: "55103", label: "Richland County" },
  { kind: "categorical", id: "55105", label: "Rock County" },
  { kind: "categorical", id: "55107", label: "Rusk County" },
  { kind: "categorical", id: "55109", label: "St. Croix County" },
  { kind: "categorical", id: "55111", label: "Sauk County" },
  { kind: "categorical", id: "55113", label: "Sawyer County" },
  { kind: "categorical", id: "55115", label: "Shawano County" },
  { kind: "categorical", id: "55117", label: "Sheboygan County" },
  { kind: "categorical", id: "55119", label: "Taylor County" },
  { kind: "categorical", id: "55121", label: "Trempealeau County" },
  { kind: "categorical", id: "55123", label: "Vernon County" },
  { kind: "categorical", id: "55125", label: "Vilas County" },
  { kind: "categorical", id: "55127", label: "Walworth County" },
  { kind: "categorical", id: "55129", label: "Washburn County" },
  { kind: "categorical", id: "55131", label: "Washington County" },
  { kind: "categorical", id: "55133", label: "Waukesha County" },
  { kind: "categorical", id: "55135", label: "Waupaca County" },
  { kind: "categorical", id: "55137", label: "Waushara County" },
  { kind: "categorical", id: "55139", label: "Winnebago County" },
  { kind: "categorical", id: "55141", label: "Wood County" },
];

/**
 * County levels keyed by state USPS code. v1 ships WI; other states
 * return [] (user adds custom or imports CSV via the editor — Q7
 * escape hatch). PR 44.3+ expand this with additional states.
 */
export const COUNTY_SEED: Readonly<Record<string, readonly SeedLevel[]>> = {
  WI: WI_COUNTIES,
};

// ────────────────────────────────────────────────────────────────────
// Seed resolution — what the wizard calls on Create.
// ────────────────────────────────────────────────────────────────────

/** Resolved set of state codes for a scope. */
export function resolveScopeStates(scope: GeoScope): readonly string[] {
  if (scope.kind === "national") return STATE_CODES;
  return scope.states;
}

/**
 * Auto-seed levels for a geo dim from granularity + scope.
 *
 * Brief 44 Q7 lock — pull from authoritative tables.
 *
 *   · state granularity → one level per scope state (51 if national)
 *   · county granularity → counties for each scope state (only WI in v1)
 *   · zip granularity → empty (lazy-loaded in PR 44.4)
 *
 * Returns levels in a stable order: by state USPS code first, then by
 * level id within each state.
 */
export function getLevelsForScope(
  granularity: GeoGranularity,
  scope: GeoScope,
): readonly SeedLevel[] {
  const states = resolveScopeStates(scope);

  if (granularity === "state") {
    // One level per scope state. Use STATE_SEED order for stability.
    const inScope = new Set(states);
    return STATE_SEED.filter((s) => inScope.has(s.id));
  }

  if (granularity === "county") {
    const out: SeedLevel[] = [];
    // STATE_CODES is alphabetical; iterate it so the result is stable
    // regardless of how the caller built the scope.states array.
    for (const code of STATE_CODES) {
      if (!states.includes(code)) continue;
      const counties = COUNTY_SEED[code];
      if (counties) out.push(...counties);
    }
    return out;
  }

  // zip — v1 returns empty; the user adds custom or imports CSV.
  // PR 44.4 lazy-loads ZIP polygons + lights this up.
  return [];
}

/**
 * Cardinality preview — what the user sees in the wizard's step-3
 * review BEFORE we materialize the level array. Cheaper than running
 * getLevelsForScope just to count.
 */
export function previewLevelCount(
  granularity: GeoGranularity,
  scope: GeoScope,
): number {
  const states = resolveScopeStates(scope);
  if (granularity === "state") return states.length;
  if (granularity === "county") {
    let total = 0;
    for (const code of states) {
      const counties = COUNTY_SEED[code];
      if (counties) total += counties.length;
    }
    return total;
  }
  return 0;
}
