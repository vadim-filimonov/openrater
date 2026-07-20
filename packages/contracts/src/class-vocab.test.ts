/**
 * Tests for class-vocab.ts — Brief 21 §6.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  getClassEntry,
  getVocabulary,
  listVocabularies,
  registerProprietaryVocabulary,
  translateClass,
  translateClassBatch,
  unregisterProprietaryVocabulary,
  vocabIdEquals,
  vocabIdKey,
  type VocabId,
} from "./class-vocab";

describe("vocabIdKey + vocabIdEquals", () => {
  it("renders canonical ids as strings", () => {
    expect(vocabIdKey("meridian_bop")).toBe("meridian_bop");
    expect(vocabIdKey("naics_2022")).toBe("naics_2022");
  });

  it("renders proprietary ids with the prefix", () => {
    expect(vocabIdKey({ kind: "proprietary", id: "carrier-x" })).toBe(
      "proprietary:carrier-x",
    );
  });

  it("equals returns true for identical ids", () => {
    expect(vocabIdEquals("meridian_bop", "meridian_bop")).toBe(true);
    expect(
      vocabIdEquals(
        { kind: "proprietary", id: "x" },
        { kind: "proprietary", id: "x" },
      ),
    ).toBe(true);
  });

  it("equals returns false for different ids", () => {
    expect(vocabIdEquals("meridian_bop", "naics_2022")).toBe(false);
    expect(
      vocabIdEquals(
        { kind: "proprietary", id: "x" },
        { kind: "proprietary", id: "y" },
      ),
    ).toBe(false);
  });
});

describe("listVocabularies + getVocabulary", () => {
  it("ships the 3 canonical vocabularies", () => {
    const names = listVocabularies().map((v) => v.id);
    expect(names).toContain("meridian_bop");
    expect(names).toContain("naics_2022");
    expect(names).toContain("sic_1987");
  });

  it("each vocabulary has a non-empty name + count > 0", () => {
    for (const v of listVocabularies()) {
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.count).toBeGreaterThan(0);
    }
  });

  it("getVocabulary returns metadata for known ids", () => {
    expect(getVocabulary("meridian_bop")?.name).toBe("Meridian BOP");
    expect(getVocabulary("naics_2022")?.name).toBe("NAICS 2022");
  });

  it("getVocabulary returns undefined for unknown proprietary id", () => {
    expect(
      getVocabulary({ kind: "proprietary", id: "nonexistent" }),
    ).toBeUndefined();
  });
});

describe("getClassEntry", () => {
  it("returns entry for known code", () => {
    const entry = getClassEntry("meridian_bop", "c104");
    expect(entry?.description).toMatch(/Restaurant/i);
  });

  it("returns undefined for unknown code", () => {
    expect(getClassEntry("meridian_bop", "c999")).toBeUndefined();
  });

  it("returns undefined for unknown vocabulary", () => {
    expect(
      getClassEntry({ kind: "proprietary", id: "ghost" }, "01"),
    ).toBeUndefined();
  });
});

// ── translateClass ────────────────────────────────────────────────

describe("translateClass — basic translations", () => {
  it("Meridian c104 → NAICS returns 722513 (limited-service restaurant)", () => {
    const matches = translateClass("meridian_bop", "c104", "naics_2022");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.to.code).toBe("722513");
    expect(matches[0]!.confidence).toBe("high");
  });

  it("Meridian c109 → NAICS returns 446110 (pharmacies)", () => {
    const matches = translateClass("meridian_bop", "c109", "naics_2022");
    expect(matches.find((m) => m.to.code === "446110")).toBeDefined();
  });

  it("reverse translation works (NAICS 722513 → Meridian)", () => {
    const matches = translateClass("naics_2022", "722513", "meridian_bop");
    expect(matches.find((m) => m.to.code === "c104")).toBeDefined();
  });

  it("sorts matches by confidence (high → medium → low)", () => {
    // Meridian c101 (general merchandise) → NAICS is one-to-many with
    // mixed confidence: 455219 medium, 455110 low.
    const matches = translateClass("meridian_bop", "c101", "naics_2022");
    expect(matches.map((m) => m.confidence)).toEqual(["medium", "low"]);
  });

  it("returns empty array for unknown source code", () => {
    expect(translateClass("meridian_bop", "c999", "naics_2022")).toEqual([]);
  });

  it("returns empty array when no crosswalk exists", () => {
    // Meridian c112 (welding supply) has no NAICS crosswalk in V1.
    expect(translateClass("meridian_bop", "c112", "naics_2022")).toEqual([]);
  });

  it("returns identity match for same-vocabulary translation", () => {
    const matches = translateClass("meridian_bop", "c104", "meridian_bop");
    expect(matches.length).toBe(1);
    expect(matches[0]!.confidence).toBe("high");
    expect(matches[0]!.crosswalk_id).toBe("identity");
  });

  it("identity translation returns empty for unknown source", () => {
    expect(translateClass("meridian_bop", "c999", "meridian_bop")).toEqual([]);
  });
});

describe("translateClass — many-to-many semantics", () => {
  it("NAICS 722511 + 722513 BOTH map to SIC 5812", () => {
    const a = translateClass("naics_2022", "722511", "sic_1987");
    const b = translateClass("naics_2022", "722513", "sic_1987");
    expect(a[0]!.to.code).toBe("5812");
    expect(b[0]!.to.code).toBe("5812");
  });

  it("Match carries a disambiguation note when present", () => {
    const matches = translateClass("naics_2022", "722511", "sic_1987");
    expect(matches[0]!.note).toMatch(/full \+ limited/i);
  });
});

describe("translateClass — citations", () => {
  it("every match carries citation_rule + citation_page + crosswalk_id", () => {
    const matches = translateClass("meridian_bop", "c104", "naics_2022");
    for (const m of matches) {
      expect(m.citation_rule.length).toBeGreaterThan(0);
      expect(m.citation_page.length).toBeGreaterThan(0);
      expect(m.crosswalk_id.length).toBeGreaterThan(0);
    }
  });
});

// ── translateClassBatch ───────────────────────────────────────────

describe("translateClassBatch", () => {
  it("returns one entry per input code in order", () => {
    const out = translateClassBatch("meridian_bop", ["c104", "c105"], "naics_2022");
    expect(out.length).toBe(2);
    expect(out[0]!.source_code).toBe("c104");
    expect(out[1]!.source_code).toBe("c105");
  });

  it("flags unmatched codes", () => {
    const out = translateClassBatch("meridian_bop", ["c104", "c999"], "naics_2022");
    expect(out[0]!.unmatched).toBe(false);
    expect(out[1]!.unmatched).toBe(true);
  });

  it("returns empty result for empty input", () => {
    expect(translateClassBatch("meridian_bop", [], "naics_2022")).toEqual([]);
  });
});

// ── Proprietary vocabularies ──────────────────────────────────────

describe("proprietary vocabulary registration", () => {
  afterEach(() => {
    unregisterProprietaryVocabulary("test-vocab");
  });

  it("registers + lists a proprietary vocabulary", () => {
    const vocab = registerProprietaryVocabulary({
      id: "test-vocab",
      name: "Test carrier catalog",
      version: "1.0",
      description: "test",
      source: "test",
      entries: [
        { vocab_id: "meridian_bop", code: "C01", description: "Test class 1" },
      ],
    });
    expect(vocab.id).toEqual({ kind: "proprietary", id: "test-vocab" });
    expect(listVocabularies().find((v) => vocabIdKey(v.id) === "proprietary:test-vocab")).toBeDefined();
  });

  it("lookup by proprietary id", () => {
    registerProprietaryVocabulary({
      id: "test-vocab",
      name: "Test",
      version: "1.0",
      description: "test",
      source: "test",
      entries: [
        { vocab_id: "meridian_bop", code: "C01", description: "Custom restaurants" },
      ],
    });
    const vid: VocabId = { kind: "proprietary", id: "test-vocab" };
    expect(getClassEntry(vid, "C01")?.description).toBe("Custom restaurants");
  });

  it("translates from proprietary → canonical via supplied crosswalks", () => {
    registerProprietaryVocabulary({
      id: "test-vocab",
      name: "Test",
      version: "1.0",
      description: "test",
      source: "test",
      entries: [
        { vocab_id: "meridian_bop", code: "C01", description: "Custom restaurants" },
      ],
      crosswalks: [
        {
          from_vocab: { kind: "proprietary", id: "test-vocab" },
          from_code: "C01",
          to_vocab: "meridian_bop",
          to_code: "c104",
          confidence: "high",
          citation_rule: "Carrier crosswalk",
          citation_page: "p.1",
          crosswalk_id: "carrier_v1",
        },
      ],
    });
    const matches = translateClass(
      { kind: "proprietary", id: "test-vocab" },
      "C01",
      "meridian_bop",
    );
    expect(matches.length).toBe(1);
    expect(matches[0]!.to.code).toBe("c104");
  });

  it("re-registering replaces the existing entry", () => {
    registerProprietaryVocabulary({
      id: "test-vocab",
      name: "v1",
      version: "1.0",
      description: "v1",
      source: "test",
      entries: [{ vocab_id: "meridian_bop", code: "C01", description: "v1 desc" }],
    });
    registerProprietaryVocabulary({
      id: "test-vocab",
      name: "v2",
      version: "2.0",
      description: "v2",
      source: "test",
      entries: [{ vocab_id: "meridian_bop", code: "C01", description: "v2 desc" }],
    });
    const vocab = getVocabulary({ kind: "proprietary", id: "test-vocab" });
    expect(vocab?.name).toBe("v2");
  });
});
