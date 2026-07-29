/**
 * inputsPreflight — G5 (ADR-0056): name what the caller got wrong.
 *
 * The ENGINE already refuses honestly (G8: a missing/unknown key errors
 * the row — `row_status: "error"`, premium withheld). This pre-flight is
 * the API-ergonomics half: structured `missing_inputs` /
 * `unknown_inputs` in the response, derived from the fields the
 * COMPILED plan actually consumes — so a misspelled column is named,
 * not hunted.
 *
 * Consumed = every `input` / `input.source` node's fieldName; required
 * = consumed with no authored defaultValue. Pure over (plan, inputs).
 *
 * FCA fca-2026-07-25 layered a REFUSAL contract on top (spec §12.4): a
 * field the workbook DECLARES required with no default, absent at
 * runtime, refuses the row — even when only the eligibility gate reads
 * it. `refused_inputs` is that subset; `missing_inputs` stays the
 * wider advisory list. The two must not be conflated (review finding:
 * escalating the whole advisory union refused rows the projected plan
 * rates correctly — caller/projector defaults, structural `optional`,
 * declared-OPTIONAL chain inputs riding authored lookup grace).
 *
 * JSON `null` counts as ABSENT here (FCA #10, the Ship try-it): on
 * the wire, `"field": null` supplies no value — and the gate's
 * missing-variable grace only covers `undefined`, so a null'd
 * required field used to dodge the refusal and rate a risk whose
 * eligibility was never answered. Null'd fields refuse by name; a
 * declared default fills a null exactly as it fills an omission.
 */

import type { Plan } from "@openrater/contracts";

export interface InputsPreflight {
  /** Required (no-default) consumed fields absent from the request —
   *  the G5 advisory list (name what to fix). */
  readonly missing_inputs: readonly string[];
  /** Supplied fields the plan does not consume (typo tell). */
  readonly unknown_inputs: readonly string[];
  /** The subset that REFUSES the row (spec §12.4): declared required
   *  with no workbook default, non-derived, absent, and not satisfied
   *  by the projected plan (an input node carrying a defaultValue or
   *  the structural `optional` grace). Empty when the caller has no
   *  declared dictionary — raw plans keep the pre-FCA advisory-only
   *  semantics (the engine's G8 refusal already covers chain misses). */
  readonly refused_inputs: readonly string[];
}

/**
 * FCA fca-2026-07-25 (S0 — required gate-only input rated anyway) —
 * the authored input dictionary, distilled from the plan's input_node
 * stage declarations. The compiled Plan only carries input NODES for
 * fields some chain stage consumes; a declared-required field that
 * feeds ONLY the eligibility gate has no node, so preflight never
 * demanded it, the gate's missing-variable grace no-matched, and an
 * ineligible risk priced 'standard' with input_issues null. Spec
 * §12.4 is unambiguous: required + no default + absent ⇒ the row
 * refuses, loudly, naming the field.
 */
export interface DeclaredInput {
  readonly fieldName: string;
  readonly required: boolean;
  readonly hasDefault: boolean;
  /** The authored default itself (present iff hasDefault) — the
   *  gate-only default injection reads it. */
  readonly defaultValue?: unknown;
  /** Brief 95 C2 — computed from other inputs, never row-supplied. */
  readonly derived: boolean;
  /** FCA #15 — the workbook's declared validation (inputs sheet
   *  min/max/allowed_values). The plausibility check reads these; a
   *  declaration without enforcement was the audit's finding. */
  readonly min?: number;
  readonly max?: number;
  readonly allowedValues?: readonly string[];
}

/** Distill the declared input dictionary from `input_node` stages
 *  (the workbook inputs sheet, as built). Absent/foreign stages → []. */
