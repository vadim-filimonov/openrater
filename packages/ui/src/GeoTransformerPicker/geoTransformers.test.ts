/**
 * Brief 44 PR 44.6 — geoTransformers tests.
 */
import { describe, expect, it } from "vitest";
import {
  applyTransformer,
  fips5_to_state,
  identity,
  state_name_to_usps,
  suggestTransformer,
  zip5_to_county,
  zip5_to_state,
} from "./geoTransformers";

describe("identity", () => {
  it("trims whitespace and returns the input as-is", () => {
    expect(identity("  WI ")).toBe("WI");
    expect(identity("55079")).toBe("55079");
  });
});

describe("zip5_to_state", () => {
  it("maps Milwaukee ZIP to WI", () => {
    expect(zip5_to_state("53201")).toBe("WI");
  });

  it("maps Manhattan ZIP to NY", () => {
    expect(zip5_to_state("10001")).toBe("NY");
  });

  it("maps SF ZIP to CA", () => {
    expect(zip5_to_state("94102")).toBe("CA");
  });

  it("maps Anchorage ZIP to AK", () => {
    expect(zip5_to_state("99501")).toBe("AK");
  });

  it("maps Honolulu ZIP to HI", () => {
    expect(zip5_to_state("96813")).toBe("HI");
  });

  it("maps Beverly Hills ZIP to CA", () => {
    expect(zip5_to_state("90210")).toBe("CA");
  });

  it("maps a DC ZIP to DC", () => {
    expect(zip5_to_state("20001")).toBe("DC");
  });

  it("returns null for non-5-digit input", () => {
    expect(zip5_to_state("not a zip")).toBeNull();
    expect(zip5_to_state("123")).toBeNull();
  });

  it("returns null for unallocated ranges (e.g. 999xx territories)", () => {
    // 96200-96699 is unallocated for US territories in our table.
    expect(zip5_to_state("96500")).toBeNull();
  });

  it("trims input + handles leading zeros", () => {
    // Boston "02101" — short form should also work.
    expect(zip5_to_state("02101")).toBe("MA");
    expect(zip5_to_state(" 02101 ")).toBe("MA");
  });
});

describe("fips5_to_state", () => {
  it("maps Milwaukee county FIPS 55079 to WI", () => {
    expect(fips5_to_state("55079")).toBe("WI");
  });

  it("maps LA county FIPS 06037 to CA", () => {
    expect(fips5_to_state("06037")).toBe("CA");
  });

  it("returns null for non-5-digit input", () => {
    expect(fips5_to_state("WI")).toBeNull();
    expect(fips5_to_state("550790")).toBe("WI"); // truncated to 5 digits → still WI
  });

  it("returns null when the leading 2 digits aren't a state FIPS", () => {
    expect(fips5_to_state("99001")).toBeNull();
  });
});

describe("state_name_to_usps", () => {
  it("maps Wisconsin → WI (exact name)", () => {
    expect(state_name_to_usps("Wisconsin")).toBe("WI");
  });

  it("is case-insensitive", () => {
    expect(state_name_to_usps("wisconsin")).toBe("WI");
    expect(state_name_to_usps("WISCONSIN")).toBe("WI");
  });

  it("trims whitespace", () => {
    expect(state_name_to_usps("  Wisconsin  ")).toBe("WI");
  });

  it("short-circuits valid USPS codes", () => {
    expect(state_name_to_usps("WI")).toBe("WI");
    expect(state_name_to_usps("wi")).toBe("WI");
  });

  it("handles DC variants", () => {
    expect(state_name_to_usps("District of Columbia")).toBe("DC");
    expect(state_name_to_usps("D.C.")).toBe("DC");
    expect(state_name_to_usps("Washington D.C.")).toBe("DC");
    expect(state_name_to_usps("DC")).toBe("DC");
  });

  it("returns null for unknown names", () => {
    expect(state_name_to_usps("Atlantis")).toBeNull();
    expect(state_name_to_usps("")).toBeNull();
  });
});

describe("zip5_to_county", () => {
  it("returns null in v1 (lazy-load deferred)", () => {
    expect(zip5_to_county("53201")).toBeNull();
  });
});

describe("applyTransformer dispatch", () => {
  it("dispatches by id to the right transformer", () => {
    expect(applyTransformer("zip5_to_state", "53201")).toBe("WI");
    expect(applyTransformer("fips5_to_state", "55079")).toBe("WI");
    expect(applyTransformer("state_name_to_usps", "Wisconsin")).toBe("WI");
    expect(applyTransformer("identity", "raw value")).toBe("raw value");
    expect(applyTransformer("zip5_to_county", "53201")).toBeNull();
  });
});

describe("suggestTransformer auto-suggest", () => {
  it("5-digit numeric + valid state-FIPS leading 2 → fips5_to_state", () => {
    // 55 = WI FIPS, so 55079 looks like a county FIPS.
    expect(suggestTransformer("55079", "state")).toBe("fips5_to_state");
  });

  it("5-digit numeric without state-FIPS prefix → zip5_to_state", () => {
    // 99 is not a state FIPS; treat as ZIP. (99501 → AK)
    expect(suggestTransformer("99501", "state")).toBe("zip5_to_state");
  });

  it("5-digit numeric + dim=county → zip5_to_county", () => {
    expect(suggestTransformer("53201", "county")).toBe("zip5_to_county");
  });

  it("2-letter USPS + dim=state → identity (already matches)", () => {
    expect(suggestTransformer("WI", "state")).toBe("identity");
  });

  it("state name + dim=state → state_name_to_usps", () => {
    expect(suggestTransformer("Wisconsin", "state")).toBe("state_name_to_usps");
  });

  it("unknown shape → identity (consumer surfaces mismatch banner)", () => {
    expect(suggestTransformer("???", "state")).toBe("identity");
  });

  it("empty sample → identity", () => {
    expect(suggestTransformer(undefined, "state")).toBe("identity");
    expect(suggestTransformer("", "state")).toBe("identity");
  });
});
