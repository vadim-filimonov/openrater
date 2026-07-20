/**
 * Test-2 finding — auto-derived connector_id must not collide with a bundled
 * id. Mirrors GeoDimWizard.test.tsx's "slug collision is avoided with a numeric
 * suffix" precedent, at the pure-helper level (rate-lab vitest runs under node).
 */
import { describe, it, expect } from "vitest";
import { slugify, uniqueConnectorId } from "./connectorId";

describe("slugify", () => {
  it("lowercases, hyphenates, and trims", () => {
    expect(slugify("LightBox Structures")).toBe("lightbox-structures");
    expect(slugify("  Acme Hazard Score! ")).toBe("acme-hazard-score");
    expect(slugify("a@@@b")).toBe("a-b");
  });

  it("returns empty for a blank/punctuation-only name", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});

describe("uniqueConnectorId", () => {
  it("passes a free id through untouched", () => {
    expect(uniqueConnectorId("acme-hazard", ["lightbox-structures"])).toBe(
      "acme-hazard",
    );
  });

  it("suffixes -2 when the slug collides with a bundled id (the finding)", () => {
    // Authoring "LightBox Structures" slugs to a RESERVED bundled id.
    const base = slugify("LightBox Structures");
    expect(uniqueConnectorId(base, ["lightbox-structures"])).toBe(
      "lightbox-structures-2",
    );
  });

  it("walks past taken suffixes to the first free one", () => {
    expect(
      uniqueConnectorId("lightbox-structures", [
        "lightbox-structures",
        "lightbox-structures-2",
        "lightbox-structures-3",
      ]),
    ).toBe("lightbox-structures-4");
  });

  it("does not accumulate suffixes across re-derivation (recomputes from base)", () => {
    // Each keystroke re-derives from the freshly-slugified name, so the result
    // is stable, never "…-2-2".
    const existing = ["lightbox-structures"];
    const once = uniqueConnectorId(slugify("LightBox Structures"), existing);
    const twice = uniqueConnectorId(slugify("LightBox Structures"), existing);
    expect(once).toBe("lightbox-structures-2");
    expect(twice).toBe("lightbox-structures-2");
  });

  it("leaves an empty base alone (save-time validation handles it)", () => {
    expect(uniqueConnectorId("", ["lightbox-structures"])).toBe("");
  });
});