export function declaredInputsFromStages(
  stages:
    | readonly { stage_kind?: string; config_json?: unknown }[]
    | null
    | undefined,
): readonly DeclaredInput[] {
  if (!stages) return [];
  const out: DeclaredInput[] = [];
  for (const s of stages) {
    if (s.stage_kind !== "input_node") continue;
    const cfg = (s.config_json ?? {}) as {
      name?: unknown;
      source_path?: unknown;
      required?: unknown;
      default_value?: unknown;
      source?: unknown;
      validation?: unknown;
    };
    const fieldName =
      (typeof cfg.source_path === "string" && cfg.source_path) ||
      (typeof cfg.name === "string" && cfg.name) ||
      "";
    if (!fieldName) continue;
    const hasDefault =
      cfg.default_value !== undefined && cfg.default_value !== null;
    const validation = (cfg.validation ?? {}) as {
      min?: unknown;
      max?: unknown;
      enum?: unknown;
    };
    const min =
      typeof validation.min === "number" && Number.isFinite(validation.min)
        ? validation.min
        : undefined;
    const max =
      typeof validation.max === "number" && Number.isFinite(validation.max)
        ? validation.max
        : undefined;
    const allowedValues = Array.isArray(validation.enum)
      ? validation.enum
          .filter((v): v is string => typeof v === "string" && v !== "")
      : undefined;
    out.push({
      fieldName,
      required: cfg.required === true,
      hasDefault,
      ...(hasDefault ? { defaultValue: cfg.default_value } : {}),
      derived: cfg.source === "derived",
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(allowedValues && allowedValues.length > 0
        ? { allowedValues }
        : {}),
    });
  }
  return out;
}

/**
 * FCA fca-2026-07-25 #15 — the plausibility signal. The workbook
 * declares validation (min/max bounds, allowed_values) and the schema
 * echoes it, but NOTHING checked a supplied value at rating time: a
 * driver_age below the declared min priced silently, garbage text in
 * an enum field silently disarmed the rule it fed. Every declared
 * bound is now checked per row and violations return WARNING issues —
 * the row still prices (row_status untouched; pricing supplied values
 * faithfully is the engine's contract), but the number stops
 * pretending nothing is odd.
 */
export function implausibleInputIssues(
  declared: readonly DeclaredInput[],
  inputs: Readonly<Record<string, unknown>>,
): {
  readonly severity: "warning";
  readonly code: "implausible_input";
  readonly nodeId: string;
  readonly message: string;
}[] {
  const issues: {
    readonly severity: "warning";
    readonly code: "implausible_input";
    readonly nodeId: string;
    readonly message: string;
  }[] = [];
  for (const d of declared) {
    const value = inputs[d.fieldName];
    if (value === undefined || value === null) continue;
    if (d.min !== undefined || d.max !== undefined) {
      const n =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : Number.NaN;
      if (Number.isFinite(n)) {
        if (d.min !== undefined && n < d.min) {
          issues.push({
            severity: "warning",
            code: "implausible_input",
            nodeId: "inputs_preflight",
            message:
              `${d.fieldName} = ${String(value)} is below the plan's ` +
              `declared minimum (${d.min}) — the row still priced; ` +
              `check the value.`,
          });
          continue;
        }
        if (d.max !== undefined && n > d.max) {
          issues.push({
            severity: "warning",
            code: "implausible_input",
            nodeId: "inputs_preflight",
            message:
              `${d.fieldName} = ${String(value)} is above the plan's ` +
              `declared maximum (${d.max}) — the row still priced; ` +
              `check the value.`,
          });
          continue;
        }
      }
    }
    if (d.allowedValues && typeof value === "string") {
      const hit = d.allowedValues.some(
        (a) => a.toLowerCase() === value.trim().toLowerCase(),
      );
      if (!hit) {
        issues.push({
          severity: "warning",
          code: "implausible_input",
          nodeId: "inputs_preflight",
          message:
            `${d.fieldName} = ${JSON.stringify(value)} is not among the ` +
            `plan's declared allowed values ` +
            `(${d.allowedValues.join(", ")}) — the row still priced; ` +
            `rules keyed on this field may not have matched.`,
        });
      }
    }
  }
  return issues;
}

/**
 * FCA review 2026-07-26 — a DECLARED default on a gate-only field
 * reached nothing: the projector lands defaults on input NODES (none
 * exists for a gate-only field) and the gate reads the raw
 * externalInputs record. Materialize those defaults into the record
 * itself, scoped to fields with NO input node — node-carried defaults
 * (which include caller `options.defaults`, the winner by precedence)
 * keep applying at substitution, and a supplied value always wins.
 */
export function withDeclaredGateDefaults(
  plan: Plan,
  declared: readonly DeclaredInput[],
  inputs: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const ported = new Set<string>();
  for (const node of plan.nodes ?? []) {
    if (node.kind !== "input" && node.kind !== "input.source") continue;
    const fieldName = (node.params as { fieldName?: unknown } | undefined)
      ?.fieldName;
    if (typeof fieldName === "string" && fieldName !== "") {
      ported.add(fieldName);
    }
  }
  let out: Record<string, unknown> | null = null;
  for (const d of declared) {
    if (!d.hasDefault) continue;
    if (ported.has(d.fieldName)) continue;
    // `null` is the wire's "no value" — the default fills it too.
    if (inputs[d.fieldName] !== undefined && inputs[d.fieldName] !== null)
      continue;
    out = out ?? { ...inputs };
    out[d.fieldName] = d.defaultValue;
  }
  return out ?? { ...inputs };
}

