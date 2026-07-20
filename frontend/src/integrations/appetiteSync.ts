/**
 * appetiteSync — Brief 70 §3 (the appetite statement's persistence
 * model).
 *
 * The document model: per SCOPE (row | policy), ONE consolidated
 * `eligibility.gate` stage whose ordered `rules[]` IS the document's
 * rule list — first match wins inside the stage (the engine's literal
 * `execute()` semantics), so drag-reorder is one config patch and the
 * "first match decides" caption is true, not a UI fiction.
 *
 * THE CONSOLIDATION LANDMINE (the 70 skeptic): legacy plans carry N
 * single-rule stages, and CROSS-STAGE composition is MOST-RESTRICTIVE-
 * WINS (`resolveEligibilityTier`), not first-match. Consolidating
 * order-preserving would flip verdicts. `consolidationOrder` sorts
 * most-restrictive-first (decline → submit → standard → preferred),
 * which reproduces the fired-rule composition exactly — verdict-
 * preserving BY CONSTRUCTION. The migration is an explicit, named
 * moment (never a silent on-mount sync), idempotent, and resumable.
 */

import type { EligibilityTier } from "@openrater/contracts";

/** One clause of a rule, in DISPLAY form (Brief 81). */
export interface AppetiteCondition {
  readonly variable: string;
  readonly op: string;
  /** Display-string value (the gatesSync coercion contract). */
  readonly value: string;
}

export interface AppetiteRule {
  readonly id: string;
  readonly tier: EligibilityTier;
  /** FIRST clause mirror — single-condition consumers keep reading
   *  these three; they always equal `conditions[0]`. */
  readonly variable: string;
  readonly op: string;
  /** Display-string value (the gatesSync coercion contract). */
  readonly value: string;
  /** Brief 81 — ALL clauses (length ≥ 1, implicit AND). One clause
   *  round-trips to the V1 config bytes; two or more persist as the
   *  compound `conditions[]` shape. */
  readonly conditions: readonly AppetiteCondition[];
  readonly reasoning: string;
  readonly citation: string;
}

export interface AppetiteScope {
  /** The consolidated stage id, when one exists. */
  readonly stageId: string | null;
  readonly rules: readonly AppetiteRule[];
}

export interface AppetiteModel {
  readonly row: AppetiteScope;
  readonly policy: AppetiteScope;
  readonly defaultTier: EligibilityTier;
  /**
   * False when the plan carries MULTIPLE gate stages for a scope (the
   * legacy shape). The document then renders the honest projection
   * ("the stricter outcome stands") and offers the consolidation
   * moment instead of editing.
   */
  readonly consolidated: boolean;
  /** Every eligibility.gate stage id, for the migration. */
  readonly legacyStageIds: readonly string[];
}

const TIER_SEVERITY: Record<string, number> = {
  decline: 0,
  submit: 1,
  standard: 2,
  preferred: 3,
};

function coerceValueIn(raw: unknown, op: string): string {
  if (op === "in" || op === "nin") {
    if (Array.isArray(raw)) return raw.map(String).join(", ");
    return String(raw ?? "");
  }
  return String(raw ?? "");
}

/**
 * Platform-test finding E3 — the dtype vocabulary the composer's field
 * options carry (PrimitiveType from the input dictionary, "number" for
 * ADR-0046 policy aggregates, undefined for dimensions).
 */
export type AppetiteValueDtype = "number" | "string" | "bool";

/**
 * Normalize a field's declared dtype into the coercion vocabulary.
 * Numeric PrimitiveTypes (money / factor / pct / int / number) coerce
 * to numbers; identifier-ish ones (string / class_code / date / enum)
 * stay strings so zero-padded codes survive verbatim.
 */
