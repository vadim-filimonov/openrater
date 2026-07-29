import { describe, it, expect } from "vitest";
import { TerritoryLookupKind } from "./lookup-territory";
import type {
  SnapshottedTerritory,
  TerritoryRates,
} from "./lookup-territory";

const RATES_A: TerritoryRates = {
  building_per_100: 0.85,
  bpp_per_100: 0.95,
  occupant_liab_per_100: 0.42,
  occupant_liab_per_1k_sales: 0.18,
  occupant_liab_per_1k_payroll: 0.22,
  lessors_per_100: 0.31,
};

const RATES_B: TerritoryRates = {
  building_per_100: 1.1,
  bpp_per_100: 1.2,
  occupant_liab_per_100: 0.55,
  occupant_liab_per_1k_sales: 0.24,
  occupant_liab_per_1k_payroll: 0.28,
  lessors_per_100: 0.4,
};

const ZERO_RATES: TerritoryRates = {
  building_per_100: 0,
  bpp_per_100: 0,
  occupant_liab_per_100: 0,
  occupant_liab_per_1k_sales: 0,
  occupant_liab_per_1k_payroll: 0,
  lessors_per_100: 0,
};

const TERRITORIES: readonly SnapshottedTerritory[] = [
  {
    territory_id: "ca-001",
    territory_code: "001",
    state_code: "CA",
    zips: ["94101", "94102"],
    base_rates: RATES_A,
  },
  {
    territory_id: "ny-002",
    territory_code: "002",
    state_code: "NY",
    zips: ["10001", "10002"],
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
      { state: "CA", zip5: "94101" },
      {
        territories: TERRITORIES,
        fallbackRates: ZERO_RATES,
        fallbackCode: "704",
      },
    );
    expect(r.territory_code).toBe("001");
    expect(r.rates).toBe(RATES_A);
  });

  it("upper-cases the input state for matching", () => {
    const r = TerritoryLookupKind.execute(
      { state: "ca", zip5: "94101" },
      {
        territories: TERRITORIES,
        fallbackRates: ZERO_RATES,
        fallbackCode: "704",
      },
    );
    expect(r.territory_code).toBe("001");
  });

  it("falls back to fallbackCode + fallbackRates when no match", () => {
    const r = TerritoryLookupKind.execute(
      { state: "TX", zip5: "75001" },
      {
        territories: TERRITORIES,
        fallbackRates: ZERO_RATES,
        fallbackCode: "704",
      },
    );
    expect(r.territory_code).toBe("704");
    expect(r.rates).toBe(ZERO_RATES);
  });

  it("uses '704' as the fallbackCode default when none configured", () => {
    const r = TerritoryLookupKind.execute(
      { state: "XX", zip5: "00000" },
      {
        territories: [],
        fallbackRates: ZERO_RATES,
      },
    );
    expect(r.territory_code).toBe("704");
  });

  it("requires exact ZIP membership — partial ZIPs don't match", () => {
    const r = TerritoryLookupKind.execute(
      { state: "CA", zip5: "94109" }, // not in CA-001's zips
      {
        territories: TERRITORIES,
        fallbackRates: ZERO_RATES,
        fallbackCode: "704",
      },
    );
    expect(r.territory_code).toBe("704");
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
      fallbackRates: ZERO_RATES,
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });

  it("validate accepts snapshotted territories", () => {
    const r = TerritoryLookupKind.validate!({
      territories: TERRITORIES,
      fallbackRates: ZERO_RATES,
    });
    expect(r.valid).toBe(true);
  });
});
