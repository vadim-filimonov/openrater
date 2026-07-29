/**
 * deriveRequiredInputs tests — Brief 38 §4.2 (PR 11h).
 *
 * Covers each of the four walkers + path-normalization + dedup +
 * stable ordering. Plus the ISO BOP sample plan as an end-to-end
 * fixture (it's the simplest non-toy plan the workspace renders).
 */

import { describe, it, expect } from "vitest";
import type { Dimension } from "@openrater/contracts";

import {
  deriveRequiredInputs,
  normalizePath,
  type StageLike,
} from "./deriveRequiredInputs";

// ─────────────────────────────────────────────────────────────────
// normalizePath
// ─────────────────────────────────────────────────────────────────

describe("normalizePath", () => {
  it("strips the form_input prefix", () => {
    expect(normalizePath("form_input.tiv")).toBe("tiv");
    expect(normalizePath("form_input.class_code")).toBe("class_code");
  });

  it("returns the stage id from stages.X.field paths", () => {
    expect(normalizePath("stages.rate_number.value")).toBe("rate_number");
    expect(normalizePath("stages.input_class_code.value")).toBe(
      "input_class_code",
    );
  });

  it("passes raw paths through unchanged", () => {
    expect(normalizePath("class_code")).toBe("class_code");
    expect(normalizePath("building_age")).toBe("building_age");
  });

  it("returns the empty string for null / undefined / blank inputs", () => {
    expect(normalizePath(undefined)).toBe("");
    expect(normalizePath(null)).toBe("");
    expect(normalizePath("")).toBe("");
    expect(normalizePath("   ")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────

function inputStage(id: string, opts: {
  displayName?: string;
  sourcePath?: string;
  dataType?: string;
} = {}): StageLike {
  return {
    stage_id: id,
    stage_kind: "input_node",
    ...(opts.displayName !== undefined ? { display_name: opts.displayName } : {}),
    config_json: {
      ...(opts.sourcePath !== undefined ? { source_path: opts.sourcePath } : {}),
      ...(opts.dataType !== undefined ? { data_type: opts.dataType } : {}),
    },
  };
}

function chainStage(chains: Array<{
  name: string;
  base_input?: string;
  exposure_input?: string;
  lcm?: { input_path?: string; value?: number | null; overridable?: boolean };
  factor_lookups?: Array<{
    name: string;
    factor_kind?: string;
    dimensions?: Record<
      string,
      {
        source: string;
        path?: string;
        op?: string;
        fields?: readonly string[];
      }
    >;
  }>;
}>): StageLike {
  return {
    stage_id: "chain_stage",
    stage_kind: "multiplicative_chain",
    config_json: { chains, output_total_field: "premium" },
  };
}

function flatFactorStage(id: string, cfg: {
  input_path?: string;
  input_paths?: readonly string[];
}): StageLike {
  return {
    stage_id: id,
    stage_kind: "flat_factor",
    display_name: id,
    config_json: { ...cfg, factor: 1, factor_kind: "test" },
  };
}

function dim(slug: string, displayName: string, shape = "categorical"): Dimension {
  // The deriver only reads .slug, .display_name, .shape — so we
  // cast a minimal object through `unknown` to satisfy the
  // (much larger) Dimension shape without re-declaring every field.
  return {
    slug,
    display_name: displayName,
    shape,
  } as unknown as Dimension;
}

// ─────────────────────────────────────────────────────────────────
// Walker 1 — input_node
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · input_node walk", () => {
  it("surfaces each input_node with its source_path as id", () => {
    const result = deriveRequiredInputs(
      [
        inputStage("input_tiv", {
          displayName: "TIV",
          sourcePath: "tiv",
          dataType: "number",
        }),
      ],
      [],
    );
    expect(result).toEqual([
      {
        id: "tiv",
        name: "TIV",
        category: "inputs",
        dtype: "number",
        origin: "Input · TIV",
      },
    ]);
  });

  it("falls back to stage_id when source_path is absent", () => {
    const result = deriveRequiredInputs(
      [inputStage("input_class_code", { displayName: "Class code" })],
      [],
    );
    expect(result[0]!.id).toBe("input_class_code");
    expect(result[0]!.name).toBe("Class code");
  });

  it("maps data_type=currency to MatchDtype number", () => {
    const result = deriveRequiredInputs(
      [
        inputStage("input_tiv", {
          sourcePath: "tiv",
          dataType: "currency",
        }),
      ],
      [],
    );
    expect(result[0]!.dtype).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────
// Walker 2 — multiplicative_chain dim refs
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · chain dim refs", () => {
  it("surfaces a dim reference from factor_lookups[].dimensions", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Building chain",
            base_input: "form_input.base",
            exposure_input: "form_input.tiv",
            lcm: { input_path: "form_input.lcm" },
            factor_lookups: [
              {
                name: "Class factor",
                factor_kind: "class_factor",
                dimensions: {
                  class_code: {
                    source: "form_input",
                    path: "class_code",
                  },
                },
              },
            ],
          },
        ]),
      ],
      [dim("class_code", "Class code")],
    );
    const classCode = result.find((r) => r.id === "class_code");
    expect(classCode).toBeDefined();
    expect(classCode!.category).toBe("dimensions");
    expect(classCode!.name).toBe("Class code");
    expect(classCode!.dimSlug).toBe("class_code");
    expect(classCode!.origin).toContain("Class factor");
    expect(classCode!.origin).toContain("Building chain");
  });

  it("handles dims that aren't in the catalog (display_name fallback to slug)", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "ch",
            factor_lookups: [
              {
                name: "F",
                dimensions: {
                  unknown_dim: { source: "form_input", path: "unknown_dim" },
                },
              },
            ],
          },
        ]),
      ],
      [], // empty dim catalog
    );
    expect(result[0]!.name).toBe("unknown_dim");
    expect(result[0]!.dimSlug).toBe("unknown_dim");
  });

  it("biases banded-shape dims to dtype=number", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "ch",
            factor_lookups: [
              {
                name: "F",
                dimensions: {
                  building_age: {
                    source: "form_input",
                    path: "building_age",
                  },
                },
              },
            ],
          },
        ]),
      ],
      [dim("building_age", "Building age", "banded")],
    );
    expect(result[0]!.dtype).toBe("number");
  });

  it("dedupes a dim shared across two chains", () => {
    // class_code referenced by both BUILDING_CHAIN and BPP_CHAIN —
    // mirrors the ISO BOP fixture. The deriver should surface ONE
    // required input.
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Building chain",
            factor_lookups: [
              {
                name: "Class factor",
                dimensions: {
                  class_code: {
                    source: "form_input",
                    path: "class_code",
                  },
                },
              },
            ],
          },
          {
            name: "BPP chain",
            factor_lookups: [
              {
                name: "BPP class factor",
                dimensions: {
                  class_code: {
                    source: "form_input",
                    path: "class_code",
                  },
                },
              },
            ],
          },
        ]),
      ],
      [dim("class_code", "Class code")],
    );
    const classCode = result.filter((r) => r.id === "class_code");
    expect(classCode.length).toBe(1);
    // First-seen wins — origin is the Building chain's Class factor.
    expect(classCode[0]!.origin).toContain("Class factor");
    expect(classCode[0]!.origin).toContain("Building chain");
  });
});

