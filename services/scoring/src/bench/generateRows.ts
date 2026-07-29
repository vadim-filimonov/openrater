/**
 * Deterministic BOP-shaped row generator for the benchmark.
 *
 * Shaped to the V49 "exposure-rated-tower" plan (territory ×
 * prop_rate_number lookups + exposure÷divisor + ISO rounding — the E13
 * path): each row carries `territory`, `prop_rate_number`,
 * `building_limit`. A fixed seed → reproducible books across runs.
 */

export interface BenchRow extends Record<string, unknown> {
  readonly territory: string;
  readonly prop_rate_number: string;
  readonly building_limit: number;
}

/** Small, fast, seedable PRNG (mulberry32) — reproducible benchmarks. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TERRITORIES = ["701", "702", "703", "704", "705"] as const;
const RATE_NUMBERS = ["07", "08", "09", "10", "11"] as const;

export function generateRows(count: number, seed = 1): BenchRow[] {
  const rand = mulberry32(seed);
  const rows: BenchRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const territory = TERRITORIES[Math.floor(rand() * TERRITORIES.length)]!;
    const prop_rate_number = RATE_NUMBERS[Math.floor(rand() * RATE_NUMBERS.length)]!;
    // $50k–$5M building limit, rounded to $1k.
    const building_limit = Math.round((50_000 + rand() * 4_950_000) / 1000) * 1000;
    rows.push({ territory, prop_rate_number, building_limit });
  }
  return rows;
}
