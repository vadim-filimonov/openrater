/**
 * Class vocabulary library — Brief 21 §6 (Class translator).
 *
 * Cross-vocabulary class translation. V1 ships four canonical
 * vocabularies (Meridian BOP — the reference program's own class
 * table; NAICS-2022 and SIC-1987 — public US-government
 * classifications; plus the proprietary slot) + small illustrative
 * crosswalk data between them.
 *
 * Per Brief 21 P-CT1: translation is MANY-TO-MANY. The same source
 * code may map to multiple target codes; this module returns ALL
 * matches with explicit confidence + crosswalk citation. The caller
 * (UI) decides which (if any) to apply.
 *
 * Per Brief 21 P-CT2: no inference, no ML. Every match comes from a
 * curated crosswalk entry with a citation_rule + citation_page.
 *
 * Note: the V1 catalog ships a few representative entries per
 * vocabulary + a handful of crosswalks (e.g., restaurants: Meridian
 * c104 ↔ NAICS 722513 ↔ SIC 5812). The Meridian entries and the
 * Meridian↔NAICS edges are FICTIONAL (they cite the reference
 * filing); the NAICS↔SIC edges follow the public BLS concordance.
 * Real deployments load their own vocabularies through the
 * proprietary slot — no licensed bureau catalogs ship in this repo.
 *
 * Pure data + pure functions. No I/O.
 */

// ── Vocabulary identity ───────────────────────────────────────────

/**
 * Closed vocabulary of supported class systems in V1. Proprietary
 * vocabularies are loaded at runtime via registerProprietaryVocabulary
 * and identified by a stable `id` string.
 */
export type VocabId =
  | "meridian_bop"
  | "naics_2022"
  | "sic_1987"
  | { readonly kind: "proprietary"; readonly id: string };

/** Convenience: pretty-print a VocabId as a stable string. */
export function vocabIdKey(id: VocabId): string {
  return typeof id === "string" ? id : `proprietary:${id.id}`;
}

/** True if two VocabIds refer to the same vocabulary. */
export function vocabIdEquals(a: VocabId, b: VocabId): boolean {
  return vocabIdKey(a) === vocabIdKey(b);
}

/**
 * Metadata about a vocabulary. Drives the picker UI.
 */
export interface Vocabulary {
  readonly id: VocabId;
  readonly name: string;
  /** Version label (e.g., "2026-Q3", "1987", "2022"). */
  readonly version: string;
  readonly description: string;
  /** Source publication (e.g., "US Census Bureau / BLS"). */
  readonly source: string;
  /** Number of class entries in this vocabulary. */
  readonly count: number;
}

// ── Class entries ─────────────────────────────────────────────────

/**
 * One class entry within a vocabulary.
 */
export interface ClassEntry {
  readonly vocab_id: VocabId;
  readonly code: string;
  readonly description: string;
  /** Optional parent code for hierarchical vocabularies (NAICS). */
  readonly parent_code?: string;
  /** Eligibility hints (for proprietary catalogs: which LOBs apply). */
  readonly eligible_for?: readonly string[];
}

// ── Cross-vocabulary matches ──────────────────────────────────────

/** Confidence level for a match. Explicit per P-CT3. */
export type MatchConfidence = "high" | "medium" | "low";

/**
 * One match in the crosswalk. From → To with explicit confidence +
 * citation.
 */
export interface ClassMatch {
  readonly from: ClassEntryRef;
  readonly to: ClassEntryRef;
  readonly confidence: MatchConfidence;
  /** Optional disambiguation note shown in the UI. */
  readonly note?: string;
  readonly citation_rule: string;
  readonly citation_page: string;
  /** Identifier of the crosswalk publication. */
  readonly crosswalk_id: string;
}

export interface ClassEntryRef {
  readonly vocab_id: VocabId;
  readonly code: string;
  readonly description: string;
}

// ── Internal: canonical vocabulary catalog ────────────────────────

/**
 * V1 illustrative class entries. Production deployments replace
 * with the full vetted vocabularies.
 *
 * Per-vocabulary entries kept small + representative — enough to
 * exercise the translation paths in tests + the cold-test rubric.
 */
