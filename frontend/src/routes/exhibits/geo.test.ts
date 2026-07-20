import { describe, expect, it } from "vitest";
import type { PlanDimension } from "@openrater/api-client";
import {
  divergingPaint,
  geoGrainOf,
  mapTerritoriesOf,
  memberStates,
  shapeCoordinates,
} from "./geo";

function geoDim(overrides: Partial<PlanDimension>): PlanDimension {
  return {
    dim_id: "territory",
    slug: "territory",
    display_name: "Territory",
    dimension_type: "geographic",
    levels: [],
    ...overrides,
  } as unknown as PlanDimension;
}

describe("shapeCoordinates", () => {
  it("unpacks flat rings into MultiPolygon coordinates", () => {
    const square = [-96.7, 40.75, -96.6, 40.75, -96.6, 40.85, -96.7, 40.85, -96.7, 40.75];
    expect(shapeCoordinates([[square]])).toEqual([
      [
        [
          [-96.7, 40.75],
          [-96.6, 40.75],
          [-96.6, 40.85],
          [-96.7, 40.85],
          [-96.7, 40.75],
        ],
      ],
    ]);
  });

  it("drops malformed rings — odd length or under four points", () => {
    const square = [-96.7, 40.75, -96.6, 40.75, -96.6, 40.85, -96.7, 40.85, -96.7, 40.75];
    const odd = [-96.7, 40.75, -96.6];
    const tiny = [-96.7, 40.75, -96.6, 40.75, -96.7, 40.75];
    expect(shapeCoordinates([[odd], [tiny]])).toEqual([]);
    // A valid outer keeps its polygon even when a sibling ring is bad.
    expect(shapeCoordinates([[square, odd]])).toHaveLength(1);
  });
});

describe("memberStates", () => {
  it("groups members by their SCF state and skips unresolvable ones", () => {
    const grouped = memberStates([
      { id: "t1", label: "T1", members: ["68502", "68510"] },
      { id: "t2", label: "T2", members: ["50309", " ", "00000"] },
    ]);
    expect(grouped.states).toEqual(["IA", "NE"]);
    expect(grouped.stateOf.get("68502")).toBe("NE");
    expect(grouped.stateOf.get("50309")).toBe("IA");
    expect(grouped.stateOf.has("00000")).toBe(false);
  });
});

describe("geoGrainOf", () => {
  it("honors the declared granularity over member shape", () => {
    const dim = geoDim({
      geo_granularity: "county",
      geo_territories: [{ id: "t1", label: "T1", members: ["68502"] }],
    });
    expect(geoGrainOf(dim)).toBe("county");
  });

  it("infers zip from 5-digit members and state from 2-letter members", () => {
    expect(
      geoGrainOf(
        geoDim({
          geo_territories: [{ id: "t1", label: "T1", members: ["68502"] }],
        }),
      ),
    ).toBe("zip");
    expect(
      geoGrainOf(
        geoDim({
          geo_territories: [{ id: "t1", label: "T1", members: ["NE", "IA"] }],
        }),
      ),
    ).toBe("state");
  });

  it("returns null when there is nothing to infer from", () => {
    expect(geoGrainOf(geoDim({ geo_territories: [] }))).toBeNull();
    expect(
      geoGrainOf(
        geoDim({
          geo_territories: [{ id: "t1", label: "T1", members: ["68502-1234"] }],
        }),
      ),
    ).toBeNull();
  });
});

describe("mapTerritoriesOf", () => {
  it("returns territories only for geographic dims that define them", () => {
    const territories = [{ id: "t1", label: "T1", members: ["68502"] }];
    expect(mapTerritoriesOf(geoDim({ geo_territories: territories }))).toEqual(
      territories,
    );
    expect(mapTerritoriesOf(geoDim({ geo_territories: [] }))).toBeNull();
    expect(mapTerritoriesOf(null)).toBeNull();
    expect(
      mapTerritoriesOf(
        geoDim({
          dimension_type: "standard",
          shape: "categorical",
          geo_territories: territories,
        }),
      ),
    ).toBeNull();
  });
});

describe("divergingPaint", () => {
  it("splits at par and scales intensity within the table's own worst deviation", () => {
    const worst = divergingPaint(1.2, 0.2);
    expect(worst.up).toBe(true);
    expect(worst.alpha).toBeCloseTo(1, 9);
    const mid = divergingPaint(0.9, 0.2);
    expect(mid.up).toBe(false);
    expect(mid.alpha).toBeCloseTo(0.675, 9);
    expect(divergingPaint(1, 0.2)).toEqual({ up: true, alpha: 0.35 });
  });

  it("stays at the floor when the table never leaves par", () => {
    expect(divergingPaint(1, 0)).toEqual({ up: true, alpha: 0.35 });
  });
});
