/**
 * gateValueLevels — Brief 89.3 follow-up.
 *
 * Pins the ONE correctness rule: the value seat may only offer ids the
 * gate can actually match at runtime (`externalInputs[variable]` is
 * read RAW — no dim resolution runs before a gate walks):
 *   · categorical → the authored level ids (THE keying site's list)
 *   · banded      → nothing (the submission carries a raw number;
 *                    band ids would author never-matching rules)
 *   · geographic  → the GRANULAR levels, never the grouped territory
 *                    projection (a factor-keying construct)
 */

import { describe, expect, it } from "vitest";
import { gateValueLevels } from "./gateValueLevels";

describe("gateValueLevels (Brief 89.3 follow-up)", () => {
  it("categorical: offers the authored level ids", () => {
    expect(
      gateValueLevels({
        shape: "categorical",
        levels: [
          { kind: "categorical", id: "Fire Resistive", label: "Fire Resistive" },
          { kind: "categorical", id: "Frame", label: "Frame" },
        ],
      }),
    ).toEqual([
      { id: "Fire Resistive", label: "Fire Resistive" },
      { id: "Frame", label: "Frame" },
    ]);
  });

  it("shape omitted (the pre-26 standard default) still offers the levels", () => {
    expect(
      gateValueLevels({
        levels: [{ kind: "categorical", id: "9", label: "" }],
      }),
    ).toEqual([{ id: "9", label: "9" }]); // label falls back to the id
  });

  it("banded: offers NOTHING — the gate compares the raw number, not band ids", () => {
    expect(
      gateValueLevels({
        shape: "banded",
        levels: [
          { kind: "banded", id: "age_0_20", label: "0–20", lo: 0, hi: 20 },
          { kind: "banded", id: "age_20_60", label: "20–60", lo: 20, hi: 60 },
        ],
      }),
    ).toEqual([]);
  });

  it("geographic with territories: offers the GRANULAR codes, not the territory projection", () => {
    const out = gateValueLevels({
      dimension_type: "geographic",
      shape: "geographic",
      levels: [
        { kind: "geographic", id: "KS", label: "Kansas" },
        { kind: "geographic", id: "MO", label: "Missouri" },
      ],
      geo_territories: [
        { id: "terr_1", label: "Territory 1", members: ["KS", "MO"] },
      ],
    });
    expect(out.map((l) => l.id)).toEqual(["KS", "MO"]);
    expect(out.some((l) => l.id === "terr_1")).toBe(false);
  });

  it("level-less dims offer nothing (the seat stays free text)", () => {
    expect(gateValueLevels({})).toEqual([]);
    expect(gateValueLevels({ levels: [] })).toEqual([]);
  });

  it("filters out empty-id levels (nothing unpickable, nothing unmatchable)", () => {
    expect(
      gateValueLevels({
        levels: [
          { kind: "categorical", id: "", label: "ghost" },
          { kind: "categorical", id: "Frame", label: "Frame" },
        ],
      }),
    ).toEqual([{ id: "Frame", label: "Frame" }]);
  });
});
