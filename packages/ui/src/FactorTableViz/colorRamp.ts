/**
 * Brief 45 PR 45.1 — Continuous color gradient for factor values.
 *
 * Brief 34 PR 34.1 encoded factor magnitude as three discrete tints
 * (low / mid / high), keyed off a 1% deviation threshold from
 * baseline. That choice reads as "categorical" on a chart — the
 * viewer sees three colored groups, not a continuous magnitude
 * encoding.
 *
 * Brief 45 §−1 Q5 lock: a continuous, perceptually-uniform gradient
 * from azure-700 (factor = 0.5) through neutral-300 (factor = 1.0)
 * to orange-600 (factor = 2.0). Outside that range, clamp to the
 * endpoint colors.
 *
 *   value 0.5   → azure-700  (#1d4ed8)
 *   value 0.75  → azure-500  (#3b82f6) — interpolated
 *   value 1.00  → neutral-300 (#d4d4d8)
 *   value 1.25  → orange-300 (#fdba74) — interpolated
 *   value 2.00  → orange-600 (#ea580c)
 *
 * Same azure + orange scales already used by the analytics map
 * (Brief 43) and the geo bucket ramp (Brief 44 PR 44.5) — visual
 * cohesion across surfaces.
 *
 * Pure module. No React, no DOM, no SVG. Returns raw hex strings
 * so the function can drop into SVG `fill="…"` AND MapLibre paint
 * AND CSS `background:` without needing the design-system
 * tokens to be loaded.
 */

// ─────────────────────────────────────────────────────────────────
// Stop palette (mirrors the design-system tokens, kept here as raw
// hex so the function is dependency-free).
// ─────────────────────────────────────────────────────────────────

interface ColorStop {
  readonly value: number;
  readonly hex: string;
}

/** Cool side (factor < 1.0). Ordered low → high value. */
const COOL_STOPS: readonly ColorStop[] = [
  { value: 0.5, hex: "#1d4ed8" }, // azure-700
  { value: 0.7, hex: "#3b82f6" }, // azure-500
  { value: 0.85, hex: "#93c5fd" }, // azure-300
  { value: 1.0, hex: "#d4d4d8" }, // zinc-300 (neutral)
];

/** Warm side (factor > 1.0). Ordered low → high value. */
const WARM_STOPS: readonly ColorStop[] = [
  { value: 1.0, hex: "#d4d4d8" }, // zinc-300 (neutral)
  { value: 1.15, hex: "#fdba74" }, // orange-300
  { value: 1.5, hex: "#f97316" }, // orange-500
  { value: 2.0, hex: "#ea580c" }, // orange-600
];

/** Min value clamp — anything below maps to the deepest azure. */
export const FACTOR_GRADIENT_MIN = 0.5;
/** Max value clamp — anything above maps to the deepest orange. */
export const FACTOR_GRADIENT_MAX = 2.0;
/** Reserved color for missing / NaN values. */
export const FACTOR_GRADIENT_NEUTRAL = "#a1a1aa"; // zinc-400

// ─────────────────────────────────────────────────────────────────
// Hex ⇄ RGB
// ─────────────────────────────────────────────────────────────────

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  // Accepts "#rrggbb" only. The palette above is curated; we don't
  // need to handle other shapes.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHex(rgb: Rgb): string {
  const h = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

// ─────────────────────────────────────────────────────────────────
// Interpolation across a stop list
// ─────────────────────────────────────────────────────────────────

function interpStops(value: number, stops: readonly ColorStop[]): string {
  // Find the two stops bracketing `value`; lerp in RGB space.
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (value <= first.value) return first.hex;
  if (value >= last.value) return last.hex;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (value >= lo.value && value <= hi.value) {
      const t = (value - lo.value) / (hi.value - lo.value);
      return rgbToHex(lerpRgb(hexToRgb(lo.hex), hexToRgb(hi.hex), t));
    }
  }
  return last.hex; // Unreachable — kept as a safety net.
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Map a factor value to a hex color on the continuous gradient.
 *
 * Brief 45 Q5 lock: azure-700 (0.5) → neutral (1.0) → orange-600
 * (2.0). Values outside [0.5, 2.0] clamp to the endpoint.
 *
 * `baseline` defaults to 1.0 (the multiplicative identity). When a
 * non-1.0 baseline is supplied (a future use case — Brief 45 doesn't
 * exercise it directly), the gradient pivots around that point —
 * the input value is normalized to `value / baseline` before lookup.
 * That keeps the encoding meaningful for additive or transformed
 * factor scales.
 *
 * Returns `FACTOR_GRADIENT_NEUTRAL` for non-finite inputs (NaN,
 * ±Infinity) so the caller can render the cell without crashing.
 */
export function factorGradient(value: number, baseline = 1.0): string {
  if (!Number.isFinite(value)) return FACTOR_GRADIENT_NEUTRAL;
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return FACTOR_GRADIENT_NEUTRAL;
  }

  // Normalize to the canonical 1.0-centered domain when a non-1.0
  // baseline is supplied. This is a multiplicative re-center.
  const v = baseline === 1.0 ? value : value / baseline;

  if (v < FACTOR_GRADIENT_MIN) return COOL_STOPS[0]!.hex;
  if (v > FACTOR_GRADIENT_MAX) return WARM_STOPS[WARM_STOPS.length - 1]!.hex;

  if (v < 1.0) return interpStops(v, COOL_STOPS);
  if (v > 1.0) return interpStops(v, WARM_STOPS);
  // Exactly at baseline.
  return COOL_STOPS[COOL_STOPS.length - 1]!.hex; // "#d4d4d8" — neutral
}

/**
 * Six-stop legend descriptor for the chart pane's gradient swatch.
 * Returns the values + hex colors so the consumer can render a
 * standalone legend strip.
 */
export interface GradientLegendStop {
  readonly value: number;
  readonly hex: string;
  readonly label: string;
}

export function factorGradientLegend(): readonly GradientLegendStop[] {
  return [
    { value: 0.5, hex: factorGradient(0.5), label: "0.5" },
    { value: 0.75, hex: factorGradient(0.75), label: "0.75" },
    { value: 1.0, hex: factorGradient(1.0), label: "1.0" },
    { value: 1.25, hex: factorGradient(1.25), label: "1.25" },
    { value: 1.5, hex: factorGradient(1.5), label: "1.5" },
    { value: 2.0, hex: factorGradient(2.0), label: "2.0" },
  ];
}