// ─────────────────────────────────────────────────────────────────
// Walker 3 — chain raw paths
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · chain raw paths", () => {
  it("surfaces base_input / exposure_input / lcm.input_path", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Building chain",
            base_input: "form_input.base_rate",
            exposure_input: "form_input.tiv",
            lcm: { input_path: "form_input.lcm" },
          },
        ]),
      ],
      [],
    );
    const ids = result.map((r) => r.id).sort();
    expect(ids).toContain("base_rate");
    expect(ids).toContain("tiv");
    expect(ids).toContain("lcm");
  });

  // ADR-0047 — an authored carrier LCM is a constant on the chain, not a
  // mappable column.
  it("does NOT surface lcm as an input when lcm.value is authored", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Building chain",
            base_input: "form_input.base_rate",
            lcm: { value: 1.401 }, // authored constant, not overridable
          },
        ]),
      ],
      [],
    );
    const ids = result.map((r) => r.id);
    expect(ids).toContain("base_rate");
    expect(ids).not.toContain("lcm");
  });

  it("still surfaces lcm when an authored value is overridable", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Building chain",
            base_input: "form_input.base_rate",
            lcm: {
              value: 1.401,
              input_path: "form_input.lcm",
              overridable: true,
            },
          },
        ]),
      ],
      [],
    );
    const ids = result.map((r) => r.id);
    expect(ids).toContain("lcm");
  });

  // Brief 89 R8 — three LCM classes: valueless column-shape = an unset
  // chain CONSTANT (constantSlot; dictionary/Match exclude it while
  // undeclared, readiness says "a step needs a value"); overridable
  // AUTHORED value = ADR-0047's optional override column (never blocks);
  // true risk inputs (exposure) carry neither flag.
  it("R8: a valueless column-shaped lcm is constantSlot; exposure is a plain input; literal base never surfaces", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Premium",
            base_input: "literal.base_value",
            exposure_input: "form_input.exposure",
            lcm: { input_path: "form_input.lcm" },
          },
        ]),
      ],
      [],
    );
    const byId = new Map(result.map((r) => [r.id, r]));
    expect(byId.get("lcm")?.constantSlot).toBe(true);
    expect(byId.get("lcm")?.optional).toBeUndefined();
    expect(byId.get("exposure")?.constantSlot).toBeUndefined();
    expect(byId.has("base_value")).toBe(false);
  });

  it("R8: an overridable AUTHORED lcm is optional — a fallback exists, nothing blocks", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Premium",
            lcm: {
              value: 1.401,
              input_path: "form_input.lcm",
              overridable: true,
            },
          },
        ]),
      ],
      [],
    );
    const lcm = result.find((r) => r.id === "lcm");
    expect(lcm?.optional).toBe(true);
    expect(lcm?.constantSlot).toBeUndefined();
  });

  // 2026-07-15 filing-digitization review regression. The ingest builder
  // (openrater/rates/ingest/builder.py) emits colon-form literal bindings
  // per the filing-transcription spec §4.6: every chain defaults to
  // `exposure_input: "literal:1"` (apply_exposure false), and round
  // stages carry `increment_input`/`min_value_input: "literal:<n>"`.
  // The colon form sailed past the dot-form `literal.` guard, so a
  // freshly ingested plan (nonprofit-do-gl bundle, 80/80 verified)
  // ghosted "literal:1" as a MISSING INPUT — and one-click Declare then
  // minted a junk `literal:1` input onto the plan. A `:` marks a binding
  // namespace, never a field (ingest lint R-006 allows no ':' in slugs).
  it("ingest shape: colon-form literal bindings never surface as required inputs", () => {
    const result = deriveRequiredInputs(
      [
        inputStage("input_revenue", {
          sourcePath: "revenue",
          dataType: "money",
        }),
        chainStage([
          {
            name: "do premium",
            base_input: "literal.base_value",
            exposure_input: "literal:1", // builder default — no exposure row
            lcm: { value: 1.0 }, // authored plan-level LCM
            factor_lookups: [
              {
                name: "revenue band factor",
                dimensions: {
                  revenue_band: { source: "form_input", path: "revenue" },
                },
              },
            ],
          },
        ]),
        // Round stages ride literal:<n> configs too (final_adjustments);
        // the deriver must stay inert on them.
        {
          stage_id: "final_adjustments_round",
          stage_kind: "round",
          config_json: {
            mode: "nearest",
            increment_input: "literal:1",
            min_value_input: "literal:0",
          },
        },
      ],
      [],
    );
    // The one consumed field is the whole story — the plan declares it,
    // so the workspace reports ZERO missing inputs and readiness never
    // nags "Declare 1 input the algorithm needs."
    expect(result.map((r) => r.id)).toEqual(["revenue"]);
  });

  it("context.* engine reads (context.lcm) never surface as required inputs", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Premium",
            base_input: "literal.base_value",
            // Spec §4.6's third binding namespace: the plan-level LCM
            // context read — a plan value, never a per-risk column.
            lcm: { input_path: "context.lcm" },
          },
        ]),
      ],
      [],
    );
    expect(result.map((r) => r.id)).toEqual([]);
  });

  it("a colon-form dim binding path never ghosts from the lookup walk either", () => {
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Premium",
            base_input: "form_input.base_rate",
            factor_lookups: [
              {
                name: "bogus binding",
                dimensions: {
                  some_dim: { source: "form_input", path: "literal:2" },
                },
              },
            ],
          },
        ]),
      ],
      [],
    );
    expect(result.map((r) => r.id)).toEqual(["base_rate"]);
  });

  it("a base_input via stages.X.value collapses to the X stage's id", () => {
    // When the chain references the OUTPUT of an input_node, the
    // path is `stages.X.value`. The deriver surfaces "X" as the
    // required field — same as the input_node walk would surface,
    // so the dedup keeps them as one entry.
    const result = deriveRequiredInputs(
      [
        inputStage("rate_number", { sourcePath: "rate_number" }),
        chainStage([
          {
            name: "Building chain",
            base_input: "stages.rate_number.value",
          },
        ]),
      ],
      [],
    );
    // Single "rate_number" entry — the input_node walk wrote first,
    // the chain raw-path walk sees the dedup id and skips.
    const rateNumber = result.filter((r) => r.id === "rate_number");
    expect(rateNumber.length).toBe(1);
    // Origin is the input_node's (first-seen wins).
    expect(rateNumber[0]!.origin).toMatch(/^Input ·/);
  });
});

