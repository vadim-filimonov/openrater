/**
 * Exhibits — the UNDERWRITING ledger (mvp-tightness §5.2 / MVP-009).
 *
 * The compare was blind to everything that isn't a factor: two plans
 * could differ only in who they DECLINE and the ledger read "no
 * changes". This derivation pairs the underwriting stages across the
 * two sides — eligibility RULES (a gate stage explodes into its
 * rules), modifier schedules, endorsements, loadings — and renders
 * each pair as one terse line in the plan's own words:
 * "years_in_business threshold 3 → 5", "cap ±25% → ±30%",
 * "× 1.08 → × 1.12". Same voice as the re-ingest gate diff (T1).
 *
 * Pure; the route feeds stages from the live plan or a frozen
 * snapshot's body (both carry the same stage rows).
 */

export interface UwStageLike {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly display_name?: string | null | undefined;
  readonly config_json?: unknown;
}

export type UnderwritingKind =
  | "rule"
  | "modifier"
  | "endorsement"
  | "loading";

export interface UnderwritingRow {
  readonly id: string;
  readonly kind: UnderwritingKind;
  readonly name: string;
  readonly status: "same" | "changed" | "new" | "retired";
  /** One line, plan words. Null when unchanged. */
  readonly change: string | null;
}

interface Clause {
  readonly variable: string;
  readonly op: string;
  readonly value: unknown;
}

interface RuleFacts {
  readonly id: string;
  readonly tier: string;
  readonly clauses: readonly Clause[];
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function fmtValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(String).join(", ")}]`;
  return String(v);
}

/** A gate stage's rules, conditions normalized (flat rule op/variable/
 *  value and the conditions[] shape both occur in the substrate). */
function rulesOf(stage: UwStageLike): RuleFacts[] {
  const rules = asObject(stage.config_json)["rules"];
  if (!Array.isArray(rules)) return [];
  const out: RuleFacts[] = [];
  for (const raw of rules) {
    const r = asObject(raw);
    const id = typeof r["rule_id"] === "string" ? r["rule_id"] : null;
    if (id === null || id === "__default__") continue;
    const clauses: Clause[] = [];
    const conditions = r["conditions"];
    if (Array.isArray(conditions)) {
      for (const c of conditions) {
        const cc = asObject(c);
        if (typeof cc["variable"] === "string") {
          clauses.push({
            variable: cc["variable"],
            op: String(cc["op"] ?? ""),
            value: cc["value"],
          });
        }
      }
    } else if (typeof r["variable"] === "string") {
      clauses.push({
        variable: r["variable"],
        op: String(r["op"] ?? ""),
        value: r["value"],
      });
    }
    out.push({ id, tier: String(r["tier"] ?? ""), clauses });
  }
  return out;
}

/** The rule diff, spoken in variables (the T1 gate-diff voice). */
function diffRule(a: RuleFacts, b: RuleFacts): string | null {
  const parts: string[] = [];
  const byVar = (cs: readonly Clause[]) =>
    new Map(cs.map((c) => [c.variable, c]));
  const av = byVar(a.clauses);
  const bv = byVar(b.clauses);
  for (const [variable, bc] of bv) {
    const ac = av.get(variable);
    if (!ac) {
      parts.push(`adds the ${variable} condition (${fmtValue(bc.value)})`);
      continue;
    }
    const numeric =
      typeof ac.value === "number" || typeof bc.value === "number";
    if (fmtValue(ac.value) !== fmtValue(bc.value)) {
      parts.push(
        `${variable} ${numeric ? "threshold" : "value"} ${fmtValue(ac.value)} → ${fmtValue(bc.value)}`,
      );
    }
    if (ac.op !== bc.op) {
      parts.push(`${variable} comparison ${ac.op} → ${bc.op}`);
    }
  }
  for (const variable of av.keys()) {
    if (!bv.has(variable)) parts.push(`drops the ${variable} condition`);
  }
  if (a.tier !== b.tier) parts.push(`tier ${a.tier} → ${b.tier}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

interface Entry {
  readonly id: string;
  readonly kind: UnderwritingKind;
  readonly name: string;
  /** Kind-specific comparable facts + renderer input. */
  readonly facts: unknown;
}