const MERIDIAN_BOP_ENTRIES: readonly Omit<ClassEntry, "vocab_id">[] = [
  { code: "c101", description: "Retail — general merchandise" },
  { code: "c103", description: "Office — professional" },
  { code: "c104", description: "Restaurant — limited cooking" },
  { code: "c105", description: "Bakery" },
  { code: "c109", description: "Pharmacy" },
  { code: "c112", description: "Welding supply" },
  { code: "c113", description: "Grocery — neighborhood" },
  { code: "c115", description: "Coffee shop — no frying" },
  { code: "c128", description: "Laundromat — self service" },
  { code: "c136", description: "Medical office — no surgery" },
  { code: "c138", description: "Veterinary office — small animal" },
];

const NAICS_2022_ENTRIES: readonly Omit<ClassEntry, "vocab_id">[] = [
  {
    code: "722511",
    description: "Full-Service Restaurants",
    parent_code: "72251",
  },
  {
    code: "722513",
    description: "Limited-Service Restaurants",
    parent_code: "72251",
  },
  {
    code: "311811",
    description: "Retail Bakeries",
    parent_code: "31181",
  },
  {
    code: "445110",
    description: "Supermarkets and Other Grocery Retailers",
    parent_code: "44511",
  },
  {
    code: "446110",
    description: "Pharmacies and Drug Stores",
    parent_code: "44611",
  },
  {
    code: "455110",
    description: "Department Stores",
    parent_code: "45511",
  },
  {
    code: "455219",
    description: "All Other General Merchandise Retailers",
    parent_code: "45521",
  },
  {
    code: "531120",
    description: "Lessors of Nonresidential Buildings",
    parent_code: "53112",
  },
  {
    code: "541940",
    description: "Veterinary Services",
    parent_code: "54194",
  },
  {
    code: "621111",
    description: "Offices of Physicians (except Mental Health Specialists)",
    parent_code: "62111",
  },
  {
    code: "812310",
    description: "Coin-Operated Laundries and Drycleaners",
    parent_code: "81231",
  },
];

const SIC_1987_ENTRIES: readonly Omit<ClassEntry, "vocab_id">[] = [
  { code: "5812", description: "Eating places" },
  { code: "5461", description: "Retail bakeries" },
  { code: "5912", description: "Drug stores and proprietary stores" },
  { code: "8011", description: "Offices and clinics of doctors of medicine" },
];

// ── Vocabulary metadata + entry indexing ──────────────────────────

const CANONICAL_VOCABS: ReadonlyMap<
  string,
  { readonly vocab: Vocabulary; readonly entries: readonly ClassEntry[] }
> = new Map([
  [
    vocabIdKey("meridian_bop"),
    {
      vocab: {
        id: "meridian_bop",
        name: "Meridian BOP",
        version: "2026",
        description:
          "The Meridian Shopfront BOP class table (fictional reference program).",
        source: "Meridian Shopfront BOP filing, Rule E.1 (fictional)",
        count: MERIDIAN_BOP_ENTRIES.length,
      },
      entries: MERIDIAN_BOP_ENTRIES.map((e) => ({
        ...e,
        vocab_id: "meridian_bop" as const,
      })),
    },
  ],
  [
    vocabIdKey("naics_2022"),
    {
      vocab: {
        id: "naics_2022",
        name: "NAICS 2022",
        version: "2022",
        description: "North American Industry Classification System, 2022 vintage.",
        source: "US Census Bureau / BLS",
        count: NAICS_2022_ENTRIES.length,
      },
      entries: NAICS_2022_ENTRIES.map((e) => ({
        ...e,
        vocab_id: "naics_2022" as const,
      })),
    },
  ],
  [
    vocabIdKey("sic_1987"),
    {
      vocab: {
        id: "sic_1987",
        name: "SIC 1987",
        version: "1987",
        description: "Standard Industrial Classification (legacy; pre-NAICS).",
        source: "US Department of Labor (deprecated 1997, still cited)",
        count: SIC_1987_ENTRIES.length,
      },
      entries: SIC_1987_ENTRIES.map((e) => ({
        ...e,
        vocab_id: "sic_1987" as const,
      })),
    },
  ],
]);

// ── Internal: canonical crosswalk catalog ─────────────────────────

/**
 * Pre-computed crosswalk edges. V1 ships a small illustrative set
 * covering the restaurant + retail + medical archetypes so tests +
 * the cold-test exercise multiple confidence paths.
 *
 * Provenance: Meridian↔NAICS edges are FICTIONAL — they cite the
 * reference filing's class table (Rule E.1) and exist to demo the
 * translator. NAICS↔SIC edges follow the public BLS concordance.
 *
 * The list is normalized: each entry is one directed edge with
 * source + target codes + confidence + citation. The translateClass
 * function looks edges up via an index built lazily.
 */