export function normalizeAppetiteDtype(
  dtype: string | undefined,
): AppetiteValueDtype | undefined {
  switch (dtype) {
    case "number":
    case "money":
    case "factor":
    case "pct":
    case "int":
      return "number";
    case "string":
    case "class_code":
    case "date":
    case "enum":
      return "string";
    case "bool":
      return "bool";
    default:
      return undefined;
  }
}

function coerceScalar(s: string): unknown {
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  if (
    !Number.isNaN(n) &&
    Number.isFinite(n) &&
    /^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)
  ) {
    return n;
  }
  return s;
}

/**
 * Coerce ONE entered value to the field's declared dtype (finding E3).
 * A declared "number" keeps non-parsing entries as strings (honest
 * fallback — the engine's loose comparator bridges the seam); a
 * declared "string" persists verbatim (zero-padded class codes stay
 * "09035"); no declared dtype falls back to the guessing coerceScalar.
 */
function coerceScalarTyped(
  s: string,
  dtype: AppetiteValueDtype | undefined,
): unknown {
  if (dtype === "string") return s;
  if (dtype === "number") {
    if (s === "") return "";
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  if (dtype === "bool") {
    if (s === "true") return true;
    if (s === "false") return false;
    return s;
  }
  return coerceScalar(s);
}

function coerceValueOut(
  raw: string,
  op: string,
  dtype: AppetiteValueDtype | undefined,
): unknown {
  const trimmed = raw.trim();
  if (op === "in" || op === "nin") {
    const entries = trimmed
      .split(",")
      .map((s) => coerceScalarTyped(s.trim(), dtype))
      .filter((s) => s !== "");
    // E3 homogeneity guard: without a declared dtype, a list that
    // guesses into MIXED number/string entries (ints for "60989",
    // strings for zero-padded "09035") can never match consistently —
    // persist all-strings instead of a half-typed list.
    if (
      dtype === undefined &&
      entries.some((e) => typeof e === "number") &&
      entries.some((e) => typeof e === "string")
    ) {
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
    }
    return entries;
  }
  return coerceScalarTyped(trimmed, dtype);
}

interface GateStageLike {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly config_json: Record<string, unknown> | null;
}

function gateStages(
  stages: readonly GateStageLike[],
): readonly GateStageLike[] {
  return stages.filter((s) => s.stage_kind === "eligibility.gate");
}

function rulesOf(stage: GateStageLike): AppetiteRule[] {
  const cfg = stage.config_json ?? {};
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  return (rules as ReadonlyArray<Record<string, unknown>>).map((r, i) => {
    // Brief 81 — read EITHER shape into one clauses list; the first
    // clause mirrors onto the top-level triple.
    const rawConditions = Array.isArray(r.conditions)
      ? (r.conditions as ReadonlyArray<Record<string, unknown>>)
      : [{ variable: r.variable, op: r.op, value: r.value }];
    const conditions: AppetiteCondition[] = rawConditions.map((c) => ({
      variable: String(c.variable ?? ""),
      op: String(c.op ?? "eq"),
      value: coerceValueIn(c.value, String(c.op ?? "eq")),
    }));
    const first = conditions[0] ?? { variable: "", op: "eq", value: "" };
    return {
      id: String(r.rule_id ?? `${stage.stage_id}_r${i}`),
      tier: (r.tier as EligibilityTier) ?? "standard",
      variable: first.variable,
      op: first.op,
      value: first.value,
      conditions,
      reasoning: String(r.reasoning ?? ""),
      citation: String(r.citation ?? ""),
    };
  });
}

function scopeOf(stage: GateStageLike): "row" | "policy" {
  return (stage.config_json?.scope as string) === "policy"
    ? "policy"
    : "row";
}

/** Read the plan's gate stages into the document model. */
export function planStagesToAppetite(
  stages: readonly GateStageLike[],
): AppetiteModel {
  const gates = gateStages(stages);
  const byScope: Record<"row" | "policy", GateStageLike[]> = {
    row: [],
    policy: [],
  };
  for (const g of gates) byScope[scopeOf(g)].push(g);

  const consolidated =
    byScope.row.length <= 1 && byScope.policy.length <= 1;

  const readScope = (list: GateStageLike[]): AppetiteScope => {
    if (list.length === 1) {
      return { stageId: list[0]!.stage_id, rules: rulesOf(list[0]!) };
    }
    // Legacy projection: flatten in most-restrictive order so the
    // READ matches what the engine composes (the honest projection).
    const flat = list.flatMap(rulesOf);
    return { stageId: null, rules: consolidationOrder(flat) };
  };

  // The plan default: the most restrictive default_tier across stages
  // (that's the one that survives `resolveEligibilityTier` when no
  // rule fires anywhere).
  let defaultTier: EligibilityTier = "standard";
  let best = TIER_SEVERITY[defaultTier] ?? 2;
  for (const g of gates) {
    const t = (g.config_json?.default_tier as EligibilityTier) ?? "standard";
    const sev = TIER_SEVERITY[t] ?? 2;
    if (gates.length > 0 && (sev < best || g === gates[0])) {
      defaultTier = t;
      best = sev;
    }
  }

  return {
    row: readScope(byScope.row),
    policy: readScope(byScope.policy),
    defaultTier,
    consolidated,
    legacyStageIds: gates.map((g) => g.stage_id),
  };
}

/**
 * Most-restrictive-first: reproduces the cross-stage
 * `resolveEligibilityTier` composition inside one first-match stage —
 * verdict-preserving by construction.
 */
export function consolidationOrder(
  rules: readonly AppetiteRule[],
): AppetiteRule[] {
  return [...rules].sort(
    (a, b) =>
      (TIER_SEVERITY[a.tier] ?? 2) - (TIER_SEVERITY[b.tier] ?? 2),
  );
}

/**
 * Build the consolidated stage config for a scope's ordered rules.
 *
 * `dtypeOf` (finding E3) resolves a rule variable to its declared
 * dtype (raw PrimitiveType is fine — normalized here) so entered
 * values persist AS the field's type instead of per-entry guessing.
 * Omitted → the legacy guess with the mixed-list homogeneity guard.
 */
export function appetiteScopeConfig(
  scope: "row" | "policy",
  rules: readonly AppetiteRule[],
  defaultTier: EligibilityTier,
  dtypeOf?: (variable: string) => string | undefined,
): Record<string, unknown> {
  return {
    scope,
    rules: rules.map((r) => {
      // Brief 81 D-B — one clause persists the V1 bytes; two or more
      // persist the compound `conditions[]` shape. Each clause coerces
      // by ITS OWN variable's declared dtype (the E3 contract).
      const clauses =
        r.conditions.length > 0
          ? r.conditions
          : [{ variable: r.variable, op: r.op, value: r.value }];
      const shape =
        clauses.length <= 1
          ? {
              variable: clauses[0]?.variable ?? r.variable,
              op: clauses[0]?.op ?? r.op,
              value: coerceValueOut(
                clauses[0]?.value ?? r.value,
                clauses[0]?.op ?? r.op,
                normalizeAppetiteDtype(
                  dtypeOf?.(clauses[0]?.variable ?? r.variable),
                ),
              ),
            }
          : {
              conditions: clauses.map((c) => ({
                variable: c.variable,
                op: c.op,
                value: coerceValueOut(
                  c.value,
                  c.op,
                  normalizeAppetiteDtype(dtypeOf?.(c.variable)),
                ),
              })),
            };
      return {
        rule_id: r.id,
        ...shape,
        tier: r.tier,
        reasoning: r.reasoning || "Appetite rule.",
        ...(r.citation ? { citation: r.citation } : {}),
      };
    }),
    default_tier: defaultTier,
    default_reasoning: "No appetite rule matched.",
  };
}

export const APPETITE_STAGE_ID: Record<"row" | "policy", string> = {
  row: "appetite_location",
  policy: "appetite_policy",
};
