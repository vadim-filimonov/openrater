/**
 * `toFiniteNumber` — coerce a runtime wire value to a finite number for
 * arithmetic, or `NaN` when it has no numeric meaning.
 *
 * The wire is stringly (CSV rows, HTML forms, integrators whose fact
 * values are `string | number`), and a numeric-typed input node does not
 * always re-type it before it reaches an arithmetic node — so a clean
 * numeric string must still coerce, exactly as JS arithmetic did
 * implicitly (`"200000" / 100 === 2000`).
 *
 * But `null` / `[]` / `{}` / booleans / `""` / non-numeric strings have
 * NO numeric meaning. JS arithmetic silently improvised them —
 * `null`/`[]`/`""` → 0 and `true` → 1 — which served a WRONG premium as
 * `row_status: "ok"` (audit A-2026-07-12 P1-01). Returning `NaN` for
 * those routes through the output node's unresolved-output backstop,
 * which WITHHOLDS the premium and names the refusal (ADR-0056 G8
 * withhold-not-improvise). A value already a finite number is unchanged.
 */
export function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN; // null, undefined, boolean, array, object
}
