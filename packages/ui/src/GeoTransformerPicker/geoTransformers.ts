/**
 * Brief 44 PR 44.6 — Input-mapping geographic transformers.
 *
 * When the user's CSV column doesn't match the geo dim's granularity
 * (e.g. dim is state-granularity but the column carries 5-digit ZIPs),
 * the Inputs workspace picks a transformer to bridge the gap. The
 * transformer fires at score time against each row's value.
 *
 * Library (Brief 44 Q6 lock):
 *   · `zip5_to_state(zip)`    — ZCTA → 2-letter USPS via SCF prefix ranges
 *   · `zip5_to_county(zip)`   — ZCTA → 5-digit FIPS county. Stubbed in v1
 *                               (needs full ZCTA→county lookup; lazy-load
 *                                lands with PR 44.4.bis when ZIP polygons
 *                                bundle in).
 *   · `fips5_to_state(fips5)` — county FIPS (5-digit) → 2-letter USPS via
 *                               STATE_FIPS_TO_USPS
 *   · `state_name_to_usps(s)` — "Wisconsin" → "WI" via the 51-entry table.
 *                               Case-insensitive + handles common variants
 *                               ("D.C." / "District of Columbia").
 *
 * All transformers return `string | null`. NULL means "could not
 * translate" — callers either skip the row or surface a runtime
 * error (the consumer's choice). Validation invariants:
 *
 *   · Input is the raw column value (string)
 *   · Output, when non-null, is in the dim's granularity space
 *   · Pure functions — no IO, no hidden state. The runtime can
 *     batch-execute against 10K rows without surprise.
 *
 * Auto-suggest uses `suggestTransformer(column_value_sample, dim_granularity)`
 * to pick a likely transformer for the input mapping UI.
 */

import { STATE_FIPS_TO_USPS } from "../GeoMapEditor/geoCatalog";
import { STATE_LABEL_BY_CODE } from "../GeoDimWizard/geoLevelSeeds";

// ────────────────────────────────────────────────────────────────────
// Transformer types
// ────────────────────────────────────────────────────────────────────

/**
 * Canonical transformer ids. Storage-friendly enums; the consumer
 * persists this on the input mapping row + the runtime dispatches
 * through `applyTransformer`.
 */
export type GeoTransformerId =
  | "identity"
  | "zip5_to_state"
  | "zip5_to_county"
  | "fips5_to_state"
  | "state_name_to_usps";

export interface GeoTransformerMeta {
  readonly id: GeoTransformerId;
  readonly label: string;
  /** Short hint shown in the picker dropdown. */
  readonly hint: string;
  /** Granularity the transformer's output is in. */
  readonly outputGranularity: "state" | "county" | "zip" | "any";
}

export const GEO_TRANSFORMER_META: Readonly<
  Record<GeoTransformerId, GeoTransformerMeta>
> = {
  identity: {
    id: "identity",
    label: "Pass-through (no transform)",
    hint: "Use the column value as-is",
    outputGranularity: "any",
  },
  zip5_to_state: {
    id: "zip5_to_state",
    label: "ZIP → State",
    hint: '5-digit ZIP → 2-letter USPS (e.g. "53201" → "WI")',
    outputGranularity: "state",
  },
  zip5_to_county: {
    id: "zip5_to_county",
    label: "ZIP → County FIPS",
    hint: '5-digit ZIP → 5-digit county FIPS (lazy-load v1: returns null)',
    outputGranularity: "county",
  },
  fips5_to_state: {
    id: "fips5_to_state",
    label: "County FIPS → State",
    hint: '5-digit county FIPS → 2-letter USPS (e.g. "55079" → "WI")',
    outputGranularity: "state",
  },
  state_name_to_usps: {
    id: "state_name_to_usps",
    label: "State name → USPS",
    hint: '"Wisconsin" → "WI" (case-insensitive)',
    outputGranularity: "state",
  },
};

// ────────────────────────────────────────────────────────────────────
// Transformers
// ────────────────────────────────────────────────────────────────────

/** Trim + return as-is. */
export function identity(v: string): string {
  return v.trim();
}

