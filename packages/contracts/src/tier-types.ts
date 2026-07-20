/**
 * Eligibility tier vocabulary — closed enum.
 *
 * Per Brief 10 (Eligibility & Appetite section). The eligibility gate
 * produces a tier verdict that downstream sections (modifier schedules
 * via tier_filter, loadings, output banners) compose with. Closed
 * vocabulary means:
 *
 *   - The UI renders one badge color per tier (predictable visual
 *     hierarchy).
 *   - Downstream filtering (modifier.schedule's tier_filter) checks
 *     against a known set; typos are caught at compile time.
 *   - The audit log + filing export can summarize tier distribution
 *     deterministically.
 *
 * Four tiers cover standard P&C appetite workflows:
 *
 *   preferred — best risks; preferential rates / autobind
 *   standard  — bread-and-butter; standard rate
 *   submit    — manual underwriter review required
 *   decline   — out of appetite; no quote
 *
 * Pure types. No React, no DOM.
 */

/** Closed eligibility tier vocabulary. */
export type EligibilityTier =
  | "preferred"
  | "standard"
  | "submit"
  | "decline";

/**
 * Iterable list of every EligibilityTier. Sorted from MOST preferred
 * to LEAST preferred — the UI uses this order for filter chips and
 * sort defaults.
 *
 * Frozen at module load so downstream code can't mutate the vocabulary.
 */
export const ELIGIBILITY_TIERS: readonly EligibilityTier[] = Object.freeze([
  "preferred",
  "standard",
  "submit",
  "decline",
] as const);

/** Display label per tier. UI uses these on <TierVerdictChip>. */
export const ELIGIBILITY_TIER_LABELS: Readonly<
  Record<EligibilityTier, string>
> = Object.freeze({
  preferred: "Preferred",
  standard: "Standard",
  submit: "Submit",
  decline: "Decline",
} as const);

/**
 * Long-form description per tier. Used in tooltips. Each description
 * is one sentence ending in a period.
 */
export const ELIGIBILITY_TIER_DESCRIPTIONS: Readonly<
  Record<EligibilityTier, string>
> = Object.freeze({
  preferred:
    "Best risk class; preferential rates and streamlined autobind workflow.",
  standard:
    "Standard risk class; bread-and-butter book at filed rates.",
  submit:
    "Manual underwriter review required before binding.",
  decline:
    "Out of appetite; no quote will be issued.",
} as const);

/**
 * Type guard: is this string a valid EligibilityTier?
 *
 * Use at the schema-validation boundary (where user input or external
 * JSON crosses into the type system).
 */
export function isEligibilityTier(value: unknown): value is EligibilityTier {
  return (
    typeof value === "string" &&
    (ELIGIBILITY_TIERS as readonly string[]).includes(value)
  );
}

/**
 * Comparator operators for eligibility rules. Wider than `PredicateOp`
 * because eligibility tests can be string/membership checks, not just
 * numeric thresholds.
 *
 *   eq  — strict equality (any primitive)
 *   ne  — strict inequality
 *   lt  — strictly less than (numeric)
 *   le  — less than or equal (numeric)
 *   gt  — strictly greater than (numeric)
 *   ge  — greater than or equal (numeric)
 *   in  — value is in a provided array
 *   nin — value is NOT in a provided array
 */
export type EligibilityOp =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "in"
  | "nin";

/** Iterable list of every EligibilityOp. */
export const ELIGIBILITY_OPS: readonly EligibilityOp[] = Object.freeze([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "in",
  "nin",
] as const);

/**
 * Coerce a value to a finite number when it plausibly IS one:
 * finite numbers pass through; non-empty numeric strings (incl.
 * zero-padded codes like "09035") parse via Number(). Everything
 * else — booleans, empty/blank strings, "12a", NaN/Infinity —
 * returns undefined. Internal to the comparator.
 */
function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Loose equality across the number/numeric-string seam: strict
 * equality first; when that misses AND at least one side is a string,
 * both sides that parse as finite numbers compare numerically (so
 * 60989 == "60989" and "09035" == 9035). Never coerces booleans and
 * never equates two non-numeric values that differ strictly.
 *
 * Platform-test finding E3: rule builders persist numeric-looking
 * codes as ints while book columns deliver strings (and vice versa);
 * strict `includes()` silently missed, leaking declines to Standard.
 */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "string" && typeof b !== "string") return false;
  const an = toFiniteNumber(a);
  if (an === undefined) return false;
  const bn = toFiniteNumber(b);
  return bn !== undefined && an === bn;
}

/**
 * Evaluate one eligibility comparator. Pure + deterministic.
 *
 *   - eq / ne: strict equality, widened across the number/numeric-
 *     string seam (60989 matches "60989") — finding E3
 *   - lt / le / gt / ge: numeric comparison; numeric STRINGS on either
 *     side coerce via Number(); returns false if either side isn't a
 *     finite number after coercion (degenerate gracefully rather than
 *     crashing on bad input)
 *   - in / nin: membership test using the same widened equality per
 *     entry
 */
export function evaluateEligibilityComparator(
  op: EligibilityOp,
  left: unknown,
  right: unknown,
): boolean {
  switch (op) {
    case "eq":
      return looseEq(left, right);
    case "ne":
      return !looseEq(left, right);
    case "lt":
    case "le":
    case "gt":
    case "ge": {
      const l = toFiniteNumber(left);
      if (l === undefined) return false;
      const r = toFiniteNumber(right);
      if (r === undefined) return false;
      if (op === "lt") return l < r;
      if (op === "le") return l <= r;
      if (op === "gt") return l > r;
      return l >= r;
    }
    case "in":
      return (
        Array.isArray(right) &&
        (right as unknown[]).some((entry) => looseEq(left, entry))
      );
    case "nin":
      return (
        Array.isArray(right) &&
        !(right as unknown[]).some((entry) => looseEq(left, entry))
      );
  }
}
