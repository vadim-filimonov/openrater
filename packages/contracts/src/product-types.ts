/**
 * Product vocabulary — the PRODUCT axis (ADR-0033 §1).
 *
 * A `ProductCode` names what a Plan rates: ONE product's rating
 * algorithm (ADR-0032 D1). It de-conflates the legacy `LineCode`
 * (`line-types.ts`), which overloaded ONE axis with three concepts —
 * products (`professional` = D&O/E&O), coverages (`liability`,
 * `property`), and true lines (`wc`, `auto`).
 *
 * ── GENERICITY INVARIANT (ADR-0033 §0 — the load-bearing rule) ──
 *
 * A `ProductCode` is an OPAQUE TAG. The engine (`runtime.ts` + the 18
 * kinds), the projector (`stagesToRuntimePlan`), and the policy composer
 * (`composePolicy`) MUST NEVER branch on its value. There is no
 * `if (product === "do")` anywhere in the rating path — product-specific
 * behavior lives INSIDE each product's authored Plan, never in shared
 * machinery.
 *
 * Consequence: adding a line of business — BOP, auto, cyber, parametric
 * — is one entry in this enum + authoring a Plan, NEVER a pipeline patch.
 * `do`/`eo` are simply the first two catalog entries; `bop`, `cgl`,
 * `wc`, `auto`, … are equal first-class peers. The framework is built
 * for arbitrary `products × coverages × policies × locations` (the
 * VISION north star), not for D&O/E&O.
 *
 * Closed enum + `other` escape hatch (owner decision O-1, 2026-05-29).
 * A registry MAY supersede the enum later WITHOUT re-keying — because
 * the value is already just a tag, widening its domain is not a breaking
 * change to anything that consumes it.
 *
 * Pure types. No React, no DOM. Consumed by:
 *   - `Plan.product` (the product a plan is scoped to)
 *   - `Coverage.product` (`coverage-types.ts`)
 *   - `PlanRef.product` (`policy-types.ts`)
 *   - UI badges (replacing <LobBadge>, lands with the axis-cleanup brief)
 *
 * See `docs/adr/0033-line-coverage-product-axis-cleanup.md`.
 */

/**
 * Closed product vocabulary. 10 standard P&C products + `other`.
 *
 * Distinct from the legacy `LineCode`: the coverages (`liability` /
 * `property`) are gone (they move to `Coverage`), and `professional`
 * splits into `do` + `eo`.
 */
export type ProductCode =
  | "bop" // Businessowners — a PACKAGE of coverages (property + liability + …)
  | "cgl" // Commercial General Liability   (was LineCode "liability")
  | "do" // Directors & Officers            (split from "professional")
  | "eo" // Errors & Omissions              (split from "professional")
  | "wc" // Workers Compensation
  | "auto" // Auto (commercial fleets AND private passenger — FCA #30)
  | "umbrella" // Umbrella over a primary
  | "excess" // Excess & Surplus (non-admitted)
  | "marine" // Ocean marine
  | "inland_marine" // Inland marine
  | "homeowners" // Homeowners (HO forms) — Brief 94.6, personal lines
  | "dwelling" // Dwelling fire (DP forms) — Brief 94.6, personal lines
  | "other"; // Manuscript / niche product

/**
 * Iterable list of every ProductCode. Frozen at module load so an
 * accidental `PRODUCT_CODES.push("cyber")` throws immediately rather
 * than corrupting the vocabulary silently (matches LINE_CODES).
 *
 * Canonical order — the UI uses it for stable badge / filter rendering.
 */
export const PRODUCT_CODES: readonly ProductCode[] = Object.freeze([
  "bop",
  "cgl",
  "do",
  "eo",
  "wc",
  "auto",
  "umbrella",
  "excess",
  "marine",
  "inland_marine",
  "homeowners",
  "dwelling",
  "other",
] as const);

/**
 * Human-readable display label per ProductCode. Terse — for badges /
 * chips. Full sentences live in PRODUCT_DESCRIPTIONS / tooltips.
 *
 * Frozen at module load (see PRODUCT_CODES).
 */
export const PRODUCT_LABELS: Readonly<Record<ProductCode, string>> =
  Object.freeze({
    bop: "Businessowners",
    cgl: "General Liability",
    do: "Directors & Officers",
    eo: "Errors & Omissions",
    wc: "Workers Comp",
    // FCA fca-2026-07-25 #30 (finding 22) — the ONE auto code spans
    // commercial fleets and private-passenger programs; labeling it
    // "Commercial Auto" put that title on a filing named "Private
    // Passenger Automobile Program" on every surface. The label says
    // what the code actually covers, no more.
    auto: "Auto",
    umbrella: "Umbrella",
    excess: "Excess & Surplus",
    marine: "Marine",
    inland_marine: "Inland Marine",
    homeowners: "Homeowners",
    dwelling: "Dwelling Fire",
    other: "Other",
  } as const);

/**
 * Long-form description of each product — what it rates. Used in
 * tooltips + accessibility labels, NOT on chip surfaces.
 *
 * Frozen at module load (see PRODUCT_CODES).
 */
export const PRODUCT_DESCRIPTIONS: Readonly<Record<ProductCode, string>> =
  Object.freeze({
    bop: "Packaged small-business policy bundling property + liability coverages.",
    cgl: "Third-party bodily injury + property damage from premises, products, operations.",
    do: "Directors & officers / management liability for the insured's leadership.",
    eo: "Professional errors & omissions for service providers' negligence claims.",
    wc: "Workplace injury + occupational illness coverage for employees.",
    auto: "Vehicle liability + physical damage (commercial or private passenger).",
    umbrella: "Excess liability above an underlying primary policy (CGL/Auto/EL).",
    excess:
      "Non-admitted carrier coverage for risks outside standard market appetite.",
    marine: "Cargo, hulls, transit on oceans and navigable waters.",
    inland_marine:
      "Moveable property in transit or off-premises (equipment, signs, cargo).",
    homeowners:
      "Owner-occupied residential package (HO forms): dwelling, contents, liability.",
    dwelling:
      "Dwelling fire (DP forms): rental / secondary residential property coverage.",
    other: "Manuscript or niche product that doesn't fit the standard vocabulary.",
  } as const);

/**
 * Type guard: is this string a valid ProductCode?
 *
 * Use at the schema-validation boundary — anywhere user input or
 * external JSON crosses into the type system. Internal code should
 * trust the ProductCode type and never call this defensively.
 *
 * NOTE: this guard validates membership, it does NOT branch on a
 * specific product — the Genericity invariant forbids that everywhere
 * in the rating path, not here at the schema boundary.
 */
export function isProductCode(value: unknown): value is ProductCode {
  return (
    typeof value === "string" &&
    (PRODUCT_CODES as readonly string[]).includes(value)
  );
}
