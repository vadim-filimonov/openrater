/**
 * <AppetiteStatement> — Brief 70 §3 (Eligibility's whole surface).
 *
 * The section IS one readable document: the plan's appetite as
 * numbered English sentences. Reading requires zero clicks — the CEO
 * cold-test happens on the landing render. Anatomy:
 *
 *   Eligibility                                    [save pill]
 *   The rules that decide what this plan writes, refers, or declines.
 *   Rules are checked top to bottom — the first match decides.
 *   This plan writes everything as Standard, except:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 1. [Decline]  when Protection class is one of 9, 10      │
 *   │ 2. [Refer]    when Building Age is more than 60          │
 *   │ ── FOR THE POLICY AS A WHOLE ──                          │
 *   │ 1. [Decline]  when total insured value is at least $1M   │
 *   │ Everything else → [Standard]                             │
 *   └──────────────────────────────────────────────────────────┘
 *   + Add rule
 *
 * Rules are <OrderedSheet> rows (drag + Alt+Arrow reorder = one
 * config patch); the composer is a <StatementComposer> sentence
 * (ONE condition — ADR-0050; gatesSync hard-blocks multi-condition);
 * deletes arm <ImpactDeletePrompt> with OUTCOME language. Pure
 * presentation — the route owns persistence.
 */

import { useMemo, useState, type JSX } from "react";
import { ClipboardCopy, Plus, X } from "lucide-react";
import { Button } from "@openrater/design-system";
import type { EligibilityTier } from "@openrater/contracts";
import { TierVerdictChip } from "../TierVerdictChip";
import { SavePill } from "../SavePill/SavePill";
import { OrderedSheet } from "../OrderedSheet";
import {
  StatementComposer,
  type ComposerOption,
  type ComposerSlot,
} from "../StatementComposer";
import { ImpactDeletePrompt } from "../ImpactDeletePrompt";
import {
  NUMERIC_OPS,
  STRING_OPS,
  fmtAppetiteValue,
  isNumericDtype,
  opPhrase,
} from "./appetitePhrases";
import "./AppetiteStatement.css";

/** One clause of a rule, in display form (Brief 81). */
export interface AppetiteConditionView {
  readonly variable: string;
  readonly op: string;
  readonly value: string;
}

export interface AppetiteRuleView {
  readonly id: string;
  readonly tier: EligibilityTier;
  /** First-clause mirror — always equals `conditions[0]`. */
  readonly variable: string;
  readonly op: string;
  readonly value: string;
  /** Brief 81 — ALL clauses (length ≥ 1, implicit AND). */
  readonly conditions: readonly AppetiteConditionView[];
  readonly reasoning: string;
  readonly citation: string;
}

export interface AppetiteFieldOption {
  readonly id: string;
  readonly label?: string;
  /** "number" enables the numeric comparator phrases. */
  readonly dtype?: string;
  readonly group: "Inputs" | "Dimensions" | "Policy totals";
  /**
   * Brief 89.3 follow-up — the AUTHORED levels when this field maps to
   * a dimension (`gateValueLevels`: the raw value space the gate
   * compares at runtime). Present + non-empty → the composer's value
   * seat offers these as picker options instead of free text, and a
   * committed value outside the list draws the never-matches warning.
   */
  readonly levels?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }>;
}

export interface AppetiteStatementProps {
  readonly rowRules: readonly AppetiteRuleView[];
  readonly policyRules: readonly AppetiteRuleView[];
  readonly defaultTier: EligibilityTier;
  /** Per-location field options (inputs + dimensions). */
  readonly rowFields: readonly AppetiteFieldOption[];
  /** Policy-total field options (ADR-0046 aggregate names). */
  readonly policyFields: readonly AppetiteFieldOption[];
  /**
   * False = the legacy multi-stage shape: the list is the HONEST
   * most-restrictive projection, editing is withheld, and the
   * consolidation moment is offered instead.
   */
  readonly consolidated: boolean;
  readonly onConsolidate?: () => void;
  readonly onAddRule?: (
    scope: "row" | "policy",
    rule: Omit<AppetiteRuleView, "id">,
  ) => void;
  readonly onUpdateRule?: (
    scope: "row" | "policy",
    id: string,
    rule: Omit<AppetiteRuleView, "id">,
  ) => void;
  readonly onDeleteRule?: (scope: "row" | "policy", id: string) => void;
  readonly onReorder?: (
    scope: "row" | "policy",
    orderedIds: readonly string[],
  ) => void;
  readonly onDefaultTierChange?: (tier: EligibilityTier) => void;
  readonly saveState?: "saving" | "saved" | "error";
  readonly readOnly?: boolean;
  readonly testId?: string;
}