interface RawCrosswalkEdge {
  readonly from_vocab: VocabId;
  readonly from_code: string;
  readonly to_vocab: VocabId;
  readonly to_code: string;
  readonly confidence: MatchConfidence;
  readonly note?: string;
  readonly citation_rule: string;
  readonly citation_page: string;
  readonly crosswalk_id: string;
}

const MERIDIAN_CITE = {
  citation_rule: "Meridian Shopfront BOP filing — class table (fictional)",
  citation_page: "Rule E.1 p.7",
  crosswalk_id: "meridian_naics_2026",
} as const;

const RAW_CROSSWALKS: readonly RawCrosswalkEdge[] = [
  // ── Restaurants (many-to-one into NAICS limited-service) ──
  {
    from_vocab: "meridian_bop",
    from_code: "c104",
    to_vocab: "naics_2022",
    to_code: "722513",
    confidence: "high",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "meridian_bop",
    from_code: "c115",
    to_vocab: "naics_2022",
    to_code: "722513",
    confidence: "medium",
    note: "Coffee shops without frying are closest to limited-service restaurants.",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "naics_2022",
    from_code: "722511",
    to_vocab: "sic_1987",
    to_code: "5812",
    confidence: "high",
    note: "SIC 5812 covers both full + limited service.",
    citation_rule: "NAICS ↔ SIC Concordance",
    citation_page: "BLS 2022 p.11",
    crosswalk_id: "naics_sic_2022",
  },
  {
    from_vocab: "naics_2022",
    from_code: "722513",
    to_vocab: "sic_1987",
    to_code: "5812",
    confidence: "high",
    note: "SIC 5812 covers both full + limited service.",
    citation_rule: "NAICS ↔ SIC Concordance",
    citation_page: "BLS 2022 p.11",
    crosswalk_id: "naics_sic_2022",
  },

  // ── Bakery ──
  {
    from_vocab: "meridian_bop",
    from_code: "c105",
    to_vocab: "naics_2022",
    to_code: "311811",
    confidence: "high",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "naics_2022",
    from_code: "311811",
    to_vocab: "sic_1987",
    to_code: "5461",
    confidence: "high",
    citation_rule: "NAICS ↔ SIC Concordance",
    citation_page: "BLS 2022 p.7",
    crosswalk_id: "naics_sic_2022",
  },

  // ── Retail ──
  {
    from_vocab: "meridian_bop",
    from_code: "c109",
    to_vocab: "naics_2022",
    to_code: "446110",
    confidence: "high",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "naics_2022",
    from_code: "446110",
    to_vocab: "sic_1987",
    to_code: "5912",
    confidence: "high",
    citation_rule: "NAICS ↔ SIC Concordance",
    citation_page: "BLS 2022 p.13",
    crosswalk_id: "naics_sic_2022",
  },
  {
    from_vocab: "meridian_bop",
    from_code: "c113",
    to_vocab: "naics_2022",
    to_code: "445110",
    confidence: "high",
    ...MERIDIAN_CITE,
  },
  // General merchandise — one-to-many with mixed confidence
  // (illustrates the sorted high → medium → low UI path).
  {
    from_vocab: "meridian_bop",
    from_code: "c101",
    to_vocab: "naics_2022",
    to_code: "455219",
    confidence: "medium",
    note: "General merchandise spans several NAICS retail industries.",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "meridian_bop",
    from_code: "c101",
    to_vocab: "naics_2022",
    to_code: "455110",
    confidence: "low",
    note: "Department stores only when the store is departmentalized.",
    ...MERIDIAN_CITE,
  },

  // ── Offices — ambiguous (no occupant-office NAICS industry) ──
  {
    from_vocab: "meridian_bop",
    from_code: "c103",
    to_vocab: "naics_2022",
    to_code: "531120",
    confidence: "low",
    note: "Occupant offices have no single NAICS industry; lessors code applies to building-owner risks.",
    ...MERIDIAN_CITE,
  },

  // ── Services ──
  {
    from_vocab: "meridian_bop",
    from_code: "c128",
    to_vocab: "naics_2022",
    to_code: "812310",
    confidence: "high",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "meridian_bop",
    from_code: "c138",
    to_vocab: "naics_2022",
    to_code: "541940",
    confidence: "high",
    ...MERIDIAN_CITE,
  },

  // ── Medical ──
  {
    from_vocab: "meridian_bop",
    from_code: "c136",
    to_vocab: "naics_2022",
    to_code: "621111",
    confidence: "high",
    ...MERIDIAN_CITE,
  },
  {
    from_vocab: "naics_2022",
    from_code: "621111",
    to_vocab: "sic_1987",
    to_code: "8011",
    confidence: "high",
    citation_rule: "NAICS ↔ SIC Concordance",
    citation_page: "BLS 2022 p.17",
    crosswalk_id: "naics_sic_2022",
  },
];