// ─────────────────────────────────────────────────────────────────
// Walker 4 — flat_factor
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · flat_factor", () => {
  it("surfaces input_path", () => {
    const result = deriveRequiredInputs(
      [
        flatFactorStage("loading_x", {
          input_path: "form_input.tiv",
        }),
      ],
      [],
    );
    expect(result.map((r) => r.id)).toEqual(["tiv"]);
  });

  it("surfaces every input_paths[] entry", () => {
    const result = deriveRequiredInputs(
      [
        flatFactorStage("multi_loading", {
          input_paths: ["form_input.tiv", "form_input.bpp"],
        }),
      ],
      [],
    );
    expect(result.map((r) => r.id).sort()).toEqual(["bpp", "tiv"]);
  });

  // Platform-test finding E10 — a loading targeting a plan stage's
  // output (`stages.<chain>.value`) or a chain output (`chain.<field>`)
  // references PLAN OUTPUTS, not risk inputs. Surfacing them made
  // "Declare N missing" mint junk input declarations
  // (`multiplicative_chain_main`, `chain.bpp_premium_premium`).
  it("does NOT surface a stages.* path that targets a plan stage (E10)", () => {
    const mainChain: StageLike = {
      stage_id: "multiplicative_chain_main",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [{ name: "main", base_value: 1, output_field: "value" }],
      },
    };
    const result = deriveRequiredInputs(
      [
        mainChain,
        flatFactorStage("loading_x", {
          input_path: "stages.multiplicative_chain_main.value",
        }),
      ],
      [],
    );
    expect(result.map((r) => r.id)).not.toContain(
      "multiplicative_chain_main",
    );
  });

  it("does NOT surface chain.* output references (E10)", () => {
    const result = deriveRequiredInputs(
      [
        flatFactorStage("multi_loading", {
          input_paths: [
            "chain.building_premium_premium",
            "chain.bpp_premium_premium",
            "form_input.is_new_business",
          ],
        }),
      ],
      [],
    );
    expect(result.map((r) => r.id)).toEqual(["is_new_business"]);
  });

  it("STILL surfaces a stages.* path that targets a declared input_node", () => {
    // Brief 52's typed-input shape: `stages.<input_node_id>.value`
    // legitimately names a declarable input — only PLAN stages skip.
    const result = deriveRequiredInputs(
      [
        inputStage("input_tiv", { displayName: "TIV" }),
        flatFactorStage("loading_x", {
          input_path: "stages.input_tiv.value",
        }),
      ],
      [],
    );
    expect(result.map((r) => r.id)).toEqual(["input_tiv"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Stable ordering
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · ordering", () => {
  it("groups dims first, then inputs, then models, then products", () => {
    const result = deriveRequiredInputs(
      [
        inputStage("zinput", { sourcePath: "z", displayName: "Z input" }),
        chainStage([
          {
            name: "ch",
            factor_lookups: [
              {
                name: "F",
                dimensions: {
                  z_dim: { source: "form_input", path: "z_dim" },
                  a_dim: { source: "form_input", path: "a_dim" },
                },
              },
            ],
          },
        ]),
        inputStage("ainput", { sourcePath: "a", displayName: "A input" }),
      ],
      [dim("z_dim", "Z dim"), dim("a_dim", "A dim")],
    );
    // First the two dims alphabetically, then the two inputs
    // alphabetically.
    expect(result.map((r) => `${r.category}:${r.name}`)).toEqual([
      "dimensions:A dim",
      "dimensions:Z dim",
      "inputs:A input",
      "inputs:Z input",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────
// ISO BOP fixture — end-to-end
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · ISO BOP fixture shape", () => {
  it("derives the full required-inputs set for an BOP-shaped plan", () => {
    // Mirrors the sample-bop-sample-plan.ts fixture (without importing
    // it — keeps the test self-contained). Building chain + BPP
    // chain, each with a class_code factor; plus 4 input_node
    // stages for class_code / tiv / bpp / rate_number.
    const stages: StageLike[] = [
      inputStage("input_class_code", {
        displayName: "Class code",
        sourcePath: "class_code",
      }),
      inputStage("input_tiv", {
        displayName: "Total insurable value",
        sourcePath: "tiv",
        dataType: "number",
      }),
      inputStage("input_bpp", {
        displayName: "Business personal property",
        sourcePath: "bpp",
        dataType: "number",
      }),
      inputStage("rate_number", {
        displayName: "Base rate",
        sourcePath: "rate_number",
        dataType: "number",
      }),
      chainStage([
        {
          name: "Building chain",
          base_input: "stages.rate_number.value",
          exposure_input: "form_input.tiv",
          lcm: { input_path: "form_input.lcm" },
          factor_lookups: [
            {
              name: "Class factor",
              dimensions: {
                class_code: {
                  source: "form_input",
                  path: "class_code",
                },
              },
            },
          ],
        },
        {
          name: "BPP chain",
          base_input: "stages.rate_number.value",
          exposure_input: "form_input.bpp",
          lcm: { input_path: "form_input.lcm" },
          factor_lookups: [
            {
              name: "BPP class factor",
              dimensions: {
                class_code: {
                  source: "form_input",
                  path: "class_code",
                },
              },
            },
          ],
        },
      ]),
    ];
    const dims = [dim("class_code", "Class code")];

    const result = deriveRequiredInputs(stages, dims);
    const ids = result.map((r) => r.id);

    // Should contain every user-facing field the chain + inputs
    // collectively need.
    expect(ids).toContain("class_code"); // dim
    expect(ids).toContain("tiv");
    expect(ids).toContain("bpp");
    expect(ids).toContain("rate_number");
    expect(ids).toContain("lcm");

    // class_code is the FIRST entry (dim category sorts first).
    expect(result[0]!.id).toBe("class_code");
    expect(result[0]!.category).toBe("dimensions");
  });
});

// ─────────────────────────────────────────────────────────────────
// The user's hypothetical case — class dim + factor + chain, no
// input_node stages. The rail must surface class_code anyway.
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · class-dim-only plan", () => {
  it("surfaces a dim ref even when the user authored zero input_node stages", () => {
    // The user creates a "class" dim, a factor table for it, and a
    // rating algo (chain). They DID NOT add an explicit input_node.
    // Before PR 11h: the workspace showed an empty mapping table.
    // After PR 11h: class_code is surfaced from the chain's dim
    // binding — the user can map a CSV column to it.
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "User chain",
            factor_lookups: [
              {
                name: "Class factor",
                dimensions: {
                  class: {
                    source: "form_input",
                    path: "class_code",
                  },
                },
              },
            ],
          },
        ]),
      ],
      [dim("class", "Class")],
    );
    expect(result).toEqual([
      {
        id: "class_code",
        name: "Class",
        category: "dimensions",
        dtype: "string",
        dimSlug: "class",
        origin: "Class factor · User chain",
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────
// PR 13.1 — Catalog-driven derivation (FT keys + dim catalog)
// ─────────────────────────────────────────────────────────────────

describe("deriveRequiredInputs · catalog-driven (PR 13.1)", () => {
  it("surfaces each catalog dim as a required input even with no stages", () => {
    const result = deriveRequiredInputs(
      [],
      [dim("class", "Class code"), dim("territory", "Territory")],
    );
    expect(result).toEqual([
      {
        id: "class",
        name: "Class code",
        category: "dimensions",
        dtype: "string",
        dimSlug: "class",
        origin: "Dim · Class code",
      },
      {
        id: "territory",
        name: "Territory",
        category: "dimensions",
        dtype: "string",
        dimSlug: "territory",
        origin: "Dim · Territory",
      },
    ]);
  });

  it("infers numeric dtype for banded dims", () => {
    const result = deriveRequiredInputs(
      [],
      [dim("building_age", "Building age", "banded")],
    );
    expect(result[0]!.dtype).toBe("number");
  });

  it("surfaces a factor table's key_dimension as a required input", () => {
    const result = deriveRequiredInputs(
      [],
      [dim("class", "Class code")],
      {
        factorTables: [
          {
            id: "class_factor",
            display_name: "Class factor table",
            key_dimension: "class",
          },
        ],
      },
    );
    expect(result).toEqual([
      {
        id: "class",
        name: "Class code",
        category: "dimensions",
        dtype: "string",
        dimSlug: "class",
        origin: "Class factor table (key)",
      },
    ]);
  });

  it("walks key_dimensions[] for 2-D / N-D factor tables", () => {
    const result = deriveRequiredInputs(
      [],
      [dim("class", "Class"), dim("building_age", "Building age", "banded")],
      {
        factorTables: [
          {
            id: "age_x_class",
            display_name: "Building age × Class",
            key_dimensions: ["building_age", "class"],
          },
        ],
      },
    );
    expect(result.map((r) => r.id).sort()).toEqual(["building_age", "class"]);
  });

  it("falls back to FT id when display_name is missing", () => {
    const result = deriveRequiredInputs([], [], {
      factorTables: [{ id: "foo_table", key_dimension: "foo" }],
    });
    expect(result[0]!.origin).toBe("foo_table (key)");
  });

  it("surfaces FT keys even when the dim isn't in the catalog", () => {
    const result = deriveRequiredInputs([], [], {
      factorTables: [
        { id: "ft", display_name: "FT", key_dimension: "orphan_slug" },
      ],
    });
    expect(result[0]!.name).toBe("orphan_slug");
    expect(result[0]!.dtype).toBe("string");
  });

  it("chain-driven origin WINS over FT-key + catalog passes", () => {
    // Same `class` dim referenced three ways: chain factor lookup
    // (Pass 1), FT key (Pass 3), catalog dim (Pass 4). The chain
    // attribution should be the one that lands in `origin`.
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "Building chain",
            factor_lookups: [
              {
                name: "Class factor",
                dimensions: {
                  class: { source: "form_input", path: "class" },
                },
              },
            ],
          },
        ]),
      ],
      [dim("class", "Class code")],
      {
        factorTables: [
          {
            id: "class_factor_table",
            display_name: "Class factor table",
            key_dimension: "class",
          },
        ],
      },
    );
    const classEntry = result.find((r) => r.id === "class");
    expect(classEntry!.origin).toBe("Class factor · Building chain");
  });

  it("FT-key origin WINS over catalog-dim fallback when both fire", () => {
    // No chain references `class`; the FT does. The dim is in the
    // catalog. The FT attribution should beat the bare catalog
    // fallback.
    const result = deriveRequiredInputs(
      [],
      [dim("class", "Class")],
      {
        factorTables: [
          {
            id: "ft",
            display_name: "Class factor table",
            key_dimension: "class",
          },
        ],
      },
    );
    expect(result[0]!.origin).toBe("Class factor table (key)");
  });

  it("returns empty for a fully blank plan with no catalogs", () => {
    expect(deriveRequiredInputs([], [], { factorTables: [] })).toEqual([]);
    expect(deriveRequiredInputs([], [])).toEqual([]);
  });

  it("co-exists with chain raw paths (inputs category unchanged)", () => {
    // Catalog passes only contribute "dimensions"; raw chain paths
    // still land in "inputs". Ordering: dims first, then inputs.
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "ch",
            base_input: "form_input.base_rate",
            exposure_input: "form_input.tiv",
          },
        ]),
      ],
      [dim("class", "Class")],
    );
    expect(result.map((r) => `${r.category}:${r.id}`)).toEqual([
      "dimensions:class",
      "inputs:base_rate",
      "inputs:tiv",
    ]);
  });
});

