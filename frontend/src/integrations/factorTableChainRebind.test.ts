/**
 * factorTableChainRebind tests — Brief 70.1.
 *
 * Pins the silent-×1.0 closure: axis changes on a chain-referenced
 * table produce read-modify-write patches that re-key the lookup's
 * dimensions, preserve surviving authored sources, and leave
 * everything else in the config verbatim.
 */

import { describe, expect, it } from "vitest";
import {
  rebindChainsForTableAxes,
  type StageLikeForRebind,
} from "./factorTableChainRebind";

const CHAIN_STAGE: StageLikeForRebind = {
  stage_id: "chain_building",
  stage_kind: "multiplicative_chain",
  config_json: {
    some_unknown_key: { survives: true },
    chains: [
      {
        name: "Building",
        base_input: "form_input.rate",
        factor_lookups: [
          {
            name: "Construction factor",
            factor_kind: "construction_factor",
            dimensions: {
              construction: { source: "form_input", path: "construction" },
            },
          },
          {
            name: "Other factor",
            factor_kind: "other_table",
            dimensions: { x: { source: "form_input", path: "x" } },
          },
        ],
      },
    ],
  },
};

describe("rebindChainsForTableAxes (Brief 70.1)", () => {
  it("re-keys the referencing lookup to the NEW axes; defaults new axes to form_input", () => {
    const { patches, rebound } = rebindChainsForTableAxes(
      [CHAIN_STAGE],
      "construction_factor",
      ["territory"],
    );
    expect(patches).toHaveLength(1);
    expect(rebound).toEqual(["Construction factor · Building chain"]);
    const cfg = patches[0]!.config_json;
    const lookup = (cfg.chains as Array<Record<string, unknown>>)[0]!
      .factor_lookups as Array<Record<string, unknown>>;
    expect(lookup[0]!.dimensions).toEqual({
      territory: { source: "form_input", path: "territory" },
    });
    // The OTHER lookup + unknown config keys survive verbatim.
    expect(lookup[1]!.dimensions).toEqual({
      x: { source: "form_input", path: "x" },
    });
    expect(cfg.some_unknown_key).toEqual({ survives: true });
  });

  it("a surviving slug keeps its AUTHORED axis source (literal/computed bindings outlive)", () => {
    const authored: StageLikeForRebind = {
      ...CHAIN_STAGE,
      config_json: {
        chains: [
          {
            name: "Building",
            factor_lookups: [
              {
                name: "2-D factor",
                factor_kind: "construction_factor",
                dimensions: {
                  construction: { source: "form_input", path: "construction" },
                  coverage: { source: "literal", value: "Building" },
                },
              },
            ],
          },
        ],
      },
    };
    const { patches } = rebindChainsForTableAxes(
      [authored],
      "construction_factor",
      ["coverage", "territory"],
    );
    const dims = (
      (patches[0]!.config_json.chains as Array<Record<string, unknown>>)[0]!
        .factor_lookups as Array<Record<string, unknown>>
    )[0]!.dimensions as Record<string, unknown>;
    expect(dims).toEqual({
      coverage: { source: "literal", value: "Building" },
      territory: { source: "form_input", path: "territory" },
    });
  });

  it("returns zero patches when nothing references the table", () => {
    const { patches, rebound } = rebindChainsForTableAxes(
      [CHAIN_STAGE],
      "unreferenced_table",
      ["whatever"],
    );
    expect(patches).toHaveLength(0);
    expect(rebound).toHaveLength(0);
  });

  it("ignores non-chain stages entirely", () => {
    const gate: StageLikeForRebind = {
      stage_id: "g",
      stage_kind: "eligibility.gate",
      config_json: { rules: [] },
    };
    expect(
      rebindChainsForTableAxes([gate], "construction_factor", ["x"]).patches,
    ).toHaveLength(0);
  });
});