/**
 * 5-digit ZIP → USPS state code via SCF-prefix range table.
 *
 * Each US state owns one or more contiguous ZIP ranges keyed by the
 * leading 3 digits (Sectional Center Facility — SCF). The ranges
 * below are inclusive on both ends; gaps cover US territories /
 * military / unused.
 *
 * Source: USPS L005 (state-by-state ZIP ranges, public domain).
 */
export function zip5_to_state(v: string): string | null {
  const z = v.trim().padStart(5, "0").slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  const n = Number(z);
  for (const [lo, hi, usps] of ZIP_RANGES) {
    if (n >= lo && n <= hi) return usps;
  }
  return null;
}

/**
 * 5-digit ZIP → 5-digit county FIPS. v1 returns null — the ZCTA→
 * county crosswalk (~42K rows) lazy-loads with the ZIP polygon
 * bundle in PR 44.4.bis. The picker still surfaces this entry so
 * the substrate is consistent; consumers display a "coming soon"
 * preview when it's chosen.
 */
export function zip5_to_county(_v: string): string | null {
  return null;
}

/** 5-digit county FIPS → USPS state via STATE_FIPS_TO_USPS. */
export function fips5_to_state(v: string): string | null {
  const f = v.trim().padStart(5, "0").slice(0, 5);
  if (!/^\d{5}$/.test(f)) return null;
  const stateFips = f.slice(0, 2);
  return STATE_FIPS_TO_USPS[stateFips] ?? null;
}

/**
 * State name → USPS via STATE_LABEL_BY_CODE inverted. Case- +
 * whitespace-insensitive. Accepts a few common variants
 * ("D.C.", "Washington D.C.").
 */
export function state_name_to_usps(v: string): string | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Direct USPS — short-circuit if the column already has codes.
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && STATE_LABEL_BY_CODE[upper] !== undefined) {
    return upper;
  }
  // Build the case-insensitive name lookup lazily (51 entries).
  if (!NAME_TO_USPS_CACHE) {
    NAME_TO_USPS_CACHE = new Map();
    for (const [usps, name] of Object.entries(STATE_LABEL_BY_CODE)) {
      NAME_TO_USPS_CACHE.set(name.toLowerCase(), usps);
    }
    // Common variants — DC has multiple spellings in the wild.
    NAME_TO_USPS_CACHE.set("d.c.", "DC");
    NAME_TO_USPS_CACHE.set("dc", "DC");
    NAME_TO_USPS_CACHE.set("washington d.c.", "DC");
    NAME_TO_USPS_CACHE.set("washington dc", "DC");
  }
  return NAME_TO_USPS_CACHE.get(trimmed.toLowerCase()) ?? null;
}
let NAME_TO_USPS_CACHE: Map<string, string> | null = null;

/** Dispatch a transformer by id. Useful for runtime / preview wiring. */
export function applyTransformer(
  id: GeoTransformerId,
  value: string,
): string | null {
  switch (id) {
    case "identity":
      return identity(value);
    case "zip5_to_state":
      return zip5_to_state(value);
    case "zip5_to_county":
      return zip5_to_county(value);
    case "fips5_to_state":
      return fips5_to_state(value);
    case "state_name_to_usps":
      return state_name_to_usps(value);
  }
}

// ────────────────────────────────────────────────────────────────────
// Auto-suggest
// ────────────────────────────────────────────────────────────────────

/**
 * Sniff a column's value shape + recommend a transformer.
 *
 * `sample` is the first non-null value the consumer pulled from the
 * CSV — we sniff this against simple shape rules:
 *
 *   · 5-digit numeric, first 2 = valid state FIPS → fips5_to_state
 *     (only when dimGranularity = state; otherwise zip5_to_county
 *     is also a candidate but v1 stubs zip5_to_county)
 *   · 5-digit numeric, not state FIPS shaped → zip5_to_state
 *   · 2-letter alpha + valid USPS → identity (no transform needed)
 *   · longer alpha (matches a state name) → state_name_to_usps
 *   · otherwise → identity (let the consumer surface a mismatch banner)
 *
 * `dimGranularity` is the geo dim's lock (state / county / zip).
 * The picker filters the suggestion set to transformers whose
 * `outputGranularity` matches.
 */