// ── Mutable runtime registry (proprietary slot) ───────────────────

interface ProprietaryRegistration {
  readonly vocab: Vocabulary;
  readonly entries: ReadonlyMap<string, ClassEntry>;
  /** Crosswalks defined for this proprietary vocab. */
  readonly crosswalks: readonly RawCrosswalkEdge[];
}

const proprietaryRegistry = new Map<string, ProprietaryRegistration>();

/**
 * Register a proprietary vocabulary at runtime. Used by the
 * proprietary-upload flow in @openrater/ui. Returns the registered
 * Vocabulary metadata for downstream consumers.
 *
 * If a proprietary vocabulary with the same id already exists, it is
 * REPLACED (per Brief 21 §6 design note: re-upload is the upgrade
 * path).
 */
export function registerProprietaryVocabulary(args: {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly source: string;
  readonly entries: readonly ClassEntry[];
  readonly crosswalks?: readonly RawCrosswalkEdge[];
}): Vocabulary {
  const vocabId: VocabId = { kind: "proprietary", id: args.id };
  const entriesMap = new Map<string, ClassEntry>();
  for (const e of args.entries) {
    entriesMap.set(e.code, { ...e, vocab_id: vocabId });
  }
  const vocab: Vocabulary = {
    id: vocabId,
    name: args.name,
    version: args.version,
    description: args.description,
    source: args.source,
    count: args.entries.length,
  };
  proprietaryRegistry.set(args.id, {
    vocab,
    entries: entriesMap,
    crosswalks: args.crosswalks ?? [],
  });
  return vocab;
}

/**
 * Unregister a previously-registered proprietary vocabulary. Pure
 * test-helper; production code typically doesn't unregister.
 */
