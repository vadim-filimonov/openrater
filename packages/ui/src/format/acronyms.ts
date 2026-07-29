/**
 * acronyms — the title-caser's allowlist (MVP-017, mvp-tightness
 * §3.4). Mechanical casing turns insurance acronyms into words
 * ("Bpp premium", a "Bpp" product chip); this post-pass restores
 * them wherever a titleizer ran. Closed list, additive on evidence.
 */

const ACRONYMS: ReadonlyMap<string, string> = new Map([
  ["bpp", "BPP"],
  ["bop", "BOP"],
  ["ilf", "ILF"],
  ["lcm", "LCM"],
]);

/** Re-case allowlisted acronyms in an already-titleized string. */
export function fixAcronymCase(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const acro = ACRONYMS.get(word.toLowerCase());
    return acro ?? word;
  });
}