function entriesOf(stages: readonly UwStageLike[]): Entry[] {
  const out: Entry[] = [];
  for (const s of stages) {
    const cfg = asObject(s.config_json);
    if (s.stage_kind === "eligibility.gate") {
      for (const rule of rulesOf(s)) {
        out.push({
          id: `rule:${rule.id}`,
          kind: "rule",
          name: rule.id,
          facts: rule,
        });
      }
    } else if (s.stage_kind === "modifier.schedule") {
      const schedule = asObject(cfg["schedule"]);
      out.push({
        id: `modifier:${s.stage_id}`,
        kind: "modifier",
        name:
          (typeof schedule["display_name"] === "string"
            ? schedule["display_name"]
            : null) ??
          s.display_name ??
          s.stage_id,
        facts: {
          cap:
            typeof schedule["total_cap_pct"] === "number"
              ? schedule["total_cap_pct"]
              : null,
          categories: Array.isArray(schedule["categories"])
            ? schedule["categories"].length
            : 0,
        },
      });
    } else if (
      s.stage_kind === "endorsement.factor" ||
      s.stage_kind === "endorsement.additive" ||
      s.stage_kind === "endorsement.sublimit" ||
      s.stage_kind === "endorsement.rate_branch"
    ) {
      out.push({
        id: `endorsement:${s.stage_id}`,
        kind: "endorsement",
        name:
          (typeof cfg["display_name"] === "string"
            ? cfg["display_name"]
            : null) ??
          s.display_name ??
          s.stage_id,
        facts: {
          factor: typeof cfg["factor"] === "number" ? cfg["factor"] : null,
          amount: typeof cfg["amount"] === "number" ? cfg["amount"] : null,
        },
      });
    } else if (s.stage_kind === "flat_factor") {
      out.push({
        id: `loading:${s.stage_id}`,
        kind: "loading",
        name: s.display_name ?? s.stage_id,
        facts: {
          factor: typeof cfg["factor"] === "number" ? cfg["factor"] : null,
        },
      });
    }
  }
  return out;
}

function diffEntry(a: Entry, b: Entry): string | null {
  if (a.kind === "rule" && b.kind === "rule") {
    return diffRule(a.facts as RuleFacts, b.facts as RuleFacts);
  }
  if (a.kind === "modifier") {
    const af = a.facts as { cap: number | null; categories: number };
    const bf = b.facts as { cap: number | null; categories: number };
    const parts: string[] = [];
    if (af.cap !== bf.cap) parts.push(`cap ±${af.cap}% → ±${bf.cap}%`);
    if (af.categories !== bf.categories) {
      parts.push(
        `${af.categories} categor${af.categories === 1 ? "y" : "ies"} → ${bf.categories}`,
      );
    }
    return parts.length > 0 ? parts.join("; ") : null;
  }
  if (a.kind === "endorsement") {
    const af = a.facts as { factor: number | null; amount: number | null };
    const bf = b.facts as { factor: number | null; amount: number | null };
    const parts: string[] = [];
    if (af.factor !== bf.factor) parts.push(`× ${af.factor} → × ${bf.factor}`);
    if (af.amount !== bf.amount) parts.push(`+ $${af.amount} → + $${bf.amount}`);
    return parts.length > 0 ? parts.join("; ") : null;
  }
  const af = a.facts as { factor: number | null };
  const bf = b.facts as { factor: number | null };
  return af.factor !== bf.factor ? `× ${af.factor} → × ${bf.factor}` : null;
}

export interface UnderwritingLedger {
  readonly rows: readonly UnderwritingRow[];
  /** Rows that count toward the rail's "What changed" number. */
  readonly changedCount: number;
}

export function underwritingLedger(
  aStages: readonly UwStageLike[],
  bStages: readonly UwStageLike[],
): UnderwritingLedger {
  const a = entriesOf(aStages);
  const b = entriesOf(bStages);
  const aById = new Map(a.map((e) => [e.id, e]));
  const bById = new Map(b.map((e) => [e.id, e]));
  const rows: UnderwritingRow[] = [];
  for (const entry of a) {
    const other = bById.get(entry.id);
    if (!other) {
      rows.push({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        status: "retired",
        change: null,
      });
      continue;
    }
    const change = diffEntry(entry, other);
    rows.push({
      id: entry.id,
      kind: entry.kind,
      name: other.name,
      status: change === null ? "same" : "changed",
      change,
    });
  }
  for (const entry of b) {
    if (!aById.has(entry.id)) {
      rows.push({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        status: "new",
        change: null,
      });
    }
  }
  const changedCount = rows.filter((r) => r.status !== "same").length;
  return { rows, changedCount };
}