export function preflightInputs(
  plan: Plan,
  supplied: Readonly<Record<string, unknown>>,
  declared: readonly DeclaredInput[] = [],
): InputsPreflight {
  const consumed = new Set<string>();
  // The authored dictionary (when the caller has stages): every
  // declared input is part of the plan's contract — consumed. The
  // required verdicts are reconciled AFTER the node scan, because the
  // projected plan can SATISFY a declared requirement (a node
  // defaultValue — caller options.defaults or the harvested workbook
  // default — or the Brief 83.2 structural `optional` grace).
  const declaredRequired = new Set<string>();
  const declaredNotRequired = new Set<string>();
  for (const d of declared) {
    consumed.add(d.fieldName);
    if (d.required && !d.hasDefault && !d.derived) {
      declaredRequired.add(d.fieldName);
    } else {
      declaredNotRequired.add(d.fieldName);
    }
  }
  const nodeRequired = new Set<string>();
  const nodeSatisfied = new Set<string>();
  for (const node of plan.nodes ?? []) {
    // Brief 83.2 — eligibility-gate rule variables are CONSUMED (they
    // read externalInputs directly, no input node) but never REQUIRED
    // by themselves: the missing-variable grace means an absent
    // UNDECLARED variable is a rule no-match, not a refusal. Without
    // this, a gate-only field like `state` reported as an "unknown
    // input" typo tell.
    if (node.kind === "eligibility.gate") {
      const rules = (node.params as { rules?: readonly unknown[] } | undefined)
        ?.rules;
      for (const rule of rules ?? []) {
        const r = rule as {
          variable?: unknown;
          conditions?: readonly { variable?: unknown }[];
        };
        if (typeof r.variable === "string" && r.variable !== "") {
          consumed.add(r.variable);
        }
        for (const c of r.conditions ?? []) {
          if (typeof c?.variable === "string" && c.variable !== "") {
            consumed.add(c.variable);
          }
        }
      }
      continue;
    }
    if (node.kind !== "input" && node.kind !== "input.source") continue;
    const params = node.params as
      | { fieldName?: unknown; defaultValue?: unknown; optional?: unknown }
      | undefined;
    const fieldName = params?.fieldName;
    if (typeof fieldName !== "string" || fieldName === "") continue;
    consumed.add(fieldName);
    // Brief 83.2 — `optional: true` marks structurally-optional inputs
    // (declared overrides, exposure-option branch inputs, the schedule
    // application): consumed, never demanded. A node defaultValue
    // (caller constant or harvested workbook default) satisfies the
    // field outright.
    if (params?.defaultValue !== undefined || params?.optional === true) {
      nodeSatisfied.add(fieldName);
    } else {
      nodeRequired.add(fieldName);
    }
  }
  // Reconcile:
  //  · refusable — declared-required with nothing satisfying it. The
  //    §12.4 refusal set. A gate-only declared-required field has no
  //    node, so nothing overrides the dictionary — it stays here.
  //  · advisory required — refusable ∪ (node-required minus the fields
  //    the dictionary explicitly declares NOT required: the workbook's
  //    word beats a structural inference).
  const refusable = new Set<string>();
  for (const f of declaredRequired) {
    if (!nodeSatisfied.has(f)) refusable.add(f);
  }
  const required = new Set<string>(refusable);
  for (const f of nodeRequired) {
    if (!declaredNotRequired.has(f)) required.add(f);
  }
  // `"field": null` supplies NO value (see the module doc) — it must
  // not dodge the refusal the omission would have earned.
  const absent = (f: string) =>
    supplied[f] === undefined || supplied[f] === null;
  const suppliedKeys = Object.keys(supplied);
  const missing_inputs = [...required].filter(absent).sort();
  const refused_inputs = [...refusable].filter(absent).sort();
  const unknown_inputs = suppliedKeys.filter((k) => !consumed.has(k)).sort();
  return { missing_inputs, unknown_inputs, refused_inputs };
}