// ── Brief 95 C2 — computed dimension bindings (derived inputs) ────────

describe("computed dimension bindings (Brief 95 C2)", () => {
  const computedLookup = chainStage([
    {
      name: "Building chain",
      base_input: "literal:0.15",
      exposure_input: "form_input.building_limit",
      factor_lookups: [
        {
          name: "Deductible band",
          factor_kind: "prop_limit_band",
          dimensions: {
            prop_limit_band: {
              source: "computed",
              op: "sum",
              fields: ["building_limit", "bpp_limit"],
            },
          },
        },
      ],
    },
  ]);

  it("requires the OPERANDS, never the computed dim's slug", () => {
    const result = deriveRequiredInputs(
      [computedLookup],
      [dim("prop_limit_band", "Property limit band")],
    );
    const ids = result.map((r) => r.id);
    expect(ids).toContain("building_limit");
    expect(ids).toContain("bpp_limit");
    // The dim key is built inside the graph (chain.add → band
    // resolution) — the catalog fallback must NOT re-demand it as a
    // column, or readiness nags "Declare 1 input the algorithm needs."
    // on every ingested plan with a derived input (found live, WI v1.1.0).
    expect(ids).not.toContain("prop_limit_band");
  });

  it("a declared operand keeps its input_node entry (richer name wins)", () => {
    // Input stages first, chains after — the stage order every
    // ingested plan carries.
    const result = deriveRequiredInputs(
      [
        {
          stage_id: "input_building_limit",
          stage_kind: "input_node",
          config_json: {
            name: "Building limit of insurance",
            source_path: "building_limit",
            data_type: "currency",
          },
        },
        computedLookup,
      ],
      [dim("prop_limit_band", "Property limit band")],
    );
    const entry = result.find((r) => r.id === "building_limit");
    expect(entry?.name).toBe("Building limit of insurance");
    expect(entry?.category).toBe("inputs");
  });

  it("the FT catalog pass also respects a computed-bound dim", () => {
    const result = deriveRequiredInputs(
      [computedLookup],
      [dim("prop_limit_band", "Property limit band")],
      {
        factorTables: [
          {
            id: "prop_limit_band",
            display_name: "Deductible band factor",
            key_dimension: "prop_limit_band",
          },
        ],
      },
    );
    expect(result.map((r) => r.id)).not.toContain("prop_limit_band");
  });
});

