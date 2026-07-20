/**
 * format tests — pins  (one absolute date rendering, local
 * components, date-only strings pass through) and  (the
 * title-caser's acronym allowlist).
 */

import { describe, it, expect } from "vitest";
import { isoDate, isoDateTime } from "./dates";
import { fixAcronymCase } from "./acronyms";

describe("isoDate / isoDateTime", () => {
  it("renders local components in ISO shape", () => {
    const d = new Date(2026, 6, 18, 21, 12); // local July 18, 21:12
    expect(isoDate(d)).toBe("2026-07-18");
    expect(isoDateTime(d)).toBe("2026-07-18 21:12");
  });

  it("passes a bare YYYY-MM-DD through verbatim (no UTC shift)", () => {
    expect(isoDate("2026-09-01")).toBe("2026-09-01");
    expect(isoDateTime("2026-09-01")).toBe("2026-09-01");
  });

  it("unparseable input renders empty, never 'Invalid Date'", () => {
    expect(isoDate("not a date")).toBe("");
    expect(isoDateTime("not a date")).toBe("");
  });
});

describe("fixAcronymCase", () => {
  it("restores allowlisted acronyms after mechanical casing", () => {
    expect(fixAcronymCase("Bpp premium")).toBe("BPP premium");
    expect(fixAcronymCase("Building Ilf")).toBe("Building ILF");
    expect(fixAcronymCase("Bop")).toBe("BOP");
    expect(fixAcronymCase("Lcm tail")).toBe("LCM tail");
  });

  it("leaves ordinary words alone", () => {
    expect(fixAcronymCase("Premises Liability")).toBe("Premises Liability");
    expect(fixAcronymCase("shopping")).toBe("shopping");
  });
});
