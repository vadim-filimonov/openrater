/**
 * name-similarity — the identifier-matching core shared by the app's
 * book intake and the MCP header preflight.
 *
 * Re-homed VERBATIM from `@openrater/ui` InputsWorkspace/autoMatch
 * so the app's Auto-recognize and the chat door's header pre-flight judge "does
 * this column name mean that input" with ONE algorithm. `autoMatch`
 * re-exports these; no consumer semantics changed.
 */

/**
 * Lowercase + strip non-alphanumerics. Used for the equality + the
 * containment checks. NOT used for Levenshtein (which preserves
 * separators when computing token-aware similarity).
 */
export function normalizeIdent(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Tokenize on snake_case, kebab-case, camelCase, whitespace, AND any
 * other non-alphanumeric punctuation (parens, brackets, colons, etc.).
 * Lowercased; empty tokens dropped. (PR 11f — the broad separator
 * class lets "Total insurable value (TIV)" token-match a clean "tiv".)
 */
export function tokenize(s: string): readonly string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Classic Levenshtein distance — single-row DP for O(min(m,n)) space. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Keep `a` the shorter for memory.
  if (a.length > b.length) [a, b] = [b, a];
  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1, // deletion
        curr[i - 1] + 1, // insertion
        prev[i - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/** Normalized Levenshtein similarity in [0, 1]. */
function levenshteinSim(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1.0;
  return 1 - levenshtein(a, b) / max;
}

/** Jaccard similarity on token sets ("building_age" ↔ "age_of_building"). */
function tokenJaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Token-coverage similarity (Brief 57): the MAX over both directions
 * of the length-weighted mean per-token prefix-match quality — "what
 * fraction of THIS identifier's characters are explained by a good
 * prefix-match in the OTHER identifier."
 */
function tokenPrefixSimilarity(
  a: readonly string[],
  b: readonly string[],
): number {
  if (a.length === 0 || b.length === 0) return 0;
  return Math.max(
    directionalTokenCoverage(a, b),
    directionalTokenCoverage(b, a),
  );
}

function directionalTokenCoverage(
  from: readonly string[],
  to: readonly string[],
): number {
  let weighted = 0;
  let totalLen = 0;
  for (const tf of from) {
    totalLen += tf.length;
    let bestFrac = 0;
    for (const tt of to) {
      const shared = sharedPrefixLen(tf, tt);
      if (shared === 0) continue;
      const denom = Math.max(tf.length, tt.length);
      const frac = shared / denom;
      if (frac > bestFrac) bestFrac = frac;
    }
    weighted += bestFrac * tf.length;
  }
  return totalLen === 0 ? 0 : weighted / totalLen;
}

function sharedPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Name-match similarity between two identifier strings, in [0, 1] —
 * the MAX of four signals: containment (abbreviation ⊂ full name),
 * token Jaccard (reorders), token prefix coverage (Brief 57), and a
 * char-level Levenshtein fallback.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeIdent(a);
  const nb = normalizeIdent(b);
  if (na === "" || nb === "") return 0;
  if (na === nb) return 1.0;

  // Containment — ONE OF the signals (PR 11f), never an early return.
  let containmentScore = 0;
  if (na.length >= 3 && nb.length >= 3) {
    if (na.includes(nb) || nb.includes(na)) {
      const shorter = Math.min(na.length, nb.length);
      const longer = Math.max(na.length, nb.length);
      const ratio = shorter / longer;
      containmentScore = 0.7 + 0.25 * ratio;
    }
  }

  const ta = tokenize(a);
  const tb = tokenize(b);
  const jaccard = tokenJaccard(ta, tb);
  const prefix = tokenPrefixSimilarity(ta, tb);
  const charSim = levenshteinSim(na, nb);

  return Math.max(containmentScore, jaccard, prefix, charSim);
}