describe("deriveRequiredInputs · composite dims (ADR-0025 / FCA #21)", () => {
  const compositeDim = () =>
    ({
      slug: "gd_basis",
      display_name: "Good-driver basis",
      shape: "composite",
      axes: ["sdip_band", "lic_band"],
    }) as unknown as Dimension;

  it("a composite binding surfaces its MEMBERS' fields, never the composite slug — from any pass", () => {
    // Live-caught on the composite demo plan: the chain pass skipped
    // the composite (good) but Pass 3 re-registered `gd_basis` from
    // the FT's key_dimension — the Overview banner demanded
    // "Declare 1 input the algorithm needs" for a field the graph
    // derives. The composite is never a column, in ANY pass.
    const result = deriveRequiredInputs(
      [
        chainStage([
          {
            name: "GD chain",
            base_input: "form_input.base",
            factor_lookups: [
              {
                name: "Good-driver factor",
                factor_kind: "gd_factor",
                dimensions: {
                  gd_basis: {
                    source: "composite",
                    axes: {
                      sdip_band: {
                        source: "form_input",
                        path: "form_input.sdip_points",
                      },
                      lic_band: {
                        source: "form_input",
                        path: "form_input.lic_years",
                      },
                    },
                    // The deriver's FactorLookup binding type is the
                    // narrow {source, path} record shape.
                  } as unknown as { source: string; path: string },
                },
              },
            ],
          },
        ]),
      ],
      [
        compositeDim(),
        dim("sdip_band", "SDIP point band", "banded"),
        dim("lic_band", "Years licensed band", "banded"),
      ],
      {
        factorTables: [
          {
            id: "ft_gd",
            display_name: "Good-driver factor",
            key_dimension: "gd_basis",
          },
        ],
      },
    );
    const ids = result.map((r) => r.id);
    expect(ids).toContain("sdip_points");
    expect(ids).toContain("lic_years");
    expect(ids).not.toContain("gd_basis");
    const member = result.find((r) => r.id === "sdip_points");
    expect(member?.dimSlug).toBe("sdip_band");
    expect(member?.dtype).toBe("number");
    expect(member?.origin).toContain("member of gd_basis");
  });

  it("an UNBOUND composite in the catalog contributes nothing itself — its members surface", () => {
    const result = deriveRequiredInputs(
      [],
      [
        compositeDim(),
        dim("sdip_band", "SDIP point band", "banded"),
        dim("lic_band", "Years licensed band", "banded"),
      ],
      {},
    );
    const ids = result.map((r) => r.id);
    expect(ids).not.toContain("gd_basis");
    expect(ids).toContain("sdip_band");
    expect(ids).toContain("lic_band");
  });
});

