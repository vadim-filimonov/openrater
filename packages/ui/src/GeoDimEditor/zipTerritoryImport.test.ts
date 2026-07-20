/**
 * Brief 51 / ADR-0038 — ZIP→territory CSV import parser tests.
 */

import { describe, it, expect } from "vitest";

import { parseZipTerritoryCsv } from "./zipTerritoryImport";

describe("parseZipTerritoryCsv", () => {
  it("seeds ZIP levels + a territory grouping from the KS map shape", () => {
    const csv = [
      "zip,territory,zip_name",
      "66002,t2,ATCHISON",
      "66101,t1,KANSAS CITY",
      "66102,t1,KANSAS CITY",
      "67201,t2,WICHITA",
    ].join("\n");
    const r = parseZipTerritoryCsv(csv);
    expect(r.error).toBeUndefined();
    expect(r.levels.map((l) => l.id)).toEqual([
      "66002",
      "66101",
      "66102",
      "67201",
    ]);
    expect(r.levels[1]).toEqual({
      kind: "categorical",
      id: "66101",
      label: "KANSAS CITY",
    });
    // Two territories with the right members.
    expect(r.territories.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    const t701 = r.territories.find((t) => t.id === "t1")!;
    expect(t701.members).toEqual(["66101", "66102"]);
    expect(r.report.levelsCreated).toBe(4);
    expect(r.report.territories).toContainEqual({ id: "t1", count: 2 });
    expect(r.report.territories).toContainEqual({ id: "t2", count: 2 });
  });

  it("end-to-end with the canonical helpers — territory becomes the lookup key", async () => {
    // Prove the import output feeds the canonical domain: after import, the
    // dim's lookup keys are the territories, and a member ZIP resolves to it.
    const { geoLookupKeys, resolveGeographicValue } = await import(
      "@openrater/contracts"
    );
    const csv = "zip,territory\n66101,t1\n66102,t1\n67201,t2";
    const r = parseZipTerritoryCsv(csv);
    const dim = { levels: r.levels, geo_territories: r.territories };
    expect(geoLookupKeys(dim).map((k) => k.id)).toEqual(["t1", "t2"]);
    expect(resolveGeographicValue(dim, "66101").key).toBe("t1"); // ZIP → territory
    expect(resolveGeographicValue(dim, "t2").key).toBe("t2"); // idempotent
  });

  it("tolerates header aliases (territory_code, zip5)", () => {
    const csv = "zip5,territory_code\n66101,t1\n67201,t2";
    const r = parseZipTerritoryCsv(csv);
    expect(r.error).toBeUndefined();
    expect(r.levels).toHaveLength(2);
    expect(r.territories.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    // No name column → label falls back to the ZIP.
    expect(r.levels[0]?.label).toBe("66101");
  });

  it("skips rows missing a ZIP or a territory, with a reason", () => {
    const csv = [
      "zip,territory",
      "66101,t1",
      ",t2", // no zip
      "67201,", // no territory
      "", // blank — ignored, not counted
    ].join("\n");
    const r = parseZipTerritoryCsv(csv);
    expect(r.levels.map((l) => l.id)).toEqual(["66101"]);
    expect(r.report.rowsRead).toBe(3); // blank line excluded
    expect(r.report.skipped).toEqual([
      { line: 3, reason: "missing ZIP" },
      { line: 4, reason: "ZIP 67201 has no territory" },
    ]);
  });

  it("last row wins for a duplicate ZIP, moving it off the prior territory", () => {
    const csv = "zip,territory\n66101,t1\n66101,t2";
    const r = parseZipTerritoryCsv(csv);
    expect(r.levels).toHaveLength(1);
    expect(r.report.duplicateZips).toEqual(["66101"]);
    // t1 lost its only member → dropped; 66101 now under t2.
    expect(r.territories.map((t) => t.id)).toEqual(["t2"]);
    expect(r.territories[0]?.members).toEqual(["66101"]);
  });

  it("errors (no levels) when a required column is absent", () => {
    const r = parseZipTerritoryCsv("postal,region\n66101,A");
    expect(r.error).toBeTruthy();
    expect(r.levels).toEqual([]);
    expect(r.territories).toEqual([]);
  });
});
