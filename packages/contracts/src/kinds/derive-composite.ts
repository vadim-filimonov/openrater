/**
 * `derive.composite` kind — join member-dim level ids into a composite
 * dim's level id (ADR-0025).
 *
 * FCA fca-2026-07-25 #21: the spec's §4.4 composite shape (and the
 * capability registry's own recommendation) built into a plan that
 * could not rate a single row — the builder projected the composite
 * dim as a plain `form_input` nobody declared, every lookup refused
 * with `key ∅::… not found`, and the input schema never mentioned the
 * field the engine then demanded. The substrate has known how to
 * resolve a composite since Brief 27 (`resolveCompositeLevel`); this
 * kind is the missing PROJECTION piece: each member axis resolves
 * through its own existing derivation (band / territory / class-
 * attribute / raw), and this node joins the resolved level ids with
 * the substrate's `COMPOSITE_LEVEL_SEPARATOR` ("·") — the exact key
 * grammar the composite dim's authored levels and factor cells use.
 *
 * Per P-N11 (visible data flow): the join is its own trace line —
 * the auditor reads raw → member level → composite key → factor as
 * separate steps, mirroring how the filing's own tables are read.
 *
 * Per P-N1: pure. Same member ids → same composite id forever.
 * Members arrive on FIXED ordered ports (`part_1`..`part_3`) because
 * '·'-joins are not commutative and the check (R-065) caps composite
 * axes at 2–3.
 */

import type { BlockKind, PortSpec } from "../block-types";
import { COMPOSITE_LEVEL_SEPARATOR } from "../dimension-types";

export interface DeriveCompositeParams {
  /** The composite dim's slug — audit/trace facing. */
  readonly dimSlug: string;
  /** Member dim slugs in axis order — trace labels for the parts. */
  readonly partNames?: readonly string[];
  /** Join separator. Defaults to the substrate's "·" (ADR-0025). */
  readonly separator?: string;
}

export type DeriveCompositeInputs = {
  part_1: string;
  part_2: string;
  part_3?: string;
};
export type DeriveCompositeOutputs = { level_id: string };

function partOf(raw: unknown): string {
  return typeof raw === "string" ? raw : raw == null ? "" : String(raw);
}

export const DeriveCompositeKind: BlockKind<
  DeriveCompositeParams,
  DeriveCompositeInputs,
  DeriveCompositeOutputs
> = {
  id: "derive.composite",
  category: "lookup",
  label: "Composite key",
  description:
    "Join member-dim level ids into a composite level id ('pts_1·lic_10_plus')",
  inputs: [
    {
      name: "part_1",
      type: "string",
      description: "First member axis's resolved level id",
    } as PortSpec,
    {
      name: "part_2",
      type: "string",
      description: "Second member axis's resolved level id",
    } as PortSpec,
    {
      name: "part_3",
      type: "string",
      optional: true,
      description: "Third member axis's resolved level id (composites cap at 3)",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "level_id",
      type: "string",
      description: "The joined composite level id, or '' when a member is unresolved",
    } as PortSpec,
  ],
  defaultParams: { dimSlug: "" },
  defaultSize: "compact",
  execute: (inputs, params) => {
    const sep = params.separator ?? COMPOSITE_LEVEL_SEPARATOR;
    const parts = [inputs.part_1, inputs.part_2, inputs.part_3]
      .filter((p) => p !== undefined)
      .map(partOf);
    // A member that failed to resolve (empty level id) poisons the
    // whole key: emit "" so the consuming lookup takes ONE clean
    // unknown-key path instead of a garbled partial key ("·lic_10").
    if (parts.some((p) => p === "")) return { level_id: "" };
    return { level_id: parts.join(sep) };
  },
  validate: (params) => {
    if (!params.dimSlug) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message: "No dimSlug set; the trace line will read 'composite ='",
            field: "dimSlug",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const slug = params.dimSlug || "composite";
    const names = params.partNames ?? [];
    const parts = [inputs.part_1, inputs.part_2, inputs.part_3]
      .filter((p) => p !== undefined)
      .map(partOf);
    const shown = parts
      .map((p, i) => {
        const n = names[i];
        const v = p === "" ? "(unresolved)" : p;
        return n ? `${n}=${v}` : v;
      })
      .join(" + ");
    if (outputs.level_id === "") {
      return `${slug} = ${shown} → unresolved`;
    }
    return `${slug} = ${shown} → ${outputs.level_id}`;
  },
  // ADR-0056 — an unresolved member is a structured warning naming the
  // member, so the row's refusal cites the actual culprit instead of
  // the downstream lookup's opaque unknown-key.
  collectRowIssues: (inputs, params, outputs) => {
    if (outputs.level_id !== "") return undefined;
    const names = params.partNames ?? [];
    const parts = [inputs.part_1, inputs.part_2, inputs.part_3].filter(
      (p) => p !== undefined,
    );
    const missing = parts
      .map((p, i) => (partOf(p) === "" ? (names[i] ?? `part ${i + 1}`) : null))
      .filter((n): n is string => n !== null);
    const slug = params.dimSlug || "composite";
    return [
      {
        severity: "warning",
        code: "composite_member_unresolved",
        message:
          `Composite \`${slug}\` couldn't build its key — ` +
          `${missing.map((m) => `\`${m}\``).join(", ")} resolved to no level; ` +
          "the consuming lookup's unknown-key policy decides the outcome.",
        detail: {
          key: missing.join(","),
          field: slug,
        },
      },
    ];
  },
};