describe("deriveRequiredInputs · schedule applications (FCA #23)", () => {
  it("a modifier.schedule stage surfaces its schedule_app_* field as an OPTIONAL mappable input", () => {
    // Finding 13: the extract's IRPM_PCT column had no destination —
    // the projector reads schedule_app_{id} from every row, but this
    // deriver never listed it, so Match columns couldn't map it and
    // six rows' filed credits/debits silently unapplied.
    const result = deriveRequiredInputs(
      [
        {
          stage_id: "mod_stage",
          stage_kind: "modifier.schedule",
          display_name: "Schedule rating",
          config_json: {
            schedule: {
              schedule_id: "psm_schedule",
              categories: [{ category_id: "overall", range_pct: 40 }],
            },
          },
        },
      ],
      [],
    );
    const entry = result.find((r) => r.id === "schedule_app_psm_schedule");
    expect(entry).toBeDefined();
    expect(entry!.optional).toBe(true);
    expect(entry!.dtype).toBe("number");
    expect(entry!.origin).toContain("Schedule");
  });

  it("the field key matches the projector's sanitize (one derivation)", () => {
    const result = deriveRequiredInputs(
      [
        {
          stage_id: "mod_stage",
          stage_kind: "modifier.schedule",
          config_json: { schedule: { schedule_id: "PSM Schedule-9" } },
        },
      ],
      [],
    );
    expect(result.some((r) => r.id === "schedule_app_psm_schedule_9")).toBe(
      true,
    );
  });
});