export function suggestTransformer(
  sample: string | undefined,
  dimGranularity: "state" | "county" | "zip",
): GeoTransformerId {
  if (!sample) return "identity";
  const s = sample.trim();
  // 5-digit numeric
  if (/^\d{5}$/.test(s)) {
    if (dimGranularity === "state") {
      // First 2 chars match a valid state FIPS → likely county FIPS.
      const head2 = s.slice(0, 2);
      if (head2 in STATE_FIPS_TO_USPS) return "fips5_to_state";
      // Otherwise treat as a ZIP.
      return "zip5_to_state";
    }
    if (dimGranularity === "county") {
      return "zip5_to_county"; // user will get a preview warning
    }
    // zip-granularity dim + 5-digit value = already matches
    return "identity";
  }
  // 2-letter alpha (USPS)
  if (/^[A-Za-z]{2}$/.test(s)) {
    return "identity";
  }
  // Longer alpha — try state-name lookup
  if (/^[A-Za-z .]+$/.test(s) && s.length > 2) {
    if (state_name_to_usps(s) !== null) return "state_name_to_usps";
  }
  return "identity";
}

// ────────────────────────────────────────────────────────────────────
// ZIP→state range table (USPS L005, public domain)
// ────────────────────────────────────────────────────────────────────

/**
 * Inclusive ZIP ranges per state. Triples: `[lo, hi, USPS]`. Ranges
 * are non-overlapping and cover ~99% of allocated ZIPs (military
 * APO/FPO/DPO + a few rural unused ranges fall outside).
 *
 * The list is small enough to keep inline. ~70 ranges total.
 */
const ZIP_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  // North-East
  [1000, 2799, "MA"],   // 010-027
  [2800, 2999, "RI"],   // 028-029
  [3000, 3899, "NH"],   // 030-038
  [3900, 4999, "ME"],   // 039-049
  [5000, 5999, "VT"],   // 050-059
  [6000, 6999, "CT"],   // 060-069
  [7000, 8999, "NJ"],   // 070-089
  [10000, 14999, "NY"], // 100-149
  [15000, 19699, "PA"], // 150-196
  [19700, 19999, "DE"], // 197-199
  // Mid-Atlantic + South
  [20000, 20099, "DC"], // 200
  [20100, 20199, "VA"], // 201 (overlay)
  [20200, 20599, "DC"], // 202-205
  [20600, 21999, "MD"], // 206-219
  [22000, 24699, "VA"], // 220-246
  [24700, 26899, "WV"], // 247-268
  [27000, 28999, "NC"], // 270-289
  [29000, 29999, "SC"], // 290-299
  [30000, 31999, "GA"], // 300-319
  [32000, 34999, "FL"], // 320-349
  [35000, 36999, "AL"], // 350-369
  [37000, 38599, "TN"], // 370-385
  [38600, 39799, "MS"], // 386-397
  [39800, 39999, "GA"], // 398-399 (overlay)
  [40000, 42799, "KY"], // 400-427
  [43000, 45999, "OH"], // 430-459
  [46000, 47999, "IN"], // 460-479
  [48000, 49999, "MI"], // 480-499
  [50000, 52899, "IA"], // 500-528
  [53000, 54999, "WI"], // 530-549
  [55000, 56799, "MN"], // 550-567
  [57000, 57799, "SD"], // 570-577
  [58000, 58899, "ND"], // 580-588
  [59000, 59999, "MT"], // 590-599
  [60000, 62999, "IL"], // 600-629
  [63000, 65899, "MO"], // 630-658
  [66000, 67999, "KS"], // 660-679
  [68000, 69399, "NE"], // 680-693
  [70000, 71499, "LA"], // 700-714
  [71600, 72999, "AR"], // 716-729
  [73000, 74999, "OK"], // 730-749
  [75000, 79999, "TX"], // 750-799
  [80000, 81699, "CO"], // 800-816
  [82000, 83199, "WY"], // 820-831
  [83200, 83899, "ID"], // 832-838
  [84000, 84799, "UT"], // 840-847
  [85000, 86599, "AZ"], // 850-865
  [87000, 88499, "NM"], // 870-884
  [88500, 88599, "TX"], // 885 (overlay)
  [88900, 89899, "NV"], // 889-898
  [90000, 96199, "CA"], // 900-961
  [96700, 96899, "HI"], // 967-968
  [97000, 97999, "OR"], // 970-979
  [98000, 99499, "WA"], // 980-994
  [99500, 99999, "AK"], // 995-999
];
