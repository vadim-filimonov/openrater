/**
 * dates — the ONE absolute date rendering (presentation consistency
 * §3.4). Absolute dates are ISO (`2026-07-18`), with 24h minutes when
 * the time is load-bearing (`2026-07-18 21:12`). Relative renderings
 * ("1d ago") are allowed only in list recency columns — that decision
 * stays at the call site; this module is the absolute half.
 *
 * Local-time components (not `toISOString`'s UTC) so an evening
 * timestamp doesn't render as tomorrow. A bare `YYYY-MM-DD` string
 * passes through verbatim — parsing it would shift it across the UTC
 * boundary for western offsets.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `2026-07-18`, or "" when the value doesn't parse. */
export function isoDate(value: string | number | Date): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `2026-07-18 21:12`, or "" when the value doesn't parse. */
export function isoDateTime(value: string | number | Date): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
