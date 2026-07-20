import { describe, it, expect } from "vitest";
import { TerritoryLookupKind } from "./lookup-territory";
import type {
  SnapshottedTerritory,
  TerritoryRates,
} from "./lookup-territory";

const RATES_A: TerritoryRates = {
  property_factor: 0.94,
  liability_factor: 1.02,
};

const RATES_B: TerritoryRates = {
  property_factor: 1.0,
  liability_factor: 1.0,
};

const EMPTY_RATES: TerritoryRates = {};

const TERRITORIES: readonly SnapshottedTerritory[] = [
  {
    territory_id: "meridian-t1",
    territory_code: "t1",
    state_code: "NE",
    zips: ["68001", "68002"],
    base_rates: RATES_A,
  },
  {
    territory_id: "meridian-t2",
    territory_code: "t2",
    state_code: "NE",
    zips: ["68102", "68104"],
    base_rates: RATES_B,
  },
];

describe("TerritoryLookupKind", () => {
  it("declares state + zip5 inputs, territory_code + rates outputs", () => {
    expect(TerritoryLookupKind.inputs).toHaveLength(2);
    expect(TerritoryLookupKind.inputs[0]?.name).toBe("state");
    expect(TerritoryLookupKind.inputs[1]?.name).toBe("zip5");
    expect(TerritoryLookupKind.outputs).toHaveLength(2);
    expect(TerritoryLookupKind.outputs[0]?.name).toBe("territory_code");
    expect(TerritoryLookupKind.outputs[1]?.name).toBe("rates");
  });

  it("returns the territory's rates when (state, zip5) matches", () => {
    const r = TerritoryLookupKind.execute(
      { state: "NE", zip5: "68001" },
      {
        territories: TERRITORIES,
        fallbackRates: EMPTY_RATES,
        fallbackCode: "t0",
      },
    );
    expect(r.territory_code).toBe("t1");
    expect(r.rates).toBe(RATES_A);
  });

  it("upper-cases the input state for matching", () => {
    const r = TerritoryLookupKind.execute(
      { state: "ne", zip5: "68001" },
      {
        territories: TERRITORIES,
        fallbackRates: EMPTY_RATES,
        fallbackCode: "t0",
      },
    );
    expect(r.territory_code).toBe("t1");
  });

  it("falls back to fallbackCode + fallbackRates when no match", () => {
    const r = TerritoryLookupKind.execute(
      { state: "TX", zip5: "75001" },
      {
        territories: TERRITORIES,
        fallbackRates: EMPTY_RATES,
        fallbackCode: "t0",
      },
    );
    expect(r.territory_code).toBe("t0");
    expect(r.rates).toBe(EMPTY_RATES);
  });

  it("uses fictional Meridian 't0' as the neutral fallback id", () => {
    const r = TerritoryLookupKind.execute(
      { state: "XX", zip5: "00000" },
      {
        territories: [],
        fallbackRates: EMPTY_RATES,
      },
    );
    expect(r.territory_code).toBe("t0");
  });

  it("requires exact ZIP membership — partial ZIPs don't match", () => {
    const r = TerritoryLookupKind.execute(
      { state: "NE", zip5: "68003" }, // not in Meridian t1's zips
      {
        territories: TERRITORIES,
        fallbackRates: EMPTY_RATES,
        fallbackCode: "t0",
      },
    );
    expect(r.territory_code).toBe("t0");
  });

  it("validate flags missing fallbackRates", () => {
    const r = TerritoryLookupKind.validate!({
      territories: [],
      // @ts-expect-error — intentionally undefined to test guard
      fallbackRates: undefined,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("fallbackRates");
  });

  it("validate warns on empty territories", () => {
    const r = TerritoryLookupKind.validate!({
      territories: [],
      fallbackRates: EMPTY_RATES,
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });

  it("validate accepts snapshotted territories", () => {
    const r = TerritoryLookupKind.validate!({
      territories: TERRITORIES,
      fallbackRates: EMPTY_RATES,
    });
    expect(r.valid).toBe(true);
  });
});