export function unregisterProprietaryVocabulary(id: string): void {
  proprietaryRegistry.delete(id);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Enumerate the canonical + any registered proprietary vocabularies.
 * The order is stable: canonical first (declaration order), then
 * proprietary (registration order).
 */
export function listVocabularies(): readonly Vocabulary[] {
  const out: Vocabulary[] = [];
  for (const { vocab } of CANONICAL_VOCABS.values()) out.push(vocab);
  for (const { vocab } of proprietaryRegistry.values()) out.push(vocab);
  return out;
}

/**
 * Look up a vocabulary by id. Returns undefined for unknown id.
 */
export function getVocabulary(id: VocabId): Vocabulary | undefined {
  if (typeof id === "string") {
    return CANONICAL_VOCABS.get(vocabIdKey(id))?.vocab;
  }
  return proprietaryRegistry.get(id.id)?.vocab;
}

/**
 * Look up a class entry by vocabulary + code. Returns undefined for
 * unknown vocabulary or unknown code.
 */
export function getClassEntry(
  id: VocabId,
  code: string,
): ClassEntry | undefined {
  if (typeof id === "string") {
    const entries = CANONICAL_VOCABS.get(vocabIdKey(id))?.entries;
    return entries?.find((e) => e.code === code);
  }
  return proprietaryRegistry.get(id.id)?.entries.get(code);
}

/**
 * Translate a class code from one vocabulary to another. Returns the
 * list of ALL matches (many-to-many per P-CT1) sorted by confidence
 * (high → medium → low), then by target code ascending for stability.
 *
 * Returns an empty array if:
 *   - the source vocabulary or code is unknown, OR
 *   - no crosswalk exists between the two vocabularies for that code
 *
 * Pure + deterministic.
 */
export function translateClass(
  from: VocabId,
  code: string,
  to: VocabId,
): readonly ClassMatch[] {
  if (vocabIdEquals(from, to)) {
    // Identity translation: return the class itself with high
    // confidence + a synthetic self-citation. Useful for UI uniformity.
    const entry = getClassEntry(from, code);
    if (!entry) return [];
    return [
      {
        from: { vocab_id: from, code, description: entry.description },
        to: { vocab_id: to, code, description: entry.description },
        confidence: "high",
        citation_rule: "Identity",
        citation_page: "—",
        crosswalk_id: "identity",
      },
    ];
  }

  const fromEntry = getClassEntry(from, code);
  if (!fromEntry) return [];

  const edges = collectEdgesFor(from, code, to);
  const matches: ClassMatch[] = [];
  for (const edge of edges) {
    const toEntry = getClassEntry(to, edge.to_code);
    if (!toEntry) continue;
    matches.push({
      from: {
        vocab_id: from,
        code: fromEntry.code,
        description: fromEntry.description,
      },
      to: {
        vocab_id: to,
        code: toEntry.code,
        description: toEntry.description,
      },
      confidence: edge.confidence,
      ...(edge.note !== undefined ? { note: edge.note } : {}),
      citation_rule: edge.citation_rule,
      citation_page: edge.citation_page,
      crosswalk_id: edge.crosswalk_id,
    });
  }

  // Sort: confidence high → medium → low, then by target code.
  matches.sort((a, b) => {
    const ca = confidenceRank(a.confidence);
    const cb = confidenceRank(b.confidence);
    if (ca !== cb) return ca - cb;
    return a.to.code < b.to.code ? -1 : 1;
  });
  return matches;
}

/**
 * Bulk translation: translate every (source code) in the input list.
 * Returns one entry per input code with the matches (which may be
 * empty for un-translatable codes). Order is preserved.
 *
 * Pure + deterministic.
 */
export interface BulkTranslationResult {
  readonly source_code: string;
  readonly matches: readonly ClassMatch[];
  /** True if zero matches (source unknown OR no crosswalk). */
  readonly unmatched: boolean;
}

export function translateClassBatch(
  from: VocabId,
  codes: readonly string[],
  to: VocabId,
): readonly BulkTranslationResult[] {
  return codes.map((code) => {
    const matches = translateClass(from, code, to);
    return { source_code: code, matches, unmatched: matches.length === 0 };
  });
}

// ── Internal helpers ──────────────────────────────────────────────

function confidenceRank(c: MatchConfidence): number {
  return c === "high" ? 0 : c === "medium" ? 1 : 2;
}

function collectEdgesFor(
  from: VocabId,
  code: string,
  to: VocabId,
): readonly RawCrosswalkEdge[] {
  const out: RawCrosswalkEdge[] = [];
  const fromKey = vocabIdKey(from);
  const toKey = vocabIdKey(to);

  // Canonical crosswalks. We treat the catalog as undirected — if A→B
  // is registered, B→A is also returned (with the same citation).
  for (const edge of RAW_CROSSWALKS) {
    if (
      vocabIdKey(edge.from_vocab) === fromKey &&
      edge.from_code === code &&
      vocabIdKey(edge.to_vocab) === toKey
    ) {
      out.push(edge);
    } else if (
      vocabIdKey(edge.to_vocab) === fromKey &&
      edge.to_code === code &&
      vocabIdKey(edge.from_vocab) === toKey
    ) {
      // Reverse the edge.
      out.push({
        from_vocab: edge.to_vocab,
        from_code: edge.to_code,
        to_vocab: edge.from_vocab,
        to_code: edge.from_code,
        confidence: edge.confidence,
        ...(edge.note !== undefined ? { note: edge.note } : {}),
        citation_rule: edge.citation_rule,
        citation_page: edge.citation_page,
        crosswalk_id: edge.crosswalk_id,
      });
    }
  }

  // Proprietary crosswalks.
  for (const reg of proprietaryRegistry.values()) {
    for (const edge of reg.crosswalks) {
      if (
        vocabIdKey(edge.from_vocab) === fromKey &&
        edge.from_code === code &&
        vocabIdKey(edge.to_vocab) === toKey
      ) {
        out.push(edge);
      } else if (
        vocabIdKey(edge.to_vocab) === fromKey &&
        edge.to_code === code &&
        vocabIdKey(edge.from_vocab) === toKey
      ) {
        out.push({
          from_vocab: edge.to_vocab,
          from_code: edge.to_code,
          to_vocab: edge.from_vocab,
          to_code: edge.from_code,
          confidence: edge.confidence,
          ...(edge.note !== undefined ? { note: edge.note } : {}),
          citation_rule: edge.citation_rule,
          citation_page: edge.citation_page,
          crosswalk_id: edge.crosswalk_id,
        });
      }
    }
  }

  return out;
}

// Re-export the raw edge type for the proprietary-upload caller.
export type { RawCrosswalkEdge as ProprietaryCrosswalkEdge };