const TIER_LABEL: Record<EligibilityTier, string> = {
  decline: "Decline",
  submit: "Refer",
  standard: "Standard",
  preferred: "Preferred",
};

const TIER_DESCRIPTION: Record<EligibilityTier, string> = {
  decline: "The risk is not written.",
  submit: "Manual underwriter review before binding.",
  standard: "Written at standard terms.",
  preferred: "Written at preferred terms.",
};

// The rule grammar (op tables + phrasing + value formatting) lives in
// appetitePhrases.ts — shared with the plan report's gates section
// (Brief 93 §1.1.6) so every surface speaks a rule identically.
const fmtValue = fmtAppetiteValue;

/** One editable clause in the composer (Brief 81). */
interface ComposerClause {
  readonly field: string;
  readonly op: string;
  readonly value: string;
}

interface ComposerState {
  readonly scope: "row" | "policy";
  /** null = adding; an id = editing that rule in place. */
  readonly editingId: string | null;
  readonly tier: EligibilityTier;
  /** Brief 81 D-D — clauses (length ≥ 1, implicit AND). */
  readonly clauses: readonly ComposerClause[];
}

export function AppetiteStatement(props: AppetiteStatementProps): JSX.Element {
  const {
    rowRules,
    policyRules,
    defaultTier,
    rowFields,
    policyFields,
    consolidated,
    onConsolidate,
    onAddRule,
    onUpdateRule,
    onDeleteRule,
    onReorder,
    onDefaultTierChange,
    saveState,
    readOnly = false,
    testId = "rater-appetite",
  } = props;
  const writable = !readOnly && consolidated;
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [deleting, setDeleting] = useState<{
    scope: "row" | "policy";
    rule: AppetiteRuleView;
  } | null>(null);
  const [tierSeatOpen, setTierSeatOpen] = useState(false);

  const fieldsFor = (scope: "row" | "policy") =>
    scope === "policy" ? policyFields : rowFields;
  const fieldMeta = (scope: "row" | "policy", id: string) =>
    fieldsFor(scope).find((f) => f.id === id);

  const sentence = (
    scope: "row" | "policy",
    rule: AppetiteRuleView,
  ): JSX.Element => {
    // Brief 81 D-D — a compound rule reads as ONE sentence, its
    // clauses joined by "and"; each clause phrases + formats by its
    // OWN field's dtype.
    const clauses =
      rule.conditions.length > 0
        ? rule.conditions
        : [{ variable: rule.variable, op: rule.op, value: rule.value }];
    return (
      <span className="rater-appetite__sent">
        when{" "}
        {clauses.map((c, i) => {
          const meta = fieldMeta(scope, c.variable);
          const numeric = isNumericDtype(meta?.dtype);
          return (
            <span key={`${c.variable}_${i}`}>
              {i > 0 ? <> and </> : null}
              <b>{meta?.label || c.variable}</b> {opPhrase(c.op, numeric)}{" "}
              <span className="rater-appetite__val">
                {fmtValue(c.value, meta?.dtype)}
              </span>
            </span>
          );
        })}
      </span>
    );
  };

  const openComposer = (scope: "row" | "policy", rule?: AppetiteRuleView) => {
    const clauses: readonly ComposerClause[] =
      rule && rule.conditions.length > 0
        ? rule.conditions.map((c) => ({
            field: c.variable,
            op: c.op,
            value: c.value,
          }))
        : [
            {
              field: rule?.variable ?? "",
              op: rule?.op ?? "",
              value: rule?.value ?? "",
            },
          ];
    setComposer({
      scope,
      editingId: rule?.id ?? null,
      tier: rule?.tier ?? "decline",
      clauses,
    });
  };

  /** A clause's effective op — the authored one, else the dtype default. */
  const clauseOp = (scope: "row" | "policy", c: ComposerClause): string => {
    if (c.op !== "") return c.op;
    const numeric = isNumericDtype(fieldMeta(scope, c.field)?.dtype);
    return numeric ? "ge" : "eq";
  };

  const commitComposer = () => {
    if (!composer) return;
    // Every clause must be complete (Brief 81 D-D — the doctrine: no
    // half-authored clause reaches the save path).
    if (composer.clauses.some((c) => c.field === "" || c.value.trim() === "")) {
      return;
    }
    const conditions = composer.clauses.map((c) => ({
      variable: c.field,
      op: clauseOp(composer.scope, c),
      value: c.value.trim(),
    }));
    const first = conditions[0]!;
    const payload = {
      tier: composer.tier,
      variable: first.variable,
      op: first.op,
      value: first.value,
      conditions,
      reasoning: "",
      citation: "",
    };
    if (composer.editingId !== null) {
      onUpdateRule?.(composer.scope, composer.editingId, payload);
    } else {
      onAddRule?.(composer.scope, payload);
    }
    setComposer(null);
  };

  // Brief 81 D-D — one slot triple per clause (`field_i` / `op_i` /
  // `value_i`), each clause dtype-phrased by its OWN field.
  const composerSlots = useMemo<readonly ComposerSlot[]>(() => {
    if (!composer) return [];
    const fields = fieldsFor(composer.scope);
    const groups: AppetiteFieldOption["group"][] = [
      "Inputs",
      "Dimensions",
      "Policy totals",
    ];
    // Dedupe by field id — a field that is BOTH a declared input and a
    // dimension (territory, wind_hail_pct, …) appeared twice, and the
    // picker keys options by value (React duplicate-key warning; both
    // rows committed the same id anyway). First group wins (Inputs).
    const seenFieldIds = new Set<string>();
    const fieldOptions: ComposerOption[] = groups.flatMap((g) =>
      fields
        .filter((f) => f.group === g)
        .filter((f) => {
          if (seenFieldIds.has(f.id)) return false;
          seenFieldIds.add(f.id);
          return true;
        })
        .map((f) => ({
          value: f.id,
          label: f.label || f.id,
          hint: `${f.id}${f.dtype ? ` · ${f.dtype}` : ""}`,
        })),
    );
    const clauseSlots: ComposerSlot[] = composer.clauses.flatMap((c, i) => {
      const meta = fieldMeta(composer.scope, c.field);
      const numeric = isNumericDtype(meta?.dtype);
      const ops = numeric ? NUMERIC_OPS : STRING_OPS;
      // Brief 89.3 follow-up — a dimension-backed field's value seat
      // offers the AUTHORED levels (the only values the gate can ever
      // match) instead of free text; the seat echoes labels, not ids.
      const levels = meta?.levels ?? [];
      const levelLabel = new Map(levels.map((l) => [l.id, l.label]));
      const valueDisplay = c.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map((e) => levelLabel.get(e) ?? e)
        .join(", ");
      return [
        {
          id: `field_${i}`,
          kind: "field" as const,
          value: c.field,
          placeholder: "choose a field…",
          options: fieldOptions,
        },
        {
          id: `op_${i}`,
          kind: "operator" as const,
          value: c.op || (numeric ? "ge" : "eq"),
          placeholder: "comparison",
          options: ops.map(([o, phrase]) => ({ value: o, label: phrase })),
        },
        {
          id: `value_${i}`,
          kind: "value" as const,
          value: c.value,
          placeholder: levels.length > 0 ? "choose a value…" : "value",
          dtype: numeric ? ("number" as const) : ("text" as const),
          ...(levels.length > 0
            ? {
                options: levels.map((l) => ({
                  value: l.id,
                  label: l.label,
                  ...(l.id !== l.label ? { hint: l.id } : {}),
                })),
                freeTextHint: "matches no authored level",
                ...(c.value !== "" ? { display: valueDisplay } : {}),
              }
            : {}),
        },
      ];
    });
    return [
      {
        id: "tier",
        kind: "tier",
        value: composer.tier,
        placeholder: "verdict",
        display: <TierVerdictChip tier={composer.tier} />,
        options: (["decline", "submit", "standard", "preferred"] as const).map(
          (t) => ({
            value: t,
            label: TIER_LABEL[t],
            hint: TIER_DESCRIPTION[t],
          }),
        ),
      },
      ...clauseSlots,
      {
        id: "scope",
        kind: "operator",
        value: composer.scope,
        placeholder: "scope",
        options: [
          { value: "row", label: "each location" },
          { value: "policy", label: "the policy as a whole" },
        ],
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer, rowFields, policyFields]);

  const composerTemplate = useMemo<readonly string[]>(() => {
    if (!composer) return [];
    const clauseTokens = composer.clauses.flatMap((_, i) => [
      ...(i > 0 ? ["and"] : []),
      `$field_${i}`,
      `$op_${i}`,
      `$value_${i}`,
    ]);
    return ["$tier", "when", ...clauseTokens, "— at", "$scope"];
  }, [composer]);

  const setClause = (i: number, patch: Partial<ComposerClause>) => {
    if (!composer) return;
    setComposer({
      ...composer,
      clauses: composer.clauses.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    });
  };

  const handleSlotCommit = (slotId: string, value: string) => {
    if (!composer) return;
    if (slotId === "tier") {
      setComposer({ ...composer, tier: value as EligibilityTier });
      return;
    }
    if (slotId === "scope") {
      // Re-homing the rule resets the clauses (the sources differ).
      setComposer({
        ...composer,
        scope: value as "row" | "policy",
        clauses: [{ field: "", op: "", value: "" }],
      });
      return;
    }
    const m = slotId.match(/^(field|op|value)_(\d+)$/);
    if (!m) return;
    const i = Number(m[2]);
    if (m[1] === "field") {
      // A new field resets the clause's op (its dtype may differ).
      setClause(i, { field: value, op: "" });
    } else if (m[1] === "op") {
      setClause(i, { op: value });
    } else {
      // Brief 89.3 follow-up — a level pick under "is one of" / "is
      // not one of" TOGGLES membership in the comma list (the value is
      // a set; re-open the seat to add or remove the next entry).
      // Everything else — single-comparator picks, free text, non-dim
      // fields — replaces wholesale.
      const clause = composer.clauses[i];
      const op = clause ? clauseOp(composer.scope, clause) : "eq";
      const hasLevels =
        (fieldMeta(composer.scope, clause?.field ?? "")?.levels?.length ?? 0) >
        0;
      if (clause && hasLevels && (op === "in" || op === "nin")) {
        const parts = clause.value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
        const next = parts.includes(value)
          ? parts.filter((p) => p !== value)
          : [...parts, value];
        setClause(i, { value: next.join(", ") });
      } else {
        setClause(i, { value });
      }
    }
  };

  // The F18 mis-scope nudge: a row-scope rule reading a field that
  // rolls up (TIV-shaped) probably means the policy total.
  const nudge =
    composer !== null &&
    composer.scope === "row" &&
    composer.clauses.some((c) =>
      /tiv|total_insured|total insured/i.test(c.field),
    ) &&
    policyFields.some((f) => /tiv/i.test(f.id));

  // The cold-start honesty note (the F18 sibling): policy scope on a
  // plan whose roll-up sums nothing yet offers only the built-in
  // location count — say WHY and where totals come from, instead of
  // presenting a near-empty picker as a dead end.
  const policyFieldsThin =
    composer !== null &&
    composer.scope === "policy" &&
    policyFields.filter((f) => f.id !== "location_count").length === 0;

  // Brief 89.3 follow-up — the silent-no-match trap: a value typed (or
  // carried in from an older rule) against a dimension-backed field
  // that matches no authored level can never fire — the gate compares
  // raw level ids. Say so while the rule is still open, per clause.
  const levelMismatches =
    composer === null
      ? []
      : composer.clauses.flatMap((c) => {
          const meta = fieldMeta(composer.scope, c.field);
          const levels = meta?.levels ?? [];
          if (levels.length === 0 || c.value.trim() === "") return [];
          const op = clauseOp(composer.scope, c);
          const entries =
            op === "in" || op === "nin"
              ? c.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s !== "")
              : [c.value.trim()];
          const ids = new Set(levels.map((l) => l.id));
          const unmatched = entries.filter((e) => !ids.has(e));
          return unmatched.length > 0
            ? [{ field: meta?.label || c.field, unmatched }]
            : [];
        });

  const composerBlock =
    composer !== null ? (
      <div
        className="rater-appetite__composer"
        data-testid={`${testId}-composer`}
      >
        <StatementComposer
          template={composerTemplate}
          slots={composerSlots}
          onSlotCommit={handleSlotCommit}
          testId={`${testId}-composer-slots`}
        />
        {/* Brief 81 D-D — clause chrome: "+ and" appends; each clause
            beyond the first can be removed individually. Design-system
            <Button> per the v2 button rule (check-v2-buttons). */}
        <div className="rater-appetite__clauses">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            icon={<Plus size={12} strokeWidth={2} aria-hidden />}
            onClick={() =>
              setComposer({
                ...composer,
                clauses: [
                  ...composer.clauses,
                  { field: "", op: "", value: "" },
                ],
              })
            }
            data-testid={`${testId}-add-clause`}
          >
            and
          </Button>
          {composer.clauses.length > 1
            ? composer.clauses.slice(1).map((c, i) => (
                <Button
                  key={`rm_${i + 1}`}
                  type="button"
                  variant="ghost"
                  size="xs"
                  icon={<X size={11} strokeWidth={2} aria-hidden />}
                  onClick={() =>
                    setComposer({
                      ...composer,
                      clauses: composer.clauses.filter(
                        (_, idx) => idx !== i + 1,
                      ),
                    })
                  }
                  aria-label={`Remove the "and ${c.field || "…"}" clause`}
                  data-testid={`${testId}-remove-clause-${i + 1}`}
                >
                  and {c.field || "…"}
                </Button>
              ))
            : null}
        </div>
        {nudge ? (
          <p className="rater-appetite__nudge" data-testid={`${testId}-nudge`}>
            This field adds up across locations — did you mean the policy as a
            whole?{" "}
            <button
              type="button"
              className="rater-appetite__nudge-fix"
              onClick={() =>
                setComposer({
                  ...composer,
                  scope: "policy",
                  clauses: [
                    {
                      field:
                        policyFields.find((f) => /tiv/i.test(f.id))?.id ?? "",
                      op: "",
                      value: composer.clauses[0]?.value ?? "",
                    },
                  ],
                })
              }
              data-testid={`${testId}-nudge-fix`}
            >
              Check the policy total instead
            </button>
          </p>
        ) : null}
        {policyFieldsThin ? (
          <p
            className="rater-appetite__nudge"
            data-testid={`${testId}-policy-thin`}
          >
            {/* F04 — name the prerequisite. The composer used to say totals
                "appear here" without saying HOW, so the canonical policy-TIV
                rule was unauthorable for anyone who didn't know to enable
                grouping first. */}
            Only the location count rolls up so far. To compare a policy total
            like TIV, open the <strong>Inputs</strong> tab, load a
            multi-location book, and choose <strong>Group by policy</strong> —
            its rolled fields (Σ TIV) then appear here.
          </p>
        ) : null}
        {levelMismatches.length > 0 ? (
          <p
            className="rater-appetite__nudge"
            data-testid={`${testId}-level-warn`}
          >
            {levelMismatches.map((mm, idx) => (
              <span key={`${mm.field}_${idx}`}>
                {mm.unmatched.map((u) => `“${u}”`).join(", ")}{" "}
                {mm.unmatched.length > 1
                  ? "aren't authored levels"
                  : "isn't an authored level"}{" "}
                of <strong>{mm.field}</strong> — this rule would never
                match.{" "}
              </span>
            ))}
            Pick from the value menu.
          </p>
        ) : null}
        <div className="rater-appetite__composer-foot">
          <Button variant="ghost" size="sm" onClick={() => setComposer(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={composer.clauses.some(
              (c) => c.field === "" || c.value.trim() === "",
            )}
            onClick={commitComposer}
            data-testid={`${testId}-composer-commit`}
          >
            {composer.editingId !== null ? "Save rule" : "Add rule"}
          </Button>
        </div>
      </div>
    ) : null;

  const chapter = (
    scope: "row" | "policy",
    rules: readonly AppetiteRuleView[],
  ): JSX.Element | null => {
    const showHead = policyRules.length > 0;
    if (scope === "policy" && rules.length === 0) return null;
    return (
      <div className="rater-appetite__chapter">
        {showHead ? (
          <div className="rater-appetite__chapter-head">
            {scope === "row" ? "At each location" : "For the policy as a whole"}
          </div>
        ) : null}
        <OrderedSheet
          rows={rules.map((r) => ({ ...r }))}
          ariaLabel={scope === "row" ? "Location rules" : "Policy rules"}
          readOnly={!writable}
          {...(writable && onReorder
            ? { onReorder: (ids: readonly string[]) => onReorder(scope, ids) }
            : {})}
          {...(writable
            ? {
                onRowClick: (r: AppetiteRuleView) => openComposer(scope, r),
              }
            : {})}
          renderRow={(r: AppetiteRuleView) =>
            composer?.editingId === r.id ? (
              <span className="rater-appetite__editing-note">
                editing below…
              </span>
            ) : (
              <span className="rater-appetite__rule">
                <TierVerdictChip tier={r.tier} />
                {sentence(scope, r)}
                {r.citation ? (
                  <span
                    className="rater-appetite__cite"
                    title={r.citation}
                    aria-label={`Citation: ${r.citation}`}
                  >
                    §
                  </span>
                ) : null}
              </span>
            )
          }
          {...(writable && onDeleteRule
            ? {
                rowActions: (r: AppetiteRuleView) => (
                  <Button
                    variant="danger-text"
                    size="xs"
                    onClick={() => setDeleting({ scope, rule: r })}
                    data-testid={`${testId}-delete-${r.id}`}
                  >
                    Remove
                  </Button>
                ),
              }
            : {})}
          testId={`${testId}-${scope}`}
        />
        {scope === "policy" ? (
          <p className="rater-appetite__crossnote">
            Location and policy checks run separately — the stricter outcome
            stands.
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <section
      className="rater-appetite"
      aria-label="Eligibility"
      data-testid={testId}
    >
      <header className="rater-appetite__head">
        <div>
          <h2 className="rater-appetite__title">Eligibility</h2>
          <p className="rater-appetite__def">
            The rules that decide what this plan writes, refers, or declines.
          </p>
        </div>
        <span className="rater-appetite__grow" />
        {saveState && !readOnly ? (
          <SavePill
            state={saveState}
            testId={`${testId}-savepill`}
            className="rater-appetite__savepill"
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon={<ClipboardCopy size={13} aria-hidden />}
          onClick={() => {
            // Brief 81 — the text export reads a compound rule's
            // clauses joined by "and", same as the on-screen sentence.
            const ruleText = (
              scope: "row" | "policy",
              r: AppetiteRuleView,
            ): string => {
              const clauses =
                r.conditions.length > 0
                  ? r.conditions
                  : [{ variable: r.variable, op: r.op, value: r.value }];
              return clauses
                .map((c) => {
                  const meta = fieldMeta(scope, c.variable);
                  const numeric =
                    scope === "policy" || isNumericDtype(meta?.dtype);
                  return `${meta?.label || c.variable} ${opPhrase(c.op, numeric)} ${fmtValue(c.value, scope === "policy" ? "number" : meta?.dtype)}`;
                })
                .join(" and ");
            };
            const lines = [
              `This plan writes everything as ${TIER_LABEL[defaultTier]}, except:`,
              ...rowRules.map(
                (r, i) =>
                  `${i + 1}. ${TIER_LABEL[r.tier]} when ${ruleText("row", r)}`,
              ),
              ...(policyRules.length > 0
                ? [
                    "For the policy as a whole:",
                    ...policyRules.map(
                      (r, i) =>
                        `${i + 1}. ${TIER_LABEL[r.tier]} when ${ruleText("policy", r)}`,
                    ),
                  ]
                : []),
            ];
            void navigator.clipboard?.writeText(lines.join("\n"));
          }}
          data-testid={`${testId}-copy`}
        >
          Copy as text
        </Button>
      </header>

      <p className="rater-appetite__doctrine">
        {consolidated
          ? "Rules are checked top to bottom — the first match decides."
          : "These rules were authored separately — the strictest match decides."}
      </p>

      {!consolidated && onConsolidate && !readOnly ? (
        <div
          className="rater-appetite__migrate"
          data-testid={`${testId}-migrate`}
        >
          To edit and reorder here, the rules consolidate into one ordered list
          (strictest first — every verdict stays the same). Order becomes yours
          to change from then on.
          <Button
            variant="ghost"
            size="sm"
            onClick={onConsolidate}
            data-testid={`${testId}-migrate-go`}
          >
            Consolidate rules
          </Button>
        </div>
      ) : null}

      <p className="rater-appetite__lede">
        This plan writes everything as <b>{TIER_LABEL[defaultTier]}</b>
        {rowRules.length + policyRules.length > 0 ? ", except:" : "."}
      </p>

      <div className="rater-appetite__panel">
        {rowRules.length + policyRules.length === 0 ? (
          <p className="rater-appetite__empty" data-testid={`${testId}-empty`}>
            No rules yet — the appetite reads as: everything →{" "}
            {TIER_LABEL[defaultTier]}.
          </p>
        ) : (
          <>
            {chapter("row", rowRules)}
            {chapter("policy", policyRules)}
          </>
        )}
        <div className="rater-appetite__closing">
          Everything else →{" "}
          <span className="rater-appetite__seat">
            {writable && onDefaultTierChange ? (
              <button
                type="button"
                className="rater-appetite__seat-btn"
                onClick={() => setTierSeatOpen((o) => !o)}
                data-testid={`${testId}-default-seat`}
              >
                <TierVerdictChip tier={defaultTier} />
              </button>
            ) : (
              <TierVerdictChip tier={defaultTier} />
            )}
            {tierSeatOpen ? (
              <div
                className="rater-appetite__seat-pop"
                data-testid={`${testId}-seat-pop`}
              >
                {(["preferred", "standard", "submit", "decline"] as const).map(
                  (t) => (
                    <button
                      key={t}
                      type="button"
                      className="rater-appetite__seat-opt"
                      onClick={() => {
                        setTierSeatOpen(false);
                        onDefaultTierChange?.(t);
                      }}
                      data-testid={`${testId}-seat-${t}`}
                    >
                      <TierVerdictChip tier={t} />
                      <span className="rater-appetite__seat-desc">
                        {TIER_DESCRIPTION[t]}
                      </span>
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </span>
        </div>
        {composer !== null ? composerBlock : null}
      </div>

      {writable && composer === null ? (
        <Button
          variant="plain"
          size="sm"
          icon={<Plus size={14} aria-hidden />}
          onClick={() => openComposer("row")}
          className="rater-appetite__add"
          data-testid={`${testId}-add`}
        >
          Add rule
        </Button>
      ) : null}

      <ImpactDeletePrompt
        open={deleting !== null}
        artifactName={
          deleting
            ? `${TIER_LABEL[deleting.rule.tier]} when ${(deleting.rule
                .conditions.length > 0
                ? deleting.rule.conditions
                : [
                    {
                      variable: deleting.rule.variable,
                      op: deleting.rule.op,
                      value: deleting.rule.value,
                    },
                  ]
              )
                .map((c) => {
                  const meta = fieldMeta(deleting.scope, c.variable);
                  return `${meta?.label || c.variable} ${opPhrase(c.op, isNumericDtype(meta?.dtype))} ${fmtValue(c.value, meta?.dtype)}`;
                })
                .join(" and ")}`
            : ""
        }
        artifactKind="rule"
        lossStatement={
          deleting ? (
            <>
              Risks matching this rule will no longer{" "}
              {deleting.rule.tier === "decline"
                ? "be declined"
                : deleting.rule.tier === "submit"
                  ? "require review"
                  : `write as ${TIER_LABEL[deleting.rule.tier]}`}
              ; they fall through to the rules below it (or the default).
            </>
          ) : (
            ""
          )
        }
        onConfirm={() => {
          if (deleting) onDeleteRule?.(deleting.scope, deleting.rule.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
        testId={`${testId}-delete-prompt`}
      />
    </section>
  );
}
