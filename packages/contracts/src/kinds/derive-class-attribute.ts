/**
 * `derive.class_attribute` kind — resolve a class code into one of its
 * DERIVED structural attributes (rate number / class group / exposure
 * base / …).
 *
 * The bridge between a `class_code` rating input and the STRUCTURAL
 * dimensions a filing derives from it. ISO BOP rates a risk by deriving
 * `prop_rate_number`, `liab_class_group`, and `liab_exposure_base` from
 * the class code (the manual's classification table), then keys factor
 * tables off those DERIVED values (`ft.rate_number_rel` on
 * `prop_rate_number`, `ft.liab_cg_occupant` on `liab_class_group`, …).
 *
 * This is the typed STRING-valued sibling of `lookup.classification`
 * (which maps class_code → a NUMBER factor): this maps class_code → a
 * STRING level id of a derived structural dim. Per ADR-0035.
 *
 * Same projector-inserts-a-derive-node pattern + persistence boundary
 * as `derive.band` (ADR-0026) and `derive.territory` (ADR-0028): the
 * `table` is a snapshot of the plan's per-plan class registry built at
 * projection/compile time. Edits to the registry require a re-projection
 * — the same contract as `lookup.direct`'s embedded `table`.
 *
 * Per node-design-principle P-N1 (pure execute): no side effects, no
 * I/O, no state. Same `(class_code, table)` → same `value` forever.
 *
 * Per P-N4 + P-N5: the trace records the derived value; `explainStep`
 * renders a citation-friendly line:
 *
 *   "Derived prop_rate_number of class 53983 → 09 (ISO BOP class table)"
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface DeriveClassAttributeParams {
  /**
   * Which derived attribute this node resolves — e.g. "prop_rate_number",
   * "liab_class_group", "liab_exposure_base". Audit-facing (appears in the
   * trace) + names the derived structural dim. Doesn't affect resolution.
   */
  readonly attributeKey: string;
  /**
   * Snapshot of `class_code → attribute value`. Per ADR-0035 the
   * projector builds this from the plan's class registry at compile time
   * (each registry row's `attributes[attributeKey]`), so the runtime
   * doesn't need the registry handle. Keys are the canonical class codes
   * (leading zeros significant, e.g. "09015"); values are level ids of
   * the derived structural dim.
   */
  readonly table: Readonly<Record<string, string>>;
  /**
   * Value returned when the class code is not in the table. Defaults to
   * "" — which then propagates to a downstream `lookup.direct` and falls
   * back to ITS `defaultValue` (no silent factor injected here).
   */
  readonly defaultValue?: string;
  /** Optional human name of the source table — trace/explain only. */
  readonly tableName?: string;
  /** Optional citation reference for provenance (P-N4). */
  readonly citation?: string;
}

export type DeriveClassAttributeInputs = {
  class_code: string;
  /**
   * Optional DECLARED override (Brief 83 / TV-19): when wired and
   * non-empty it supersedes the class-derived value — ISO BOP's
   * `liab_exposure_basis_override` lets an occupant-class insured elect
   * the lessors basis. Left unwired by every plan that doesn't author
   * `derived_from.override_field`, so legacy graphs are byte-identical.
   */
  override?: string;
};
export type DeriveClassAttributeOutputs = { value: string };

/**
 * Coerce + normalize a class code the same way in `execute` and
 * `explainStep`. Class codes are case-sensitive digit-strings — leading
 * zeros matter ("09015" ≠ "9015") — so we trim + stringify but do NOT
 * lowercase. `externalInputs` are `unknown`, so a CSV cell that parsed
 * to a number (53983) must still resolve.
 */
function normalizeCode(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (raw == null) return "";
  return String(raw).trim();
}

export const DeriveClassAttributeKind: BlockKind<
  DeriveClassAttributeParams,
  DeriveClassAttributeInputs,
  DeriveClassAttributeOutputs
> = {
  id: "derive.class_attribute",
  category: "lookup",
  label: "Class-derived attribute",
  description:
    "Derive a structural attribute from a class code ('53983' → rate number '09')",
  inputs: [
    {
      name: "class_code",
      type: "class_code",
      description: "The class code to derive a structural attribute from",
    } as PortSpec,
    {
      name: "override",
      type: "string",
      description:
        "Optional declared override — a non-empty value supersedes the class-derived attribute (filed basis elections)",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "string",
      description:
        "The derived attribute value (a level id of the structural dim)",
    } as PortSpec,
  ],
  defaultParams: { attributeKey: "", table: {} },
  defaultSize: "compact",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    // A DECLARED override wins outright (P-N1-pure: same inputs, same
    // value). Empty/absent falls through to the class derivation, so an
    // unwired port changes nothing.
    const override = normalizeCode(inputs.override);
    if (override !== "") return { value: override };
    const code = normalizeCode(inputs.class_code);
    const found = params.table[code];
    return { value: found ?? params.defaultValue ?? "" };
  },
  validate: (params) => {
    if (Object.keys(params.table).length === 0) {
      // An empty table is valid at the kind level (the registry may be
      // empty, or the editor is mid-author), but the engine will always
      // return the default. Surface as a warning — matches
      // `lookup.classification` + `derive.territory`.
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message:
              "Class-attribute table is empty; every class resolves to the default",
            field: "table",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const attr = params.attributeKey || "attribute";
    const src = params.tableName ? ` (${params.tableName})` : "";
    if (normalizeCode(inputs.override) !== "") {
      return `Declared ${attr} override → ${outputs.value} (supersedes the class-derived value)`;
    }
    const code = normalizeCode(inputs.class_code);
    if (Object.prototype.hasOwnProperty.call(params.table, code)) {
      return `Derived ${attr} of class ${inputs.class_code} → ${outputs.value}${src}`;
    }
    return `Class ${inputs.class_code} not in ${attr} table${src} → ${outputs.value} (default)`;
  },
  // ADR-0056 — a class code with no attribute row is a structured
  // (warning) issue naming the root cause; the CONSUMING lookup's
  // onMiss policy governs the row's fate when the unresolved key
  // misses its table.
  collectRowIssues: (inputs, params) => {
    // An override answers the question the class table would have — no
    // missing-attribute warning; a junk override value surfaces at the
    // CONSUMING lookup's onMiss with the value named (Law 2).
    if (normalizeCode(inputs.override) !== "") return undefined;
    const code = normalizeCode(inputs.class_code);
    if (Object.prototype.hasOwnProperty.call(params.table, code)) {
      return undefined;
    }
    const attr = params.attributeKey || "attribute";
    return [
      {
        severity: "warning",
        code: "class_attribute_missing",
        message: `Class \`${String(inputs.class_code)}\` has no \`${attr}\` attribute${params.tableName ? ` in ${params.tableName}` : ""}; the consuming lookup's unknown-key policy decides the outcome.`,
        detail: {
          key: String(inputs.class_code),
          field: attr,
          ...(params.tableName !== undefined
            ? { table: params.tableName }
            : {}),
        },
      },
    ];
  },
};
